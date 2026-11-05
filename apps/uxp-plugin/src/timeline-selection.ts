export type TimelineSelectionAssessment = {
  status: "pass" | "fail";
  expectedIds: string[];
  actualIds: string[];
  missingIds: string[];
  unexpectedIds: string[];
  duplicateExpectedIds: string[];
  duplicateActualIds: string[];
};

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated].sort((left, right) => left.localeCompare(right));
}

/** Compare an exact requested timeline selection with public-UXP readback. */
export function assessTimelineSelection(expectedIds: string[], actualIds: string[]): TimelineSelectionAssessment {
  const duplicateExpectedIds = duplicates(expectedIds);
  const duplicateActualIds = duplicates(actualIds);
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  const missingIds = [...expected].filter((id) => !actual.has(id)).sort((left, right) => left.localeCompare(right));
  const unexpectedIds = [...actual].filter((id) => !expected.has(id)).sort((left, right) => left.localeCompare(right));
  return {
    status: duplicateExpectedIds.length === 0
      && duplicateActualIds.length === 0
      && missingIds.length === 0
      && unexpectedIds.length === 0
      ? "pass"
      : "fail",
    expectedIds: [...expected].sort((left, right) => left.localeCompare(right)),
    actualIds: [...actual].sort((left, right) => left.localeCompare(right)),
    missingIds,
    unexpectedIds,
    duplicateExpectedIds,
    duplicateActualIds,
  };
}
