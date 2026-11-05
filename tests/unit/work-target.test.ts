import { describe, expect, it, vi } from "vitest";
import { uxpModules } from "../helpers/uxp-modules.js";
import { workIntent } from "../../apps/uxp-plugin/src/work-target.js";

import { readWorkIntent } from "../../apps/uxp-plugin/src/read-work-target.js";
import { HostCommandQueue } from "../../apps/uxp-plugin/src/host-command-queue.js";

function fixture() {
  const events: string[] = [];
  const time = (seconds: number) => ({ seconds, ticks: String(Math.round(seconds * 254016000000)) });
  let position = time(1), selected: any[] = [], displayed: any[] = [], active: any;
  const source = { getId: () => "source", name: "Media" };
  const clip = { getProjectItem: () => source, getStartTime: () => time(2), getEndTime: () => time(4),
    getName: () => "Target", getIsSelected: () => selected.includes(clip) };
  const track = { getTrackItems: () => [clip], setMute: vi.fn(() => { throw Error("Must not mute"); }) };
  const selection = { addItem: (item: any) => { selected.push(item); return true; }, getTrackItems: () => selected };
  const sequence = { guid: "sequence", name: "WORKING__Test", getVideoTrackCount: () => 1, getAudioTrackCount: () => 0, getCaptionTrackCount: () => 0,
    getVideoTrack: () => track, getTimebase: () => "8467200000", getPlayerPosition: vi.fn(() => position),
    setPlayerPosition: vi.fn((value: any) => { events.push("playhead"); position = value; return true; }),
    clearSelection: () => { events.push("selection"); selected = []; displayed = []; }, getSelection: () => selection,
    setSelection: vi.fn((value: any) => { displayed = [...value.getTrackItems()]; return true; }) };
  active = sequence;
  const other = { ...sequence, guid: "other", name: "WORKING__Other" };
  const project = { guid: "project", path: "C:\\scratch\\test.prproj", getActiveSequence: () => active, getSequences: () => [sequence, other],
    openSequence: vi.fn(() => { events.push("open"); return true; }),
    setActiveSequence: vi.fn((value: any) => { events.push("activate"); active = value; return true; }) };
  const load = uxpModules({ Project: { getActiveProject: () => project }, Constants: { TrackItemType: { CLIP: 1 } },
    TickTime: { createWithSeconds: time, createWithTicks: (ticks: string) => ({ ticks, seconds: Number(ticks) / 254016000000 }) } });
  const host = load("apps/uxp-plugin/src/host-work-target.ts");
  const select = async (seq: any, entries: any[]) => { await seq.clearSelection(); for (const entry of entries) selection.addItem(entry.raw); };
  const id = `video:0:${time(2).ticks}:source`;
  const request = (command: string, args: any = {}) => ({ version: 1, id: "work", command, args, timeoutMs: 5000 });
  return { events, sequence, project, track, other, load, host, select, id, request, displayed: () => displayed };
}

