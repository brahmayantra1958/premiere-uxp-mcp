import {describe,it,expect,vi} from "vitest";
const f=vi.hoisted(()=>({context:{projectId:"p",sequenceId:"s",sequenceName:"WORKING__test"},focus:vi.fn()}));
vi.mock("../../apps/uxp-plugin/src/host-context.js",()=>({ppro:{},inspectHostContext:async()=>({...f.context})}));
vi.mock("../../apps/uxp-plugin/src/host-work-target.js",()=>({followTimelineWork:async(r:any,_select:any,run:any)=>{f.focus(r);return run();}}));
import {PremiereHost} from "../../apps/uxp-plugin/src/premiere-host.js";
function fixture(){
 f.context={projectId:"p",sequenceId:"s",sequenceName:"WORKING__test"};f.focus.mockClear();
 const native=vi.fn(async()=>({status:"unverified",dispatchAccepted:true}));
 const host=new PremiereHost(()=>{},()=>{},undefined,undefined,undefined,native);
 const request={version:1 as const,id:"request",command:"activate_native_tool",timeoutMs:1000,args:{expectedProjectId:"p",expectedSequenceId:"s",expectedSequenceName:"WORKING__test",trackItemIds:["clip"],tool:"selection"}};
 return {native,host,request,run:(args={})=>host.dispatch({...request,args:{...request.args,...args}})};
}
describe("native tool host boundary",()=>{
 it("runs under the work-target protocol and does not promote an accepted command",async()=>{
  const a=fixture();expect(await a.run()).toMatchObject({status:"unverified",hostResult:{dispatchAccepted:true}});expect(a.native).toHaveBeenCalledExactlyOnceWith("request");expect(f.focus).toHaveBeenCalledWith(a.request);
 });
 it.each([{expectedProjectId:"other"},{expectedSequenceId:"other"},{expectedSequenceName:"other"},{trackItemIds:[]},{tool:"cmd.file.exit"}])("rejects invalid identity/action before native dispatch: %j",async args=>{
  const a=fixture();await expect(a.run(args)).rejects.toThrow();expect(a.native).not.toHaveBeenCalled();
 });
 it("rejects identity drift after asynchronous native dispatch",async()=>{
  const a=fixture();a.native.mockImplementation(async()=>{f.context.sequenceId="different";return {status:"unverified",dispatchAccepted:true};});await expect(a.run()).rejects.toThrow("changed during");
 });
 it("does not trust PASS returned by an execution-only adapter",async()=>{
  const a=fixture();a.native.mockResolvedValue({status:"pass",dispatchAccepted:true});expect(await a.run()).toMatchObject({status:"unverified"});
 });
 it("accepts correlated SDK execution with independent same-process tool proof",async()=>{
  const a=fixture();a.native.mockResolvedValue({id:"request",status:"pass",dispatchAccepted:true,sdkError:0,premierePid:123,readback:{protocol:1,status:"pass",route:"windows_msaa_tool_state",premierePid:123,panel:"Tools",selectedTools:[{name:"선택 도구",role:43,state:8}]}} as any);
  expect(await a.run()).toMatchObject({status:"pass"});
 });
});
