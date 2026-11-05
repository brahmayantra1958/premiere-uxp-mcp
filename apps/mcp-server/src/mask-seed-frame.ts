import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { ProjectSnapshot, TrackItemSnapshot } from "@premiere-uxp/contracts";

type MaskSeedTargetItem = TrackItemSnapshot & {
  mediaType: "video";
  projectItemId: string;
  inPoint: NonNullable<TrackItemSnapshot["inPoint"]>;
  outPoint: NonNullable<TrackItemSnapshot["outPoint"]>;
};

export type MaskSeedPlan = {
  projectId: string;
  projectName: string;
  projectPath: string;
  stateSha256: string;
  sequenceId: string;
  sequenceName: string;
  width: number;
  height: number;
  frameRate: number;
  trackItemId: string;
  projectItemId: string;
  trackIndex: number;
  clipStartSeconds: number;
  clipEndSeconds: number;
  speed: number;
  reversed: boolean;
  requestedTimelineTimeSeconds: number;
  timelineFrameIndex: number;
  timelineTimeSeconds: number;
  sourceTimeSeconds: number;
};

export type PngEvidence = {
  path: string;
  exists: boolean;
  sizeBytes?: number;
  width?: number;
  height?: number;
  sha256?: string;
  status: "pass" | "fail";
  errors: string[];
};

function stateFingerprint(snapshot: ProjectSnapshot): string {
  return createHash("sha256").update(JSON.stringify({
    projectId: snapshot.projectId,
    projectPath: snapshot.projectPath,
    activeSequence: snapshot.activeSequence,
    markers: snapshot.markers,
    effects: snapshot.effects,
  })).digest("hex");
}

function requireFinitePositive(value: number | undefined, label: string): number {
  if (!Number.isFinite(value) || Number(value) <= 0) throw new Error(`MASK_SEED_${label.toUpperCase()}_UNAVAILABLE`);
  return Number(value);
}

function targetItem(snapshot: ProjectSnapshot, trackItemId: string): MaskSeedTargetItem {
  const sequence = snapshot.activeSequence;
  if (!sequence) throw new Error("MASK_SEED_NO_ACTIVE_SEQUENCE");
  if (sequence.itemsTruncated) throw new Error("MASK_SEED_TIMELINE_READBACK_TRUNCATED");
  const item = sequence.items.find((candidate) => candidate.id === trackItemId);
  if (!item) throw new Error(`MASK_SEED_TRACK_ITEM_NOT_FOUND: ${trackItemId}`);
  if (item.mediaType !== "video") throw new Error(`MASK_SEED_VIDEO_REQUIRED: ${trackItemId}`);
  if (!item.projectItemId) throw new Error(`MASK_SEED_PROJECT_ITEM_ID_UNAVAILABLE: ${trackItemId}`);
  if (!item.inPoint || !item.outPoint) throw new Error(`MASK_SEED_SOURCE_RANGE_UNAVAILABLE: ${trackItemId}`);
  return item as MaskSeedTargetItem;
}

export function planMaskSeedFrame(
  snapshot: ProjectSnapshot,
  trackItemId: string,
  requestedTimelineTimeSeconds: number,
): MaskSeedPlan {
  if (!Number.isFinite(requestedTimelineTimeSeconds) || requestedTimelineTimeSeconds < 0) {
    throw new Error("MASK_SEED_INVALID_TIMELINE_TIME");
  }
  const sequence = snapshot.activeSequence;
  if (!sequence) throw new Error("MASK_SEED_NO_ACTIVE_SEQUENCE");
  const width = requireFinitePositive(sequence.width, "width");
  const height = requireFinitePositive(sequence.height, "height");
  const frameRate = requireFinitePositive(sequence.frameRate, "frame_rate");
  const item = targetItem(snapshot, trackItemId);
  const timelineFrameIndex = Math.round(requestedTimelineTimeSeconds * frameRate);
  const timelineTimeSeconds = timelineFrameIndex / frameRate;
  const frameTolerance = 0.5 / frameRate + Number.EPSILON;
  if (timelineTimeSeconds < item.start.seconds - frameTolerance || timelineTimeSeconds >= item.end.seconds - frameTolerance) {
    throw new Error(`MASK_SEED_TIME_OUTSIDE_CLIP: ${trackItemId}`);
  }
  const speed = Math.abs(item.speed ?? 1);
  if (!Number.isFinite(speed) || speed <= 0) throw new Error(`MASK_SEED_INVALID_CLIP_SPEED: ${trackItemId}`);
  const reversed = Boolean(item.reversed);
  const sourceOffset = Math.max(0, timelineTimeSeconds - item.start.seconds) * speed;
  const sourceTimeSeconds = reversed
    ? item.outPoint.seconds - sourceOffset
    : item.inPoint.seconds + sourceOffset;
  if (sourceTimeSeconds < item.inPoint.seconds - frameTolerance || sourceTimeSeconds > item.outPoint.seconds + frameTolerance) {
    throw new Error(`MASK_SEED_SOURCE_TIME_OUTSIDE_CLIP: ${trackItemId}`);
  }
  return {
    projectId: snapshot.projectId,
    projectName: snapshot.projectName,
    projectPath: snapshot.projectPath,
    stateSha256: stateFingerprint(snapshot),
    sequenceId: sequence.id,
    sequenceName: sequence.name,
    width,
    height,
    frameRate,
    trackItemId: item.id,
    projectItemId: item.projectItemId,
    trackIndex: item.trackIndex,
    clipStartSeconds: item.start.seconds,
    clipEndSeconds: item.end.seconds,
    speed,
    reversed,
    requestedTimelineTimeSeconds,
    timelineFrameIndex,
    timelineTimeSeconds,
    sourceTimeSeconds,
  };
}

export function verifyMaskSeedState(plan: MaskSeedPlan, snapshot: ProjectSnapshot): string[] {
  const errors: string[] = [];
  if (snapshot.projectId !== plan.projectId || snapshot.projectPath !== plan.projectPath) errors.push("MASK_SEED_PROJECT_DRIFT");
  if (snapshot.activeSequence?.id !== plan.sequenceId || snapshot.activeSequence?.name !== plan.sequenceName) errors.push("MASK_SEED_SEQUENCE_DRIFT");
  if (stateFingerprint(snapshot) !== plan.stateSha256) errors.push("MASK_SEED_VISIBLE_STATE_DRIFT");
  return errors;
}

export async function probePngEvidence(filePath: string): Promise<PngEvidence> {
  try {
    const [bytes, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
    const signature = bytes.subarray(0, 8).toString("hex");
    const chunk = bytes.subarray(12, 16).toString("ascii");
    const width = bytes.length >= 24 ? bytes.readUInt32BE(16) : 0;
    const height = bytes.length >= 24 ? bytes.readUInt32BE(20) : 0;
    const errors = [
      ...(signature === "89504e470d0a1a0a" ? [] : ["PNG signature mismatch"]),
      ...(chunk === "IHDR" ? [] : ["PNG IHDR chunk missing"]),
      ...(width > 0 && height > 0 ? [] : ["PNG dimensions are invalid"]),
      ...(metadata.size > 24 ? [] : ["PNG file is truncated"]),
    ];
    return {
      path: filePath,
      exists: true,
      sizeBytes: metadata.size,
      width,
      height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      status: errors.length ? "fail" : "pass",
      errors,
    };
  } catch (error) {
    return { path: filePath, exists: false, status: "fail", errors: [error instanceof Error ? error.message : String(error)] };
  }
}
