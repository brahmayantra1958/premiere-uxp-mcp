import { expect, it } from 'vitest';
import { uxpModules } from '../helpers/uxp-modules.js';

function fixture(fault='none') {
  const TPS = 254016000000, frame = TPS / 24, time = (ticks: number) => ({ ticks: String(ticks), seconds: ticks / TPS });
  const items: any[] = [{ start: 0, end: frame, media: 'video', sourceIn: 3600 * TPS, sourceOut: 3600 * TPS + frame * 4, original: true }];
  if (fault === 'later-video') { items[0].start = frame * 201; items[0].end = frame * 202; }
  if (fault === 'later-audio') items.push({ ...items[0], media: 'audio', start: frame * 201, end: frame * 202 });
  let inserts=0, trims=0, removes=0; let selected: any[]=[];
  const transitionReads: {media: string; includeEmpty: boolean}[]=[];
  const wrapper = (item: any) => ({ item, getProjectItem: () => null, getName: () => 'Graphic', getStartTime: () => time(item.start), getEndTime: () => time(item.end),
    getInPoint: () => time(item.sourceIn), getOutPoint: () => time(item.sourceOut), isDisabled: () => false, getSpeed: () => item.speed??1, isSpeedReversed: () => item.reversed??false, isAdjustmentLayer: () => item.adjustmentLayer??false,
    getComponentChain: async () => ({ getComponentCount: () => 1, getComponentAtIndex: () => ({ getParamCount: () => 1, getDisplayName: async () => 'Graphic', getMatchName: async () => 'AE.ADBE Graphic Group',
      getParam: () => ({ displayName: 'Amount', getValueAtTime: async () => ({ value: fault === 'component-drift' && trims ? 99 : 100 }), isTimeVarying: () => false, areKeyframesSupported: async () => true, getKeyframeListAsTickTimes: () => [] }) }) }),
    createSetEndAction: (end: any) => () => { trims++; item.end = Number(end.ticks); if (fault === 'collateral') items[0].sourceIn++;
      if(fault==='speed-collateral')items[0].speed=2;if(fault==='reversed-collateral')items[0].reversed=true;if(fault==='adjustment-collateral')items[0].adjustmentLayer=true; },
  });
  const emptyPlaceholder={getStartTime:()=>{throw Error('empty track item has no transition timing');}};
  const track = (media: string) => ({ id: 1, name: media === 'video' ? 'V' : 'A', isMuted: () => { if (fault === 'mute-unreadable') throw Error('mute unavailable'); return false; },
    getTrackItems: (kind: number, includeEmpty: boolean) => {
      if(kind===1)return items.filter(item=>item.media===media).map(wrapper);
      transitionReads.push({media,includeEmpty});
      // Adobe's second argument is includeEmptyTrackItems. Existing general
      // snapshots still request these placeholders; strict append must not.
      if(includeEmpty)return [emptyPlaceholder];
      if(fault===`raw-null-${media}`)return null;
      if(fault===`raw-sentinel-${media}`||fault==='sentinel')return [emptyPlaceholder];
      if(fault===`raw-transition-${media}`)return [{getStartTime:()=>time(0),getEndTime:()=>time(frame),getMatchName:()=> 'AE.ADBE Cross Dissolve'}];
      return [];
    } });
  const selection = { addItem: (raw: any) => { selected.push(raw); return true; }, getTrackItems: () => selected };
  const sequence = { guid: 's', name: 'S', getTimebase: () => String(frame), getSettings: () => ({ getVideoFrameRect: () => ({ width: 1920, height: 1080 }), getVideoFrameRate: () => ({ value: 24 }) }),
    getVideoTrackCount: () => 1, getAudioTrackCount: () => 1, getCaptionTrackCount: () => 0, getEndTime: () => time(Math.max(0,...items.map(item => item.end))), getVideoTrack: () => track('video'), getAudioTrack: () => track('audio'),
    clearSelection: async () => { selected=[]; return true; }, getSelection: () => selection, setSelection: () => true };
  const project = { guid: 'p', path: 'C:/fixture.prproj', getActiveSequence: () => sequence, lockedAccess: (callback: any) => callback(),
    executeTransaction: (callback: any) => { callback({ addAction: (action: any) => action() }); return true; } };
  const editor = { insertMogrtFromPath: (_path: string, at: any) => { inserts++; const item={ start: Number(at.ticks), end: Number(at.ticks) + TPS * 5, media: 'video', sourceIn: 3600 * TPS, sourceOut: 3600 * TPS + frame * 4 }; items.push(item); return [wrapper(item)]; },
    createRemoveItemsAction: () => () => { removes++; const removed = new Set(selected.map(raw => raw.item)); for (let i=items.length-1;i>=0;i--) if (removed.has(items[i])) items.splice(i,1); } };
  const load = uxpModules({ Project: { getActiveProject: () => project }, Constants: { TrackItemType: { CLIP: 1, TRANSITION: 2 }, MediaType: { VIDEO: 1, AUDIO: 2 } }, SequenceEditor: { getEditor: () => editor }, TickTime: { TIME_ZERO: time(0), createWithTicks: (ticks: string) => time(Number(ticks)) } });
  const { PremiereHost } = load('apps/uxp-plugin/src/premiere-host.ts');
  const args = { insertionMode: 'trailing_append', expectedProjectId: 'p', expectedSequenceId: 's', expectedSequenceName: 'S', expectedVideoTrackCount: 1, expectedAudioTrackCount: 1, expectedCaptionTrackCount: 0,
    expectedTimelineItemCount: items.length, videoTrackIndex: 0, expectedVideoTrackId: 1, expectedVideoTrackName: 'V', expectedVideoTrackItemCount: 1, audioTrackIndex: 0, timeSeconds: 200 / 24, durationSeconds: 1 / 24, mogrtPath: 'C:/fixture.mogrt' };
  return { args, items, transitionReads, counts: () => ({ inserts, trims, removes }), run: (input: any = args, command='insert_mogrt_caption') => new PremiereHost().dispatchCommand({ version: 1, id: 'append-'+fault, command, args: input }) };
}

