import { equalSnapshotValue } from './snapshot-equality.js';
type Snapshot = Record<string, any>;

const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const tick = (value: any) => typeof value?.ticks === 'string' && /^-?\d+$/.test(value.ticks) && Number.isFinite(value.seconds);
const range = (item: Snapshot, start: string, end: string) => tick(item[start]) && tick(item[end]) && BigInt(item[end].ticks) > BigInt(item[start].ticks);

/** A trailing append may expose the template's unknown initial duration. It
 * therefore requires a complete empty suffix on BOTH destination media tracks.
 * This checks detached timeline metadata, not old clips' effect values. */
export function graphicAppendErrors(snapshot: Snapshot, args: Snapshot, afterInsertion=false): string[] {
  const errors: string[] = [];
  if (snapshot.itemsTruncated !== false || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.tracks)
    || !Array.isArray(snapshot.transitions) || !Array.isArray(snapshot.captionTrackStates)) return ['Trailing append requires complete timeline collections'];
  if (typeof snapshot.id !== 'string' || !snapshot.id || typeof snapshot.name !== 'string'
    || ![snapshot.width, snapshot.height, snapshot.frameRate].every(value => Number.isFinite(value) && value > 0)) errors.push('Sequence identity or settings are unreadable');
  if (![snapshot.videoTracks, snapshot.audioTracks, snapshot.captionTracks].every(count)) return [...errors, 'Track counts are unreadable'];
  const tracks = new Map<string, Snapshot>();
  for (const track of snapshot.tracks) {
    const key = `${track.mediaType}:${track.index}`, limit = track.mediaType === 'video' ? snapshot.videoTracks : track.mediaType === 'audio' ? snapshot.audioTracks : 0;
    if (!count(track.index) || track.index >= limit || tracks.has(key) || !count(track.id) || typeof track.name !== 'string'
      || typeof track.muted !== 'boolean' || !count(track.itemCount) || !count(track.transitionCount)) errors.push('Track metadata is incomplete or duplicated');
    tracks.set(key, track);
  }
  if (tracks.size !== snapshot.videoTracks + snapshot.audioTracks || snapshot.tracks.length !== tracks.size) errors.push('Track metadata coverage is incomplete');
  const ids = new Set<string>();
  if (!Number.isFinite(args.timeSeconds) || args.timeSeconds < 0) return [...errors, 'Insertion time is invalid'];
  const startTicks = BigInt(Math.round(Number(args.timeSeconds) * 254016000000));
  for (const item of snapshot.items) {
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || typeof item.projectItemId !== 'string'
      || !['video', 'audio'].includes(item.mediaType) || !count(item.trackIndex) || !tracks.has(`${item.mediaType}:${item.trackIndex}`)
      || !range(item, 'start', 'end') || !range(item, 'inPoint', 'outPoint') || !Number.isFinite(item.speed) || item.speed <= 0
      || !['disabled', 'reversed', 'adjustmentLayer'].every(key => typeof item[key] === 'boolean')) {
      errors.push('Timeline item metadata is incomplete, invalid or duplicated');
    } else {
      if (BigInt(item.start.ticks) < 0n) errors.push('Timeline item starts before zero');
      const targeted = item.mediaType === 'video' && item.trackIndex === args.videoTrackIndex
        || item.mediaType === 'audio' && item.trackIndex === args.audioTrackIndex;
      if (!afterInsertion && targeted && BigInt(item.end.ticks) > startTicks) errors.push('Trailing append requires every destination-track item to end at or before the insertion tick');
    }
    ids.add(item.id);
  }
  for (const [key, track] of tracks) if (snapshot.items.filter((item: Snapshot) => `${item.mediaType}:${item.trackIndex}` === key).length !== track.itemCount) errors.push('Track item count differs from the complete item collection');
  const video = tracks.get(`video:${args.videoTrackIndex}`), audio = tracks.get(`audio:${args.audioTrackIndex}`);
  if (!count(args.expectedVideoTrackItemCount) || !video || video.itemCount !== args.expectedVideoTrackItemCount + (afterInsertion ? 1 : 0) || !audio) errors.push('Destination item count or track changed');
  if (video?.transitionCount !== 0 || audio?.transitionCount !== 0) errors.push('Trailing append requires both destination tracks to contain no transitions');
  const transitionIds = new Set<string>();
  for (const transition of snapshot.transitions) {
    if (typeof transition.id !== 'string' || !transition.id || transitionIds.has(transition.id) || !count(transition.trackIndex)
      || !tracks.has(`video:${transition.trackIndex}`) || !range(transition, 'start', 'end')) errors.push('Transition metadata is incomplete or duplicated');
    if (transition.trackIndex === args.videoTrackIndex) errors.push('Trailing append target contains a transition');
    transitionIds.add(transition.id);
  }
  for (const track of snapshot.tracks.filter((entry: Snapshot) => entry.mediaType === 'video')) if (snapshot.transitions.filter((transition: Snapshot) => transition.trackIndex === track.index).length !== track.transitionCount) errors.push('Video transition metadata coverage is incomplete');
  const captionIndices = new Set<number>();
  for (const track of snapshot.captionTrackStates) {
    if (!count(track.index) || track.index >= snapshot.captionTracks || captionIndices.has(track.index) || !count(track.id) || typeof track.name !== 'string'
      || typeof track.muted !== 'boolean' || !count(track.itemCount) || !count(track.transitionCount)) errors.push('Caption track metadata is incomplete or duplicated');
    captionIndices.add(track.index);
  }
  if (captionIndices.size !== snapshot.captionTracks || snapshot.captionTrackStates.length !== captionIndices.size) errors.push('Caption track metadata coverage is incomplete');
  return [...new Set(errors)];
}

/** The general timeline snapshot tolerates unsupported mute getters. An opt-in
 * append must independently prove those track-state fields instead of treating
 * the fallback false value as readback. Each callback supplies a fresh binding. */
export async function verifyGraphicAppendTrackStates(snapshot: Snapshot, read: (mediaType: 'video' | 'audio' | 'caption', index: number) => Promise<unknown>): Promise<void> {
  for (const track of [...snapshot.tracks, ...snapshot.captionTrackStates.map((entry: Snapshot) => ({ ...entry, mediaType: 'caption' }))]) {
    const expected = { id: track.id, name: track.name, muted: track.muted };
    if (!equalSnapshotValue(expected, await read(track.mediaType, track.index))) throw Error('Trailing append track identity or mute state did not read back exactly');
  }
}

/** A raw collection must be genuinely empty. Do not skip unreadable wrappers or
 * treat a transition sentinel/null/failed read as empty for this opt-in route. */
export async function requireEmptyGraphicAppendTransitions(read: (mediaType: 'video' | 'audio') => Promise<unknown>): Promise<void> {
  for (const mediaType of ['video', 'audio'] as const) {
    const collection = await read(mediaType);
    if (!Array.isArray(collection) || collection.length !== 0) throw Error(`Trailing append requires a readable empty raw ${mediaType} transition collection (array=${Array.isArray(collection)}, count=${Array.isArray(collection) ? collection.length : 'unknown'})`);
  }
}
