export type SceneDetectionItem = {
  id: string;
  mediaType: "video" | "audio";
  trackIndex: number;
  projectItemId: string;
  start: { seconds: number };
  end: { seconds: number };
};

export type SceneCutTargetResult = {
  trackItemId: string;
  projectItemId: string;
  trackIndex: number;
  startSeconds: number;
  endSeconds: number;
  segmentCount: number;
  detectedCutCount: number;
  segments: Array<{ id: string; startSeconds: number; endSeconds: number }>;
};

export type SceneCutReadback = {
  selectedCount: number;
  detectedCutCount: number;
  unaffectedItemCount: number;
  targets: SceneCutTargetResult[];
  errors: string[];
};

function overlaps(left: SceneDetectionItem, right: SceneDetectionItem, tolerance: number): boolean {
  return left.start.seconds < right.end.seconds - tolerance
    && right.start.seconds < left.end.seconds - tolerance;
}

function near(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

/**
 * Proves that Premiere replaced each selected clip with contiguous segments
 * covering the same timeline range and left every unselected item intact.
 * A successful analysis may legitimately produce zero cuts.
 */
export function assessSceneCutReadback(
  before: SceneDetectionItem[],
  after: SceneDetectionItem[],
  selectedIds: string[],
  frameRate: number,
): SceneCutReadback {
  const tolerance = 1 / (Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 24);
  const selected = new Set(selectedIds);
  const errors: string[] = [];
  const targets: SceneCutTargetResult[] = [];

  if (!selectedIds.length) errors.push("Scene detection requires at least one selected clip");
  if (selected.size !== selectedIds.length) errors.push("Scene detection target IDs must be unique");

  for (const targetId of selectedIds) {
    const target = before.find((item) => item.id === targetId);
    if (!target) {
      errors.push(`Scene detection target disappeared from the baseline: ${targetId}`);
      continue;
    }
    if (target.mediaType !== "video") {
      errors.push(`Scene detection accepts video clips only: ${targetId}`);
      continue;
    }

    const ambiguous = before.filter((item) => item.id !== target.id
      && item.mediaType === "video"
      && item.trackIndex === target.trackIndex
      && item.projectItemId === target.projectItemId
      && overlaps(item, target, tolerance));
    if (ambiguous.length) {
      errors.push(`Scene detection target cannot be distinguished from an overlapping source instance: ${targetId}`);
      continue;
    }

    const segments = after
      .filter((item) => item.mediaType === "video"
        && item.trackIndex === target.trackIndex
        && item.projectItemId === target.projectItemId
        && item.start.seconds >= target.start.seconds - tolerance
        && item.end.seconds <= target.end.seconds + tolerance
        && overlaps(item, target, tolerance))
      .sort((left, right) => left.start.seconds - right.start.seconds);

    if (!segments.length) {
      errors.push(`Scene detection produced no segment covering the selected clip: ${targetId}`);
      continue;
    }
    const firstSegment = segments[0]!;
    const lastSegment = segments.at(-1)!;
    if (!near(firstSegment.start.seconds, target.start.seconds, tolerance)) {
      errors.push(`Scene detection changed the selected clip start: ${targetId}`);
    }
    if (!near(lastSegment.end.seconds, target.end.seconds, tolerance)) {
      errors.push(`Scene detection changed the selected clip end: ${targetId}`);
    }
    for (let index = 1; index < segments.length; index += 1) {
      const previousSegment = segments[index - 1]!;
      const currentSegment = segments[index]!;
      if (!near(previousSegment.end.seconds, currentSegment.start.seconds, tolerance)) {
        errors.push(`Scene detection left a gap or overlap at segment ${index} for ${targetId}`);
      }
    }

    targets.push({
      trackItemId: target.id,
      projectItemId: target.projectItemId,
      trackIndex: target.trackIndex,
      startSeconds: target.start.seconds,
      endSeconds: target.end.seconds,
      segmentCount: segments.length,
      detectedCutCount: Math.max(0, segments.length - 1),
      segments: segments.map((item) => ({ id: item.id, startSeconds: item.start.seconds, endSeconds: item.end.seconds })),
    });
  }

  const afterIds = new Set(after.map((item) => item.id));
  const unaffected = before.filter((item) => !selected.has(item.id));
  for (const item of unaffected) {
    if (!afterIds.has(item.id)) errors.push(`Scene detection changed or removed an unselected timeline item: ${item.id}`);
  }

  return {
    selectedCount: selectedIds.length,
    detectedCutCount: targets.reduce((sum, target) => sum + target.detectedCutCount, 0),
    unaffectedItemCount: unaffected.length,
    targets,
    errors,
  };
}
