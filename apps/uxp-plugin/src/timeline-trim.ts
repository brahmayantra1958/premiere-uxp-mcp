import { exactTicksFromSeconds, nearestFrameTicks } from "./tick-conversion.js";

/** Premiere couples timeline start/end actions with source in/out. Read back both clocks and reacquire a changed item ID; preserving only timeline duration is insufficient. */
export type TrimTimelineItem = {
  id: string;
  projectItemId: string;
  mediaType: string;
  trackIndex: number;
  start: { seconds: number; ticks?: string };
  end: { seconds: number; ticks?: string };
  inPoint: { seconds: number };
  outPoint: { seconds: number };
  speed?: number;
  reversed?: boolean;
};

export type ExactTrimRequest = {
  trackItemId: string;
  expectedProjectItemId: string;
  expectedMediaType: "video" | "audio";
  expectedTrackIndex: number;
  expectedStartSeconds: number;
  expectedEndSeconds: number;
  expectedInPointSeconds: number;
  expectedOutPointSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
};

export type ExactTrimPlan = {
  targetId: string;
  projectItemId: string;
  mediaType: "video" | "audio";
  trackIndex: number;
  frameRate: number;
  original: { startSeconds: number; endSeconds: number; inPointSeconds: number; outPointSeconds: number };
  expected: { startSeconds: number; endSeconds: number; inPointSeconds: number; outPointSeconds: number };
  writes: { startSeconds?: number; endSeconds?: number };
};

function onFrameGrid(seconds: number, frameRate: number): boolean {
  const frames = seconds * frameRate;
  return Number.isFinite(frames) && Math.abs(frames - Math.round(frames)) <= 0.001;
}

function sameBoundary(actualSeconds: number, expectedSeconds: number, frameRate: number): boolean {
  return Number.isFinite(actualSeconds)
    && Number.isFinite(expectedSeconds)
    && Math.abs(actualSeconds - expectedSeconds) <= Math.max(0.000_001, 0.001 / frameRate);
}

function overlap(start: number, end: number, otherStart: number, otherEnd: number, tolerance: number): boolean {
  return start < otherEnd - tolerance && end > otherStart + tolerance;
}

/**
 * Plan one exact, normal-speed timeline trim after source/timeline identity and
 * collision checks. Premiere couples a timeline start/end trim to the matching
 * source in/out point, so the readback contract includes those derived values.
 */
