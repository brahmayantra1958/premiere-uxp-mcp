import { describe, expect, it, vi } from "vitest";
import { buildTrackWave, trackCommandSequenceSchema } from "../../apps/mcp-server/src/track-sequence-tools.js";
import { TrackCommandSequences, parseTrackCommandSequence, preflightTrackCommandSequence, stateErrors, type SequenceAdapter } from "../../apps/uxp-plugin/src/track-command-sequence.js";
import { executeTrackRelocation, relocatedItem, type RelocationItem, type RelocationState } from "../../apps/uxp-plugin/src/track-relocation.js";

function fixture() {
  const item = (n: number) => ({ id: `video:0:${n * 100}:p${n}`, projectItemId: `p${n}`, name: `clip${n}`, mediaType: "video", trackIndex: 0,
    start: { ticks: String(n * 100), seconds: n }, end: { ticks: String(n * 100 + 99), seconds: n + .99 },
    inPoint: { ticks: "0", seconds: 0 }, outPoint: { ticks: "99", seconds: .99 }, speed: 1, reversed: false });
  const items = [item(1), item(2), item(3)];
  const query = { project: { id: "p" }, sequence: { id: "s", name: "WORKING__test" }, page: { hasMore: false, scanTruncated: false }, items };
  const prepared = buildTrackWave(query, [0, 1, 2, 1, 0], 1, 0, 240000);
  const plan = parseTrackCommandSequence(prepared.arguments);
  let state: RelocationState = { sequence: { id: "s", name: "WORKING__test", itemsTruncated: false, videoTracks: 3, audioTracks: 0, items,
    tracks: [0, 1, 2].map(index => ({ mediaType: "video", index, transitionCount: 0, itemCount: index ? 0 : 3 })) },
    effects: Object.fromEntries(items.map(item => [item.id, [{ name: "Motion", scale: 150, keyframes: [{ ticks: "50", value: 170 }] }]])) };
  const baseline = structuredClone(state);
  const calls: string[] = [];
  const adapter: SequenceAdapter = {
    async read() { calls.push("read"); return structuredClone(state); },
    async move(_plan, move, id, expected, verified) {
      calls.push(id);
      return executeTrackRelocation(move, {
        async read() { return structuredClone(state); },
        validateBefore: observed => { const errors = stateErrors(expected, observed); if (errors.length) throw Error(errors.join()); },
        verified,
        async clone(source, destinationTrackIndex) {
          const dest = relocatedItem(source, destinationTrackIndex);
          state.sequence.items.push(dest); state.effects[dest.id] = structuredClone(state.effects[source.id]);
        },
        async lift(source) { state.sequence.items = state.sequence.items.filter((item: RelocationItem) => item.id !== source.id); delete state.effects[source.id]; },
        async select() {},
      });
    },
  };
  const jobs = new TrackCommandSequences();
  return { plan, query, jobs, adapter, calls, baseline, getState: () => state, setState: (value: RelocationState) => { state = value; } };
}

