/** 2026-09-25 user instruction: restore every automatic follow that 0.14.7 turned off.
 * Targeted reads and edits reveal their work target: sequence tab, playhead,
 * target clips, track targeting, native panel/effect disclosure and Project item.
 * 2026-09-28: overview/verification reads preserve the last location and panel;
 * untimed work within the current clip keeps its playhead. No end-of-command reset.
 * Following is visible feedback only. A navigation failure is reported with the
 * result and never blocks dispatch or changes a content status. */
export const workFollow = { enabled: true };

export type FollowPhase = "before_command" | "after_read" | "after_command";
export type FollowFailure = { status: "unverified"; phase: FollowPhase; reason: string };

/** Navigation helpers share their messages with explicit navigation, where a
 * failure does block the dependent command. Automatic follow never blocks, so
 * that clause would misstate dispatch (2026-11-04: "Network request failed;
 * dependent content command was not dispatched" on a clone that ran and passed). */
export function followFailureReason(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/;?\s*(?:the\s+)?(?:dependent\s+)?content(?:\s+command)?\s+was\s+not\s+dispatched\.?/gi, "").trim();
  return message || "Work follow failed";
}

/** Run one navigation step; an error becomes an observation instead of a command failure. */
export async function attemptFollow<T>(phase: FollowPhase, work: () => Promise<T>): Promise<T | FollowFailure> {
  try { return await work(); }
  catch (error) { return { status: "unverified", phase, reason: followFailureReason(error) }; }
}

export function followFailed(value: unknown): value is FollowFailure {
  return !!value && typeof value === "object" && (value as { status?: unknown }).status === "unverified";
}
