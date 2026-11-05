import { describe, expect, it } from "vitest";
import { equalSnapshotValue } from "../../apps/uxp-plugin/src/snapshot-equality.js";
import { stableValue } from "../../apps/uxp-plugin/src/track-relocation.js";

describe("allocation-free readback comparison", () => {
  it("agrees with the prior canonical JSON comparator across nested snapshot shapes", () => {
    let seed = 8721;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const value = (depth: number): any => {
      if (!depth) return [null, false, true, `ticks:${random()}`, random() / 100][random() % 5];
      if (random() % 2) return Array.from({ length: random() % 4 }, () => value(depth - 1));
      return Object.fromEntries(Array.from({ length: random() % 5 }, (_, i) => [`k${i}`, value(depth - 1)]));
    };
    const reorder = (v: any): any => Array.isArray(v) ? v.map(reorder) : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).reverse().map(key => [key, reorder(v[key])])) : v;
    for (let i = 0; i < 500; i++) {
      const a = value(4); const b = reorder(a); const c = value(4);
      expect(equalSnapshotValue(a, b)).toBe(stableValue(a) === stableValue(b));
      expect(equalSnapshotValue(a, c)).toBe(stableValue(a) === stableValue(c));
    }
  });
  it("does not miss ordered keyframe, tick, interpolation, type or extra-field changes", () => {
    const baseline = { start: { ticks: "100000000000000001" }, optional: undefined,
      components: [{ value: [1, 2], timeVarying: true, keyframes: [{ ticks: "1", mode: 2 }, { ticks: "2", mode: 4 }] }] };
    expect(equalSnapshotValue(baseline, JSON.parse(JSON.stringify(baseline)))).toBe(true);
    for (const change of [
      (v: any) => { v.start.ticks = "100000000000000002"; },
      (v: any) => { v.components[0].keyframes.reverse(); },
      (v: any) => { v.components[0].keyframes[0].mode = 4; },
      (v: any) => { v.components[0].value[0] = "1"; },
      (v: any) => { v.components[0].newField = null; },
    ]) { const mutated = structuredClone(baseline); change(mutated); expect(equalSnapshotValue(baseline, mutated)).toBe(false); }
  });
});
