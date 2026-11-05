import { HostCommandError } from './bridge-client.js';
import { equalSnapshotValue as equal } from './snapshot-equality.js';
import type { AnyRecord } from './host-foundation.js';
import type { HostResult } from './wire.js';

/** Plain plans already validated by clone_clips. No native wrapper is retained. */
export type CloneBatchPlan = Readonly<{
  clone: AnyRecord;
  source: AnyRecord;
  videoOffset: number;
  audioOffset: number;
  timeOffset: number;
  destinationTrack: number;
}>;
/** Observations contain only bounded counters and fixed phases, never Actions,
 * native source wrappers, arbitrary labels or payloads. They do not prove that
 * an added action was applied; only final timeline readback can prove that. */
export type TransactionObservation = Readonly<{
  phase: 'locked_enter' | 'execute_enter' | 'callback_enter' | 'actions_created' | 'add_action_enter' | 'add_action_exit' | 'callback_exit' | 'execute_exit' | 'execute_throw' | 'locked_exit' | 'locked_throw';
  ordinal?: number;
  count?: number;
}>;
export type CloneActionPhase = 'get_editor_enter' | 'get_editor_exit' | 'create_tick_time_enter' | 'create_tick_time_exit' | 'create_clone_action_enter' | 'create_clone_action_exit';
export type CloneTrackBatchHost = Readonly<{
  /** All wrappers come from one fresh same-track collection, never one lookup
   * per source (a later collection can invalidate every earlier wrapper). */
  acquireSources(ids: readonly string[]): Promise<{
    snapshots: readonly AnyRecord[];
    createAction(plan: CloneBatchPlan, observe?: (phase: CloneActionPhase) => void): unknown;
    /** Runs factory synchronously inside both lockedAccess and executeTransaction. */
    executeTransaction(label: string, factory: () => unknown[], observe?: (event: TransactionObservation) => void): boolean;
  }>;
  waitForQuiet(): Promise<void>;
  targetSequenceSnapshot(): Promise<AnyRecord>;
}>;

const range = (item: AnyRecord) => ({ start: Number(item.start?.seconds), end: Number(item.end?.seconds) });
const destination = (plan: CloneBatchPlan) => ({ start: range(plan.source).start + plan.timeOffset, end: range(plan.source).end + plan.timeOffset });
const validRange = (value: { start: number; end: number }) => Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start;
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end - 0.000001 && b.start < a.end - 0.000001;
const exactTime = (actual: unknown, expected: number) => Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) <= 0.000001;

/** Additive plans from one source track require complete, empty, independent
 * destinations. Every eligible plan uses its own fresh-source transaction. */
export function canBatchOneTrackClones(before: AnyRecord, plans: readonly CloneBatchPlan[]): boolean {
  if (plans.length < 2 || plans.length > 100 || before.itemsTruncated !== false || !Array.isArray(before.items) || !Array.isArray(before.tracks)) return false;
  const scope = plans[0]!.source, originals = new Map<string, AnyRecord>(before.items.map((item: AnyRecord) => [item.id, item]));
  if (originals.size !== before.items.length || !['audio', 'video'].includes(scope.mediaType)) return false;
  for (const [index, plan] of plans.entries()) {
    const source = plan.source;
    if (!source.id || source.mediaType !== scope.mediaType || source.trackIndex !== scope.trackIndex || !validRange(range(source)) || !equal(originals.get(source.id), source)) return false;
    if (plan.clone.mode !== undefined && plan.clone.mode !== 'overwrite' || plan.clone.trackItemId !== source.id) return false;
    if (![plan.videoOffset, plan.audioOffset, plan.destinationTrack].every(Number.isInteger) || !Number.isFinite(plan.timeOffset)) return false;
    if (plan.destinationTrack !== source.trackIndex + (source.mediaType === 'video' ? plan.videoOffset : plan.audioOffset)) return false;
    if (!before.tracks.some((track: AnyRecord) => track.mediaType === source.mediaType && track.index === plan.destinationTrack)) return false;
    const expected = destination(plan);
    if (!validRange(expected) || expected.start < 0) return false;
    for (const item of before.items) if (item.mediaType === source.mediaType && item.trackIndex === plan.destinationTrack) {
      if (!validRange(range(item)) || overlaps(expected, range(item))) return false;
    }
    for (const prior of plans.slice(0, index)) if (prior.destinationTrack === plan.destinationTrack && overlaps(destination(prior), expected)) return false;
  }
  return true;
}

