import { describe, expect, it, vi } from "vitest";
vi.mock("../../apps/uxp-plugin/src/host-context.js", () => ({ ppro: {
  TickTime: { TIME_ZERO: { ticks: "0", seconds: 0 }, createWithTicks: (ticks: string) => ({ ticks, seconds: Number(ticks) / 100 }) },
  Keyframe: { INTERPOLATION_MODE_LINEAR: 1, INTERPOLATION_MODE_HOLD: 2, INTERPOLATION_MODE_BEZIER: 3 },
}, activeSequence: vi.fn() }));
vi.mock("../../apps/uxp-plugin/src/host-foundation.js", () => ({ text: (v: unknown) => v == null ? "" : String(v), asTickTime: (v: any) => ({ ticks: String(v.ticks), seconds: Number(v.seconds) }) }));
vi.mock("../../apps/uxp-plugin/src/host-items.js", () => ({ trackItems: vi.fn() }));
import { componentSnapshot, GraphicObjectUnavailableError, isGraphicObjectUnavailable } from "../../apps/uxp-plugin/src/host-components.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Every completed native promise rebuilds the graph. Wrappers from the prior
 * epoch then reject even synchronous access, including keyframe-time fields. */
function rebuildingFixture() {
  let epoch = 0, pending = 0, peak = 0, sequence = 0;
  const state = { componentCount: 1, paramCount: 1, displayName: "Graphic", matchName: "Graphic.Match", paramName: "Amount", nullAt: "", afterLeaf: (name: string) => { void name; } };
  const events: string[] = [];
  const check = (born: number) => { expect(pending).toBe(0); if (born !== epoch) throw Error("The script object is no longer valid."); };
  const complete = async (name: string) => {
    pending++; peak = Math.max(peak, pending); events.push(name);
    await Promise.resolve(); await Promise.resolve();
    pending--; epoch++; state.afterLeaf(name);
  };
  const tickTime = (ticks: string) => {
    const born = epoch;
    return { get ticks() { check(born); return ticks; }, get seconds() { check(born); return Number(ticks) / 100; } };
  };
  const param = () => {
    const born = epoch;
    return {
      get displayName() { check(born); return state.paramName; },
      getValueAtTime: async () => {
        check(born); await complete("getValueAtTime");
        const valueEpoch = epoch;
        return { get value() { check(valueEpoch); return 7; } };
      },
      isTimeVarying: () => { check(born); state.afterLeaf("isTimeVarying"); return true; },
      areKeyframesSupported: async () => { check(born); await complete("areKeyframesSupported"); return true; },
      getKeyframeListAsTickTimes: () => { check(born); return [tickTime("25"), tickTime("50")]; },
      getKeyframePtr: (time: any) => {
        check(born); const ticks = String(time.ticks), keyEpoch = epoch;
        return {
          get value() { check(keyEpoch); return { value: Number(ticks) / 10 }; },
          getTemporalInterpolationMode: async () => { check(keyEpoch); await complete("getTemporalInterpolationMode"); return ticks === "25" ? 2 : 3; },
        };
      },
    };
  };
  const component = () => {
    const born = epoch;
    return {
      getParamCount: () => { check(born); return state.paramCount; },
      getParam: () => { check(born); return state.nullAt === "param" ? null : param(); },
      getDisplayName: async () => { check(born); const name = state.displayName; await complete("getDisplayName"); return name; },
      getMatchName: async () => { check(born); const name = state.matchName; await complete("getMatchName"); return name; },
    };
  };
  const factory = vi.fn(async () => {
    expect(pending).toBe(0); const born = epoch; sequence++;
    return {
      getComponentChain: async () => {
        check(born); await complete("getComponentChain");
        if (state.nullAt === "chain") return null;
        const chainEpoch = epoch;
        return {
          getComponentCount: () => { check(chainEpoch); return state.componentCount; },
          getComponentAtIndex: () => { check(chainEpoch); return state.nullAt === "component" ? null : component(); },
        };
      },
    };
  });
  return { factory, state, events, inspect: () => ({ peak, pending, sequence }) };
}

