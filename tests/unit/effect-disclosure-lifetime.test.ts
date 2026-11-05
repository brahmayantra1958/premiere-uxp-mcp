import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({ fixture: null as any }));
const tick = (seconds: number) => ({ seconds, ticks: String(Math.round(seconds * 254016000000)) });

vi.mock('../../apps/uxp-plugin/src/host-context.js', () => ({
  ppro: {
    ClipProjectItem: { cast: async (value: any) => value },
    TickTime: { TIME_ZERO: { seconds: 0, ticks: '0' }, createWithTicks: (ticks: string) => ({ ticks, seconds: Number(ticks) / 254016000000 }) },
  },
  mutationContext: async () => shared.fixture.context(),
  sequenceId: async (sequence: any) => sequence.guid,
  assertMethod: (owner: any, key: string) => { if (typeof owner[key] !== 'function') throw Error('Missing ' + key); },
}));
vi.mock('../../apps/uxp-plugin/src/host-items.js', () => ({
  findTrackItemEntry: async () => shared.fixture.acquire(),
}));
// Exercise the real PremiereHost adapters and preservation, isolating only the
// external disclosure protocol. The real quiet clock and graph reader are used.
vi.mock('../../apps/uxp-plugin/src/effect-disclosure.js', () => ({
  revealEffectDisclosure: async (_work: unknown, services: any) => shared.fixture.disclose(services),
}));

import { PremiereHost } from '../../apps/uxp-plugin/src/premiere-host.js';
import { noteGraphicMutation } from '../../apps/uxp-plugin/src/graphic-lifecycle.js';
import { workFollow } from '../../apps/uxp-plugin/src/work-follow.js';

type Mode = 'clear throws' | 'restore verification throws' | 'clear succeeds';
type ReadEvent = { name: string; at: number; generation: number };
let pending: Promise<any> | undefined;

function fixture(mode: Mode) {
  const state = {
    generation: 0, changedAt: undefined as number | undefined, blockedUntil: Number.NEGATIVE_INFINITY,
    reads: [] as ReadEvent[], premature: [] as ReadEvent[], selectionItems: [] as any[],
    clearCalls: 0, setCalls: 0, verificationFailure: false, discloseCalls: 0,
    adapterReturnedAt: undefined as number | undefined, yieldedAt: undefined as number | undefined,
  };
  const read = (name: string, born = state.generation) => {
    const event = { name, at: Date.now(), generation: born };
    state.reads.push(event);
    if (Date.now() < state.blockedUntil) state.premature.push(event);
    if (born !== state.generation) throw Error('The script object is no longer valid.');
  };
  const change = () => {
    state.generation += 1;
    state.changedAt = Date.now();
    state.blockedUntil = Date.now() + 250;
  };
  const snapshot = {
    id: 'audio:0:2540160000000:source', name: 'Audio', projectItemId: 'source', mediaType: 'audio', trackIndex: 0,
    start: tick(10), end: tick(20), inPoint: tick(3), outPoint: tick(13), speed: 1, reversed: false, disabled: false, adjustmentLayer: false,
  };
  const acquire = () => {
    read('metadata');
    const born = state.generation;
    const parameter = () => ({
      get displayName() { read('parameter name', born); return 'Level'; },
      getValueAtTime: async () => { read('value', born); return { value: 1 }; },
      isTimeVarying: () => { read('animation', born); return false; },
      areKeyframesSupported: async () => { read('key support', born); return true; },
      getKeyframeListAsTickTimes: () => { read('key list', born); return []; },
    });
    const component = () => ({
      getParamCount: () => { read('topology', born); return 1; },
      getMatchName: async () => { read('match name', born); return 'Volume'; },
      getDisplayName: async () => { read('component name', born); return 'Volume'; },
      getParam: () => { read('parameter', born); return parameter(); },
    });
    return {
      snapshot: structuredClone(snapshot),
      raw: {
        getProjectItem: async () => {
          read('project item', born);
          return { getMediaFilePath: async () => { read('media path', born); return 'C:/audio.wav'; } };
        },
        getComponentChain: async () => {
          read('chain', born);
          return { getComponentCount: () => { read('topology', born); return 1; }, getComponentAtIndex: () => component() };
        },
      },
    };
  };
  const selection = {
    addItem: (item: any) => { state.selectionItems.push(item); return true; },
    getTrackItems: async () => state.selectionItems,
  };
  const sequence = {
    guid: 'sequence', name: 'Sequence',
    clearSelection: async () => {
      state.clearCalls += 1; state.selectionItems = [];
      // The restore fixture's initial clear is followed by its setSelection;
      // its injected uncertain boundary is the later committed selection.
      if (mode !== 'restore verification throws') change();
      if (mode === 'clear throws') throw Error('CLEAR_APPLIED_THEN_FAILED');
    },
    getSelection: async () => {
      if (state.verificationFailure) {
        state.verificationFailure = false;
        throw Error('RESTORE_APPLIED_VERIFICATION_FAILED');
      }
      return selection;
    },
    setSelection: async () => {
      state.setCalls += 1; change(); state.verificationFailure = true; return true;
    },
  };
  const project = { guid: 'project', executeTransaction: vi.fn(() => { throw Error('Disclosure test must not dispatch content'); }) };
  const proveNative = vi.fn(async (raw: any) => { read('full native proof'); return structuredClone(raw); });
  const context = () => { read('context'); return { project, sequence }; };
  const disclose = async (services: any) => {
    state.discloseCalls += 1;
    await services.assertTarget();
    try {
      if (mode === 'restore verification throws') await services.restoreSelection();
      else await services.clearSelection();
    } catch (error) {
      state.adapterReturnedAt = Date.now();
      // Mirrors the disclosure helper's error-finally identity guard. It must
      // not touch metadata while the selection's native graph is reconstructing.
      await services.assertTarget();
      throw error;
    }
    state.adapterReturnedAt = Date.now();
    await services.yieldToHost();
    state.yieldedAt = Date.now();
    await services.assertTarget();
    return { status: 'pass', changed: true };
  };
  const host = new PremiereHost() as any;
  host.revealPanel = vi.fn(async () => ({ status: 'pass' }));
  const reveal = vi.spyOn(host, 'revealEffect');
  const request = {
    version: 1, id: mode, command: 'set_effect_values', timeoutMs: 5000,
    args: {
      expectedProjectId: 'project', expectedSequenceId: 'sequence', expectedSequenceName: 'Sequence',
      trackItemId: snapshot.id, expectedProjectItemId: 'source', expectedMediaType: 'audio', expectedTrackIndex: 0,
      expectedStartSeconds: 10, expectedEndSeconds: 20, componentIndex: 0, componentMatchName: 'Volume', __readEffectChain: proveNative,
    },
  };
  const value = { state, acquire, context, disclose, project, proveNative, host, reveal, request };
  shared.fixture = value;
  return value;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T06:00:00Z'));
  noteGraphicMutation(Date.now() - 1000); workFollow.enabled = true;
});
afterEach(async () => {
  try { await vi.runAllTimersAsync(); if (pending) await pending; }
  finally { pending = undefined; shared.fixture = null; vi.useRealTimers(); noteGraphicMutation(Date.now() - 1000); }
});