function matchesDestination(item: AnyRecord, plan: CloneBatchPlan): boolean {
  const expected = destination(plan), source = plan.source;
  return item.trackIndex === plan.destinationTrack && exactTime(item.start?.seconds, expected.start) && exactTime(item.end?.seconds, expected.end)
    && ['name', 'mediaType', 'projectItemId', 'inPoint', 'outPoint', 'disabled', 'speed', 'reversed', 'adjustmentLayer'].every(key => equal(item[key], source[key]));
}

/** Final readback proves every original and every new item. Sequence duration
 * may grow; track item counts must grow by exactly the planned additions. */
export function assessCloneBatch(before: AnyRecord, after: AnyRecord, plans: readonly CloneBatchPlan[]) {
  const errors: string[] = [];
  const items: AnyRecord[] = Array.isArray(after.items) ? after.items : [];
  const originalIds = new Set<string>(before.items.map((item: AnyRecord) => item.id));
  const additions = items.filter(item => !originalIds.has(item.id));
  const byId = new Map<string, { item: AnyRecord; count: number }>();
  for (const item of items) byId.set(item.id, { item, count: (byId.get(item.id)?.count ?? 0) + 1 });
  const uniqueIds = byId.size === items.length;
  const complete = after.itemsTruncated === false && Array.isArray(after.items);
  if (!complete || !uniqueIds) errors.push('Clone batch final timeline is incomplete or has ambiguous item identities');
  const originalsPreserved = before.items.every((original: AnyRecord) => {
    const match = byId.get(original.id);
    return match?.count === 1 && equal(match.item, original);
  });
  if (!originalsPreserved) errors.push('Clone batch changed or removed an original timeline item');
  if (items.length !== before.items.length + plans.length || additions.length !== plans.length) errors.push('Clone batch final item count differs from the complete planned additions');
  const unchanged = ['id', 'name', 'width', 'height', 'frameRate', 'videoTracks', 'audioTracks', 'captionTracks', 'captionTrackStates', 'transitions'];
  if (!unchanged.every(key => equal(before[key], after[key]))) errors.push('Clone batch changed sequence identity, settings, track counts, captions or transitions');
  const expectedTracks = before.tracks.map((track: AnyRecord) => ({ ...track, itemCount: Number(track.itemCount) + plans.filter(plan => plan.source.mediaType === track.mediaType && plan.destinationTrack === track.index).length }));
  if (!equal(expectedTracks, after.tracks)) errors.push('Clone batch changed track metadata or unexpected track item counts');
  const steps = plans.map((plan, index) => {
    const matches = additions.filter(item => matchesDestination(item, plan));
    const verified = complete && uniqueIds && matches.length === 1;
    if (!verified) errors.push(`Clone ${index + 1} did not read back uniquely with its original duration/source range`);
    return { index, sourceId: plan.source.id as string, verified, destinationId: matches.length === 1 ? matches[0]!.id as string : null };
  });
  if (new Set(steps.filter(step => step.verified).map(step => step.destinationId)).size !== plans.length) errors.push('Clone batch destinations do not identify distinct new items');
  return { pass: errors.length === 0, originalsPreserved, steps, errors };
}

/** Same-track multi-source extension. The source collector validates exact IDs
 * and full metadata; all returned snapshots must equal this command's before.
 * There is no further await/collection acquisition before synchronous dispatch.
 * Undefined is possible only before acquisition; dispatched work never falls back. */
