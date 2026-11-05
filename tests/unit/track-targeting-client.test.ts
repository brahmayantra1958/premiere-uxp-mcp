import { expect, it, vi } from "vitest";
import { uxpModules } from "../helpers/uxp-modules.js";
const config={port:8098,token:"0".repeat(64),version:"0.1.0",projectPath:"C:\\work\\a.prproj",sequenceId:"seq1",sequenceName:"WORKING__test"};
const project={path:config.projectPath};
const sequence={guid:config.sequenceId,name:config.sequenceName,getVideoTrackCount:()=>2,getAudioTrackCount:()=>1,getVideoTrack:(i:number)=>({name:`V${i+1}`}),getAudioTrack:()=>({name:"A1"})};
const after=[{mediaType:"video",trackIndex:0,name:"V1",targeted:false},{mediaType:"video",trackIndex:1,name:"V2",targeted:true},{mediaType:"audio",trackIndex:0,name:"A1",targeted:false}];
function fixture(result: any={status:"pass",route:"cep_track_targeting",version:"0.1.0",after}) {
  const fetch=vi.fn(async(url: string,_options?:any):Promise<any>=>{ void url;void _options; return {ok:true,json:async()=>result}; });
  const module=uxpModules({}, {__PREMIERE_MCP_TRACK_TARGETING__:config,fetch})("apps/uxp-plugin/src/track-targeting-client.ts");
  return {module,fetch};
}
it('reconciles only a proven pre-dispatch quarantine rejection, with one fresh read and a new ID',async()=>{
 const f=fixture();f.fetch.mockResolvedValueOnce({ok:false,status:409,json:async()=>({error:'UNVERIFIED_PRIOR_DISPATCH_RELOAD_REQUIRED'})});
 const r=await f.module.requestTrackTargeting(project,sequence,[{mediaType:'video',trackIndex:1}]);expect(r.status).toBe('pass');
 const calls=f.fetch.mock.calls.map(c=>JSON.parse(c[1].body));expect(calls.map(c=>c.operation)).toEqual(['set_track_targeting','read_track_targeting','set_track_targeting']);expect(new Set(calls.map(c=>c.id)).size).toBe(3);expect(calls[1].targets).toEqual([]);
 expect(r.reconciliation.previousIntentDispatched).toBe(false);
});
it('does not retry unknown dispatches or loop if reconciliation leaves quarantine active',async()=>{
 const unknown=fixture({status:'unverified',error:'HOST_TIMEOUT_DO_NOT_REPLAY'});
 await expect(unknown.module.requestTrackTargeting(project,sequence,[{mediaType:'video',trackIndex:1}])).rejects.toThrow('HOST_TIMEOUT');expect(unknown.fetch).toHaveBeenCalledTimes(1);
 const f=fixture();const rejected={ok:false,status:409,json:async()=>({error:'UNVERIFIED_PRIOR_DISPATCH_RELOAD_REQUIRED'})};
 f.fetch.mockResolvedValueOnce(rejected).mockResolvedValueOnce({ok:true,json:async()=>({status:'pass',route:'cep_track_targeting',version:'0.1.0',after})}).mockResolvedValueOnce(rejected);
 await expect(f.module.requestTrackTargeting(project,sequence,[{mediaType:'video',trackIndex:1}])).rejects.toThrow('dependent content');expect(f.fetch).toHaveBeenCalledTimes(3);
});
it("uses the approved localhost authority and verifies the complete exclusive vector",async()=>{
  const f=fixture();const result=await f.module.requestTrackTargeting(project,sequence,[{mediaType:"video",trackIndex:1}]);
  expect(result.status).toBe("pass");expect(f.fetch.mock.calls[0]![0]).toBe("http://localhost:8098/targeting");
});
it.each([
  {status:"fail",error:"host error"},
  {status:"pass",route:"cep_track_targeting",version:"wrong",after},
  {status:"pass",route:"cep_track_targeting",version:"0.1.0",after:after.slice(0,2)},
  {status:"pass",route:"cep_track_targeting",version:"0.1.0",after:after.map(t=>({...t,targeted:true}))},
])("blocks dependent edits on rejected or mismatched native readback",async value=>{
  const f=fixture(value);await expect(f.module.requestTrackTargeting(project,sequence,[{mediaType:"video",trackIndex:1}])).rejects.toThrow("dependent content command was not dispatched");
});
it("preserves targeting for sequence-only reads and does not invent a target",async()=>{
  const f=fixture();expect((await f.module.requestTrackTargeting(project,sequence,[])).status).toBe("preserved");
});
it("allows another sequence and does not dispatch an unavailable V/A track",async()=>{
  const f=fixture();expect((await f.module.requestTrackTargeting(project,{...sequence,guid:"other"},[])).status).toBe("preserved");
  expect(JSON.parse(f.fetch.mock.calls[0]![1].body).sequenceId).toBe("other");f.fetch.mockClear();
  expect((await f.module.requestTrackTargeting(project,sequence,[{mediaType:"video",trackIndex:4}])).status).toBe("unsupported");expect(f.fetch).not.toHaveBeenCalled();
});
