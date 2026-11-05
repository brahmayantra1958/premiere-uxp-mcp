export type TrimEdit = Readonly<{
  trackItemId: string;
  startSeconds?: number;
  endSeconds?: number;
  inPointSeconds?: number;
  outPointSeconds?: number;
}>;

export type TrimPhase = Readonly<{
  kind: "source" | "timeline";
  edit: TrimEdit;
}>;

/**
 * Premiere 26.3 can dereference a null host object when source-range and
 * timeline-boundary actions for multiple track items share one transaction.
 * Keep each item isolated and apply source range before timeline boundaries.
 */
export function trimEditPhases(edit: TrimEdit): TrimPhase[] {
  const phases: TrimPhase[] = [];
  if (edit.inPointSeconds !== undefined || edit.outPointSeconds !== undefined) phases.push({ kind: "source", edit });
  if (edit.startSeconds !== undefined || edit.endSeconds !== undefined) phases.push({ kind: "timeline", edit });
  return phases;
}