export function planExactClipTrim(
  request: ExactTrimRequest,
  current: TrimTimelineItem,
  allItems: TrimTimelineItem[],
  frameRate: number,
): ExactTrimPlan {
  if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("Trim requires a positive sequence frame rate");
  if (Math.abs(Number(current.speed ?? 1) - 1) > 0.000_001 || current.reversed) {
    throw new Error("Exact timeline trim currently requires a normal-speed, forward clip");
  }
  if (current.id !== request.trackItemId
    || current.projectItemId !== request.expectedProjectItemId
    || current.mediaType !== request.expectedMediaType
    || current.trackIndex !== request.expectedTrackIndex
    || !sameBoundary(current.start.seconds, request.expectedStartSeconds, frameRate)
    || !sameBoundary(current.end.seconds, request.expectedEndSeconds, frameRate)
    || !sameBoundary(current.inPoint.seconds, request.expectedInPointSeconds, frameRate)
    || !sameBoundary(current.outPoint.seconds, request.expectedOutPointSeconds, frameRate)) {
    throw new Error("Timeline item differs from the exact trim target");
  }
  const writes = Object.fromEntries(Object.entries({
    startSeconds: request.startSeconds,
    endSeconds: request.endSeconds,
  }).filter(([, value]) => value !== undefined)) as ExactTrimPlan["writes"];
  if (!Object.keys(writes).length) throw new Error("Trim requires at least one changed boundary");
  const expected = {
    startSeconds: request.startSeconds ?? current.start.seconds,
    endSeconds: request.endSeconds ?? current.end.seconds,
    inPointSeconds: current.inPoint.seconds + ((request.startSeconds ?? current.start.seconds) - current.start.seconds),
    outPointSeconds: current.outPoint.seconds + ((request.endSeconds ?? current.end.seconds) - current.end.seconds),
  };
  const original = {
    startSeconds: current.start.seconds,
    endSeconds: current.end.seconds,
    inPointSeconds: current.inPoint.seconds,
    outPointSeconds: current.outPoint.seconds,
  };
  if (Object.entries(expected).some(([, value]) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Trim boundaries must be finite and non-negative");
  }
  if (expected.startSeconds >= expected.endSeconds || expected.inPointSeconds >= expected.outPointSeconds) {
    throw new Error("Trim start/in-point must remain before end/out-point");
  }
  if (!onFrameGrid(expected.startSeconds, frameRate) || !onFrameGrid(expected.endSeconds, frameRate)) {
    throw new Error("Timeline trim boundaries must align to the sequence frame grid");
  }
  const changed = Object.keys(writes).some((key) => Math.abs(
    expected[key as keyof typeof expected] - original[key as keyof typeof original],
  ) > 0.000_001);
  if (!changed) throw new Error("Trim request is an exact no-op");
  const tolerance = 0.000_001;
  const collision = allItems.find((item) => item.id !== current.id
    && item.mediaType === current.mediaType
    && item.trackIndex === current.trackIndex
    && overlap(expected.startSeconds, expected.endSeconds, item.start.seconds, item.end.seconds, tolerance));
  if (collision) throw new Error(`Trimmed range overlaps timeline item ${collision.id}`);
  return { targetId: current.id, projectItemId: current.projectItemId, mediaType: request.expectedMediaType, trackIndex: current.trackIndex, frameRate, original, expected, writes };
}

export type ExactTrimTicks = { startTicks: string; endTicks: string; writes: { startTicks?: string; endTicks?: string } };

function originalTicks(value: unknown, name: string): string {
  const ticks = String(value ?? "");
  if (!/^\d+$/.test(ticks)) throw new Error(`Exact trim requires the current ${name} ticks`);
  return ticks;
}

/** Native writes for an accepted plan. Each written boundary is its nearest
 * tick snapped to the frame grid the plan already required (within float
 * noise); an unwritten boundary must keep its current ticks exactly. */
export function exactTrimTicks(plan: ExactTrimPlan, current: Pick<TrimTimelineItem, "start" | "end">, frameTicks: string): ExactTrimTicks {
  const snap = (seconds: number) => nearestFrameTicks(exactTicksFromSeconds(seconds), frameTicks);
  const writes = {
    ...(plan.writes.startSeconds !== undefined ? { startTicks: snap(plan.writes.startSeconds) } : {}),
    ...(plan.writes.endSeconds !== undefined ? { endTicks: snap(plan.writes.endSeconds) } : {}),
  };
  const startTicks = writes.startTicks ?? originalTicks(current.start.ticks, "start");
  const endTicks = writes.endTicks ?? originalTicks(current.end.ticks, "end");
  if (BigInt(startTicks) >= BigInt(endTicks)) throw new Error("Trim start must remain before end on the frame grid");
  return { startTicks, endTicks, writes };
}

/** Tick-exact readback, the same identity the effect-job baseline compares. */
export function trimTicksMatch(observed: Pick<TrimTimelineItem, "start" | "end"> | undefined, expected: ExactTrimTicks): boolean {
  return Boolean(observed) && String(observed!.start.ticks) === expected.startTicks && String(observed!.end.ticks) === expected.endTicks;
}

export function assessExactClipTrim(
  beforeItems: TrimTimelineItem[],
  afterItems: TrimTimelineItem[],
  plan: ExactTrimPlan,
): {
  status: "pass" | "fail";
  trimmedItemId?: string;
  observedTargetId?: string;
  observedTarget?: TrimTimelineItem;
  sourceRangeMatches: boolean;
  missingUnrelatedIds: string[];
  unexpectedIds: string[];
} {
  const beforeIds = new Set(beforeItems.map((item) => item.id));
  const afterIds = new Set(afterItems.map((item) => item.id));
  const timelineCandidates = afterItems.filter((item) => item.projectItemId === plan.projectItemId
    && item.mediaType === plan.mediaType
    && item.trackIndex === plan.trackIndex
    && sameBoundary(item.start.seconds, plan.expected.startSeconds, plan.frameRate)
    && sameBoundary(item.end.seconds, plan.expected.endSeconds, plan.frameRate));
  const observedTarget = timelineCandidates.length === 1 ? timelineCandidates[0] : undefined;
  const sourceRangeMatches = Boolean(observedTarget
    && sameBoundary(observedTarget.inPoint.seconds, plan.expected.inPointSeconds, plan.frameRate)
    && sameBoundary(observedTarget.outPoint.seconds, plan.expected.outPointSeconds, plan.frameRate));
  const trimmed = sourceRangeMatches ? observedTarget : undefined;
  const missingUnrelatedIds = [...beforeIds]
    .filter((id) => id !== plan.targetId && !afterIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  const unexpectedIds = [...afterIds]
    .filter((id) => !beforeIds.has(id) && id !== observedTarget?.id)
    .sort((left, right) => left.localeCompare(right));
  return {
    status: trimmed
      && missingUnrelatedIds.length === 0
      && unexpectedIds.length === 0
      && afterItems.length === beforeItems.length
      ? "pass"
      : "fail",
    ...(trimmed ? { trimmedItemId: trimmed.id } : {}),
    ...(observedTarget ? { observedTargetId: observedTarget.id, observedTarget } : {}),
    sourceRangeMatches,
    missingUnrelatedIds,
    unexpectedIds,
  };
}
