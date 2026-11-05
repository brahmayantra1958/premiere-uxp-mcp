import { describe, expect, it, vi } from "vitest";
import { uxpModules } from "../helpers/uxp-modules.js";
import { overlapsRange, parseTimelineId, queryBounds } from "../../apps/uxp-plugin/src/item-query.js";

function fixture(count = 60, globals: Record<string, unknown> = {}) {
  const time = (seconds: number) => ({ seconds, ticks: String(seconds * 254016000000) });
  const hydrate = vi.fn(), metadata = vi.fn(), component = vi.fn<() => any>(() => { throw Error("No effects in an orientation read"); });
  const media = Array.from({ length: count }, (_, i) => ({ name: `Media ${i}`, getId: () => `media-${i}`,
    getColorLabelIndex: metadata, isSequence: () => false, getMediaFilePath: () => `C:\\media\\${i}.mov` }));
  const clips = media.map((source, i) => ({ getProjectItem: () => source, getStartTime: () => time(i * 2), getEndTime: () => time(i * 2 + 2),
    getName: () => `Clip ${i}`, getInPoint: () => { hydrate(); return time(0); }, getOutPoint: () => time(2),
    isDisabled: () => false, getSpeed: () => 1, isSpeedReversed: () => false, isAdjustmentLayer: () => false,
    getIsSelected: () => i === 3, getComponentChain: component }));
  const sequence = { guid: "sequence-1", name: "WORKING__test", getVideoTrackCount: () => 1, getAudioTrackCount: () => 0, getCaptionTrackCount: () => 0,
    getVideoTrack: vi.fn(() => ({ getTrackItems: () => clips })), getEndTime: () => time(count * 2),
    getSettings: () => ({ getVideoFrameRect: () => ({ width: 1920, height: 1080 }), getVideoFrameRate: () => ({ value: 30 }) }) };
  const project = { guid: "project-1", name: "Test", path: "C:\\scratch\\test.prproj", getActiveSequence: () => sequence,
    getRootItem: vi.fn(() => ({ getId: () => "root", getItems: () => media })) };
  const ppro = { TickTime:{createWithTicks:(ticks:string)=>({ticks,seconds:Number(ticks)/254016000000})},Project: { getActiveProject: vi.fn(() => project) }, Constants: { TrackItemType: { CLIP: 1 } },
    FolderItem: { cast: () => null }, ClipProjectItem: { cast: (item: unknown) => item } };
  const load = uxpModules(ppro, globals);
  return { project, sequence, ppro, clips, hydrate, metadata, component,
    items: load("apps/uxp-plugin/src/host-items.ts"), agent: load("apps/uxp-plugin/src/host-agent-context.ts"), lifecycle:load("apps/uxp-plugin/src/graphic-lifecycle.ts") };
}

function graphicFixture(mediaType:'video'|'audio'='video') {
  // Advance only the lifecycle's synthetic wait clock; these fixtures prove
  // protocol/lifetime behavior, not the adequacy of production timing values.
  let now = 0;
  const f = fixture(1, {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (resolve: () => void, milliseconds: number) => { now += milliseconds; void Promise.resolve().then(resolve); return 0; },
  });
  let epoch = 0, pending = 0, peak = 0, valueReads = 0;
  const state = { inSeconds: 0, endSeconds: 2, speed: 1, onLeaf: (name: string) => { void name; } };
  const check = (born: number) => { expect(pending).toBe(0); if (born !== epoch) throw Error("The script object is no longer valid."); };
  const complete = async (name: string) => { pending++; peak = Math.max(peak, pending); await Promise.resolve(); pending--; epoch++; state.onLeaf(name); };
  const time = (seconds: number) => ({ seconds, ticks: String(seconds * 254016000000) });
  const makeComponent = () => {
    const born = epoch;
    return {
      getParamCount: () => { check(born); return 1; },
      getDisplayName: async () => { check(born); await complete("getDisplayName"); return mediaType==='audio'?"Volume":"Graphic"; },
      getMatchName: async () => { check(born); await complete("getMatchName"); return mediaType==='audio'?"Internal Volume Stereo":"AE.ADBE Text"; },
      getParam: () => {
        check(born); const paramEpoch = epoch;
        return {
          get displayName() { check(paramEpoch); return mediaType==='audio'?"Level":"Text"; },
          getValueAtTime: async () => { check(paramEpoch); valueReads++; await complete("getValueAtTime"); return { value: mediaType==='audio'?.125:"Premiere UXP MCP" }; },
          isTimeVarying: () => { check(paramEpoch); return false; },
          areKeyframesSupported: async () => { check(paramEpoch); await complete("areKeyframesSupported"); return false; },
          getKeyframeListAsTickTimes: () => { check(paramEpoch); return []; },
        };
      },
    };
  };
  const raw = () => {
    const born = epoch;
    return {
      ...f.clips[0], getProjectItem: () => { check(born); return mediaType==='audio'?f.clips[0]!.getProjectItem():null; },
      getInPoint: () => { check(born); f.hydrate(); return time(state.inSeconds); },
      getEndTime: () => { check(born); return time(state.endSeconds); },
      getSpeed: () => { check(born); return state.speed; },
      getComponentChain: async () => {
        check(born); await complete("getComponentChain"); const chainEpoch = epoch;
        return {
          getComponentCount: () => { check(chainEpoch); return 1; },
          getComponentAtIndex: () => { check(chainEpoch); return makeComponent(); },
        };
      },
    };
  };
  f.sequence.getVideoTrack.mockImplementation(() => ({ getTrackItems: () => [raw()] as any }));
  const audioTrack=vi.fn(()=>({getTrackItems:()=>[raw()]}));
  if(mediaType==='audio')Object.assign(f.sequence,{getVideoTrackCount:()=>0,getAudioTrackCount:()=>1,getAudioTrack:audioTrack});
  return { ...f, state, audioTrack, now:()=>now, inspect: () => ({ epoch, pending, peak, valueReads }) };
}