describe('PremiereHost disclosure selection lifetime', () => {
  it.each(['clear throws', 'restore verification throws'] as const)('settles %s before any subsequent metadata, topology or final content read', async mode => {
    const f = fixture(mode);
    pending = f.host.followPanels(f.request);
    // Complete only the existing 100 ms two-probe baseline. The failing native
    // selection then starts the real 250 ms mutation quiet period.
    await vi.advanceTimersByTimeAsync(100);
    expect(f.state.changedAt).toBe(Date.now());
    expect(f.proveNative).toHaveBeenCalledTimes(1);
    const readsAtFailure = f.state.reads.length;
    expect(f.state.adapterReturnedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(249);
    expect(f.state.reads).toHaveLength(readsAtFailure);
    expect(f.proveNative).toHaveBeenCalledTimes(1);
    expect(f.state.adapterReturnedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.state.adapterReturnedAt).toBe(f.state.changedAt! + 250);
    expect(f.state.reads.length).toBeGreaterThan(readsAtFailure);
    expect(f.state.reads.slice(readsAtFailure).every(event => event.at >= f.state.changedAt! + 250)).toBe(true);
    // Final full preservation still performs its normal stable-probe interval.
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result.effectExpansion).toMatchObject({ status: 'unverified', reason: mode === 'clear throws' ? 'CLEAR_APPLIED_THEN_FAILED' : 'RESTORE_APPLIED_VERIFICATION_FAILED' });
    expect(f.proveNative).toHaveBeenCalledTimes(2);
    expect(f.state.reads.filter(event => event.name === 'value')).toHaveLength(2);
    expect(f.state.premature).toEqual([]);
    expect(f.reveal).toHaveBeenCalledOnce(); expect(f.state.discloseCalls).toBe(1);
    expect(f.state.clearCalls).toBe(1); expect(f.state.setCalls).toBe(mode === 'clear throws' ? 0 : 1);
    expect(f.project.executeTransaction).not.toHaveBeenCalled();
  });

  it('uses one 250 ms period after successful clear and keeps yield/final waits from starting another period', async () => {
    const f = fixture('clear succeeds');
    pending = f.host.followPanels(f.request);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.state.changedAt).toBe(Date.now());
    const readsAfterClear = f.state.reads.length;
    await vi.advanceTimersByTimeAsync(249);
    expect(f.state.reads).toHaveLength(readsAfterClear);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.state.adapterReturnedAt).toBe(f.state.changedAt! + 250);
    expect(f.state.yieldedAt).toBe(f.state.adapterReturnedAt);
    await vi.advanceTimersByTimeAsync(100);
    const expansion=(await pending).effectExpansion;
    expect(expansion.status).toBe('pass');
    // The returned record must include the finally preservation read. Its
    // full values cost is outside the native disclosure helper's own timing.
    expect(expansion.effectPhaseTimingsMs).toMatchObject({
      baselineSnapshot:100,nativeFollow:250,finalQuiet:0,finalTopology:0,finalValues:100,total:450,
    });
    expect(Object.values(expansion.effectPhaseTimingsMs).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)).toBe(true);
    const {total,...phases}=expansion.effectPhaseTimingsMs;
    expect(Object.values(phases).reduce((sum:number,value)=>sum+Number(value),0)).toBe(total);
    expect(Date.now()).toBe(f.state.changedAt! + 350);
    expect(f.proveNative).toHaveBeenCalledTimes(2);
    expect(f.state.premature).toEqual([]);
    expect(f.state.clearCalls).toBe(1); expect(f.state.setCalls).toBe(0);
    expect(f.project.executeTransaction).not.toHaveBeenCalled();
  });
});
