import { describe, expect, it, vi } from 'vitest';
import { uxpModules } from '../helpers/uxp-modules.js';
import { canBatchOneTrackClones, tryCloneOneTrackBatch, type CloneBatchPlan, type CloneTrackBatchHost } from '../../apps/uxp-plugin/src/host-clone-batch.js';

const time = (seconds: number) => ({ ticks: String(Math.round(seconds * 254016000000)), seconds });
function nativeTrack(count = 4, fault = '') {
  const data = Array.from({ length: count }, (_, index) => ({ name: `Graphic ${index}`, trackIndex: 1, start: index * 10, end: index * 10 + 1, inPoint: 3600, outPoint: 3601, speed: 1 }));
  const lastOriginal = data.at(-1);
  const plain = (item: typeof data[number]) => ({ id: `video:${item.trackIndex}:${time(item.start).ticks}:`, name: item.name, mediaType: 'video', projectItemId: '', trackIndex: item.trackIndex, start: time(item.start), end: time(item.end), inPoint: time(item.inPoint), outPoint: time(item.outPoint), disabled: false, speed: item.speed, reversed: false, adjustmentLayer: false });
  const snapshot = () => ({ id: 's', name: 'Sequence', width: 1920, height: 1080, frameRate: 24, duration: time(Math.max(...data.map(item => item.end))), videoTracks: 2, audioTracks: 0, captionTracks: 0, captionTrackStates: [], transitions: [], itemsTruncated: false, items: data.map(plain), tracks: [0, 1].map(index => ({ mediaType: 'video', index, id: index + 1, name: `Track ${index}`, muted: false, itemCount: data.filter(item => item.trackIndex === index).length, transitionCount: 0 })) });
  let epoch = 0, pending = 0, peak = 0, collections = 0, starts = 0, metadata = 0, actions = 0, transactions = 0, locked = false, executing = false;
  const events: string[] = [];
  const read = async <T>(generation: number, value: () => T) => {
    pending++; peak = Math.max(peak, pending); await Promise.resolve(); pending--;
    if (generation !== epoch) throw Error('previous collection invalidated');
    return value();
  };
  const track = (trackIndex: number) => ({ getTrackItems: () => {
    expect(pending).toBe(0); collections++; const generation = ++epoch; events.push('collection');
    if (fault === 'null-collection') return [null];
    const values = data.filter(item => item.trackIndex === trackIndex);
    if (fault === 'duplicate-id') values.push(values[0]!);
    return values.map(item => ({
      getProjectItem: () => read(generation, () => null),
      getStartTime: () => { starts++; return read(generation, () => time(item.start)); },
      getEndTime: () => read(generation, () => time(item.end)),
      getName: () => { metadata++; return read(generation, () => { if (fault === 'transmutation' && item === lastOriginal) data[0]!.speed = 2; return item.name; }); },
      getInPoint: () => read(generation, () => { if (fault === 'unreadable') throw Error('native metadata invalid'); return time(item.inPoint); }),
      getOutPoint: () => read(generation, () => time(item.outPoint)),
      isDisabled: () => read(generation, () => false), getSpeed: () => read(generation, () => item.speed),
      isSpeedReversed: () => read(generation, () => false), isAdjustmentLayer: () => read(generation, () => false),
      clone(plan: CloneBatchPlan) {
        expect(locked).toBe(true); expect(executing).toBe(true); expect(pending).toBe(0);
        if (generation !== epoch) throw Error('previous collection invalidated');
        actions++; events.push('action');
        const copy = { ...item, trackIndex: plan.destinationTrack, start: item.start + plan.timeOffset, end: item.end + plan.timeOffset };
        return () => { data.push(copy); };
      },
    }));
  } });
  const sequence = { getVideoTrackCount: () => 2, getAudioTrackCount: () => 0, getVideoTrack: track };
  const items = uxpModules({ Constants: { TrackItemType: { CLIP: 1 } } })('apps/uxp-plugin/src/host-items.ts');
  const before = snapshot();
  const plans: CloneBatchPlan[] = before.items.map((source, index) => ({ clone: { trackItemId: source.id, mode: 'overwrite' }, source, videoOffset: -1, audioOffset: 0, destinationTrack: 0, timeOffset: 10000 + index - source.start.seconds }));
  const host: CloneTrackBatchHost = {
    acquireSources: vi.fn(async ids => {
      const found = await items.findTrackItemEntriesFromOneTrack(sequence, ids);
      const byId = new Map<string, any>(found.map((entry: any) => [entry.snapshot.id, entry]));
      return {
        snapshots: found.map((entry: any) => entry.snapshot),
        createAction: plan => byId.get(plan.source.id).raw.clone(plan),
        executeTransaction(_label, factory) {
          locked = true; executing = true; transactions++; events.push('transaction');
          try {
            const prepared = factory(); events.push('dispatch');
            for (const [index, action] of prepared.entries()) {
              (action as () => void)();
              if (fault === 'partial-throw' && index === 0) throw Error('native transaction failed after one action');
            }
            return true;
          } finally { locked = false; executing = false; epoch++; }
        },
      };
    }),
    waitForQuiet: vi.fn(async () => { events.push('quiet'); }),
    targetSequenceSnapshot: vi.fn(async () => { events.push('final-read'); return snapshot(); }),
  };
  return { data, before, plans, host, items, sequence, events, stats: () => ({ collections, starts, metadata, pending, peak, actions, transactions }) };
}

