import { isFrameAligned } from "./timing.js";
import { exactTickOffsetFromSeconds, nearestFrameTicks } from "./tick-conversion.js";

export type MoveTimelineItem = {
  id: string;
  projectItemId: string;
  mediaType: string;
  trackIndex: number;
  start: { seconds: number; ticks?: string };
  end: { seconds: number; ticks?: string };
};

export type ExactMoveTicks = { offsetTicks: string; startTicks: string; endTicks: string };

/** Native move offset for an accepted plan: the destination start is the
 * nearest frame boundary of start + offset (the plan already required it within
 * float noise), and the end moves by exactly the same signed tick offset. */
export function exactMoveTicks(current: Pick<MoveTimelineItem, "start" | "end">, offsetSeconds: number, frameTicks: string): ExactMoveTicks {
  const start = String(current.start.ticks ?? ""), end = String(current.end.ticks ?? "");
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) throw new Error("Exact move requires the current start/end ticks");
  const requested = BigInt(start) + BigInt(exactTickOffsetFromSeconds(offsetSeconds));
  if (requested < 0n) throw new Error("Move destination is outside the non-negative timeline");
  const destination = BigInt(nearestFrameTicks(requested, frameTicks)), offset = destination - BigInt(start);
  if (offset === 0n) throw new Error("Move offset must change the clip by at least one frame");
  return { offsetTicks: offset.toString(), startTicks: destination.toString(), endTicks: (BigInt(end) + offset).toString() };
}

export function moveTicksMatch(observed: Pick<MoveTimelineItem, "start" | "end"> | undefined, expected: ExactMoveTicks): boolean {
  return Boolean(observed) && String(observed!.start.ticks) === expected.startTicks && String(observed!.end.ticks) === expected.endTicks;
}

export type ExactMoveRequest = {
  trackItemId: string;
  expectedProjectItemId: string;
  expectedMediaType: "video" | "audio";
  expectedTrackIndex: number;
  expectedStartSeconds: number;
  expectedEndSeconds: number;
  offsetSeconds: number;
};

export type ExactMovePlan = {
  targetId: string;
  projectItemId: string;
  mediaType: "video" | "audio";
  trackIndex: number;
  originalStartSeconds: number;
  originalEndSeconds: number;
  offsetSeconds: number;
  expectedStartSeconds: number;
  expectedEndSeconds: number;
};

function overlap(start: number, end: number, otherStart: number, otherEnd: number, tolerance: number): boolean {
  return start < otherEnd - tolerance && end > otherStart + tolerance;
}

function onFrameGrid(seconds: number, frameRate: number): boolean {
  const frames = seconds * frameRate;
  return Number.isFinite(frames) && Math.abs(frames - Math.round(frames)) <= 0.001;
}

/** Construct a one-item move only after exact identity and empty-destination checks. */
export function planExactClipMove(
  request: ExactMoveRequest,
  current: MoveTimelineItem,
  allItems: MoveTimelineItem[],
  frameRate: number,
): ExactMovePlan {
  if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("Move requires a positive sequence frame rate");
  if (current.id !== request.trackItemId
    || current.projectItemId !== request.expectedProjectItemId
    || current.mediaType !== request.expectedMediaType
    || current.trackIndex !== request.expectedTrackIndex
    || !isFrameAligned(current.start.seconds, request.expectedStartSeconds)
    || !isFrameAligned(current.end.seconds, request.expectedEndSeconds)) {
    throw new Error("Timeline item differs from the exact move target");
  }
  if (!Number.isFinite(request.offsetSeconds) || Math.abs(request.offsetSeconds) * frameRate < 0.5) {
    throw new Error("Move offset must change the clip by at least one frame");
  }
  const expectedStartSeconds = current.start.seconds + request.offsetSeconds;
  const expectedEndSeconds = current.end.seconds + request.offsetSeconds;
  if (expectedStartSeconds < 0 || expectedEndSeconds <= expectedStartSeconds) {
    throw new Error("Move destination is outside the non-negative timeline");
  }
  if (!onFrameGrid(expectedStartSeconds, frameRate) || !onFrameGrid(expectedEndSeconds, frameRate)) {
    throw new Error("Move destination must align to the sequence frame grid");
  }
  const tolerance = 1 / frameRate + 0.000_001;
  const collision = allItems.find((item) => item.id !== current.id
    && item.mediaType === current.mediaType
    && item.trackIndex === current.trackIndex
    && overlap(expectedStartSeconds, expectedEndSeconds, item.start.seconds, item.end.seconds, tolerance));
  if (collision) throw new Error(`Move destination overlaps timeline item ${collision.id}`);
  return {
    targetId: current.id,
    projectItemId: current.projectItemId,
    mediaType: request.expectedMediaType,
    trackIndex: current.trackIndex,
    originalStartSeconds: current.start.seconds,
    originalEndSeconds: current.end.seconds,
    offsetSeconds: request.offsetSeconds,
    expectedStartSeconds,
    expectedEndSeconds,
  };
}

export function assessExactClipMove(
  beforeItems: MoveTimelineItem[],
  afterItems: MoveTimelineItem[],
  plan: ExactMovePlan,
): {
  status: "pass" | "fail";
  movedItemId?: string;
  originalStillPresent: boolean;
  missingUnrelatedIds: string[];
  unexpectedIds: string[];
} {
  const beforeIds = new Set(beforeItems.map((item) => item.id));
  const afterIds = new Set(afterItems.map((item) => item.id));
  const moved = afterItems.find((item) => item.projectItemId === plan.projectItemId
    && item.mediaType === plan.mediaType
    && item.trackIndex === plan.trackIndex
    && isFrameAligned(item.start.seconds, plan.expectedStartSeconds)
    && isFrameAligned(item.end.seconds, plan.expectedEndSeconds));
  const originalStillPresent = afterIds.has(plan.targetId);
  const missingUnrelatedIds = [...beforeIds]
    .filter((id) => id !== plan.targetId && !afterIds.has(id))
    .sort((left, right) => left.localeCompare(right));
  const unexpectedIds = [...afterIds]
    .filter((id) => !beforeIds.has(id) && id !== moved?.id)
    .sort((left, right) => left.localeCompare(right));
  return {
    status: moved
      && !originalStillPresent
      && missingUnrelatedIds.length === 0
      && unexpectedIds.length === 0
      && afterItems.length === beforeItems.length
      ? "pass"
      : "fail",
    ...(moved ? { movedItemId: moved.id } : {}),
    originalStillPresent,
    missingUnrelatedIds,
    unexpectedIds,
  };
}