export async function tryCloneOneTrackBatch(before: AnyRecord, plans: readonly CloneBatchPlan[], host: CloneTrackBatchHost): Promise<HostResult | undefined> {
  if (!canBatchOneTrackClones(before, plans)) return undefined;
  return executeFreshSourceTransactions(before, plans, host);
}

function assertUnchangedSources(plans: readonly CloneBatchPlan[], sources: Awaited<ReturnType<CloneTrackBatchHost['acquireSources']>>): void {
  const ids = [...new Set<string>(plans.map(plan => plan.source.id))];
  const snapshots = new Map<string, AnyRecord>(sources.snapshots.map(snapshot => [snapshot.id, snapshot]));
  if (sources.snapshots.length !== ids.length || snapshots.size !== ids.length || !plans.every(plan => equal(snapshots.get(plan.source.id), plan.source))) {
    throw new HostCommandError('CLONE_SOURCE_CHANGED', 'One or more clone sources changed before the transaction; no clone was dispatched for this transaction');
  }
}

/** Native compound registration can fail after applying a prefix even when no
 * destination writes to the source track. Rebind the original for each action;
 * never register multiple clone actions or reuse a created clone
 * as the next source. Every completed commit proves the entire original state
 * plus ALL additions so far. Any non-PASS stops this command without fallback.
 * Pending acquisition/quiet/read promises retain the calling command's lane. */
async function executeFreshSourceTransactions(before: AnyRecord, plans: readonly CloneBatchPlan[], host: CloneTrackBatchHost): Promise<HostResult> {
  const batchMode = 'fresh_source_transactions';
  const transactions: AnyRecord[] = [];
  const nativeAccepted: boolean[] = [];
  let lastVerifiedAfter = before;
  let lastResult: HostResult | undefined;
  for (const [index, plan] of plans.entries()) {
    let source: Awaited<ReturnType<CloneTrackBatchHost['acquireSources']>>;
    try { source = await host.acquireSources([plan.source.id]); assertUnchangedSources([plan], source); }
    catch (error) {
      if (index === 0) throw error;
      return { status: 'unverified', before, hostResult: { accepted: false, batchMode, plannedClones: plans.length,
        transactions, attemptedTransactions: transactions.length, verifiedTransactions: index,
        lastVerifiedPrefixClones: index, lastVerifiedAfter, failedStepIndex: index, failurePhase: 'source_reacquisition' },
      errors: [String(error)], recovery: 'Clone command stopped after a verified prefix because a fresh original source could not be proved. Inspect current state; do not replay prior or uncertain clones.' };
    }
    // Action factory/execute remain synchronous, with one newly acquired source
    // and no intervening await. The existing executor owns quiet/full readback.
    const result = await executeCloneBatch(before, [plan], host, source, plans.slice(0, index + 1));
    const details = result.hostResult as AnyRecord;
    transactions.push({ index, status: result.status, transaction: details.transaction });
    nativeAccepted.push(details.steps?.[index]?.hostResult === true);
    const aggregate = { ...result, hostResult: { ...details, batchMode, plannedClones: plans.length, transactions,
      attemptedTransactions: transactions.length, verifiedTransactions: index + (result.status === 'pass' ? 1 : 0),
      ...(details.steps ? { steps: details.steps.map((step: AnyRecord) => ({ ...step, hostResult: nativeAccepted[step.index] })) } :
        { lastVerifiedPrefixClones: index, lastVerifiedAfter }),
    } };
    if (result.status !== 'pass') return aggregate;
    lastVerifiedAfter = result.after as AnyRecord;
    lastResult = aggregate;
  }
  return lastResult!;
}

