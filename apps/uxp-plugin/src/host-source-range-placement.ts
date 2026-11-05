import { mutationContext, ppro, exactTickFromSeconds, sequenceId, assertMethod } from './host-context.js';
import { findProjectItem } from './host-items.js';
import { sequenceSnapshot } from './host-sequence.js';
import { readMediaDuration, readSourceEditability } from './host-source-editability.js';
import { placementIntervalsOverlap } from './placement-interval.js';
import { equalSnapshotValue } from './snapshot-equality.js';
import type { AnyRecord } from './host-foundation.js';
import type { HostResult } from './wire.js';

type Transaction = (project: any, label: string, actions: () => any[]) => boolean;

async function marks(clip: any) {
  const result: Record<string, { inTicks: string; outTicks: string }> = {};
  for (const kind of ['video', 'audio']) {
    try {
      const mediaType = ppro.Constants.MediaType[kind.toUpperCase()];
      const start = await clip.getInPoint(mediaType), end = await clip.getOutPoint(mediaType);
      if (/^\d+$/.test(String(start?.ticks)) && /^\d+$/.test(String(end?.ticks)) && BigInt(end.ticks) > BigInt(start.ticks))
        result[kind] = { inTicks: String(start.ticks), outTicks: String(end.ticks) };
    } catch { /* Missing requested streams reject below. */ }
  }
  return result;
}

/** One original ProjectItem, one empty destination. Mark -> place -> restore are
 * separate transactions because native actions can capture earlier mark values.
 * Every phase reacquires its wrapper. A failed phase is never replayed. */