describe("bounded agent inspection", () => {
  it('finds exact IDs beyond 500 and paginates all media without hydrating prior pages',async()=>{
    const f=fixture(620);
    expect((await f.items.findProjectItemEntry(f.project,'media-610')).snapshot.path).toBe('C:\\media\\610.mov');
    f.metadata.mockClear();
    const first=await f.agent.queryMedia({offset:400,limit:100});
    expect(first.page).toMatchObject({returned:100,hasMore:true,scanTruncated:false,nextOffset:500});
    const second=await f.agent.queryMedia({cursor:first.page.nextCursor,limit:100});
    expect(second.items[0].id).toBe('media-500');
    const third=await f.agent.queryMedia({cursor:second.page.nextCursor,limit:100});
    expect(third.page).toMatchObject({returned:20,hasMore:false,scanTruncated:false,nextCursor:null});
    expect(f.metadata).toHaveBeenCalledTimes(220);
    expect((await f.agent.queryMedia({ids:['media-619'],binId:'root',limit:1})).items[0].id).toBe('media-619');
    await expect(f.agent.queryMedia({cursor:first.page.nextCursor,nameContains:'Media 5'})).rejects.toThrow('INVALID_MEDIA_CURSOR');
    await expect(f.agent.queryMedia({cursor:'bad'})).rejects.toThrow('INVALID_MEDIA_CURSOR');
  });
  it('rejects unproven video sequence-time sampling even when public speed is 1',async()=>{
    const f=fixture();
    await expect(f.agent.queryTimeline({nameContains:'Clip 3',limit:1,includeEffects:true,effectTimeSeconds:7})).rejects.toThrow('REQUIRES_EXACT_EFFECT');
    expect(f.component).not.toHaveBeenCalled();
  });
  it("hydrates selected clips only and never reads project media/effects for context", async () => {
    const f = fixture();
    const result = await f.agent.getAgentContext();
    expect(result).toMatchObject({ status: "ready", project: { id: "project-1" }, editBoundary: { allowed: true } });
    expect(result.selection.items).toHaveLength(1);
    expect(f.hydrate).toHaveBeenCalledTimes(1);
    expect(f.project.getRootItem).not.toHaveBeenCalled();
    expect(f.component).not.toHaveBeenCalled();
    f.hydrate.mockClear();
    expect((await f.items.timelineSelectionSnapshot(f.sequence)).itemIds).toEqual(result.selection.items.map((i: any) => i.id));
    expect(f.hydrate).toHaveBeenCalledTimes(1);
  });

  it("finds one clip by complete identity and hydrates only that target", async () => {
    const f = fixture();
    const target = "video:0:1524096000000:media-3";
    expect((await f.items.findTrackItemEntry(f.sequence, target)).snapshot.name).toBe("Clip 3");
    expect(f.hydrate).toHaveBeenCalledTimes(1);
    await expect(f.items.findTrackItemEntry(f.sequence, target.replace("media-3", "stale"))).rejects.toThrow("not found");
    expect(f.hydrate).toHaveBeenCalledTimes(1);
  });

  it("paginates matching clips completely, uses half-open overlap, and bounds hydration", async () => {
    const f = fixture();
    const args = { nameContains: "CLIP", startSeconds: 6, endSeconds: 12, limit: 2 };
    const first = await f.agent.queryTimeline(args);
    expect(first.items.map((item: any) => item.name)).toEqual(["Clip 3", "Clip 4"]);
    expect(first.page).toMatchObject({ hasMore: true, nextOffset: 2, scanTruncated: false });
    expect(f.hydrate).toHaveBeenCalledTimes(2);
    const second = await f.agent.queryTimeline({ ...args, offset: first.page.nextOffset });
    expect(second.items.map((item: any) => item.name)).toEqual(["Clip 5"]);
    expect(second.page.hasMore).toBe(false);
  });

  it("hydrates only filtered media and preserves parent identity", async () => {
    const f = fixture();
    const result = await f.agent.queryMedia({ ids: ["media-4"], limit: 1 });
    expect(result.items).toMatchObject([{ id: "media-4", parentId: "root", path: "C:\\media\\4.mov" }]);
    expect(f.metadata).toHaveBeenCalledTimes(1);
    f.metadata.mockClear();
    await f.items.findProjectItemEntry(f.project, "media-4");
    expect(f.metadata).toHaveBeenCalledTimes(1);
  });

  it.each([false,true])("reads ordinary media effects without extra graph/target traversal when projectItemId is missing=%s", async missingId => {
    const f = fixture();
    if(missingId){
      const queryEntries=f.items.queryTimelineEntries;
      f.items.queryTimelineEntries=async(...args:any[])=>{const result=await queryEntries(...args);for(const entry of result.entries)delete entry.snapshot.projectItemId;return result;};
    }
    f.component.mockReturnValue({ getComponentCount: () => 0 });
    const result = await f.agent.queryTimeline({ nameContains: "Clip 3", limit: 1, includeEffects: true });
    expect(result.items[0]).toMatchObject({ name: "Clip 3", components: [] });
    expect(f.component).toHaveBeenCalledTimes(1);
    expect(f.hydrate).toHaveBeenCalledTimes(1);
    expect(f.sequence.getVideoTrack).toHaveBeenCalledTimes(1);
    expect(f.ppro.Project.getActiveProject).toHaveBeenCalledTimes(2);
    expect(f.project.getRootItem).not.toHaveBeenCalled();
  });

  it("reacquires exact native-graphic targets across every awaited effect leaf and source metadata read", async () => {
    const f=graphicFixture();
    const result=await f.agent.queryTimeline({ids:['video:0:0:'],limit:1,includeEffects:true,includeSourceMetadata:true,expectedProjectId:'project-1',expectedSequenceId:'sequence-1'});
    expect(result.items).toMatchObject([{id:'video:0:0:',projectItemId:'',name:'Clip 0',sourceMetadata:{status:'unsupported'},components:[{
      matchName:'AE.ADBE Text',params:[{displayName:'Text',value:'Premiere UXP MCP',sampledAt:{ticks:'0',seconds:0},sampledSequenceTime:null,timeMapping:'native_only_use_get_effect_values',readStatus:{value:'pass',animation:'pass'}}],
    }]}]);
    expect(f.inspect()).toMatchObject({pending:0,peak:1,valueReads:1});
    expect(f.sequence.getVideoTrack.mock.calls.length).toBeGreaterThan(1);
    expect(f.project.getRootItem).not.toHaveBeenCalled();expect(f.metadata).not.toHaveBeenCalled();
  });

  it.each([true,false])('protects audio effect snapshots and waits before metadata after mutations (explicit audio=%s)',async explicitAudio=>{
    const f=graphicFixture('audio'),readTimes:number[]=[];
    const acquire=f.ppro.Project.getActiveProject.getMockImplementation()!;
    f.ppro.Project.getActiveProject.mockImplementation(()=>{readTimes.push(f.now());return acquire();});
    f.lifecycle.noteGraphicMutation(0);
    const result=await f.agent.queryTimeline({...(explicitAudio?{mediaType:'audio'}:{}),ids:['audio:0:0:media-0'],includeEffects:true});
    expect(readTimes[0]).toBe(250);
    expect(result.items).toMatchObject([{id:'audio:0:0:media-0',projectItemId:'media-0',mediaType:'audio',components:[{
      matchName:'Internal Volume Stereo',params:[{displayName:'Level',value:.125,sampledAt:{ticks:'0',seconds:0},sampledSequenceTime:{ticks:'0',seconds:0},timeMapping:'source_to_sequence_1x',readStatus:{value:'pass',animation:'pass'}}],
    }]}]);
    expect(f.inspect()).toMatchObject({pending:0,peak:1,valueReads:1});
    expect(f.audioTrack.mock.calls.length).toBeGreaterThan(1);
    expect(f.project.getRootItem).not.toHaveBeenCalled();
  });

  it('rejects audio source-bound changes rather than mapping values against stale metadata',async()=>{
    const f=graphicFixture('audio');
    f.state.onLeaf=name=>{if(name==='getValueAtTime')f.state.inSeconds=1;};
    await expect(f.agent.queryTimeline({ids:['audio:0:0:media-0'],includeEffects:true})).rejects.toMatchObject({code:'GRAPHIC_NOT_SETTLED'});
    expect(f.inspect().valueReads).toBe(1);
  });

  it.each([{mediaType:'video'}, {ids:['video:0:0:media-0']}])('keeps explicit ordinary video reads immediate after an unrelated mutation ($mediaType $ids)',async query=>{
    let now=0;
    const f=fixture(1,{Date:class extends Date{static now(){return now;}},setTimeout:(resolve:()=>void,ms:number)=>{now+=ms;void Promise.resolve().then(resolve);return 0;}});
    f.component.mockReturnValue({getComponentCount:()=>0});f.lifecycle.noteGraphicMutation(0);
    expect((await f.agent.queryTimeline({...query,includeEffects:true})).items).toHaveLength(1);
    expect(now).toBe(0);expect(f.hydrate).toHaveBeenCalledTimes(1);expect(f.component).toHaveBeenCalledTimes(1);
  });

  it.each(['inPoint','endTime','speed'])("never combines old graphic metadata with effect values after %s drift", async field => {
    const f=graphicFixture();
    f.state.onLeaf=name=>{
      if(name!=='getValueAtTime')return;
      if(field==='inPoint')f.state.inSeconds=1;
      else if(field==='endTime')f.state.endSeconds=3;
      else f.state.speed=2;
    };
    await expect(f.agent.queryTimeline({ids:['video:0:0:'],includeEffects:true})).rejects.toMatchObject({code:'GRAPHIC_NOT_SETTLED'});
    expect(f.inspect().valueReads).toBe(1);
  });

  it.each(['project','sequence'])("propagates permanent %s changes during graphic reads without retrying the old target", async target => {
    const f=graphicFixture();
    f.state.onLeaf=name=>{if(name==='getValueAtTime'){if(target==='project')f.project.guid='switched';else f.sequence.guid='switched';}};
    await expect(f.agent.queryTimeline({ids:['video:0:0:'],includeEffects:true})).rejects.toMatchObject({code:target==='project'?'PROJECT_PRECONDITION_FAILED':'SEQUENCE_PRECONDITION_FAILED'});
    expect(f.inspect().valueReads).toBe(1);
  });

  it("rejects stale pins before scanning and identity drift after a read", async () => {
    const f = fixture();
    await expect(f.agent.queryTimeline({ expectedSequenceId: "old" })).rejects.toThrow("requested query target");
    expect(f.hydrate).not.toHaveBeenCalled();
    f.ppro.Project.getActiveProject.mockImplementationOnce(() => f.project)
      .mockImplementationOnce(() => ({ ...f.project, guid: "switched" }));
    await expect(f.agent.queryTimeline({ limit: 1 })).rejects.toThrow("changed during inspection");
  });

  it("returns empty-host state and allows any saved local project", async () => {
    const f = fixture();
    f.ppro.Project.getActiveProject.mockReturnValueOnce(null as any).mockReturnValueOnce(null as any);
    expect(await f.agent.getAgentContext()).toMatchObject({ status: "no_project", project: null, editBoundary: { allowed: false } });
    f.project.path = "C:\\source\\original.prproj";
    expect(await f.agent.getAgentContext()).toMatchObject({ editBoundary: { allowed: true } });
    f.project.path = "//Example_nas/data3/source.prproj";
    expect(await f.agent.getAgentContext()).toMatchObject({ editBoundary: { allowed: false } });
  });

  it("returns project identity when no sequence is active", async () => {
    const f = fixture();
    f.project.getActiveSequence = () => null as any;
    expect(await f.agent.getAgentContext()).toMatchObject({ status: "no_sequence", project: { id: "project-1" }, sequence: null, editBoundary: { allowed: false } });
    expect(f.hydrate).not.toHaveBeenCalled();
  });

  it("reports scan limits, never claiming completeness after a bounded scan", async () => {
    const f = fixture(1001);
    const result = await f.agent.queryTimeline({ ids: ["absent"] });
    expect(result.items).toEqual([]);
    expect(result.page).toMatchObject({ scannedItemCount: 1000, scanTruncated: true, hasMore: false });
  });

  it("validates pure bounds and exact timeline IDs", () => {
    expect(() => queryBounds({ limit: 101 })).toThrow("INVALID_QUERY");
    expect(() => queryBounds({ includeEffects: true, limit: 21 })).toThrow("INVALID_QUERY");
    expect(parseTimelineId("video:0:123:source:with:colon")?.projectItemId).toBe("source:with:colon");
    expect(parseTimelineId("bad")).toBeNull();
    expect(overlapsRange(0, 2, { startSeconds: 2 })).toBe(false);
  });
});
