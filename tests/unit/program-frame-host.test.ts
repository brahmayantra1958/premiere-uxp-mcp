import {describe,it,expect,vi} from "vitest";
const shared=vi.hoisted(()=>({f:null as any}));
vi.mock("../../apps/uxp-plugin/src/host-context.js",()=>({
  mutationContext:async()=>({project:shared.f.project,sequence:shared.f.sequence}),
  sequenceId:async(s:any)=>s.guid,
  inspectHostContext:async()=>({projectId:shared.f.project.guid,sequenceId:shared.f.sequence.guid,projectName:"Project",sequenceName:"WORKING__test"}),
  ppro:{TickTime:{createWithSeconds:(seconds:number)=>({seconds,ticks:String(Math.round(seconds*254016000000))}),createWithTicks:(ticks:string)=>({ticks,seconds:Number(ticks)/254016000000})},
    Exporter:{exportSequenceFrame:(...args:any[])=>shared.f.exportFrame(...args)}}
}));
vi.mock("../../apps/uxp-plugin/src/host-foundation.js",()=>({LOCAL_SCRATCH_ROOT:"C:\\scratch",text:(v:any)=>String(v??""),normalizeHostPath:(v:string)=>v.replaceAll("/","\\").toLowerCase(),
  splitWindowsPath:(v:string)=>({directory:v.slice(0,v.lastIndexOf("\\")),filename:v.slice(v.lastIndexOf("\\")+1)})}));
vi.mock("../../apps/uxp-plugin/src/host-work-target.js",()=>({focusWorkTarget:async(_r:any,_select:any,target:any)=>{shared.f.position=String(Math.round(target.timeSeconds*254016000000));return {status:"pass",clipSelection:"preserved"};}}));
import {PremiereHost} from "../../apps/uxp-plugin/src/premiere-host.js";
function fixture(){
  const f:any={position:"0",project:{guid:"project"},sequence:{guid:"sequence",name:"WORKING__test",getTimebase:()=>"8467200000",getEndTime:()=>({ticks:"2540160000000"}),
    getSettings:()=>({getVideoFrameRect:()=>({width:1920,height:1080})}),getPlayerPosition:()=>({ticks:f.position}),setPlayerPosition:vi.fn(async(v:any)=>{f.position=v.ticks;return true;})},exportFrame:vi.fn(async()=>true)};
  const finalized=vi.fn(async()=>({status:"pass",width:1920,height:1080,sha256:"a".repeat(64)}));
  const host=new PremiereHost(()=>{},()=>{},async()=>({status:"unverified"}),finalized);shared.f=f;
  const request={version:1 as const,id:"frame",command:"capture_program_frame",timeoutMs:15000,args:{expectedProjectId:"project",expectedSequenceId:"sequence",expectedSequenceName:"WORKING__test",timeSeconds:1.01,outputPath:"C:\\output\\frame.png"}};
  return {...f,request,finalized,run:(args={})=>host.dispatch({...request,args:{...request.args,...args}})};
}
describe("native Program Monitor frame proof",()=>{
  it("snaps exact ticks, waits for artifact proof and passes only after identity/position readback",async()=>{
    const f=fixture(),r:any=await f.run();expect(r).toMatchObject({status:"pass",frame:{ticks:"254016000000",frameIndex:30,finalizedSha256:"a".repeat(64)},navigation:{originalTicks:'0',restoreRequested:false,restored:false},visibility:{status:"unverified"}});
    // Automatic follow keeps the captured frame on screen; an explicit request still restores.
    expect(f.sequence.setPlayerPosition.mock.calls.map((c:any)=>c[0].ticks)).toEqual(['254016000000']);
    const g=fixture(),restored:any=await g.run({restorePlayhead:true});expect(restored.navigation).toMatchObject({originalTicks:'0',restored:true});
    expect(g.sequence.setPlayerPosition.mock.calls.map((c:any)=>c[0].ticks)).toEqual(['254016000000','0']);
    expect(f.exportFrame.mock.calls[0]![1]).toMatchObject({ticks:"254016000000"});expect(f.finalized).toHaveBeenCalledExactlyOnceWith("frame");
  });
  it.each([{expectedProjectId:"wrong"},{expectedSequenceId:"wrong"},{expectedSequenceName:"wrong"},{timeSeconds:10},{timeSeconds:-1},{timeSeconds:NaN},{outputPath:"C:\\private\\frame.png"}])("rejects stale or invalid capture input before exporting: %j",async args=>{
    const f=fixture();await expect(f.run(args)).rejects.toThrow();expect(f.exportFrame).not.toHaveBeenCalled();
  });
  it("reports incomplete or wrong-sized exports without a second dispatch",async()=>{
    for(const artifact of [{status:"unverified"},{status:"pass",width:1,height:1}]){const f=fixture();f.finalized.mockResolvedValueOnce(artifact as any);await expect(f.run()).rejects.toThrow("incomplete");expect(f.exportFrame).toHaveBeenCalledOnce();}
  });
  it("rejects context drift while the asynchronous exporter completes",async()=>{
    const f=fixture();f.finalized.mockImplementationOnce(async()=>{f.sequence.guid="other";return {status:"pass",width:1920,height:1080,sha256:"a".repeat(64)};});
    await expect(f.run()).rejects.toThrow("changed during frame export");expect(f.exportFrame).toHaveBeenCalledOnce();
    expect(f.sequence.setPlayerPosition).toHaveBeenCalledTimes(1);
  });
});
