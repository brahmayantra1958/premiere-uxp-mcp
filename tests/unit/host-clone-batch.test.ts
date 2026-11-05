import { describe, expect, it, vi } from 'vitest';
import { assessCloneBatch, canBatchOneTrackClones, tryCloneOneTrackBatch, type CloneTrackBatchHost, type CloneBatchPlan } from '../../apps/uxp-plugin/src/host-clone-batch.js';

const time = (seconds: number) => ({ seconds, ticks: String(Math.round(seconds * 254016000000)) });
function fixture(kind: 'audio' | 'graphic' = 'graphic') {
  const mediaType = kind === 'audio' ? 'audio' : 'video';
  const item = { id: `${mediaType}:1:0:${kind === 'audio' ? 'source' : ''}`, name: 'Original', mediaType, projectItemId: kind === 'audio' ? 'source' : '', trackIndex: 1, start: time(0), end: time(1), inPoint: time(3600), outPoint: time(3601), disabled: false, speed: 1, reversed: false, adjustmentLayer: false };
  const before = { id: 'sequence', name: 'Sequence', width: 1920, height: 1080, frameRate: 24, duration: time(1), videoTracks: kind === 'graphic' ? 2 : 0, audioTracks: kind === 'audio' ? 2 : 0, captionTracks: 0, captionTrackStates: [], transitions: [], itemsTruncated: false, items: [item], tracks: [0, 1].map(index => ({ mediaType, index, id: index + 1, name: `Track ${index}`, muted: false, transitionCount: 0, itemCount: index === 1 ? 1 : 0 })) };
  const plans: CloneBatchPlan[] = [2, 3, 4].map(timeOffset => ({ clone: { trackItemId: item.id, mode: 'overwrite' }, source: structuredClone(item), videoOffset: kind === 'graphic' ? -1 : 0, audioOffset: kind === 'audio' ? -1 : 0, destinationTrack: 0, timeOffset }));
  const after = structuredClone(before), events: string[] = [];
  let locked = false, phase = 'preflight';
  const acquireSources = vi.fn(async () => { phase = 'preflight'; return {
    snapshots: [structuredClone(item)],
    createAction(plan: CloneBatchPlan) {
      expect(locked).toBe(true); expect(phase).toBe('create'); events.push('action');
      const clone = { ...structuredClone(plan.source), trackIndex: plan.destinationTrack, start: time(plan.source.start.seconds + plan.timeOffset), end: time(plan.source.end.seconds + plan.timeOffset) };
      clone.id = `${mediaType}:${clone.trackIndex}:${clone.start.ticks}:${clone.projectItemId}`;
      return () => { after.items.push(clone as typeof item); after.tracks[0]!.itemCount++; };
    },
    executeTransaction(_label: string, factory: () => unknown[]) {
      expect(phase).toBe('preflight'); events.push('lock'); locked = true; phase = 'create';
      const actions = factory(); phase = 'dispatch'; events.push('dispatch');
      for (const action of actions) (action as () => void)();
      locked = false; phase = 'complete'; events.push('unlock'); return true;
    },
  }; });
  const host: CloneTrackBatchHost = { acquireSources, waitForQuiet: vi.fn(async () => { expect(phase).toBe('complete'); events.push('quiet'); }), targetSequenceSnapshot: vi.fn(async () => { events.push('read'); return structuredClone(after); }) };
  return { before, after, item, plans, host, events, acquireSources };
}

