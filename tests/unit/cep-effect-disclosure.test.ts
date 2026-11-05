import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {runInNewContext} from "node:vm";
const service=createRequire(import.meta.url)("../../apps/cep-effect-disclosure/service.cjs");
const scope={projectPath:"C:\\work\\edit.prproj",sequenceId:"seq-123",sequenceName:"WORKING__test"};
const target={mediaType:"video",trackIndex:0,startTicks:"100",endTicks:"200",clipName:"clip.mov",mediaPath:"C:\\media\\clip.mov",componentMatchName:"AE.ADBE Motion"};
function request(extra={}){return {version:1,id:"disclosure-123",operation:"set_effect_disclosure",expiresAt:Date.now()+15000,...scope,target,expanded:true,...extra};}
function fixture(){
 let value="false",selection:any[]=[];
 const component={matchName:target.componentMatchName};
 const clip={name:target.clipName,start:{ticks:"100"},end:{ticks:"200"},projectItem:{getMediaPath:()=>target.mediaPath},components:{0:component,numItems:1}};
 const sequence={sequenceID:scope.sequenceId,name:scope.sequenceName,videoTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}},getSelection:()=>selection};
 const properties={getProperty:vi.fn(()=>value),isPropertyReadOnly:()=>false,setProperty:vi.fn((key:string,next:boolean,persist:number,create:number)=>{expect(key).toBe("ECP.Filter.ExpandedAE.ADBE Motion");expect(persist).toBe(0);expect(create).toBe(1);value=String(next);})};
 const app={project:{path:scope.projectPath,activeSequence:sequence},properties};
 const context:any={app};runInNewContext(readFileSync("apps/cep-effect-disclosure/host/disclosure.jsx","utf8").replace("__BRAHMA_YANTRA_EFFECT_DISCLOSURE_SCOPE__",JSON.stringify(scope)),context);
 return {app,clip,component,sequence,properties,select:()=>{selection=[clip];},execute:(r=request())=>JSON.parse(runInNewContext(service.expression(r),context))};
}
describe("bounded effect disclosure preference (fixtures, not native UI proof)",()=>{
 it("only changes the actual component preference and distinguishes UI proof",()=>{
  const f=fixture();expect(f.execute()).toMatchObject({status:"pass",before:"false",after:"true",uiVerified:false,scope:"effect_match_name"});expect(f.properties.setProperty).toHaveBeenCalledOnce();
 });
 it.each(["selection","project","sequence","clip","component","duplicate"])("blocks %s mismatch before setting a preference",kind=>{
  const f=fixture();if(kind==="selection")f.select();if(kind==="project")f.app.project.path="C:\\other.prproj";if(kind==="sequence")f.sequence.sequenceID="other";
  if(kind==="clip")f.clip.start.ticks="101";if(kind==="component")f.component.matchName="another";
  if(kind==="duplicate"){(f.clip.components as any)[1]=f.component;f.clip.components.numItems=2;}
  expect(f.execute().status).toBe("fail");expect(f.properties.setProperty).not.toHaveBeenCalled();
 });
 it("fails as UNVERIFIED on silent setter failure or context drift after dispatch",()=>{
  for(const drift of [false,true]){const f=fixture();f.properties.setProperty.mockImplementation(()=>{if(drift)f.app.project.path="C:\\other.prproj";});expect(f.execute().status).toBe("unverified");}
 });
 it("allows a read while selected without requiring selection changes",()=>{
  const f=fixture();f.select();expect(f.execute(request({operation:"read_effect_disclosure",expanded:undefined}))).toMatchObject({status:"pass",value:"false"});expect(f.properties.setProperty).not.toHaveBeenCalled();
 });
 it("permits Time Remapping in arbitrary video chains that retain both intrinsics",()=>{
  const f=fixture();(f.clip.components as any)[1]={matchName:"AE.ADBE Opacity"};f.clip.components.numItems=2;
  let value="true";f.properties.getProperty.mockImplementation(()=>value);
  f.properties.setProperty.mockImplementation((key,next)=>{expect(key).toBe("ECP.Filter.ExpandedBE.TimeRemapping");value=String(next);});
  const r=request({target:{...target,componentMatchName:"BE.TimeRemapping"},expanded:false});
  expect(f.execute(r)).toMatchObject({status:"pass",after:"false",uiVerified:false});
  f.properties.setProperty.mockClear();(f.clip.components as any)[2]={matchName:"AE.ADBE Tint"};f.clip.components.numItems=3;
  expect(f.execute(r).status).toBe("pass");
  f.properties.setProperty.mockClear();f.component.matchName="another";
  expect(f.execute(r).status).toBe("fail");expect(f.properties.setProperty).not.toHaveBeenCalled();
 });
 it("permits a guarded duplicate slot while keeping the preference explicitly group-scoped",()=>{
  const f=fixture();(f.clip.components as any)[1]=f.component;f.clip.components.numItems=2;
  expect(f.execute(request({target:{...target,componentIndex:1}}))).toMatchObject({status:"pass",scope:"effect_match_name",uiVerified:false});
  f.properties.setProperty.mockClear();
  expect(f.execute(request({target:{...target,componentIndex:2}})).status).toBe("fail");expect(f.properties.setProperty).not.toHaveBeenCalled();
 });
 it("rejects arbitrary code, preference keys and malformed targets",()=>{
  for(const extra of [{script:"anything"},{key:"unrelated.preference"},{operation:"eval"},{target:{...target,trackIndex:-1}},{target:{...target,componentMatchName:"x\n"}},{target:{...target,startTicks:"1.5"}},{expanded:1}])expect(()=>service.validate(request(extra))).toThrow();
 });
});
