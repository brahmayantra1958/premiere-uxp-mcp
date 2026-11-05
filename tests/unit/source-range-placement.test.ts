import { expect, it } from 'vitest';
import { uxpModules } from '../helpers/uxp-modules.js';

function fixture(fault = '') {
  const time = (n: number) => ({ seconds: n, ticks: String(Math.round(n * 254016000000)) });
  let sourceIn = time(1), sourceOut = time(9);
  const actions: string[] = [], items: any[] = [];
  const source = { name: 'original.mp4', getId: () => 'source', getMediaFilePath: () => 'C:/original.mp4',
    getMedia: () => ({ duration: Promise.resolve(time(12)) }), isSequence: () => false, isOffline: () => false,
    getInPoint: (kind: string) => fault === 'missing-audio-marks' && kind === 'audio' ? undefined : fault === 'split-marks' && kind === 'audio' ? time(0) : sourceIn, getOutPoint: () => sourceOut,
    createSetInOutPointsAction: (start: any, end: any) => () => { actions.push('marks:' + start.seconds); if (fault === 'restore' && start.seconds === 1) return; sourceIn = start; sourceOut = end; } };
  const clip = (at: number, end: number, si: any, so: any, id = source) => ({ getName: () => 'clip', getProjectItem: () => id,
    getStartTime: () => time(at), getEndTime: () => time(end), getInPoint: () => si, getOutPoint: () => so,
    isDisabled: () => false, getSpeed: () => 1, isSpeedReversed: () => false, getComponentChain: () => ({ getComponentCount: () => 0 }),
    createSetStartAction: (next: any) => () => { si = time(si.seconds + next.seconds - at); at = next.seconds; },
    createSetEndAction: (next: any) => () => { so = time(so.seconds + next.seconds - end); end = next.seconds; } });
  const track = (kind: string) => ({ getTrackItems: (type: number) => type === 1 && kind === 'video' ? items : [], isMuted: () => false });
  const sequence = { guid: 's', name: 'Sequence', getTimebase: () => time(1 / 25).ticks, getVideoTrackCount: () => 1, getAudioTrackCount: () => 1, getCaptionTrackCount: () => 0,
    getVideoTrack: () => track('video'), getAudioTrack: () => track('audio'), getEndTime: () => time(30),
    getSettings: () => ({ getVideoFrameRect: () => ({ width: 1920, height: 1080 }), getVideoFrameRate: () => ({ value: 25 }) }) };
  const root = { getId: () => 'root', getItems: () => [source] };
  const project = { guid: 'p', path: 'C:/scratch/project.prproj', getActiveSequence: () => sequence, getRootItem: () => root,
    lockedAccess: (f: any) => f(), executeTransaction: (f: any) => { const deferred: any[] = []; f({ addAction: (a: any) => deferred.push(a) }); deferred.forEach(a => a()); return true; } };
  const editor = { createOverwriteItemAction: (_raw: any, at: any) => {
    const si = { ...sourceIn }, so = { ...sourceOut };
    return () => { actions.push('place'); if (fault === 'place') throw Error('native disconnect'); items.push(clip(at.seconds, at.seconds + so.seconds - si.seconds, fault === 'in' ? time(0) : si, so)); if (fault !== 'order') items.sort((a, b) => a.getStartTime().seconds - b.getStartTime().seconds); };
  } };
  const load = uxpModules({ Project: { getActiveProject: () => project }, SequenceEditor: { getEditor: () => editor }, ClipProjectItem: { cast: (r: any) => r }, FolderItem: { cast: (r: any) => r === root ? r : null },
    Constants: { TrackItemType: { CLIP: 1, TRANSITION: 2 }, MediaType: { VIDEO: 'video', AUDIO: 'audio' } }, TickTime: { createWithSeconds: time, createWithTicks: (ticks: string) => ({ ticks, seconds: Number(ticks) / 254016000000 }) } });
  load('apps/uxp-plugin/src/work-follow.ts').workFollow.enabled = false;
  const host = new (load('apps/uxp-plugin/src/premiere-host.ts').PremiereHost)();
  const args = { expectedProjectId: 'p', expectedSequenceId: 's', expectedSequenceName: 'Sequence', placements: [{ projectItemId: 'source', timeSeconds: 10, videoTrackIndex: 0, audioTrackIndex: 0, mode: 'overwrite', requireEmpty: true, expectedMediaTypes: ['video'], sourceRange: { inPointSeconds: 2, outPointSeconds: 5 } }] };
  return { args, actions, items, clip, time, marks: () => [sourceIn.seconds, sourceOut.seconds], run: (a = args) => host.dispatch({ version: 1, id: 'test', command: 'place_clips', args: a, timeoutMs: 5000 }),
    trim: (trim: any) => host.dispatch({ version: 1, id: 'trim', command: 'trim_clip_exact', args: { expectedProjectId: 'p', expectedSequenceId: 's', expectedSequenceName: 'Sequence', trim }, timeoutMs: 5000 }) };
}

