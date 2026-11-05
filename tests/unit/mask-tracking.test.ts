import {describe,it,expect,vi} from "vitest";
import {trackObjectMaskFrames} from "../../apps/uxp-plugin/src/mask-tracking.js";
import {MaskTrackingSession} from "../../apps/mcp-server/src/mask-tracking-session.js";
import {verifyMaskTrackingArchive} from "../../apps/mcp-server/src/mask-tracking-bridge.js";
import type {MaskTrackingWork} from "@premiere-uxp/contracts/mask-tracking";
import type {NativeMaskArchive} from "../../apps/mcp-server/src/premiere-mask-archive.js";
const work:MaskTrackingWork={sequenceName:"WORKING__test",maskName:"01",direction:"forward",frames:2,target:{sequenceId:"s",projectItemId:"p",clipName:"clip",trackIndex:0,startTicks:"0",endTicks:"2540160000000"}};
const mask=(changed=false)=>({name:"01",objectId:"5",nativeType:4,parameters:[22,23,24].map(id=>({id,name:String(id),controlType:1,stateHash:changed&&id===24?"after":"before",...(id===24?{binary:{sha256:changed?"after":"before",bytes:4}}:{})}))});
function fixture(){
 let position=200n;const calls:string[]=[];
 const services={assertTarget:vi.fn(async()=>{calls.push("assert");}),save:vi.fn(async()=>{calls.push("save");}),position:async()=>String(position),yieldToHost:vi.fn(async()=>{}),request:vi.fn(async(phase:string,step:number)=>{calls.push(`${phase}:${step}`);if(phase==="step")position+=100n;return {status:phase==="step"?"unverified":"pass",dispatchAccepted:phase==="step"};})};
 return {services,calls,setPosition:(p:bigint)=>{position=p;}};
}
describe("owned native mask frame sequence",()=>{
 it("submits two non-retried steps between saved archive observations",async()=>{
  const f=fixture(),r=await trackObjectMaskFrames(work,"100",f.services);
  expect(r).toMatchObject({status:"pass",completedFrames:2,position:{beforeTicks:"200",afterTicks:"400"}});
  expect(f.calls.filter(c=>c!=="assert")).toEqual(["save","before:0","step:0","step:1","save","after:2"]);
 });
 it("rejects an end outside the clip before saving or dispatching",async()=>{
  const f=fixture();await expect(trackObjectMaskFrames({...work,target:{...work.target,endTicks:"400"}},"100",f.services)).rejects.toThrow("RANGE_INVALID");expect(f.services.request).not.toHaveBeenCalled();
 });
 it("rejects a non-frame-aligned playhead",async()=>{const f=fixture();f.setPosition(201n);await expect(trackObjectMaskFrames(work,"100",f.services)).rejects.toThrow("RANGE_INVALID");});
 it("does not retry accepted tracking without a frame advance",async()=>{
  const f=fixture();f.services.request.mockImplementation(async phase=>({status:phase==="before"?"pass":"unverified",dispatchAccepted:phase==="step"}));
  expect(await trackObjectMaskFrames(work,"100",f.services)).toMatchObject({status:"unverified",completedFrames:0});
  expect(f.services.request.mock.calls.filter(c=>c[0]==="step")).toHaveLength(1);expect(f.services.yieldToHost).toHaveBeenCalledTimes(15);
 });
 it("stops before a second step when context drifts",async()=>{
  const f=fixture();f.services.assertTarget.mockImplementation(async()=>{if(f.services.request.mock.calls.some(c=>c[0]==="step"))throw Error("CONTEXT_CHANGED");});
  expect(await trackObjectMaskFrames(work,"100",f.services)).toMatchObject({status:"unverified",completedFrames:1});expect(f.services.request.mock.calls.filter(c=>c[0]==="step")).toHaveLength(1);
 });
 it("requires archive proof even when frame stepping succeeded",async()=>{
  const f=fixture(),base=f.services.request.getMockImplementation()!;f.services.request.mockImplementation(async(p,s)=>p==="after"?{status:"unverified",dispatchAccepted:false}:base(p,s));
  expect(await trackObjectMaskFrames(work,"100",f.services)).toMatchObject({status:"unverified",completedFrames:2});
 });
 it("supports exact backward frame accounting",async()=>{
  const f=fixture();f.services.request.mockImplementation(async phase=>{if(phase==="step")f.setPosition(100n);return {status:phase==="step"?"unverified":"pass",dispatchAccepted:phase==="step"};});
  expect(await trackObjectMaskFrames({...work,direction:"backward",frames:1},"100",f.services)).toMatchObject({status:"pass",position:{afterTicks:"100"}});
 });
});
describe("parent-bound mask session",()=>{
 const args={expectedMediaType:"video",expectedSequenceId:"s",expectedSequenceName:"WORKING__test",expectedProjectItemId:"p",expectedClipName:"clip",expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:10,maskName:"01",direction:"forward",frames:2};
 function server(){const services={read:vi.fn(async()=>({target:work.target,masks:[mask()],fileSha256:"hash",savedAt:"now"})),step:vi.fn(async()=>({status:"unverified",dispatchAccepted:true}))};return {services,session:new MaskTrackingSession(args,services)};}
 it("rejects changed targets, orphan ordering and duplicate frames",async()=>{
  const f=server();expect(await f.session.request("step",0,work)).toBeUndefined();expect(await f.session.request("before",0,{...work,direction:"backward"})).toBeUndefined();
  expect(await f.session.request("before",0,work)).toMatchObject({status:"pass"});expect(await f.session.request("before",0,work)).toBeUndefined();
  await f.session.request("step",0,work);expect(await f.session.request("step",0,work)).toBeUndefined();expect(await f.session.request("after",2,work)).toBeUndefined();await f.session.request("step",1,work);
  f.services.read.mockResolvedValue({target:work.target,masks:[mask(true)],fileSha256:"after",savedAt:"now"});expect(await f.session.request("after",2,work)).toMatchObject({status:"pass"});expect(await f.session.request("step",2,work)).toBeUndefined();expect(f.services.step).toHaveBeenCalledTimes(2);
 });
 it("rejects extra masks before any tracking dispatch",async()=>{
  const f=server();f.services.read.mockResolvedValue({target:work.target,masks:[mask(),{...mask(),name:"02"}],fileSha256:"hash",savedAt:"now"});expect(await f.session.request("before",0,work)).toMatchObject({status:"unsupported"});expect(await f.session.request("step",0,work)).toBeUndefined();expect(f.services.step).not.toHaveBeenCalled();
 });
 it("quarantines a step with an unknown result",async()=>{
  const f=server();await f.session.request("before",0,work);f.services.step.mockRejectedValue(Error("timeout"));expect(await f.session.request("step",0,work)).toMatchObject({status:"unverified"});expect(await f.session.request("step",0,work)).toBeUndefined();expect(await f.session.request("step",1,work)).toBeUndefined();
 });
});
describe("native mask archive tracking proof",()=>{
 it("allows only the observed reverse button latch, keeping its metadata guarded",()=>{
  const before:NativeMaskArchive=mask(),after:NativeMaskArchive=mask(true);
  before.parameters.push({id:2,name:"",controlType:16,stateHash:"false",structureHash:"same",scalar:"-91445760000000000,false,0,0,0,0,0,0"});
  after.parameters.push({id:2,name:"",controlType:16,stateHash:"true",structureHash:"same",scalar:"-91445760000000000,true,0,0,0,0,0,0"});
  expect(verifyMaskTrackingArchive([before],[after],"01","backward").status).toBe("pass");
  expect(verifyMaskTrackingArchive([before],[after],"01","forward").status).toBe("unverified");
  after.parameters.at(-1)!.structureHash="different";expect(verifyMaskTrackingArchive([before],[after],"01","backward").status).toBe("unverified");
 });
 it("does not promote unchanged bytes or changes to another parameter",()=>{
  expect(verifyMaskTrackingArchive([mask()],[mask()],"01").status).toBe("unverified");const after=mask(true);after.parameters[0]!.stateHash="changed";expect(verifyMaskTrackingArchive([mask()],[after],"01").status).toBe("unverified");
 });
 it("permits native interaction records alongside tracker data",()=>{const after=mask(true);after.parameters[1]!.stateHash="changed";expect(verifyMaskTrackingArchive([mask()],[after],"01")).toMatchObject({status:"pass",changedParameterIds:[23,24]});});
});