describe('same-source additive clone transaction', () => {
  it.each(['audio', 'graphic'] as const)('reacquires each %s source for one action, then proves the complete prefix before continuing', async kind => {
    const f = fixture(kind), original = structuredClone(f.before);
    const result = await tryCloneOneTrackBatch(f.before, f.plans, f.host);
    expect(result?.status).toBe('pass');
    expect(result?.hostResult).toMatchObject({ batchMode: 'fresh_source_transactions', completedClones: 3, accepted: true, originalsPreserved: true, attemptedTransactions: 3, verifiedTransactions: 3 });
    expect(f.events).toEqual(Array.from({ length: 3 }, () => ['lock', 'action', 'dispatch', 'unlock', 'quiet', 'read']).flat());
    expect(f.acquireSources.mock.calls).toEqual(Array.from({ length: 3 }, () => [[f.item.id]]));
    expect(f.host.waitForQuiet).toHaveBeenCalledTimes(3); expect(f.host.targetSequenceSnapshot).toHaveBeenCalledTimes(3);
    expect(f.before).toEqual(original);
  });

  it.each(['single', 'insert', 'different-source', 'overlap', 'occupied', 'source-destination', 'truncated', 'over-limit'] as const)('returns undefined without acquiring or dispatching an ineligible %s batch', async fault => {
    const f = fixture(); let plans = f.plans;
    if (fault === 'single') plans = plans.slice(0, 1);
    if (fault === 'insert') plans = [{ ...plans[0]!, clone: { ...plans[0]!.clone, mode: 'insert' } }, ...plans.slice(1)];
    if (fault === 'different-source') plans = [{ ...plans[0]!, clone: { trackItemId: 'other' } }, ...plans.slice(1)];
    if (fault === 'overlap') plans = [plans[0]!, { ...plans[1]!, timeOffset: 2.5 }];
    if (fault === 'occupied') f.before.items.push({ ...f.item, id: 'occupied', trackIndex: 0, start: time(2), end: time(3) });
    if (fault === 'source-destination') plans = plans.map(plan => ({ ...plan, videoOffset: 0, destinationTrack: 1, timeOffset: 0 }));
    if (fault === 'truncated') f.before.itemsTruncated = true;
    if (fault === 'over-limit') plans = Array.from({ length: 101 }, (_, i) => ({ ...plans[0]!, timeOffset: 2 + i }));
    expect(await tryCloneOneTrackBatch(f.before, plans, f.host)).toBeUndefined(); expect(f.host.acquireSources).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
  });

  it('accepts adjacent one-frame destinations and rejects an exact duplicate', () => {
    const f = fixture(); f.item.end = time(1 / 24); f.item.outPoint = time(3600 + 1 / 24);
    const plans = [0, 1, 2].map(i => ({ ...f.plans[0]!, source: structuredClone(f.item), timeOffset: 2 + i / 24 }));
    expect(canBatchOneTrackClones(f.before, plans)).toBe(true);
    expect(canBatchOneTrackClones(f.before, [plans[0]!, plans[0]!])).toBe(false);
  });

  it('rejects fresh-source drift before action creation, without falling back', async () => {
    const f = fixture(), acquire = f.host.acquireSources;
    const changed: CloneTrackBatchHost = { ...f.host, acquireSources: async id => ({ ...await acquire(id), snapshots: [{ ...f.item, outPoint: time(3602) }] }) };
    await expect(tryCloneOneTrackBatch(f.before, f.plans, changed)).rejects.toMatchObject({ code: 'CLONE_SOURCE_CHANGED' });
    expect(f.events).toEqual([]); expect(f.host.targetSequenceSnapshot).not.toHaveBeenCalled();
  });

  it.each(['source-range', 'unrelated-item', 'missing-clone', 'unexpected-clone', 'duplicate-id', 'track-name', 'track-count', 'transition', 'caption', 'truncated'] as const)('cannot pass a final %s preservation failure', async fault => {
    const f = fixture();
    if (fault === 'unrelated-item') { const unrelated = { ...structuredClone(f.item), id: 'unrelated', start: time(8), end: time(9) }; f.before.items.push(unrelated); f.after.items.push(structuredClone(unrelated)); }
    const read = f.host.targetSequenceSnapshot;
    const host: CloneTrackBatchHost = { ...f.host, targetSequenceSnapshot: async () => {
      const snapshot = await read();
      if (fault === 'source-range') snapshot.items[1].outPoint = time(4000);
      if (fault === 'unrelated-item') snapshot.items.find((item: any) => item.id === 'unrelated').disabled = true;
      if (fault === 'missing-clone') snapshot.items.pop();
      if (fault === 'unexpected-clone') snapshot.items.push({ ...snapshot.items[1], id: 'unexpected' });
      if (fault === 'duplicate-id') snapshot.items[1].id = snapshot.items[0].id;
      if (fault === 'track-name') snapshot.tracks[1].name = 'Changed';
      if (fault === 'track-count') snapshot.tracks[0].itemCount++;
      if (fault === 'transition') snapshot.transitions = [{ id: 'new-transition' }];
      if (fault === 'caption') snapshot.captionTrackStates = [{ id: 'new-caption' }];
      if (fault === 'truncated') snapshot.itemsTruncated = true;
      return snapshot;
    } };
    expect((await tryCloneOneTrackBatch(f.before, f.plans, host))?.status).toBe('fail');
    expect(f.host.acquireSources).toHaveBeenCalledTimes(1); expect(f.events.filter(event => event === 'dispatch')).toHaveLength(1);
  });

  it('does not count the unchanged original as a new clone', () => {
    const f = fixture(); const assessment = assessCloneBatch(f.before, structuredClone(f.before), f.plans);
    expect(assessment.pass).toBe(false); expect(assessment.steps.every(step => !step.verified)).toBe(true);
  });

  it('preserves uncertainty after a dispatch exception even if readback finds that step, without creating later clones', async () => {
    const f = fixture(), acquire = f.host.acquireSources;
    const host: CloneTrackBatchHost = { ...f.host, acquireSources: async id => {
      const source = await acquire(id); return { ...source, executeTransaction(label, factory) { source.executeTransaction(label, factory); throw Error('native completion unknown'); } };
    } };
    const result = await tryCloneOneTrackBatch(f.before, f.plans, host);
    expect(result?.status).toBe('unverified'); expect(result?.hostResult).toMatchObject({ accepted: false, completedClones: 1, dispatchError: 'Error: native completion unknown' });
    expect(f.events.filter(event => event === 'dispatch')).toHaveLength(1);
  });

  it('requires accepted native completion even when all final destinations happen to match', async () => {
    const f = fixture(), acquire = f.host.acquireSources;
    const host: CloneTrackBatchHost = { ...f.host, acquireSources: async id => { const source = await acquire(id); return { ...source, executeTransaction(label, factory) { source.executeTransaction(label, factory); return false; } }; } };
    expect((await tryCloneOneTrackBatch(f.before, f.plans, host))?.status).toBe('fail');
  });

  it('keeps a pending quiet boundary and pending read owned without timeout, replay or early result', async () => {
    const f = fixture(); let releaseQuiet!: () => void, releaseRead!: (value: typeof f.after) => void, completed = false;
    const quiet = new Promise<void>(resolve => { releaseQuiet = resolve; }), read = new Promise<typeof f.after>(resolve => { releaseRead = resolve; });
    const host: CloneTrackBatchHost = { ...f.host, waitForQuiet: vi.fn(f.host.waitForQuiet).mockImplementationOnce(() => quiet), targetSequenceSnapshot: vi.fn(f.host.targetSequenceSnapshot).mockImplementationOnce(() => read) };
    vi.useFakeTimers();
    try {
      const result = tryCloneOneTrackBatch(f.before, f.plans, host).then(value => { completed = true; return value; });
      await vi.advanceTimersByTimeAsync(100_000); expect(completed).toBe(false); expect(host.targetSequenceSnapshot).not.toHaveBeenCalled();
      releaseQuiet(); await vi.advanceTimersByTimeAsync(100_000); expect(completed).toBe(false); expect(host.targetSequenceSnapshot).toHaveBeenCalledTimes(1);
      expect(f.events.filter(event => event === 'dispatch')).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
      expect(f.host.acquireSources).toHaveBeenCalledTimes(1);
      releaseRead(structuredClone(f.after)); expect((await result)?.status).toBe('pass');
      expect(f.host.acquireSources).toHaveBeenCalledTimes(3); expect(host.targetSequenceSnapshot).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('returns UNVERIFIED when final native read fails and never retries the mutation or read', async () => {
    const f = fixture(), failed = vi.fn(async () => { throw Error('native object invalid'); });
    const result = await tryCloneOneTrackBatch(f.before, f.plans, { ...f.host, targetSequenceSnapshot: failed });
    expect(result?.status).toBe('unverified'); expect(result?.after).toBeUndefined(); expect(failed).toHaveBeenCalledTimes(1);
    expect(f.events.filter(event => event === 'dispatch')).toHaveLength(1);
  });
});