describe("graphic component proxy lifetime", () => {
  it("rebinds each native leaf and copies values/ticks before the next native await", async () => {
    const f = rebuildingFixture();
    const oldItem = { getComponentChain: () => { throw Error("previously acquired item must not be reused"); } };
    const result = await componentSnapshot(oldItem, true, true, undefined, undefined, undefined, f.factory);
    expect(result[0]).toMatchObject({ componentIndex: 0, displayName: "Graphic", matchName: "Graphic.Match", params: [{
      paramIndex: 0, displayName: "Amount", value: 7, timeVarying: true, supportsKeyframes: true,
      keyframes: [{ ticks: "25", seconds: .25 }, { ticks: "50", seconds: .5 }],
      keyframeDetails: [{ time: { ticks: "25", seconds: .25 }, value: 2.5, interpolation: "hold" }, { time: { ticks: "50", seconds: .5 }, value: 5, interpolation: "bezier" }],
      readStatus: { value: "pass", animation: "pass" }, readErrors: [],
    }] });
    expect(f.inspect()).toMatchObject({ peak: 1, pending: 0 });
    expect(f.events.filter(name => name === "getValueAtTime")).toHaveLength(1);
    // One initial chain + five component bindings + two parameter bindings +
    // two keyframe bindings. Before grouped synchronous metadata this was 12.
    expect(f.factory).toHaveBeenCalledTimes(10);
  });

  it.each(["chain", "component", "param"])("rejects a null %s as typed unavailable even in non-strict reads", async nullAt => {
    const f = rebuildingFixture(); f.state.nullAt = nullAt;
    const error = await componentSnapshot(null, false, false, undefined, undefined, undefined, f.factory).catch(error => error);
    expect(error).toBeInstanceOf(GraphicObjectUnavailableError);
    expect(isGraphicObjectUnavailable(error)).toBe(true);
    expect(error.code).toBe("GRAPHIC_OBJECT_NOT_READY");
    expect(f.events).not.toContain("getValueAtTime");
  });

  it.each(["componentCount", "paramCount", "paramName", "displayName", "matchName"])("rejects %s drift instead of combining different graphs", async field => {
    const f = rebuildingFixture();
    f.state.afterLeaf = name => {
      if (name !== "getValueAtTime") return;
      if (field === "componentCount") f.state.componentCount = 2;
      else if (field === "paramCount") f.state.paramCount = 2;
      else if (field === "paramName") f.state.paramName = "Replacement";
      else if (field === "displayName") f.state.displayName = "Replacement";
      else f.state.matchName = "Replacement.Match";
    };
    await expect(componentSnapshot(null, false, false, undefined, undefined, undefined, f.factory)).rejects.toBeInstanceOf(GraphicObjectUnavailableError);
    expect(f.events.filter(name => name === "getValueAtTime")).toHaveLength(1);
  });

  it("does not swallow unavailable metadata as unknown support", async () => {
    const f = rebuildingFixture();
    f.state.afterLeaf = name => { if (name === "areKeyframesSupported") throw new GraphicObjectUnavailableError("support object unavailable"); };
    await expect(componentSnapshot(null, false, false, undefined, undefined, undefined, f.factory)).rejects.toBeInstanceOf(GraphicObjectUnavailableError);
    expect(f.events).not.toContain("getTemporalInterpolationMode");
  });

  it("uses a new exact item factory after a completed invalidation and never a cached wrapper", async () => {
    const f = rebuildingFixture();
    const invalid = vi.fn(async () => { throw Error("The script object is no longer valid."); });
    let acquisitions = 0;
    const factory = vi.fn(async () => ++acquisitions === 1 ? { getComponentChain: invalid } : f.factory());
    expect(await componentSnapshot(null, true, false, undefined, undefined, undefined, factory)).toHaveLength(1);
    expect(invalid).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls.length).toBeGreaterThan(2);
  });

  it.each(["getValueAtTime", "areKeyframesSupported"])("does not acquire a queued target or release its lane while %s is unresolved", async heldMethod => {
    const started = deferred<void>(), release = deferred<number>();
    const firstItem = { getComponentChain: async () => ({ getComponentCount: () => 1, getComponentAtIndex: () => ({
      getParamCount: () => 1, getDisplayName: async () => "Hold", getMatchName: async () => "Hold.Match",
      getParam: () => ({ displayName: "Amount", getValueAtTime: () => { if(heldMethod!=="getValueAtTime")return Promise.resolve(4); started.resolve(); return release.promise; }, isTimeVarying: () => false, areKeyframesSupported: async () => { if(heldMethod!=="areKeyframesSupported")return true; started.resolve(); await release.promise; return true; }, getKeyframeListAsTickTimes: () => [] }),
    }) }) };
    const first = componentSnapshot(null, true, false, undefined, undefined, undefined, async () => firstItem);
    await started.promise;
    const next = rebuildingFixture();
    const second = componentSnapshot(null, true, false, undefined, undefined, undefined, next.factory);
    try {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(next.factory).not.toHaveBeenCalled();
    } finally {
      release.resolve(4);
      await first;
    }
    expect(await second).toHaveLength(1);
    expect(next.factory).toHaveBeenCalled();
  });
});
