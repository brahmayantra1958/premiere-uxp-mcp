import { describe, expect, it } from "vitest";
import { assessRelocation, executeTrackRelocation, planTrackRelocation, relocatedItem, type RelocationAdapter, type RelocationRequest, type RelocationState } from "../../apps/uxp-plugin/src/track-relocation.js";

function fixture() {
  const source = { id: "video:0:100:p1", projectItemId: "p1", name: "clip", mediaType: "video", trackIndex: 0,
    start: { ticks: "100", seconds: 1 }, end: { ticks: "200", seconds: 2 }, inPoint: { ticks: "50", seconds: .5 }, outPoint: { ticks: "150", seconds: 1.5 }, speed: 1, reversed: false, disabled: false };
  const other = { ...source, id: "video:0:300:p2", projectItemId: "p2", start: { ticks: "300", seconds: 3 }, end: { ticks: "400", seconds: 4 } };
  const state: RelocationState = { sequence: { id: "seq", itemsTruncated: false, items: [source, other], videoTracks: 2, audioTracks: 1, captionTracks: 0, transitions: [],
    tracks: [0,1].map(index => ({ mediaType: "video", index, name: `V${index+1}`, muted: false, transitionCount: 0, itemCount: index ? 0 : 2 })) },
    effects: { [source.id]: [{ matchName: "Motion", value: 150, keyframes: [{ ticks: "150", value: 200 }] }], [other.id]: [{ value: 33 }] } };
  const request: RelocationRequest = { trackItemId: source.id, expectedProjectItemId: source.projectItemId, expectedMediaType: "video", expectedTrackIndex: 0,
    expectedStartSeconds: 1, expectedEndSeconds: 2, expectedInPointSeconds: .5, expectedOutPointSeconds: 1.5, destinationTrackIndex: 1 };
  const events: string[] = [];
  const adapter: RelocationAdapter = {
    async read() { events.push("read"); return structuredClone(state); },
    async clone(item, trackIndex) { events.push(`clone:${trackIndex}`); const destination = relocatedItem(item, trackIndex); state.sequence.items.push(destination); state.effects[destination.id] = structuredClone(state.effects[item.id]); },
    async lift(item) { events.push(`lift:${item.trackIndex}`); state.sequence.items = state.sequence.items.filter((value: any) => value.id !== item.id); delete state.effects[item.id]; },
    async select(item) { events.push(`select:${item.trackIndex}`); },
  };
  return { source, other, state, request, events, adapter };
}

describe("track relocation preservation and staged recovery", () => {
  it("copies exactly, reads effects, then lifts; selects the destination", async () => {
    const f=fixture(); const result=await executeTrackRelocation(f.request,f.adapter);
    expect(result.status).toBe("pass");
    expect(f.events).toEqual(["read","clone:1","read","lift:0","read","select:1"]);
    expect(f.state.sequence.items).toContainEqual(relocatedItem(f.source,1));
  });
  it.each(["start","end","inPoint","outPoint"])("rejects a changed %s tick even if the seconds field is unchanged", field => {
    const f=fixture(); const plan=planTrackRelocation(f.request,f.state); const after=structuredClone(f.state);
    const dest=relocatedItem(f.source,1); (dest as any)[field]={...dest[field],ticks:"101"};
    after.sequence.items.push(dest);after.effects[dest.id]=after.effects[f.source.id];
    expect(assessRelocation(f.state,after,plan,"cloned").join()).toContain("Clip content changed");
  });
  it.each(["effect","timing","unrelated"])("does not lift source when the clone changes %s", async fault => {
    const f=fixture(); const clone=f.adapter.clone;
    f.adapter.clone=async (...args) => {await clone(...args);const dest=f.state.sequence.items.at(-1);
      if(fault==="effect")f.state.effects[dest.id]=[{value:1}];
      if(fault==="timing")dest.end={ticks:"199",seconds:1.99};
      if(fault==="unrelated")f.state.sequence.items[1].disabled=true;
    };
    const result=await executeTrackRelocation(f.request,f.adapter);
    expect(f.events).not.toContain("lift:0");
    expect(result.status).toBe(fault==="unrelated"?"unverified":"fail");
    expect(f.state.sequence.items).toContainEqual(f.source);
  });
  it("inspects and removes the clone after a thrown clone response",async()=>{
    const f=fixture();const clone=f.adapter.clone;f.adapter.clone=async(...args)=>{await clone(...args);throw Error("response lost");};
    const result=await executeTrackRelocation(f.request,f.adapter);
    expect(result.status).toBe("fail");expect(f.events.filter(e=>e.startsWith("clone"))).toHaveLength(1);expect(f.state.sequence.items).toEqual([f.source,f.other]);
  });
  it("recovers a lost lift response using the proven faithful destination",async()=>{
    const f=fixture();const lift=f.adapter.lift;let first=true;f.adapter.lift=async item=>{await lift(item);if(first){first=false;throw Error("response lost");}};
    const result=await executeTrackRelocation(f.request,f.adapter);
    expect(result.status).toBe("fail");expect(result.hostResult).toMatchObject({rollback:{verified:true}});
    expect(f.events).toContain("clone:0");expect(f.state.sequence.items).toContainEqual(f.source);expect(f.state.sequence.items).toHaveLength(2);
  });
  it("refuses any overlap including one tick; adjacent clips are allowed",()=>{
    const f=fixture();const other={...f.other,trackIndex:1,start:{ticks:"199",seconds:1.99}};f.state.sequence.items.push(other);
    expect(()=>planTrackRelocation(f.request,f.state)).toThrow("overlaps");
    other.start={ticks:"200",seconds:2};expect(planTrackRelocation(f.request,f.state).destination.trackIndex).toBe(1);
  });
  it.each([0,2,-1,1.5])("refuses invalid destination %s",destinationTrackIndex=>{
    const f=fixture();expect(()=>planTrackRelocation({...f.request,destinationTrackIndex},f.state)).toThrow("another existing track");
  });
  it("refuses stale source facts, possible A/V links, and transitions before mutation",()=>{
    const f=fixture();expect(()=>planTrackRelocation({...f.request,expectedInPointSeconds:0},f.state)).toThrow("changed");
    f.state.sequence.items.push({...f.source,id:"audio:0:100:p1",mediaType:"audio"});expect(()=>planTrackRelocation(f.request,f.state)).toThrow("linked");
    f.state.sequence.items.pop();f.state.sequence.tracks[1].transitionCount=1;expect(()=>planTrackRelocation(f.request,f.state)).toThrow("transitions");
  });
});