describe('automatic work follow and explicit navigation',()=>{
  it('retains the last work location for full job proof while preserving targeted public follow',async()=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts'),notify=vi.fn(),host=new PremiereHost(notify);
    const raw=(await f.sequence.getVideoTrack().getTrackItems())[0];
    Object.assign(raw,{getComponentChain:()=>({getComponentCount:()=>1,getComponentAtIndex:()=>({
      getParamCount:()=>1,getDisplayName:async()=> 'Volume',getMatchName:async()=> 'Volume',getParam:()=>({
        displayName:'Level',getValueAtTime:async()=>.125,isTimeVarying:()=>false,areKeyframesSupported:async()=>true,getKeyframeListAsTickTimes:()=>[],
      }),
    })})});
    const panel=vi.spyOn(host,'revealPanel'),effect=vi.spyOn(host,'revealEffect');
    await f.sequence.setPlayerPosition({ticks:'4318272000000',seconds:17});f.events.length=0;
    const args={expectedProjectId:'project',expectedSequenceId:'sequence',ids:[f.id],includeEffects:true,limit:1};
    const result=await host.dispatch({...f.request('query_timeline',args),readPurpose:'job_preservation'});
    expect(result.items[0].components[0].params[0]).toMatchObject({value:.125,readStatus:{value:'pass',animation:'pass'}});
    expect(result.workTarget).toBeUndefined();expect(result.visibility).toBeUndefined();
    expect(f.sequence.getPlayerPosition().seconds).toBe(17);expect(f.events).toEqual([]);expect(notify).not.toHaveBeenCalled();
    expect(panel).not.toHaveBeenCalled();expect(effect).not.toHaveBeenCalled();
    expect(readWorkIntent('query_timeline',args,result)).toMatchObject({itemIds:[f.id]});
    // An argument with the same spelling has no internal authority.
    expect(readWorkIntent('query_timeline',{...args,readPurpose:'job_preservation'},result)).toMatchObject({itemIds:[f.id]});
  });
  it('follows an exact queried clip without reopening panels or replacing selection',async()=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts'),notify=vi.fn(),host=new PremiereHost(notify);
    await f.select(f.sequence,[{raw:(await f.sequence.getVideoTrack().getTrackItems())[0]}]);f.events.length=0;
    const result=await host.dispatch(f.request('query_timeline',{ids:[f.id],limit:1}));
    expect(result.items[0].id).toBe(f.id);expect(result.workTarget).toMatchObject({phase:'after_read',playhead:{seconds:2},clipSelection:'preserved'});
    expect(f.sequence.getSelection().getTrackItems()).toHaveLength(1);expect(f.events).toEqual(['playhead']);expect(notify).toHaveBeenCalledOnce();
  });
  it('keeps the last work position and panel through overview and selection verification',async()=>{
    const f=fixture();
    await f.host.followTimelineWork(f.request('split_clips',{split:{trackItemId:f.id,atSeconds:3}}),f.select,async()=>({status:'pass'}),vi.fn());
    f.events.length=0;
    const result={items:[{id:f.id,start:{seconds:2}}],selection:{items:[{id:f.id,start:{seconds:2}}]}};
    for(const command of ['get_agent_context','inspect_sequence','inspect_project','inspect_timeline_selection','inspect_markers','inspect_effects','inspect_delivery_state','query_timeline']) {
      const observed=await f.host.followTimelineWork(f.request(command,{selectedOnly:true,limit:1}),f.select,async()=>result,vi.fn());
      expect(observed.workTarget).toBeUndefined();
    }
    expect(f.sequence.getPlayerPosition().seconds).toBe(3);expect(f.events).toEqual([]);
    await f.host.followTimelineWork(f.request('query_timeline',{ids:[f.id]}),f.select,async()=>result,vi.fn());
    expect(f.sequence.getPlayerPosition().seconds).toBe(3);expect(f.events).toEqual([]);
  });
  it('keeps an in-clip playhead for untimed edits but honors an explicit time',async()=>{
    const f=fixture();await f.sequence.setPlayerPosition({ticks:'762048000000',seconds:3});f.events.length=0;
    await f.host.followTimelineWork(f.request('set_transform',{trackItemId:f.id}),f.select,async()=>({status:'pass'}),vi.fn());
    expect(f.sequence.getPlayerPosition().seconds).toBe(3);expect(f.events).not.toContain('playhead');
    await f.host.followTimelineWork(f.request('set_transform',{trackItemId:f.id,timeSeconds:2}),f.select,async()=>({status:'pass'}),vi.fn());
    expect(f.sequence.getPlayerPosition().seconds).toBe(2);
  });
  it('reads without claiming user navigation when automatic follow is turned off',async()=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts'),notify=vi.fn(),host=new PremiereHost(notify);
    f.load('apps/uxp-plugin/src/work-follow.ts').workFollow.enabled=false;
    const result=await host.dispatch(f.request('query_timeline',{limit:1}));
    expect(result.items[0].id).toBe(f.id);expect(result.workTarget).toBeUndefined();expect(f.sequence.getPlayerPosition().seconds).toBe(1);expect(f.events).toEqual([]);expect(notify).not.toHaveBeenCalled();
  });
  it('reveals and selects an edit target before dispatch and publishes it first',async()=>{
    const f=fixture();
    const result=await f.host.followTimelineWork(f.request('split_clips',{split:{trackItemId:f.id,atSeconds:2.011}}),f.select,
      async()=>{f.events.push('edit');return {status:'fail',errors:['edit preflight rejected']};},
      (_id:string,target:any)=>{f.events.push('notify');expect(target.playhead.seconds).toBe(2);});
    expect(f.events).toEqual(['open','activate','playhead','selection','notify','edit']);
    expect(result).toMatchObject({status:'fail',workTarget:{phase:'before_command',clipSelection:'pass',sequenceActivation:'pass'}});
  });
  it('never blocks or flips an edit when its navigation fails',async()=>{
    const f=fixture(),dispatch=vi.fn(async()=>({status:'pass'}));
    const result=await f.host.followTimelineWork(f.request('set_transform',{trackItemId:f.id}),async()=>{throw Error('Host selection rejected');},dispatch,vi.fn());
    expect(dispatch).toHaveBeenCalledOnce();expect(result).toMatchObject({status:'pass',workTarget:{status:'unverified',phase:'before_command'}});
    expect(result.workTarget.reason).toContain('Host selection rejected');
    const g=fixture();g.sequence.setPlayerPosition.mockImplementation(()=>true);
    const lying=await g.host.followTimelineWork(g.request('set_transform',{trackItemId:g.id}),g.select,dispatch,vi.fn());
    expect(lying).toMatchObject({status:'pass',workTarget:{status:'unverified'}});expect(lying.workTarget.reason).toContain('Playhead readback');expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('does not dispatch when navigation failure coincides with a changed active target',async()=>{
    const f=fixture(),dispatch=vi.fn();
    await expect(f.host.followTimelineWork(f.request('set_transform',{trackItemId:f.id}),async()=>{f.project.setActiveSequence(f.other);throw Error('boom');},dispatch,vi.fn())).rejects.toThrow('Active target changed');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each(['inspect_project','query_timeline','set_transform'])('rejects a stale current identity for %s before dispatch',async command=>{
    const f=fixture(),dispatch=vi.fn();await expect(f.host.followTimelineWork(f.request(command,{expectedProjectId:'other'}),f.select,dispatch,vi.fn())).rejects.toThrow('requested target');expect(dispatch).not.toHaveBeenCalled();expect(f.events).toEqual([]);
  });
  it('preserves the content result when the user changes selection or playhead during work',async()=>{
    const f=fixture();const result=await f.host.followTimelineWork(f.request('set_transform',{trackItemId:f.id}),f.select,async()=>{await f.sequence.clearSelection();await f.sequence.setPlayerPosition({ticks:'2540160000000',seconds:10});return {status:'pass'};},vi.fn());
    expect(result).toMatchObject({status:'pass',actualTarget:{projectId:'project',sequenceId:'sequence'}});expect(f.sequence.getPlayerPosition().seconds).toBe(10);
  });
  it('keeps exact explicit navigation available and verifies its native position',async()=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts');
    const result=await new PremiereHost().dispatch(f.request('focus_timeline',{expectedProjectId:'project',sequenceId:'sequence',trackItemIds:[f.id]}));
    expect(result.workTarget.playhead.seconds).toBe(2);expect(f.project.openSequence).toHaveBeenCalledOnce();
    f.sequence.setPlayerPosition.mockImplementation(()=>true);
    await expect(new PremiereHost().dispatch(f.request('focus_timeline',{expectedProjectId:'project',sequenceId:'sequence',timeSeconds:5}))).rejects.toThrow('Playhead readback');
  });
  it('keeps explicit target resolution separate from automatic dispatch',()=>{
    expect(workIntent('set_effect_keyframes',{trackItemId:'a',keyframes:[{timeSeconds:8}]}).timeSeconds).toBe(8);
    expect(readWorkIntent('query_timeline',{}, {items:[{id:'video:0:1:p',start:{seconds:12}}]})).toBeUndefined();
    expect(readWorkIntent('query_timeline',{startSeconds:15}, {items:[{id:'video:0:1:p',start:{seconds:12}}]})).toMatchObject({timeSeconds:15});
  });
  it('reports queued/running work, rejects duplicates and cleans up expired work',async()=>{
    const f=fixture(),queue=new HostCommandQueue();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const first=queue.run({...f.request('set_transform'),id:'first'},async()=>{await gate;});
    const second=queue.run({...f.request('query_timeline'),id:'second',timeoutMs:-1},async()=>{throw Error('must not dispatch');});
    const failed=expect(second).rejects.toThrow('expired waiting');await Promise.resolve();
    expect(queue.inspect()).toEqual([{id:'first',command:'set_transform',state:'running'},{id:'second',command:'query_timeline',state:'queued'}]);
    expect(()=>queue.run({...f.request('query_timeline'),id:'first'},async()=>{})).toThrow('already queued');
    release();await first;await failed;expect(queue.inspect()).toEqual([]);
  });
});