export async function placeSourceRange(args: AnyRecord, transaction: Transaction): Promise<HostResult> {
  let dispatched = false;
  const errors: string[] = [];
  let before: AnyRecord | undefined, after: AnyRecord | undefined;
  let sourceMarksRestored = false;
  try {
    if (args.placements?.length !== 1 || !args.expectedSequenceName) throw Error('SOURCE_RANGE_REQUIRES_ONE_PLACEMENT_AND_NAMED_TARGET');
    const p = args.placements[0], range = p.sourceRange;
    if (p.mode !== 'overwrite' || !p.requireEmpty || !p.expectedMediaTypes?.length) throw Error('SOURCE_RANGE_REQUIRES_EMPTY_OVERWRITE_AND_STREAMS');
    if (p.expectedDurationSeconds !== undefined || p.expectedSourceInSeconds !== undefined) throw Error('SOURCE_RANGE_CONFLICTING_LEGACY_EXPECTATIONS');
    const initial = await mutationContext(args);
    const frame = BigInt(await initial.sequence.getTimebase());
    const start = exactTickFromSeconds(Number(p.timeSeconds));
    const sourceIn = exactTickFromSeconds(Number(range.inPointSeconds)), sourceOut = exactTickFromSeconds(Number(range.outPointSeconds));
    const length = BigInt(sourceOut.ticks) - BigInt(sourceIn.ticks);
    if (frame <= 0n || length <= 0n || length % frame !== 0n || BigInt(start.ticks) % frame !== 0n) throw Error('SOURCE_RANGE_FRAME_ALIGNMENT_REQUIRED');
    before = await sequenceSnapshot(initial.sequence);
    if (before.itemsTruncated) throw Error('SOURCE_RANGE_TIMELINE_INCOMPLETE');
    const trackIndex = (kind: string) => Number(kind === 'video' ? p.videoTrackIndex : p.audioTrackIndex);
    for (const kind of ['video', 'audio']) {
      if (!Number.isInteger(trackIndex(kind)) || trackIndex(kind) < 0 || trackIndex(kind) >= before[kind + 'Tracks']) throw Error('SOURCE_RANGE_EXISTING_TRACK_REQUIRED');
    }
    // Protect both destination streams even when only one was requested. The
    // editor has no stream-selection argument; an unexpected stream must not overwrite a peer.
    const occupied = before.items.find((item: AnyRecord) => item.trackIndex === trackIndex(item.mediaType) && placementIntervalsOverlap(Number(p.timeSeconds), Number(length) / 254016000000, item.start.seconds, item.end.seconds - item.start.seconds));
    if (occupied) throw Error(`PLACEMENT_RANGE_OCCUPIED: ${occupied.mediaType} track ${occupied.trackIndex}; expectedMediaTypes verifies inserted streams but does not select them. Public overwrite can insert both source streams, so both destination ranges must be empty.`);
    if (before.transitions.some((item: AnyRecord) => item.trackIndex === p.videoTrackIndex && placementIntervalsOverlap(Number(p.timeSeconds), Number(length) / 254016000000, item.start.seconds, item.end.seconds - item.start.seconds))) throw Error('SOURCE_RANGE_TRANSITION_OVERLAP');
    const acquire = async () => {
      const context = await mutationContext(args);
      const raw = await findProjectItem(context.project, p.projectItemId);
      return { ...context, raw, clip: await ppro.ClipProjectItem.cast(raw) };
    };
    let current = await acquire();
    if (await current.clip.isSequence?.() || await current.clip.isOffline?.()) throw Error('SOURCE_RANGE_ONLINE_FILE_REQUIRED');
    const sourcePath = String(await current.clip.getMediaFilePath());
    if (!sourcePath) throw Error('SOURCE_RANGE_FILE_REQUIRED');
    const duration = await readMediaDuration(current.clip);
    if (BigInt(sourceOut.ticks) > BigInt(duration)) throw Error('SOURCE_RANGE_OUTSIDE_MEDIA');
    const original = await marks(current.clip), saved = Object.values(original)[0];
    const missingMarks = p.expectedMediaTypes.filter((kind: string) => !original[kind]);
    if (!saved || missingMarks.length) throw Error(`SOURCE_MARKS_NOT_RESTORABLE: readable source in/out bounds unavailable for ${missingMarks.join(', ') || 'all streams'}; exact source mark restoration cannot be proven. Full-source placement plus trim_clip_exact requires the full insertion range to be empty.`);
    if (Object.values(original).some(mark => !equalSnapshotValue(mark, saved))) throw Error('SOURCE_MARKS_NOT_RESTORABLE: independent A/V source marks differ; the public source-mark setter has no mediaType argument and cannot restore them independently. Full-source placement plus trim_clip_exact requires the full insertion range to be empty.');
    assertMethod(current.clip, 'createSetInOutPointsAction');
    assertMethod(ppro.SequenceEditor.getEditor(current.sequence), 'createOverwriteItemAction');
    // Only bounded, readable mark values are restored. No guessed clear/sentinel state.
    try {
      dispatched = true;
      if (!transaction(current.project, 'Set source range for placement', () => [current.clip.createSetInOutPointsAction(sourceIn, sourceOut)])) throw Error('SOURCE_MARK_WRITE_UNVERIFIED');
      current = await acquire();
      const marked = await marks(current.clip);
      if (Object.keys(original).some(kind => marked[kind]?.inTicks !== sourceIn.ticks || marked[kind]?.outTicks !== sourceOut.ticks)) throw Error('SOURCE_MARK_READBACK_UNVERIFIED');
      const fresh = await sequenceSnapshot(current.sequence);
      if (!equalSnapshotValue(fresh.items, before.items) || !equalSnapshotValue(fresh.transitions, before.transitions)) throw Error('SOURCE_RANGE_CONTEXT_CHANGED');
      current = await acquire();
      if (String(await current.clip.getMediaFilePath()) !== sourcePath) throw Error('SOURCE_RANGE_PATH_CHANGED');
      if (!transaction(current.project, 'Place original source range', () => [ppro.SequenceEditor.getEditor(current.sequence).createOverwriteItemAction(current.raw, start, p.videoTrackIndex, p.audioTrackIndex)])) throw Error('SOURCE_RANGE_PLACEMENT_UNVERIFIED');
    } catch (error) { errors.push(String(error)); }
    try {
      // Never restore into another project/sequence or overwrite subsequently changed marks.
      const restore = await acquire(), observed = await marks(restore.clip);
      if (String(await restore.clip.getMediaFilePath()) !== sourcePath) throw Error('SOURCE_RANGE_PATH_CHANGED_BEFORE_RESTORE');
      if (equalSnapshotValue(observed, original)) sourceMarksRestored = true;
      else if (Object.keys(original).every(kind => observed[kind]?.inTicks === sourceIn.ticks && observed[kind]?.outTicks === sourceOut.ticks)) {
        const accepted = transaction(restore.project, 'Restore source marks', () => [restore.clip.createSetInOutPointsAction(ppro.TickTime.createWithTicks(saved.inTicks), ppro.TickTime.createWithTicks(saved.outTicks))]);
        sourceMarksRestored = accepted && equalSnapshotValue(await marks((await acquire()).clip), original);
      }
      if (!sourceMarksRestored) throw Error('SOURCE_MARK_RESTORE_UNVERIFIED');
    } catch (error) { errors.push(String(error)); }
    if (errors.length) throw Error('SOURCE_RANGE_TRANSACTION_UNVERIFIED');
    current = await acquire();
    if (String(await current.clip.getMediaFilePath()) !== sourcePath || await readMediaDuration(current.clip) !== duration) throw Error('SOURCE_RANGE_MEDIA_CHANGED');
    after = await sequenceSnapshot(current.sequence);
    const oldIds = new Set(before.items.map((item: AnyRecord) => item.id));
    const inserted = after.items.filter((item: AnyRecord) => !oldIds.has(item.id));
    if (after.itemsTruncated || !equalSnapshotValue(after.items.filter((item: AnyRecord) => oldIds.has(item.id)), before.items) || !equalSnapshotValue(after.transitions, before.transitions)
      || ['videoTracks','audioTracks','captionTracks'].some(key => after![key] !== before![key])) errors.push('SOURCE_RANGE_UNRELATED_STATE_CHANGED');
    if (inserted.length !== p.expectedMediaTypes.length || p.expectedMediaTypes.some((kind: string) => inserted.filter((item: AnyRecord) => item.mediaType === kind && item.trackIndex === trackIndex(kind)).length !== 1)) errors.push('SOURCE_RANGE_STREAMS_DIFFER');
    for (const item of inserted) if (item.projectItemId !== p.projectItemId || item.start.ticks !== start.ticks || BigInt(item.end.ticks) !== BigInt(start.ticks) + length || item.inPoint?.ticks !== sourceIn.ticks || item.outPoint?.ticks !== sourceOut.ticks || item.disabled !== false || item.speed !== 1 || item.reversed !== false) errors.push('SOURCE_RANGE_READBACK_DIFFERS: ' + item.id);
    for (const kind of p.expectedMediaTypes) {
      const trackItems = after.items.filter((item: AnyRecord) => item.mediaType === kind && item.trackIndex === trackIndex(kind));
      if (trackItems.some((item: AnyRecord, i: number) => i > 0 && BigInt(item.start.ticks) < BigInt(trackItems[i - 1].start.ticks))) errors.push('SOURCE_RANGE_NATIVE_ORDER_UNVERIFIED');
    }
    const editability = [];
    for (const item of inserted) editability.push(await readSourceEditability(current.raw, item, p.sourceMapping));
    return { status: errors.length ? 'unverified' : 'pass', before, hostResult: { sourceRangeProtocol: 1, contentDispatched: true, sourceMarksRestored, structuralOnly: true, placedItemIds: inserted.map((item: AnyRecord) => item.id) },
      after: { ...after, sequenceId: await sequenceId(current.sequence), editability, renderVerification: { status: 'unverified', reason: 'MCP owner must compare captured program frames before overall PASS' } }, placedItemIds: inserted.map((item: AnyRecord) => item.id), errors };
  } catch (error) {
    return { status: dispatched ? 'unverified' : 'fail', before, after, hostResult: { contentDispatched: dispatched, sourceMarksRestored }, errors: [...errors, String(error)] };
  }
}