it('places original source 2–5s at 10–13s, preserves peers, restores marks, returns handles', async () => {
  const f = fixture(); f.items.push(f.clip(20, 21, f.time(0), f.time(1)));
  const result = await f.run();
  expect(result).toMatchObject({ status: 'pass', hostResult: { structuralOnly: true, sourceMarksRestored: true, sourceRangeProtocol: 1 }, after: { editability: [{ handles: { headSeconds: 2, tailSeconds: 7 } }], renderVerification: { status: 'unverified' } } });
  expect(f.marks()).toEqual([1, 9]); expect(f.actions).toEqual(['marks:2', 'place', 'marks:1']);
  expect(f.items).toHaveLength(2);
});
it.each(['in', 'restore', 'place'])('retains post-dispatch uncertainty for %s; no replay', async fault => {
  const f = fixture(fault); const result = await f.run();
  expect(result).toMatchObject({ status: 'unverified', hostResult: { contentDispatched: true } });
  expect(f.actions.filter(s => s === 'place')).toHaveLength(1);
  if (fault !== 'restore') expect(f.marks()).toEqual([1, 9]);
});
it('refuses independently marked A/V without changing either marker', async () => {
  const f = fixture('split-marks'); expect(await f.run()).toMatchObject({ status: 'fail', hostResult: { contentDispatched: false }, errors: [expect.stringContaining('independent A/V source marks differ')] }); expect(f.actions).toEqual([]);
});
it('keeps both destination streams protected for an audio-only expectation', async () => {
  const f = fixture(); f.args.placements[0].expectedMediaTypes = ['audio'];
  f.items.push(f.clip(12, 14, f.time(0), f.time(2)));
  expect(await f.run()).toMatchObject({ status: 'fail', hostResult: { contentDispatched: false }, errors: [expect.stringContaining('expectedMediaTypes verifies inserted streams but does not select them')] });
  expect(f.actions).toEqual([]); expect(f.marks()).toEqual([1, 9]);
});
it('explains unavailable audio marks without guessing clear state or writing marks', async () => {
  const f = fixture('missing-audio-marks'); f.args.placements[0].expectedMediaTypes = ['audio'];
  expect(await f.run()).toMatchObject({ status: 'fail', hostResult: { contentDispatched: false }, errors: [expect.stringContaining('readable source in/out bounds unavailable for audio')] });
  expect(f.actions).toEqual([]); expect(f.marks()).toEqual([1, 9]);
});
it.each(['occupied', 'off-grid', 'out-of-media', 'wrong-target', 'multiple', 'insert', 'legacy'])('rejects %s before changing source marks', async fault => {
  const f = fixture();
  if (fault === 'occupied') f.items.push(f.clip(12, 14, f.time(0), f.time(2)));
  if (fault === 'off-grid') f.args.placements[0].sourceRange.outPointSeconds = 5.01;
  if (fault === 'out-of-media') f.args.placements[0].sourceRange.outPointSeconds = 13;
  if (fault === 'wrong-target') f.args.expectedSequenceId = 'other';
  if (fault === 'multiple') f.args.placements.push(f.args.placements[0]);
  if (fault === 'insert') f.args.placements[0].mode = 'insert';
  if (fault === 'legacy') (f.args.placements[0] as any).expectedDurationSeconds = 3;
  expect(await f.run()).toMatchObject({ status: 'fail', hostResult: { contentDispatched: false } }); expect(f.actions).toEqual([]);
});
it('allows an exactly adjacent peer without dropping its first frame', async () => {
  const f = fixture(); f.items.push(f.clip(13, 14, f.time(0), f.time(1))); expect((await f.run()).status).toBe('pass');
});
it('rejects the A1 native ordering defect even when the inserted model values match', async () => {
  const f = fixture('order'); f.items.push(f.clip(20, 21, f.time(0), f.time(1)));
  expect(await f.run()).toMatchObject({ status: 'unverified', errors: ['SOURCE_RANGE_NATIVE_ORDER_UNVERIFIED'] });
});
it('recomputes handles from the actual coupled source range after an exact trim', async () => {
  const f = fixture(); const placed = await f.run();
  const result = await f.trim({ trackItemId: placed.placedItemIds[0], expectedProjectItemId: 'source', expectedMediaType: 'video', expectedTrackIndex: 0,
    expectedStartSeconds: 10, expectedEndSeconds: 13, expectedInPointSeconds: 2, expectedOutPointSeconds: 5, startSeconds: 8, endSeconds: 20 });
  expect(result).toMatchObject({ status: 'pass', after: { editability: [{ handles: { headSeconds: 0, tailSeconds: 0 }, warnings: [expect.stringContaining('NO_SOURCE_HANDLES')] }], renderVerification: { status: 'unverified' } } });
});
