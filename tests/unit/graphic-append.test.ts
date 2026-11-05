import { expect, it, vi } from 'vitest';
import { graphicAppendErrors, requireEmptyGraphicAppendTransitions, verifyGraphicAppendTrackStates } from '../../apps/uxp-plugin/src/graphic-append.js';
import { assessGraphicInsertion } from '../../apps/uxp-plugin/src/graphic-insertion.js';

const time = (ticks: number) => ({ ticks: String(ticks), seconds: ticks / 254016000000 });
const item = (id: string, mediaType='video', start=0, end=100) => ({ id, name: id, projectItemId: '', mediaType, trackIndex: 0, start: time(start), end: time(end), inPoint: time(900), outPoint: time(1300), disabled: false, speed: 1, reversed: false, adjustmentLayer: false });
function fixture() {
  const before: any = { id: 's', name: 'S', width: 1920, height: 1080, frameRate: 24, videoTracks: 1, audioTracks: 1, captionTracks: 0, itemsTruncated: false,
    items: [item('old')], tracks: [{ mediaType: 'video', index: 0, id: 1, name: 'V', muted: false, itemCount: 1, transitionCount: 0 }, { mediaType: 'audio', index: 0, id: 1, name: 'A', muted: false, itemCount: 0, transitionCount: 0 }], transitions: [], captionTrackStates: [] };
  const args = { videoTrackIndex: 0, audioTrackIndex: 0, expectedVideoTrackItemCount: 1, timeSeconds: 100 / 254016000000, durationSeconds: 10 / 254016000000 };
  const after = structuredClone(before); after.items.push(item('new', 'video', 100, 110)); after.tracks[0].itemCount++;
  return { before, after, args };
}

it('accepts an exact adjacent trailing boundary and a later gap, including a four-frame native source span', () => {
  const { before, after, args } = fixture();
  expect(graphicAppendErrors(before, args)).toEqual([]);
  expect(graphicAppendErrors(before, { ...args, timeSeconds: 200 / 254016000000 })).toEqual([]);
  expect(graphicAppendErrors(after, args, true)).toEqual([]);
  expect(assessGraphicInsertion(before, after, args).errors).toEqual([]);
});

it.each(['one-tick-overlap', 'later-video', 'later-audio', 'disabled-later', 'missing-source', 'missing-state', 'invalid-ticks', 'duplicate-id', 'stale-count', 'truncated', 'transition', 'count-coverage'])('refuses %s before dispatch can be authorized', fault => {
  const { before, args } = fixture();
  if (fault === 'one-tick-overlap') before.items[0].end = time(101);
  if (fault === 'later-video' || fault === 'disabled-later') { before.items[0].start = time(200); before.items[0].end = time(300); before.items[0].disabled = fault === 'disabled-later'; }
  if (fault === 'later-audio') { before.items.push(item('audio', 'audio', 200, 300)); before.tracks[1].itemCount++; }
  if (fault === 'missing-source') delete before.items[0].inPoint;
  if (fault === 'missing-state') delete before.items[0].reversed;
  if (fault === 'invalid-ticks') before.items[0].end.ticks = 'bad';
  if (fault === 'duplicate-id') { before.items.push(structuredClone(before.items[0])); before.tracks[0].itemCount++; }
  if (fault === 'stale-count') args.expectedVideoTrackItemCount = 2;
  if (fault === 'truncated') before.itemsTruncated = true;
  if (fault === 'transition') { before.transitions.push({ id: 't', trackIndex: 0, start: time(0), end: time(10) }); before.tracks[0].transitionCount++; }
  if (fault === 'count-coverage') before.tracks[1].itemCount = 1;
  expect(graphicAppendErrors(before, args).length).toBeGreaterThan(0);
});

it.each(['source', 'speed', 'disabled', 'track-name', 'other-track-mute', 'track-count', 'settings', 'sequence', 'transition', 'caption', 'extra-audio', 'ripple', 'one-tick-duration'])('retains final preservation rejection for %s', fault => {
  const { before, after, args } = fixture();
  if (fault === 'source') after.items[0].inPoint = time(901);
  if (fault === 'speed') after.items[0].speed = 2;
  if (fault === 'disabled') after.items[0].disabled = true;
  if (fault === 'track-name') after.tracks[0].name = 'renamed';
  if (fault === 'other-track-mute') after.tracks[1].muted = true;
  if (fault === 'track-count') after.tracks[0].itemCount++;
  if (fault === 'settings') after.width = 1080;
  if (fault === 'sequence') after.id = 'other';
  if (fault === 'transition') after.transitions.push({ id: 'new-transition' });
  if (fault === 'caption') after.captionTrackStates.push({ id: 'caption' });
  if (fault === 'extra-audio') after.items.push(item('extra', 'audio', 100, 110));
  if (fault === 'ripple') { after.items[0].start = time(1); after.items[0].end = time(101); }
  if (fault === 'one-tick-duration') after.items[1].end = time(111);
  expect(assessGraphicInsertion(before, after, args).errors.length).toBeGreaterThan(0);
});

it.each([null, undefined, [{}], [{ getStartTime: () => { throw Error('sentinel'); } }]])('never treats a raw transition collection %j as proven empty', async collection => {
  await expect(requireEmptyGraphicAppendTransitions(async () => collection)).rejects.toThrow('raw video transition');
});

it('keeps raw native collection reads serial and propagates failure', async () => {
  let finish!: (value: unknown) => void;
  const read = vi.fn((media: string) => media === 'video' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]));
  const pending = requireEmptyGraphicAppendTransitions(read);
  await Promise.resolve(); expect(read).toHaveBeenCalledTimes(1);
  finish([]); await pending; expect(read.mock.calls.map(call => call[0])).toEqual(['video', 'audio']);
  await expect(requireEmptyGraphicAppendTransitions(async () => { throw Error('native failed'); })).rejects.toThrow('native failed');
});

it('does not accept the ordinary snapshot mute fallback as native track-state proof', async () => {
  const { before } = fixture();
  const read = async (media: string) => { const track = before.tracks.find((t: any) => t.mediaType === media); return { id: track.id, name: track.name, muted: track.muted }; };
  await expect(verifyGraphicAppendTrackStates(before, read)).resolves.toBeUndefined();
  await expect(verifyGraphicAppendTrackStates(before, async () => { throw Error('mute unsupported'); })).rejects.toThrow('mute unsupported');
  await expect(verifyGraphicAppendTrackStates(before, async media => ({ ...await read(media), muted: true }))).rejects.toThrow('track identity or mute');
});
