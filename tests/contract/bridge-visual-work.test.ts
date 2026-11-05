import {createServer} from "node:net";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {afterEach,describe,it,expect,vi} from "vitest";
import {WebSocket} from "ws";
import {freshTestDirectory} from "../helpers/workspace.js";
const native=vi.hoisted(()=>({panel:vi.fn(async()=>({status:"unverified",dispatchAccepted:true})),frame:vi.fn(async()=>({status:"pass"})),selection:vi.fn(async()=>({status:"pass"})),visual:vi.fn(async()=>({status:"unverified",dispatchAccepted:true}))}));
vi.mock("../../apps/mcp-server/src/native-visual-bridge.js",()=>({requestNativeVisual:native.visual}));
vi.mock("../../apps/mcp-server/src/native-panel-bridge.js",()=>({focusNativePanel:native.panel}));
vi.mock("../../apps/mcp-server/src/program-frame-artifact.js",()=>({waitForProgramFrame:native.frame}));
vi.mock("../../apps/mcp-server/src/project-selection-bridge.js",()=>({selectNativeProjectItem:native.selection}));
import {UxpBridgeServer} from "../../apps/mcp-server/src/bridge.js";
const bridges:UxpBridgeServer[]=[];
const socketTargets=new WeakMap<WebSocket,{projectPath:string;projectId:string;sequenceId:string;sequenceName:string}>();
const mask=vi.hoisted(()=>({read:vi.fn(async()=>({masks:[{name:"01",nativeType:4}]}))}));
const disclosure=vi.hoisted(()=>vi.fn(async()=>({status:"pass",available:true,layoutVerified:true,empty:true})));
const chainProof=vi.hoisted(()=>vi.fn(async()=>({status:'pass',components:[]})));
const nativeSample=vi.hoisted(()=>vi.fn(async()=>({status:'pass'})));
vi.mock('../../apps/mcp-server/src/effect-native-sample.js',async original=>({...await original<Record<string,unknown>>(),requestEffectNativeSample:nativeSample}));
vi.mock('../../apps/mcp-server/src/effect-chain-proof.js',async original=>({...await original<Record<string,unknown>>(),requestEffectChainProof:chainProof}));
vi.mock("../../apps/mcp-server/src/mask-tracking-bridge.js",async original=>({...await original<Record<string,unknown>>(),readMaskTrackingArchive:mask.read}));
vi.mock("../../apps/mcp-server/src/effect-disclosure-bridge.js",async original=>({...await original<Record<string,unknown>>(),requestEffectDisclosure:disclosure}));
afterEach(async()=>{await Promise.all(bridges.splice(0).map(b=>b.stop()));vi.clearAllMocks();});
async function fixture(name:string){
  const net=createServer();await new Promise<void>(r=>net.listen(0,"127.0.0.1",r));const port=(net.address() as any).port;await new Promise<void>(r=>net.close(()=>r()));
  const dir=await freshTestDirectory(name),token=path.join(dir,"token");
  const bridge=new UxpBridgeServer("127.0.0.1",port,token,path.join(dir,"credentials.json"));bridges.push(bridge);await bridge.start();
  const connect=async()=>{
    const socket=new WebSocket(`ws://127.0.0.1:${port}`);await new Promise<void>(r=>socket.once("open",r));
    const authenticated=new Promise<any>(r=>socket.once("message",d=>r(JSON.parse(d.toString()))));
    socket.send(JSON.stringify({version:1,type:"authenticate",method:"pairing_token",token:await readFile(token,"utf8"),projectId:"p",client:"premiere-uxp-panel"}));
    const projectPath=path.join(dir,"fixture.prproj");await writeFile(projectPath,"fixture");socketTargets.set(socket,{projectPath,projectId:"p",sequenceId:"s",sequenceName:"WORKING__test"});
    const protocols = await authenticated;
    expect(protocols).toMatchObject({projectSelectionProtocol:1});
    if (process.platform === 'win32') expect(protocols).toMatchObject({nativePanelProtocol:1,effectNativeTimeProtocol:2});
    else { expect(protocols.nativePanelProtocol).toBeUndefined(); expect(protocols.effectNativeTimeProtocol).toBeUndefined(); }
    return socket;
  };
  return {bridge,socket:await connect(),connect};
}
const send=(socket:WebSocket,message:any)=>socket.send(JSON.stringify({...message,...(["native_effect_sample","native_effect_chain_proof","native_mask_archive","mask_tracking","effect_disclosure","project_selection"].includes(message.type)?{editTarget:socketTargets.get(socket)}:{})}));
const done=(socket:WebSocket,id:string)=>send(socket,{version:1,id,ok:true,result:{status:"pass"},durationMs:0});
describe("parent-bound native visual work protocol",()=>{
  it('allows one exact scroll continuation after native progress, never an unbounded loop',async()=>{
    const {bridge,socket}=await fixture('parameter-scroll-continuation');
    const work={trackItemId:'video:0:0:source',sequenceName:'WORKING__test',componentMatchNames:['fx'],target:{mediaType:'video',trackIndex:0,startTicks:'0',endTicks:'2540160000000',clipName:'clip',mediaPath:'C:\\clip.mov',componentMatchName:'fx',componentIndex:0}};
    const parameter={paramIndex:4,name:'Curve',expanded:true,disclosureKey:'ECP.Custom.Expanded'};
    const budget:any={readback:{status:'unverified',route:'windows_msaa_parameter_state',reason:'PARAMETER_SCROLL_BUDGET',dispatchAccepted:true,progress:{steps:6,targetState:8,targetTop:380,viewportTop:100,viewportHeight:300}}};
    disclosure.mockResolvedValueOnce({status:'pass',available:true,layoutVerified:true,empty:true}).mockResolvedValueOnce({status:'pass',available:true,layoutVerified:true,empty:true}).mockResolvedValueOnce(budget).mockResolvedValueOnce(budget);
    const callback=(phase:string,id=phase)=>({version:1,type:'effect_disclosure',id,parentId:'p',phase,work:phase==='inspect'?work:{...work,parameter}});
    socket.on('message',raw=>{const r=JSON.parse(raw.toString());if(r.command)send(socket,callback('inspect'));
      else if(r.id==='inspect')send(socket,callback('parameter_inspect'));
      else if(r.id==='parameter_inspect')send(socket,callback('parameter_scroll'));
      else if(r.id==='parameter_scroll'){send(socket,{...callback('parameter_scroll','orphan'),parentId:'other'});send(socket,callback('parameter_scroll','continue'));}
      else if(r.id==='continue'){send(socket,callback('parameter_scroll','excess'));done(socket,'p');}
    });
    await bridge.call({version:1,id:'p',command:'get_effect_values',args:{expectedSequenceName:work.sequenceName,expectedMediaType:'video',expectedClipName:'clip',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:10,componentIndex:0,componentMatchName:'fx',paramIndex:4,expectedDisplayName:'Curve'},timeoutMs:2000});
    expect(disclosure.mock.calls.map(c=>(c as unknown[])[0])).toEqual(['inspect','parameter_inspect','parameter_scroll','parameter_scroll']);socket.close();
  });
  it('accepts reverse time proof only for the exact requested key times before a parent edit',async()=>{
    const {bridge,socket}=await fixture('reverse-time-callback');
    const work={purpose:'time_mapping',reversed:true,sampleTimes:['127008000000'],projectId:'p',sequenceId:'s',sequenceName:'WORKING__test',trackItemId:'video:0:0:source',projectItemId:'source',clipName:'clip',mediaType:'video',trackIndex:0,startTicks:'0',endTicks:'254016000000',inTicks:'0',outTicks:'254016000000',sequenceTicks:'0',nativeTicks:'0',mediaPath:'C:\\clip.mp4',componentMatchNames:['Tint'],components:[{componentIndex:0,componentMatchName:'Tint',parameterNames:['Black']}],componentIndex:0,componentMatchName:'Tint',paramIndex:0,parameterCount:1};
    socket.on('message',raw=>{const r=JSON.parse(raw.toString());if(r.command){
      const callback={version:1,type:'native_effect_sample',id:'map',parentId:r.id,work};
      send(socket,{...callback,parentId:'orphan'});send(socket,{...callback,work:{...work,sampleTimes:['0']}});send(socket,{...callback,work:{...work,reversed:'false'}});send(socket,callback);
    }else if(r.type==='native_visibility_result')done(socket,'edit');});
    await bridge.call({version:1,id:'edit',command:'set_effect_keyframes',args:{expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:work.sequenceName,trackItemId:work.trackItemId,expectedProjectItemId:'source',expectedClipName:'clip',expectedMediaType:'video',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:1,componentIndex:0,keyframes:[{timeTicks:'127008000000'}]},timeoutMs:2000});
    expect(nativeSample).toHaveBeenCalledExactlyOnceWith(work);socket.close();
  });
  it('rejects orphan, unscoped and concurrent SDK sample callbacks before native dispatch',async()=>{
    const {bridge,socket}=await fixture('native-color-callback');
    let release!:(value:{status:string})=>void;nativeSample.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const work={projectId:'p',sequenceId:'s',sequenceName:'WORKING__test',trackItemId:'video:0:0:source',projectItemId:'source',clipName:'clip',mediaType:'video',trackIndex:0,startTicks:'0',endTicks:'254016000000',inTicks:'0',outTicks:'254016000000',sequenceTicks:'127008000000',nativeTicks:'127008000000',mediaPath:'C:\\clip.mp4',componentMatchNames:['Tint'],components:[{componentIndex:0,componentMatchName:'Tint',parameterNames:['Black']}],componentIndex:0,componentMatchName:'Tint',paramIndex:0,parameterCount:1};
    socket.on('message',raw=>{const r=JSON.parse(raw.toString());if(r.command){
      const message={version:1,type:'native_effect_sample',id:'sample',parentId:r.id,work};
      send(socket,{...message,parentId:'orphan'});send(socket,{...message,work:{...work,script:'code'}});send(socket,{...message,work:{...work,sequenceTicks:'0'}});send(socket,{...message,work:{...work,projectItemId:'other'}});send(socket,message);send(socket,{...message,id:'concurrent'});
    }else if(r.type==='native_visibility_result')done(socket,'effect');});
    const call=bridge.call({version:1,id:'effect',command:'get_effect_values',args:{expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:work.sequenceName,trackItemId:work.trackItemId,expectedProjectItemId:'source',expectedClipName:'clip',expectedMediaType:'video',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:1,componentIndex:0,componentMatchName:'Tint',detail:'parameter',paramIndex:0,expectedDisplayName:'Black',timeSeconds:.5},timeoutMs:2000});
    await vi.waitFor(()=>expect(nativeSample).toHaveBeenCalledExactlyOnceWith(work));release({status:'pass'});await call;expect(nativeSample).toHaveBeenCalledOnce();socket.close();
  });
  it('reads the whole Point chain only within the exact parent and source identity',async()=>{
    const {bridge,socket}=await fixture('point-chain-proof');
    const work={projectId:'p',sequenceId:'s',sequenceName:'WORKING__test',trackItemId:'video:0:0:source',projectItemId:'source',clipName:'clip',mediaType:'video',trackIndex:0,startTicks:'0',endTicks:'254016000000',componentMatchNames:['Motion','PointFx'],components:[{componentIndex:1,componentMatchName:'PointFx',parameterNames:['Position']}]};
    socket.on('message',raw=>{const r=JSON.parse(raw.toString());if(r.command){
      const message={version:1,type:'native_effect_chain_proof',id:'proof',parentId:r.id,work};
      send(socket,{...message,parentId:'orphan'});send(socket,{...message,work:{...work,projectPath:'other'}});send(socket,{...message,work:{...work,projectItemId:'wrong'}});send(socket,message);
    }else if(r.type==='native_visibility_result')done(socket,'effect');});
    await bridge.call({version:1,id:'effect',command:'set_effect_values',args:{expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:work.sequenceName,trackItemId:work.trackItemId,expectedProjectItemId:'source',expectedClipName:'clip',expectedMediaType:'video',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:1},timeoutMs:2000});
    expect(chainProof).toHaveBeenCalledExactlyOnceWith(work);socket.close();
  });
  it('binds exact parameter navigation to the first parent parameter',async()=>{
    const {bridge,socket}=await fixture('parameter-callback-target');
    const work={trackItemId:'video:0:0:source',sequenceName:'WORKING__test',componentMatchNames:['fx'],target:{mediaType:'video',trackIndex:0,startTicks:'0',endTicks:'2540160000000',clipName:'clip',mediaPath:'C:\\clip.mov',componentMatchName:'fx',componentIndex:0}};
    const callback=(phase:string,w:any=work)=>({version:1,type:'effect_disclosure',id:phase,parentId:'p',phase,work:w});
    socket.on('message',raw=>{const r=JSON.parse(raw.toString());if(r.command)send(socket,callback('inspect'));else if(r.id==='inspect'){
      const parameter={paramIndex:4,name:'Rotation',expanded:true,disclosureKey:'ECP.Angle.Expanded'};
      send(socket,callback('parameter_inspect',{...work,parameter:{...parameter,paramIndex:3}}));send(socket,callback('parameter_inspect',{...work,parameter}));
    }else if(r.type==='native_visibility_result')done(socket,'p');});
    await bridge.call({version:1,id:'p',command:'get_effect_values',args:{expectedSequenceName:work.sequenceName,expectedMediaType:'video',expectedClipName:'clip',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:10,componentIndex:0,componentMatchName:'fx',paramIndex:4,expectedDisplayName:'Rotation'},timeoutMs:2000});
    expect(disclosure.mock.calls.map(c=>(c as unknown[])[0])).toEqual(['inspect','parameter_inspect']);socket.close();
  });
  it('permits two saved Point reads only after matching effect reveal and exact source correlation',async()=>{
    const {bridge,socket}=await fixture('point-archive-callback');let reads=0;
    const work={trackItemId:'video:0:0:source',sequenceName:'WORKING__test',componentMatchNames:['fx'],target:{mediaType:'video',trackIndex:0,startTicks:'0',endTicks:'2540160000000',clipName:'clip',mediaPath:'C:\\clip.mov',componentMatchName:'fx',componentIndex:0}};
    const callback=(phase:string,source='source')=>({version:1,type:'effect_disclosure',id:phase,parentId:'p',phase,work:phase==='inspect'?work:{...work,schemaTarget:{projectItemId:source,parameterNames:['Position']}}});
    socket.on('message',raw=>{const r=JSON.parse(raw.toString());if(r.command){send(socket,callback('keyframes_readback'));send(socket,callback('inspect'));}else if(r.id==='inspect'){send(socket,callback('keyframes_readback','wrong'));send(socket,callback('keyframes_readback'));}else if(r.id==='keyframes_readback'){if(++reads===1){send(socket,callback('keyframes_readback'));send(socket,callback('keyframes_readback'));}else done(socket,'p');}});
    await bridge.call({version:1,id:'p',command:'set_effect_keyframes',args:{expectedSequenceName:work.sequenceName,expectedMediaType:'video',expectedClipName:'clip',expectedProjectItemId:'source',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:10,componentIndex:0,componentMatchName:'fx'},timeoutMs:2000});
    expect(disclosure.mock.calls.map(c=>(c as unknown[])[0])).toEqual(['inspect','keyframes_readback','keyframes_readback']);socket.close();
  });
  it("binds saved-mask inspection to one exact parent target and never accepts a caller path",async()=>{
    const {bridge,socket}=await fixture("visual-mask-archive");
    const work={sequenceName:"WORKING__test",target:{sequenceId:"s",trackIndex:0,startTicks:"0",endTicks:"2540160000000",projectItemId:"source",clipName:"clip"}};
    socket.on("message",raw=>{const r=JSON.parse(raw.toString());if(r.command){
      const callback={version:1,type:"native_mask_archive",id:"mask",parentId:r.id,work};
      send(socket,{...callback,work:{...work,projectPath:"C:\\other.prproj"}});send(socket,{...callback,work:{...work,target:{...work.target,trackIndex:1}}});send(socket,callback);send(socket,callback);
    }else if(r.type==="native_visibility_result")done(socket,"mask-parent");});
    await bridge.call({version:1,id:"mask-parent",command:"inspect_native_masks",args:{expectedMediaType:"video",expectedSequenceId:"s",expectedSequenceName:work.sequenceName,expectedProjectItemId:"source",expectedClipName:"clip",expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:10},timeoutMs:2000});
    expect(mask.read).toHaveBeenCalledExactlyOnceWith(work);socket.close();
  });
  it("orders disclosure and scrolling, rejecting changed targets and duplicate phases",async()=>{
    const {bridge,socket}=await fixture("visual-effect-disclosure");
    const work={sequenceName:"WORKING__test",componentMatchNames:["AE.ADBE Opacity","AE.ADBE Motion"],target:{mediaType:"video",trackIndex:0,startTicks:"0",endTicks:"2540160000000",clipName:"clip",mediaPath:"C:\\clip.mov",componentMatchName:"AE.ADBE Motion"}};
      const callback=(phase:string)=>({version:1,type:"effect_disclosure",id:phase,parentId:"effect-parent",phase,work});
    socket.on("message",raw=>{const r=JSON.parse(raw.toString());if(r.command){
      send(socket,callback("scroll"));send(socket,{...callback("inspect"),work:{...work,expanded:false}});send(socket,{...callback("inspect"),work:{...work,target:{...work.target,trackIndex:1}}});send(socket,{...callback("inspect"),work:{...work,target:{...work.target,componentMatchName:"AE.ADBE Opacity"}}});send(socket,callback("inspect"));send(socket,callback("inspect"));
    }else if(r.type==="native_visibility_result"){
      if(r.id==="inspect"){send(socket,callback("write"));send(socket,callback("clear_verify"));send(socket,callback("clear_verify"));}
      else if(r.id==="clear_verify"){send(socket,callback("write"));send(socket,callback("write"));}
      else if(r.id==="write")send(socket,callback("verify"));
      else if(r.id==="verify"){send(socket,callback("scroll"));send(socket,callback("scroll"));}
      else done(socket,"effect-parent");
    }});
    await bridge.call({version:1,id:"effect-parent",command:"set_transform",args:{expectedSequenceName:work.sequenceName,expectedMediaType:"video",expectedClipName:"clip",expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:10},timeoutMs:2000});
    expect(disclosure.mock.calls.map(c=>(c as unknown[])[0])).toEqual(["inspect","clear_verify","write","verify","scroll"]);socket.close();
  });
  it("derives the SDK feature from the parent and rejects repeated or orphan requests",async()=>{
    const {bridge,socket}=await fixture("visual-bridge-sdk");
    socket.on("message",raw=>{const r=JSON.parse(raw.toString());if(r.command){
      const callback={version:1,type:"native_visual",id:"native",parentId:r.id,feature:"arbitrary_delete",pipe:"wrong"};
      send(socket,{...callback,parentId:"missing"});send(socket,callback);send(socket,callback);
    }else if(r.type==="native_visibility_result")done(socket,"tool");});
    await bridge.call({version:1,id:"tool",command:"activate_native_tool",args:{tool:"selection"},timeoutMs:2000});
    expect(native.visual).toHaveBeenCalledExactlyOnceWith("selection_tool","tool");socket.close();
  });
  it("rejects wrong panel/parent and caps navigation even within an authenticated command",async()=>{
    const {bridge,socket}=await fixture("visual-bridge-panel");let responses=0;
    socket.on("message",raw=>{const r=JSON.parse(raw.toString());if(r.command){
      const base={version:1,type:"native_visibility",id:"visible",parentId:r.id,panel:"effect_controls",projectName:"Project",sequenceName:"Sequence"};
      send(socket,{...base,parentId:"absent"});send(socket,{...base,panel:"project"});
      send(socket,base);send(socket,{...base,id:"second"});send(socket,{...base,id:"third"});
    }else if(r.type==="native_visibility_result" && ++responses===2)done(socket,"edit");});
    await expect(bridge.call({version:1,id:"edit",command:"set_effect_values",args:{},timeoutMs:2000})).resolves.toMatchObject({ok:true});
    expect(native.panel).toHaveBeenCalledTimes(2);expect(native.panel).toHaveBeenCalledWith("effect_controls","Project","Sequence");
    expect(native.selection).not.toHaveBeenCalled();socket.close();
  });
  it("uses only the server-chosen frame path and finalizes at most once",async()=>{
    const {bridge,socket}=await fixture("visual-bridge-frame");
    socket.on("message",raw=>{const r=JSON.parse(raw.toString());if(r.command){
      send(socket,{version:1,type:"project_selection",id:"wrong",parentId:r.id,target:{}});
      const callback={version:1,type:"program_frame_ready",id:"ready",parentId:r.id,outputPath:"C:\\private\\wrong.png"};send(socket,callback);send(socket,callback);
    }else if(r.type==="native_visibility_result")done(socket,"capture");});
    await bridge.call({version:1,id:"capture",command:"capture_program_frame",args:{outputPath:"C:\\output\\original.png"},timeoutMs:2000});
    expect(native.frame).toHaveBeenCalledExactlyOnceWith("C:\\output\\original.png");expect(native.selection).not.toHaveBeenCalled();socket.close();
  });
  it("restricts project selection to one request under a project command",async()=>{
    const {bridge,socket}=await fixture("visual-bridge-project");const target={pathSegments:["Footage","clip.mov"],kind:"clip",mediaPath:"C:\\clip.mov"};
    socket.on("message",raw=>{const r=JSON.parse(raw.toString());if(r.command){
      const callback={version:1,type:"project_selection",id:"selection",parentId:r.id,target};send(socket,callback);send(socket,callback);
      send(socket,{version:1,type:"program_frame_ready",id:"wrong-frame",parentId:r.id});
    }else if(r.type==="native_visibility_result")done(socket,"query");});
    await bridge.call({version:1,id:"query",command:"query_media",args:{},timeoutMs:2000});
    expect(native.selection).toHaveBeenCalledExactlyOnceWith(target);expect(native.frame).not.toHaveBeenCalled();socket.close();
  });
  it("rejects old in-flight work when a panel is replaced, while keeping the new connection usable",async()=>{
    const {bridge,socket,connect}=await fixture("visual-bridge-replacement");
    const result=bridge.call({version:1,id:"old",command:"query_media",args:{},timeoutMs:2000}).catch(e=>e);
    const replacement=await connect();expect(String(await result)).toContain("Panel replaced");
    replacement.on("message",raw=>{const r=JSON.parse(raw.toString());done(replacement,r.id);});
    await expect(bridge.call({version:1,id:"new",command:"ping",args:{},timeoutMs:2000})).resolves.toMatchObject({ok:true});socket.close();replacement.close();
  });
});