describe("declarative track wave protocol", () => {
  it("orders a travelling crest and returns every clip through V2/V3/V2/V1", () => {
    const f = fixture();
    expect(f.plan.steps).toHaveLength(12);
    for (const clip of f.plan.clips) expect(f.plan.steps.filter(step => step.clipRef === clip.ref).map(step => step.destinationTrackIndex)).toEqual([1, 2, 1, 0]);
    expect(f.plan.steps.slice(0, 3)).toEqual([{ clipRef: "clip_0", destinationTrackIndex: 1 }, { clipRef: "clip_0", destinationTrackIndex: 2 }, { clipRef: "clip_1", destinationTrackIndex: 1 }]);
    expect(preflightTrackCommandSequence(f.plan, f.baseline).returnsToStart).toBe(true);
    expect(trackCommandSequenceSchema.safeParse(f.plan).success).toBe(true);
  });
  it("refuses partial planning, missing source bounds and invalid clip references", () => {
    const f = fixture();
    expect(() => buildTrackWave({ ...f.query, page: { hasMore: true } }, [0, 1, 0], 1, 0, 1000)).toThrow("complete");
    expect(() => parseTrackCommandSequence({ ...f.plan, steps: [{ clipRef: "missing", destinationTrackIndex: 1 }] })).toThrow("reference");
    expect(() => parseTrackCommandSequence({ ...f.plan, clips: [f.plan.clips[0], f.plan.clips[0]] })).toThrow("duplicate");
    expect(() => parseTrackCommandSequence({ ...f.plan, maxRunMs: Infinity })).toThrow("deadline");
    expect(() => parseTrackCommandSequence({ ...f.plan, steps: Array(257).fill(f.plan.steps[0]) })).toThrow("256");
    expect(() => parseTrackCommandSequence({ ...f.plan, clips: [{ ...f.plan.clips[0], expectedInPointSeconds: undefined }] })).toThrow("unguarded");
  });
  it("preflights ALL legs and rejects a later unavailable destination before dispatch", async () => {
    const f = fixture(); f.plan.steps[9]!.destinationTrackIndex = 9;
    f.jobs.accept("job", f.plan); await f.jobs.run("job", f.adapter);
    expect(f.calls).toEqual(["read"]); expect(f.jobs.status("job").state).toBe("fail");
    expect(f.getState()).toEqual(f.baseline);
  });
  it("runs the whole wave serially, rebinds IDs and proves exact final content/effects", async () => {
    const f = fixture(); f.jobs.accept("job", f.plan); await f.jobs.run("job", f.adapter);
    expect(f.jobs.status("job")).toMatchObject({ state: "pass", completedSteps: 12, preservation: { expectedState: "pass", returnedToStart: true } });
    expect(stateErrors(f.baseline, f.getState())).toEqual([]);
    expect(f.jobs.busy).toBe(false);
  });
  it("accepts by value and rejects conflicting IDs or concurrent jobs", () => {
    const f = fixture(); const first = f.jobs.accept("job", f.plan);
    expect(f.jobs.accept("job", f.plan).fresh).toBe(false);
    expect(() => f.jobs.accept("other", f.plan)).toThrow("BUSY");
    f.plan.steps[0]!.destinationTrackIndex = 2;
    expect(first.job.plan.steps[0]!.destinationTrackIndex).toBe(1);
    expect(() => f.jobs.accept("job", f.plan)).toThrow("different");
  });
  it("status remains available during a native step; cancel waits for its proof", async () => {
    const f = fixture(); let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const move = f.adapter.move;
    f.adapter.move = async (...args) => { entered(); await gate; return move(...args); };
    f.jobs.accept("job", f.plan); const running = f.jobs.run("job", f.adapter); await started;
    expect(f.jobs.status("job")).toMatchObject({ state: "running", currentStep: 0, completedSteps: 0 });
    expect(f.jobs.cancel("job")).toMatchObject({ state: "running", cancelRequested: true });
    release(); await running;
    expect(f.jobs.status("job")).toMatchObject({ state: "cancelled", completedSteps: 1, preservation: { expectedState: "pass", returnedToStart: false } });
    expect(f.calls.filter(call => call.includes(":step:"))).toHaveLength(1);
  });
  it("detects outside changes between steps before dispatching another clone", async () => {
    const f = fixture(); const move = f.adapter.move; let count = 0;
    f.adapter.move = async (...args) => {
      if (++count === 2) f.getState().sequence.items[2].disabled = true;
      return move(...args);
    };
    f.jobs.accept("job", f.plan); await f.jobs.run("job", f.adapter);
    expect(f.jobs.status("job")).toMatchObject({ state: "unverified", completedSteps: 1 });
    expect(count).toBe(2);
  });
  it("never dispatches subsequent steps after an unverified result", async () => {
    const f = fixture(); f.adapter.move = async () => ({ status: "unverified", errors: ["unknown native state"] });
    f.jobs.accept("job", f.plan); await f.jobs.run("job", f.adapter);
    expect(f.jobs.status("job")).toMatchObject({ state: "unverified", completedSteps: 0, results: [{ status: "unverified" }] });
  });
  it("final collateral mismatch prevents pass even after every move passed", async () => {
    const f = fixture(); const read = f.adapter.read; let reads = 0;
    f.adapter.read = async (...args) => { if (++reads === 2) f.getState().sequence.tracks[0].name = "unexpected"; return read(...args); };
    f.jobs.accept("job", f.plan); await f.jobs.run("job", f.adapter);
    expect(f.jobs.status("job")).toMatchObject({ state: "unverified", completedSteps: 12, preservation: { expectedState: "unverified" } });
  });
  it("unknown/reloaded jobs report UNVERIFIED and cancellation cannot execute work", () => {
    const f = fixture(); expect(f.jobs.cancel("unknown").state).toBe("unverified"); expect(f.jobs.busy).toBe(false); expect(f.calls).toEqual([]);
  });
  it("does not publish terminal cancellation until final readback releases the queue", async () => {
    const f = fixture(); let release!: () => void; let entered!: () => void; let reads = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const finalRead = new Promise<void>(resolve => { entered = resolve; });
    const read = f.adapter.read;
    f.adapter.read = async (...args) => { if (++reads === 2) { entered(); await gate; } return read(...args); };
    const move = f.adapter.move;
    f.adapter.move = async (...args) => { const result = await move(...args); f.jobs.cancel("job"); return result; };
    f.jobs.accept("job", f.plan); const running = f.jobs.run("job", f.adapter); await finalRead;
    expect(f.jobs.status("job")).toMatchObject({ state: "running", completedSteps: 1 }); expect(f.jobs.busy).toBe(true);
    release(); await running;
    expect(f.jobs.status("job")).toMatchObject({ state: "cancelled", preservation: { expectedState: "pass" } }); expect(f.jobs.busy).toBe(false);
  });
  it("returns paginated evidence without dropping later results", async () => {
    const f = fixture(); f.plan.steps = Array.from({ length: 5 }, () => f.plan.steps).flat();
    f.jobs.accept("job", f.plan); await f.jobs.run("job", f.adapter);
    const first = f.jobs.status("job"); const last = f.jobs.status("job", 50);
    expect(first).toMatchObject({ state: "pass", nextCursor: 50, hasMore: true }); expect(first.results).toHaveLength(50);
    expect(last).toMatchObject({ nextCursor: 60, hasMore: false }); expect(last.results).toHaveLength(10);
  });
  it("spaces actual step starts and does not burst while waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const f = fixture(); f.plan.minIntervalMs = 1000;
      f.jobs.accept("job", f.plan); const running = f.jobs.run("job", f.adapter);
      await vi.advanceTimersByTimeAsync(0); expect(f.jobs.status("job").completedSteps).toBe(1);
      await vi.advanceTimersByTimeAsync(999); expect(f.jobs.status("job").completedSteps).toBe(1);
      await vi.advanceTimersByTimeAsync(1); expect(f.jobs.status("job").completedSteps).toBe(2);
      f.jobs.cancel("job"); await vi.advanceTimersByTimeAsync(50); await running;
      expect(f.jobs.status("job").results?.map(result => result.startedMs)).toEqual([0, 1000]);
    } finally { vi.useRealTimers(); }
  });
  it("the run deadline stops at a step boundary without dispatching the remainder", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      const f = fixture(); f.plan.minIntervalMs = 5000; f.plan.maxRunMs = 1000;
      f.jobs.accept("job", f.plan); const running = f.jobs.run("job", f.adapter);
      await vi.advanceTimersByTimeAsync(1000); await running;
      expect(f.jobs.status("job")).toMatchObject({ state: "fail", completedSteps: 1, preservation: { expectedState: "pass" } });
      await expect(f.jobs.run("job", f.adapter)).rejects.toThrow("cannot replay");
    } finally { vi.useRealTimers(); }
  });
});