async function executeCloneBatch(before: AnyRecord, plans: readonly CloneBatchPlan[], host: CloneTrackBatchHost, source: Awaited<ReturnType<CloneTrackBatchHost['acquireSources']>>, proofPlans: readonly CloneBatchPlan[] = plans): Promise<HostResult> {
  if (plans.length !== 1) throw new HostCommandError('CLONE_TRANSACTION_SCOPE_INVALID', 'A fresh-source clone transaction must contain exactly one action');
  const batchMode = 'fresh_source_transactions';
  const transaction = {
    plannedActions: plans.length, uniqueSources: new Set(plans.map(plan => plan.source.id)).size,
    actionCreationOrdinal: 0, createdActions: 0, addActionOrdinal: 0, addedActions: 0,
    factoryCompleted: false, callbackCompleted: false, executeReturned: false,
    lastPhase: 'not_entered' as string, lastActionPhase: 'not_entered' as string,
    failurePhase: null as string | null, failureOrdinal: null as number | null,
  };
  const observe = (event: TransactionObservation) => {
    // Preserve the failing inner call when an outer lock also rethrows it.
    if (event.phase === 'execute_throw' || event.phase === 'locked_throw') {
      if (transaction.failurePhase === null) {
        transaction.failurePhase = transaction.lastPhase;
        transaction.failureOrdinal = transaction.lastPhase === 'add_action_enter' ? transaction.addActionOrdinal
          : transaction.lastPhase === 'create_action_enter' ? transaction.actionCreationOrdinal : null;
      }
    }
    transaction.lastPhase = event.phase;
    if (event.phase === 'add_action_enter') transaction.addActionOrdinal = event.ordinal ?? 0;
    if (event.phase === 'add_action_exit') transaction.addedActions = event.ordinal ?? 0;
    if (event.phase === 'callback_exit') transaction.callbackCompleted = true;
    if (event.phase === 'execute_exit') transaction.executeReturned = true;
  };
  let accepted = false, dispatchError: string | undefined;
  try {
    accepted = source.executeTransaction(`Clone ${plans.length} clips from one track`, () => {
      const actions = plans.map((plan, index) => {
        transaction.lastPhase = 'create_action_enter'; transaction.actionCreationOrdinal = index + 1;
        transaction.lastActionPhase = 'not_entered';
        const action = source.createAction(plan, phase => { transaction.lastActionPhase = phase; });
        transaction.createdActions++; transaction.lastPhase = 'create_action_exit'; return action;
      });
      transaction.factoryCompleted = true; return actions;
    }, observe);
  } catch (error) {
    if (transaction.failurePhase === null) {
      transaction.failurePhase = transaction.lastPhase;
      transaction.failureOrdinal = transaction.lastPhase === 'create_action_enter' ? transaction.actionCreationOrdinal : null;
    }
    dispatchError = String(error);
  }
  let after: AnyRecord;
  try {
    await host.waitForQuiet();
    after = await host.targetSequenceSnapshot();
  } catch (error) {
    return { status: 'unverified', before, hostResult: { accepted, batchMode, transaction, ...(dispatchError ? { dispatchError } : {}) }, errors: [String(error)], recovery: 'Clone batch may be partially applied. Inspect its exact current state before new work; do not replay it.' };
  }
  const proof = assessCloneBatch(before, after, proofPlans);
  const errors = [...(dispatchError ? [`Clone batch dispatch threw: ${dispatchError}`] : []), ...(!accepted ? ['Premiere did not accept the clone batch transaction'] : []), ...proof.errors];
  return {
    status: dispatchError ? 'unverified' : accepted && proof.pass ? 'pass' : 'fail', before, after,
    hostResult: { accepted: accepted && proof.pass && !dispatchError, batchMode, transaction, steps: proof.steps.map(step => ({ ...step, hostResult: accepted })), completedClones: proof.steps.filter(step => step.verified).length, originalsPreserved: proof.originalsPreserved, ...(dispatchError ? { dispatchError } : {}) },
    errors,
    ...(errors.length ? { recovery: 'Inspect the exact batch readback before new work; do not replay completed or uncertain clones.' } : {}),
  };
}