it('inserts directly at frame 200, then appends the adjacent frame with full source/component proof', async () => {
  const f=fixture(), first=await f.run();
  expect(first.status).toBe('pass'); expect(first.hostResult.sourceBoundsProof.status).toBe('pass'); expect(first.hostResult.durationPreservation.status).toBe('pass');
  expect(first.hostResult.readback).toMatchObject({ tracksPreserved: true, sequenceSettingsUnchanged: true, changedUnrelatedIds: [] });
  expect(first.hostResult.insertedItem.start.ticks).toBe(String(200*254016000000/24));
  expect(first.hostResult.insertedItem.outPoint.ticks).toBe(String(3600*254016000000+4*254016000000/24));
  const second=await f.run({ ...f.args, timeSeconds: 201/24, expectedTimelineItemCount: 2, expectedVideoTrackItemCount: 2 });
  expect(second.status).toBe('pass'); expect(f.counts()).toEqual({ inserts: 2, trims: 2, removes: 0 });
  expect(f.transitionReads.some(read=>read.includeEmpty)).toBe(true);
  expect(f.transitionReads.filter(read=>!read.includeEmpty)).toEqual(Array.from({length:6},()=>[
    {media:'video',includeEmpty:false},{media:'audio',includeEmpty:false},
  ]).flat());
});

it.each(['video','audio'].flatMap(media=>['null','sentinel','transition'].map(kind=>({media,kind}))))('rejects a $kind from the strict non-empty-item $media collection without insertion',async({media,kind})=>{
  const f=fixture(`raw-${kind}-${media}`),result=await f.run();
  expect(result.status).toBe('fail');expect(result.hostResult.contentDispatched).toBe(false);expect(f.counts().inserts).toBe(0);
  expect(f.transitionReads).toContainEqual({media,includeEmpty:false});
  expect(JSON.stringify(result)).toContain(`raw ${media} transition collection (array=${kind!=='null'}, count=${kind==='null'?'unknown':1})`);
});

it.each(['later-video','later-audio','sentinel','mute-unreadable'])('rejects %s before native insertion', async fault => {
  const f=fixture(fault), result=await f.run(); expect(result.status).toBe('fail'); expect(result.hostResult.contentDispatched).toBe(false); expect(f.counts().inserts).toBe(0);
});

it('keeps existing default empty-track and rectangle routes restricted', async () => {
  const f=fixture();
  expect((await f.run({ ...f.args, insertionMode: 'empty_track' })).hostResult.contentDispatched).toBe(false);
  expect((await f.run(f.args, 'insert_editable_graphic')).hostResult.contentDispatched).toBe(false);
  expect(f.counts().inserts).toBe(0);
  expect((await f.run({ ...f.args,expectedVideoTrackItemCount:2 })).hostResult.contentDispatched).toBe(false);
});

it.each(['component-drift','collateral','speed-collateral','reversed-collateral','adjustment-collateral'])('never replays a dispatched insertion and distinguishes restored versus unrestored %s', async fault => {
  const f=fixture(fault), result=await f.run();
  expect(result.status).toBe(fault==='component-drift'?'fail':'unverified');
  expect(result.hostResult.rollback).toMatchObject({ attempted: true, verified: fault==='component-drift' });
  expect(f.counts()).toEqual({ inserts: 1, trims: 1, removes: 1 });
});
