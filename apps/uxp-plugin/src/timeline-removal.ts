export type LiftRemovalAssessment = {
  status: "pass" | "fail";
  removedTargetIds: string[];
  remainingTargetIds: string[];
  missingUnrelatedIds: string[];
  unexpectedIds: string[];
  duplicateTargetIds: string[];
};

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return sorted(repeated);
}

/**
 * Prove that a non-ripple lift removed only the requested timeline IDs.
 * Timeline IDs encode track and start time, so every unrelated ID must remain
 * byte-for-byte stable when ripple is disabled.
 */
export function assessLiftRemoval(beforeIds: string[], afterIds: string[], targetIds: string[]): LiftRemovalAssessment {
  const before = new Set(beforeIds);
  const after = new Set(afterIds);
  const targets = new Set(targetIds);
  const duplicateTargetIds = duplicates(targetIds);
  const remainingTargetIds = sorted([...targets].filter((id) => after.has(id)));
  const missingUnrelatedIds = sorted([...before].filter((id) => !targets.has(id) && !after.has(id)));
  const unexpectedIds = sorted([...after].filter((id) => !before.has(id)));
  const removedTargetIds = sorted([...targets].filter((id) => before.has(id) && !after.has(id)));
  const everyTargetExisted = [...targets].every((id) => before.has(id));
  return {
    status: duplicateTargetIds.length === 0
      && everyTargetExisted
      && remainingTargetIds.length === 0
      && missingUnrelatedIds.length === 0
      && unexpectedIds.length === 0
      && afterIds.length === beforeIds.length - targetIds.length
      ? "pass"
      : "fail",
    removedTargetIds,
    remainingTargetIds,
    missingUnrelatedIds,
    unexpectedIds,
    duplicateTargetIds,
  };
}
