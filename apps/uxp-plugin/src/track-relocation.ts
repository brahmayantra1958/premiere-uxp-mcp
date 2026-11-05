import { equalSnapshotValue } from "./snapshot-equality.js";

/** Pure contract for an individual clip relocation. A destination must be empty;
 * the source is never lifted until a full, identical clone has been observed. */
export type RelocationItem = Record<string, any> & {
  id: string; projectItemId: string; mediaType: string; trackIndex: number;
  start: { ticks: string; seconds: number }; end: { ticks: string; seconds: number };
};
export type RelocationRequest = {
  trackItemId: string; expectedProjectItemId: string; expectedMediaType: "video" | "audio";
  expectedTrackIndex: number; expectedStartSeconds: number; expectedEndSeconds: number;
  expectedInPointSeconds: number; expectedOutPointSeconds: number; destinationTrackIndex: number;
};
export type RelocationState = { sequence: Record<string, any>; effects: Record<string, unknown>; readTimingsMs?: Record<string, number> };
export type RelocationPlan = { source: RelocationItem; destination: RelocationItem };

export function stableValue(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, sort(v[key])])) : v;
  return JSON.stringify(sort(value));
}
const same = equalSnapshotValue;
export function relocatedItem(source: RelocationItem, trackIndex: number): RelocationItem {
  return { ...source, trackIndex, id: [source.mediaType, trackIndex, source.start.ticks, source.projectItemId].join(":") };
}

export function planTrackRelocation(request: RelocationRequest, state: RelocationState): RelocationPlan {
  const sequence = state.sequence;
  if (sequence.itemsTruncated) throw Error("Relocation requires a complete timeline snapshot");
  const matches = sequence.items.filter((item: RelocationItem) => item.id === request.trackItemId);
  if (matches.length !== 1) throw Error("Relocation source is not uniquely identified");
  const source = matches[0] as RelocationItem;
  const close = (actual: number | undefined, expected: number) => Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual! - expected) < 1e-8;
  if (source.projectItemId !== request.expectedProjectItemId || source.mediaType !== request.expectedMediaType ||
      source.trackIndex !== request.expectedTrackIndex || !close(source.start.seconds, request.expectedStartSeconds) ||
      !close(source.end.seconds, request.expectedEndSeconds) || !close(source.inPoint?.seconds, request.expectedInPointSeconds) ||
      !close(source.outPoint?.seconds, request.expectedOutPointSeconds)) throw Error("Relocation source changed; inspect fresh target facts");
  const count = source.mediaType === "video" ? sequence.videoTracks : sequence.audioTracks;
  if (!Number.isInteger(request.destinationTrackIndex) || request.destinationTrackIndex < 0 || request.destinationTrackIndex >= count ||
      request.destinationTrackIndex === source.trackIndex) throw Error("Destination must be another existing track of the same media type");
  if (source.speed !== 1 || source.reversed !== false) throw Error("Retimed or reversed clip relocation is not verified");
  for (const key of ["start", "end", "inPoint", "outPoint"]) if (!/^\d+$/.test(source[key]?.ticks ?? "")) throw Error("Exact source tick readback is required");
  const destination = relocatedItem(source, request.destinationTrackIndex);
  const intersects = (item: RelocationItem) => BigInt(item.start.ticks) < BigInt(source.end.ticks) && BigInt(item.end.ticks) > BigInt(source.start.ticks);
  if (sequence.items.some((item: RelocationItem) => item.mediaType === source.mediaType && item.trackIndex === destination.trackIndex && intersects(item))) {
    throw Error("Destination overlaps an existing clip; overwrite is forbidden");
  }
  // Link membership has no public getter. Refuse possible A/V counterparts rather
  // than silently breaking the common linked-source case with clone + lift.
  if (sequence.items.some((item: RelocationItem) => item.projectItemId === source.projectItemId && item.mediaType !== source.mediaType)) {
    throw Error("Possible linked A/V counterpart: grouped relocation is not verified. Official fallback: pin the exact sequence, clone_clips the audio trackItemId with audioTrackOffset and zero time offset, verify the cloned audio plus unchanged video, then remove_clips only the original audio ID. Verify video/link state; link preservation is not guaranteed by this fallback. Never remove before clone readback");
  }
  const tracks = sequence.tracks.filter((track: any) => track.mediaType === source.mediaType && [source.trackIndex, destination.trackIndex].includes(track.index));
  if (tracks.length !== 2 || tracks.some((track: any) => track.transitionCount !== 0)) throw Error("Source/destination tracks with transitions are not supported for relocation");
  if (!state.effects[source.id]) throw Error("Source component readback is required");
  return { source, destination };
}

