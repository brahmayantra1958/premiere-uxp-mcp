import { describe, expect, it, vi } from "vitest";
import { uxpModules } from "../helpers/uxp-modules.js";

function fixture() {
  const properties = [new Map<string, any>([["MZ.TrackTargeted",1],["MZ.SourceTrackState",2],["MZ.SourceTrackNumber",0]]),
    new Map<string, any>([["MZ.SourceTrackState",0],["MZ.SourceTrackNumber",-1]]),new Map<string, any>([["MZ.TrackTargeted",1]])];
  let locked=false;
  const project={lockedAccess:(callback:()=>void)=>{locked=true;try{callback();}finally{locked=false;}},executeTransaction:vi.fn((callback:any)=>{const actions:(()=>void)[]=[];callback({addAction:(action:any)=>actions.push(action)});actions.forEach(action=>action());return true;})};
  const track=(i:number)=>({index:i,name:`track${i}`,isMuted:()=>i===2});
  const sequence={getVideoTrackCount:()=>2,getAudioTrackCount:()=>1,getVideoTrack:(i:number)=>track(i),getAudioTrack:()=>track(2)};
  const createdKeys:string[]=[];
  const module=uxpModules({Properties:{PROPERTY_PERSISTENT:1,getProperties:(track:any)=>{
    const values=properties[track.index]!;
    return {hasValue:(key:string)=>values.has(key),getValue:(key:string)=>String(values.get(key)),
      createSetValueAction:(key:string,value:any)=>{expect(locked).toBe(true);createdKeys.push(key);return()=>{values.set(key,value);};},
      createClearValueAction:(key:string)=>()=>{values.delete(key);}};
  }}})("apps/uxp-plugin/src/host-track-targeting.ts");
  return {properties,project,sequence,module,createdKeys};
}
describe("native track Properties targeting",()=>{
  it("keeps the visually rejected property writer out of automatic targeting",async()=>{
    const f=fixture();expect((await f.module.targetWorkingTracks()).status).toBe("unsupported");
    expect(f.project.executeTransaction).not.toHaveBeenCalled();expect(f.createdKeys).toEqual([]);
  });
  it("exclusively targets V2, materializes absent native bits and preserves patching/mute",async()=>{
    const f=fixture();const result=await f.module.applyTrackTargetProperties(f.project,f.sequence,[{mediaType:"video",trackIndex:1}]);
    expect(result.status).toBe("pass");expect(result.after.map((t:any)=>t.targeted)).toEqual([false,true,false]);
    expect(result.sourcePatchingPreserved).toBe(true);expect(f.properties[0]!.get("MZ.SourceTrackState")).toBe(2);
    expect(new Set(f.createdKeys)).toEqual(new Set(["MZ.TrackTargeted"]));
  });
  it("avoids repeated transactions when the requested vector already matches",async()=>{
    const f=fixture();const tracks=[{mediaType:"video",trackIndex:1}];
    await f.module.applyTrackTargetProperties(f.project,f.sequence,tracks);await f.module.applyTrackTargetProperties(f.project,f.sequence,tracks);
    expect(f.project.executeTransaction).toHaveBeenCalledOnce();
  });
  it("preserves targets when a sequence-wide request has no track",async()=>{
    const f=fixture();expect((await f.module.applyTrackTargetProperties(f.project,f.sequence,[])).status).toBe("preserved");
    expect(f.project.executeTransaction).not.toHaveBeenCalled();expect(f.properties[1]!.has("MZ.TrackTargeted")).toBe(false);
  });
  it("does not trust a successful transaction when readback differs",async()=>{
    const f=fixture();f.project.executeTransaction.mockImplementationOnce(()=>true);
    await expect(f.module.applyTrackTargetProperties(f.project,f.sequence,[{mediaType:"video",trackIndex:1}])).rejects.toThrow("readback differs");
  });
  it("restores values and originally absent keys after a thrown transaction response",async()=>{
    const f=fixture();const execute=f.project.executeTransaction.getMockImplementation()!;
    f.project.executeTransaction.mockImplementationOnce(callback=>{execute(callback);throw Error("response lost");});
    await expect(f.module.applyTrackTargetProperties(f.project,f.sequence,[{mediaType:"video",trackIndex:1}])).rejects.toThrow("restored: true");
    expect(f.properties.map(p=>p.get("MZ.TrackTargeted"))).toEqual([1,undefined,1]);
  });
  it("does not dispatch on unknown native values or nonexistent targets",async()=>{
    const f=fixture();f.properties[0]!.set("MZ.TrackTargeted","bad");expect((await f.module.applyTrackTargetProperties(f.project,f.sequence,[{mediaType:"video",trackIndex:1}])).status).toBe("unsupported");
    f.properties[0]!.set("MZ.TrackTargeted",1);expect((await f.module.applyTrackTargetProperties(f.project,f.sequence,[{mediaType:"video",trackIndex:7}])).status).toBe("unsupported");
    expect(f.project.executeTransaction).not.toHaveBeenCalled();
  });
});
