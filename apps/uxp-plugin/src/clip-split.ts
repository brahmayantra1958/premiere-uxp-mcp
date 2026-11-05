/** Staging must include hidden/disabled AV extents. The exact split preserves source continuity and effects; a linked group outside the explicit target must not be silently separated. */
export type SplitTimelineItem = Readonly<{
  id: string;
  projectItemId: string;
  mediaType: "video" | "audio";
  trackIndex: number;
  name?: string;
  start: Readonly<{ seconds: number }>;
  end: Readonly<{ seconds: number }>;
  inPoint?: Readonly<{ seconds: number }>;
  outPoint?: Readonly<{ seconds: number }>;
  disabled?: boolean;
  speed?: number;
  reversed?: boolean;
  adjustmentLayer?: boolean;
}>;

export type ClipSplitPlan = Readonly<{
  targetId: string;
  projectItemId: string;
  mediaType: "video" | "audio";
  trackIndex: number;
  originalStartSeconds: number;
  originalEndSeconds: number;
  splitSeconds: number;
  stagingStartSeconds: number;
  stagedTrimStartSeconds: number;
  cloneTimeOffsetSeconds: number;
  finalMoveOffsetSeconds: number;
}>;

export type ClipSplitReadback = Readonly<{
  leftItemId?: string;
  rightItemId?: string;
  left?: SplitTimelineItem;
  right?: SplitTimelineItem;
  unaffectedItemCount: number;
  errors: string[];
}>;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function tolerance(frameRate: number): number {
  return 0.5 / frameRate;
}

/** Floating host clocks may differ by a few picoseconds at a shared cut.
 * An adjacent segment has no positive interior overlap with the target. */
function overlapsInterior(item:SplitTimelineItem,start:number,end:number):boolean {
  return Math.min(item.end.seconds,end)-Math.max(item.start.seconds,start)>0.000_001;
}

function near(a: number, b: number, frameRate: number): boolean {
  return finite(a) && finite(b) && Math.abs(a - b) <= tolerance(frameRate);
}

function seconds(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = Number((value as { seconds?: unknown }).seconds);
  return Number.isFinite(candidate) ? candidate : undefined;
}

function sameOptionalTime(a: unknown, b: unknown, frameRate: number): boolean {
  const left = seconds(a);
  const right = seconds(b);
  return left === undefined && right === undefined
    ? true
    : left !== undefined && right !== undefined && near(left, right, frameRate);
}

function sameUnchangedItem(a: SplitTimelineItem, b: SplitTimelineItem, frameRate: number): boolean {
  return a.id === b.id
    && a.projectItemId === b.projectItemId
    && a.mediaType === b.mediaType
    && a.trackIndex === b.trackIndex
    && a.name === b.name
    && near(a.start.seconds, b.start.seconds, frameRate)
    && near(a.end.seconds, b.end.seconds, frameRate)
    && sameOptionalTime(a.inPoint, b.inPoint, frameRate)
    && sameOptionalTime(a.outPoint, b.outPoint, frameRate)
    && a.disabled === b.disabled
    && a.speed === b.speed
    && a.reversed === b.reversed
    && a.adjustmentLayer === b.adjustmentLayer;
}

/**
 * Plan a public-UXP split without placing a full-duration clone over later clips.
 * The clone is staged after every timeline item, trimmed from the left, then
 * cloned into the cut gap through SequenceEditor before the staging item is
 * lifted. Direct TrackItem movement can leave native collection order stale.
 */
export function planClipSplit(
  items: readonly SplitTimelineItem[],
  targetId: string,
  splitSeconds: number,
  sequenceEndSeconds: number,
  frameRate: number,
): ClipSplitPlan {
  if (!finite(frameRate) || frameRate <= 0) throw new Error("Sequence frame rate must be positive");
  const target = items.find((item) => item.id === targetId);
  if (!target) throw new Error(`Track item not found: ${targetId}`);
  const start = target.start.seconds;
  const end = target.end.seconds;
  if (!finite(splitSeconds)) throw new Error("Split time must be finite");
  const oneFrame = 1 / frameRate;
  if (splitSeconds - start < oneFrame - 0.000_001 || end - splitSeconds < oneFrame - 0.000_001) {
    throw new Error(`Split time must leave at least one frame on both sides of ${targetId}`);
  }
  const overlappingPeer = items.find((item) => item.id !== target.id
    && item.projectItemId === target.projectItemId
    && item.mediaType === target.mediaType
    && item.trackIndex === target.trackIndex
    && overlapsInterior(item,start,end));
  if (overlappingPeer) throw new Error(`Split target overlaps another instance of the same source on its track: ${overlappingPeer.id}`);

  const furthestEnd = Math.max(
    finite(sequenceEndSeconds) ? sequenceEndSeconds : 0,
    ...items.map((item) => item.end.seconds),
  );
  const stagingStartSeconds = Math.ceil((furthestEnd + oneFrame * 2) * frameRate) / frameRate;
  const elapsed = splitSeconds - start;
  const stagedTrimStartSeconds = stagingStartSeconds + elapsed;
  return {
    targetId,
    projectItemId: target.projectItemId,
    mediaType: target.mediaType,
    trackIndex: target.trackIndex,
    originalStartSeconds: start,
    originalEndSeconds: end,
    splitSeconds,
    stagingStartSeconds,
    stagedTrimStartSeconds,
    cloneTimeOffsetSeconds: stagingStartSeconds - start,
    finalMoveOffsetSeconds: start - stagingStartSeconds,
  };
}