/** Every source/unrelated item and component is compared, not just counts/IDs. */
export function assessRelocation(before: RelocationState, after: RelocationState, plan: RelocationPlan, phase: "cloned" | "moved" | "restored"): string[] {
  const errors: string[] = [];
  if (after.sequence.itemsTruncated) errors.push("Timeline readback is truncated");
  const expected = (before.sequence.items as RelocationItem[]).filter(item => phase !== "moved" || item.id !== plan.source.id);
  if (phase !== "restored") expected.push(plan.destination);
  const actual = after.sequence.items as RelocationItem[];
  const actualById = new Map<string, RelocationItem[]>();
  for (const item of actual) { const matches = actualById.get(item.id) ?? []; matches.push(item); actualById.set(item.id, matches); }
  if (actual.length !== expected.length) errors.push("Unexpected timeline item count");
  for (const item of expected) {
    const matches = actualById.get(item.id) ?? [];
    if (matches.length !== 1 || !same(matches[0], item)) errors.push(`Clip content changed or missing: ${item.id}`);
    const effectId = item.id === plan.destination.id ? plan.source.id : item.id;
    if (!same(before.effects[effectId], after.effects[item.id])) errors.push(`Component/keyframe readback changed: ${item.id}`);
  }
  const metadata = (sequence: Record<string, any>) => {
    const rest = { ...sequence }; delete rest.items;
    return { ...rest, tracks: sequence.tracks.map((track: Record<string, any>) => { const value = { ...track }; delete value.itemCount; return value; }) };
  };
  if (!same(metadata(before.sequence), metadata(after.sequence))) errors.push("Sequence, track or transition state changed");
  return errors;
}

export type RelocationAdapter = {
  read(): Promise<RelocationState>;
  validateBefore?(state: RelocationState): void;
  verified?(state: RelocationState): void;
  clone(source: RelocationItem, destinationTrackIndex: number): Promise<void>;
  lift(item: RelocationItem): Promise<void>;
  select(item: RelocationItem): Promise<void>;
};

/** Reacquisition belongs to the adapter. No wrapper survives a host transaction.
 * Recovery removes only a uniquely identified generated clone. Never blindly retry. */
export async function executeTrackRelocation(request: RelocationRequest, adapter: RelocationAdapter) {
  const timingsMs: Record<string, number> = {};
  const timed = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await action(); } finally { timingsMs[name] = performance.now() - start; }
  };
  const before = await timed("beforeRead", () => adapter.read());
  const validationStart = performance.now();
  adapter.validateBefore?.(before);
  timingsMs.validateBefore = performance.now() - validationStart;
  const plan = planTrackRelocation(request, before);
  let phase = "preflight";
  try {
    phase = "clone_dispatched";
    await timed("clone", () => adapter.clone(plan.source, plan.destination.trackIndex));
    const cloned = await timed("cloneRead", () => adapter.read());
    const cloneCompareStart = performance.now();
    const cloneErrors = assessRelocation(before, cloned, plan, "cloned");
    timingsMs.cloneCompare = performance.now() - cloneCompareStart;
    if (cloneErrors.length) throw Error(cloneErrors.join("; "));
    phase = "clone_verified";
    await timed("lift", () => adapter.lift(plan.source));
    phase = "lift_dispatched";
    const after = await timed("afterRead", () => adapter.read());
    const afterCompareStart = performance.now();
    const errors = assessRelocation(before, after, plan, "moved");
    timingsMs.afterCompare = performance.now() - afterCompareStart;
    if (errors.length) throw Error(errors.join("; "));
    phase = "move_verified";
    await timed("select", () => adapter.select(plan.destination));
    adapter.verified?.(after);
    return { status: "pass" as const, before: before.sequence, after: after.sequence,
      hostResult: { route: "public_uxp_verified_clone_then_lift", plan, phase, timingsMs, readTimingsMs: { before: before.readTimingsMs, cloned: cloned.readTimingsMs, after: after.readTimingsMs }, preserved: ["start_ticks", "end_ticks", "source_in_out_ticks", "components", "keyframes", "unrelated_items", "tracks", "transitions"], components: after.effects[plan.destination.id] }, errors: [] };
  } catch (error) {
    const errors = [String(error)];
    let recovered: RelocationState | undefined;
    let rollbackVerified = false;
    try {
      let state = await adapter.read();
      const source = state.sequence.items.find((item: RelocationItem) => item.id === plan.source.id);
      const destinations = state.sequence.items.filter((item: RelocationItem) => item.id === plan.destination.id);
      if (!source && destinations.length === 1 && assessRelocation(before, state, plan, "moved").length === 0) {
        // The source is absent only after a proved faithful move. Recreate it at
        // the empty original position, prove both copies, then lift our clone.
        await adapter.clone(plan.destination, plan.source.trackIndex);
        state = await adapter.read();
      }
      if (state.sequence.items.some((item: RelocationItem) => item.id === plan.source.id) && destinations.length === 1) {
        const withoutClone: RelocationState = { ...state, sequence: { ...state.sequence, items: state.sequence.items.filter((item: RelocationItem) => item.id !== plan.destination.id) } };
        if (assessRelocation(before, withoutClone, plan, "restored").length === 0) await adapter.lift(destinations[0]);
      }
      recovered = await adapter.read();
      const recoveryErrors = assessRelocation(before, recovered, plan, "restored");
      rollbackVerified = recoveryErrors.length === 0;
      errors.push(...recoveryErrors);
      if (rollbackVerified) await adapter.select(plan.source);
    } catch (recoveryError) { errors.push(`Recovery: ${String(recoveryError)}`); }
    return { status: rollbackVerified ? "fail" as const : "unverified" as const, before: before.sequence, after: recovered?.sequence,
      hostResult: { route: "public_uxp_verified_clone_then_lift", plan, phase, timingsMs, rollback: { verified: rollbackVerified } }, errors,
      recovery: rollbackVerified ? "Original content restored and verified. Inspect before a new operation." : "State is not proven restored. Stop editing; inspect the exact target before retrying or saving." };
  }
}