describe('one-track source collector', () => {
  it('returns requested-order exact metadata from one collection, with no outstanding native reads', async () => {
    const f = nativeTrack(4), ids = [f.before.items[3]!.id, f.before.items[0]!.id];
    const entries = await f.items.findTrackItemEntriesFromOneTrack(f.sequence, ids);
    expect(entries.map((entry: any) => entry.snapshot)).toEqual([f.before.items[3], f.before.items[0]]);
    expect(f.stats()).toMatchObject({ collections: 1, starts: 6, metadata: 2, pending: 0, peak: 1 });
    for (const entry of entries) expect(await entry.raw.getName()).toBe(entry.snapshot.name);
    f.sequence.getVideoTrack(0).getTrackItems();
    await expect(entries[0].raw.getName()).rejects.toThrow('previous collection invalidated');
  });

  it.each(['mixed-track', 'mixed-media', 'duplicate-request', 'malformed', 'empty'] as const)('rejects %s before any collection acquisition', async fault => {
    const f = nativeTrack(), first = f.before.items[0]!.id;
    const ids = fault === 'mixed-track' ? [first, first.replace('video:1:', 'video:0:')] : fault === 'mixed-media' ? [first, first.replace('video:', 'audio:')] : fault === 'duplicate-request' ? [first, first] : fault === 'malformed' ? ['unknown'] : [];
    await expect(f.items.findTrackItemEntriesFromOneTrack(f.sequence, ids)).rejects.toMatchObject({ code: 'TRACK_ITEM_BATCH_SCOPE_INVALID' }); expect(f.stats().collections).toBe(0);
  });

  it.each(['duplicate-id', 'unreadable', 'null-collection'] as const)('does not substitute or omit a %s source', async fault => {
    const f = nativeTrack(4, fault);
    await expect(f.items.findTrackItemEntriesFromOneTrack(f.sequence, [f.before.items[0]!.id])).rejects.toThrow();
    expect(f.stats().pending).toBe(0); expect(f.stats().collections).toBe(fault === 'null-collection' ? 2 : 1);
  });

  it('fails a missing source even when another native item shares its start', async () => {
    const f = nativeTrack();
    await expect(f.items.findTrackItemEntriesFromOneTrack(f.sequence, [f.before.items[0]!.id + 'wrong-project-source'])).rejects.toMatchObject({ code: 'TRACK_ITEM_NOT_FOUND' });
    expect(f.stats()).toMatchObject({ collections: 1, pending: 0 });
  });

  it.each([[100, 1136], [500, 5344]])('reads a %i-item track once for20 exact sources, instead of20 independent scans', async (count, referenceStarts) => {
    const collected = nativeTrack(count), repeated = nativeTrack(count);
    const ids = Array.from({ length: 20 }, (_, i) => collected.before.items[Math.floor((i + 1) * count / 20) - 1]!.id);
    const result = await collected.items.findTrackItemEntriesFromOneTrack(collected.sequence, ids);
    const references = [];
    for (const id of ids) references.push((await repeated.items.findTrackItemEntry(repeated.sequence, id)).snapshot);
    expect(result.map((entry: any) => entry.snapshot)).toEqual(references);
    expect(collected.stats()).toMatchObject({ collections: 1, starts: count + ids.length, metadata: 20, pending: 0, peak: 1 });
    expect(repeated.stats().collections).toBe(20); expect(repeated.stats().starts).toBe(referenceStarts); expect(repeated.stats().starts).toBeGreaterThan(collected.stats().starts * 8);
  });
});