/** Verify the two editable clips, source continuity, and every unrelated item. */
export function assessClipSplitReadback(
  before: readonly SplitTimelineItem[],
  after: readonly SplitTimelineItem[],
  plan: ClipSplitPlan,
  frameRate: number,
): ClipSplitReadback {
  const errors: string[] = [];
  const original = before.find((item) => item.id === plan.targetId);
  if (!original) return { unaffectedItemCount: 0, errors: [`Baseline split target is missing: ${plan.targetId}`] };
  const candidates = after.filter((item) => item.projectItemId === plan.projectItemId
    && item.mediaType === plan.mediaType
    && item.trackIndex === plan.trackIndex
    && overlapsInterior(item,plan.originalStartSeconds,plan.originalEndSeconds));
  const left = candidates.find((item) => near(item.start.seconds, plan.originalStartSeconds, frameRate)
    && near(item.end.seconds, plan.splitSeconds, frameRate));
  const right = candidates.find((item) => near(item.start.seconds, plan.splitSeconds, frameRate)
    && near(item.end.seconds, plan.originalEndSeconds, frameRate));
  if (!left) errors.push("Left split item did not read back at the original start and requested cut");
  if (!right) errors.push("Right split item did not read back at the requested cut and original end");
  if (candidates.length !== 2) errors.push(`Expected exactly two target segments, read back ${candidates.length}`);
  if (after.length !== before.length + 1) errors.push(`Split changed timeline item count by ${after.length - before.length}; expected +1`);

  let unaffectedItemCount = 0;
  for (const prior of before) {
    if (prior.id === plan.targetId) continue;
    const current = after.find((item) => item.id === prior.id);
    if (!current || !sameUnchangedItem(prior, current, frameRate)) {
      errors.push(`Split changed or removed an unrelated timeline item: ${prior.id}`);
    } else {
      unaffectedItemCount += 1;
    }
  }

  if (left && right) {
    for (const item of [left, right]) {
      if (item.projectItemId !== original.projectItemId || item.mediaType !== original.mediaType || item.trackIndex !== original.trackIndex) {
        errors.push(`Split segment identity mismatch: ${item.id}`);
      }
      if (item.name !== original.name || item.disabled !== original.disabled || item.speed !== original.speed || item.reversed !== original.reversed || item.adjustmentLayer !== original.adjustmentLayer) {
        errors.push(`Split segment state mismatch: ${item.id}`);
      }
    }
    const inBefore = seconds(original.inPoint);
    const outBefore = seconds(original.outPoint);
    const leftIn = seconds(left.inPoint);
    const leftOut = seconds(left.outPoint);
    const rightIn = seconds(right.inPoint);
    const rightOut = seconds(right.outPoint);
    if ([inBefore, outBefore, leftIn, leftOut, rightIn, rightOut].some((value) => value === undefined)) {
      errors.push("Split source in/out points were not fully readable");
    } else if (original.reversed) {
      if (!near(leftOut!, outBefore!, frameRate) || !near(rightIn!, inBefore!, frameRate) || !near(leftIn!, rightOut!, frameRate)) {
        errors.push("Reversed split source ranges are not contiguous with the original source range");
      }
    } else if (!near(leftIn!, inBefore!, frameRate) || !near(rightOut!, outBefore!, frameRate) || !near(leftOut!, rightIn!, frameRate)) {
      errors.push("Split source ranges are not contiguous with the original source range");
    }
  }

  return {
    ...(left ? { leftItemId: left.id, left } : {}),
    ...(right ? { rightItemId: right.id, right } : {}),
    unaffectedItemCount,
    errors,
  };
}

export function assessClipSplitRecovery(
  before: readonly SplitTimelineItem[],
  after: readonly SplitTimelineItem[],
  frameRate: number,
): string[] {
  const errors: string[] = [];
  if (before.length !== after.length) errors.push(`Recovery item count mismatch: ${before.length} -> ${after.length}`);
  for (const prior of before) {
    const current = after.find((item) => item.id === prior.id);
    if (!current || !sameUnchangedItem(prior, current, frameRate)) errors.push(`Recovery did not restore timeline item: ${prior.id}`);
  }
  return errors;
}
