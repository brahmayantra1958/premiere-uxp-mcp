import { describe, expect, it } from "vitest";
import { snapshotHostValue, unwrapHostValue } from "../../apps/uxp-plugin/src/host-value";

describe("unwrapHostValue", () => {
  it("unwraps Premiere scalar and array Variant values", () => {
    expect(unwrapHostValue({ value: 100 })).toBe(100);
    expect(unwrapHostValue({ value: { value: [0.5, 0.5] } })).toEqual([0.5, 0.5]);
  });

  it("preserves structured PointF and Color values", () => {
    const point = { x: 0.25, y: 0.75 };
    const color = { red: 1, green: 0.5, blue: 0.25, alpha: 1 };
    expect(unwrapHostValue(point)).toBe(point);
    expect(unwrapHostValue(color)).toBe(color);
  });

  it("owns nested readback values even after a native/Variant source changes", () => {
    const native = { value: { position: [0.25, 0.75], color: { red: 1, alpha: 0.5 } } };
    const snapshot = snapshotHostValue(native);
    native.value.position[0] = 9; native.value.color.alpha = 0;
    expect(snapshot).toEqual({ position: [0.25, 0.75], color: { red: 1, alpha: 0.5 } });
  });

  it("keeps scalar types and structured fields without a JSON precision/coercion round trip", () => {
    const value = { precise: 1.2345678901234567, ticks: "9007199254740995", flag: false, nested: { value: 5 } };
    expect(snapshotHostValue(value)).toEqual(value);
    expect(snapshotHostValue(value)).not.toBe(value);
  });
});