describe('multi-source same-track fresh clone transactions', () => {
  it('validates each exact source in a fresh collection and commits one action before complete prefix proof', async () => {
    const f = nativeTrack();
    const result = await tryCloneOneTrackBatch(f.before, f.plans, f.host);
    expect(result?.status).toBe('pass'); expect(result?.hostResult).toMatchObject({ batchMode: 'fresh_source_transactions', completedClones: 4, originalsPreserved: true });
    expect(f.stats()).toMatchObject({ collections: 4, transactions: 4, actions: 4, pending: 0, peak: 1 });
    expect(f.events).toEqual(Array.from({ length: 4 }, () => ['collection', 'transaction', 'action', 'dispatch', 'quiet', 'final-read']).flat());
  });

  it('reacquires repeated original sources while preserving every clone intent', async () => {
    const f = nativeTrack(2), extra = { ...f.plans[0]!, timeOffset: 20000 };
    const result = await tryCloneOneTrackBatch(f.before, [...f.plans, extra], f.host);
    expect(result?.status).toBe('pass'); expect(f.host.acquireSources).toHaveBeenCalledTimes(3); expect(f.stats().actions).toBe(3);
    for (const [index, source] of [f.before.items[0]!, f.before.items[1]!, f.before.items[0]!].entries()) expect(f.host.acquireSources).toHaveBeenNthCalledWith(index + 1, [source.id]);
  });

  it('refuses mixed source tracks, mixed media and occupied destinations without acquisition', async () => {
    for (const change of [{ trackIndex: 0 }, { mediaType: 'audio' }]) {
      const f = nativeTrack(), plans = [...f.plans]; plans[1] = { ...plans[1]!, source: { ...plans[1]!.source, ...change } };
      expect(canBatchOneTrackClones(f.before, plans)).toBe(false); expect(await tryCloneOneTrackBatch(f.before, plans, f.host)).toBeUndefined(); expect(f.stats().collections).toBe(0);
    }
    const f = nativeTrack(), occupied = f.plans.map(plan => ({ ...plan, destinationTrack: 1, videoOffset: 0, timeOffset: 0 }));
    expect(await tryCloneOneTrackBatch(f.before, occupied, f.host)).toBeUndefined(); expect(f.stats().collections).toBe(0);
  });

  it('rejects complete metadata drift before creating any native action', async () => {
    const f = nativeTrack(); f.data[0]!.outPoint++;
    await expect(tryCloneOneTrackBatch(f.before, f.plans, f.host)).rejects.toMatchObject({ code: 'CLONE_SOURCE_CHANGED' });
    expect(f.stats()).toMatchObject({ collections: 1, transactions: 0, actions: 0 });
  });

  it('cannot falsely pass an earlier source transmuted during a later source metadata read', async () => {
    const f = nativeTrack(4, 'transmutation'), result = await tryCloneOneTrackBatch(f.before, f.plans, f.host);
    expect(result?.status).toBe('fail'); expect(result?.hostResult).toMatchObject({ originalsPreserved: false, completedClones: 4 }); expect(f.stats().transactions).toBe(4);
  });

  it('detects an illicit extra collection before action creation instead of cloning substituted wrappers', async () => {
    const f = nativeTrack(), acquire = f.host.acquireSources;
    const host: CloneTrackBatchHost = { ...f.host, acquireSources: async ids => { const result = await acquire(ids); f.sequence.getVideoTrack(0).getTrackItems(); return result; } };
    const result = await tryCloneOneTrackBatch(f.before, f.plans, host);
    expect(result?.status).toBe('unverified'); expect(f.stats()).toMatchObject({ collections: 2, actions: 0, transactions: 1 }); expect(f.data).toHaveLength(4);
  });

  it('keeps a partial native dispatch UNVERIFIED and reports only observed clones without replay', async () => {
    const f = nativeTrack(4, 'partial-throw'), result = await tryCloneOneTrackBatch(f.before, f.plans, f.host);
    expect(result?.status).toBe('unverified'); expect(result?.hostResult).toMatchObject({ accepted: false, completedClones: 1 }); expect(f.stats().transactions).toBe(1); expect(f.host.acquireSources).toHaveBeenCalledTimes(1);
  });
});
