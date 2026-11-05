import { describe, expect, it } from "vitest";
import { canonicalizeOperationValue, createOperationFingerprint } from "../../apps/mcp-server/src/operation-identity.js";

describe("operation identity", () => {
  it("erases object-key order without erasing array order", () => {
    const left = { z: 2, a: { y: 4, x: 3 }, items: ["first", "second"] };
    const reordered = { items: ["first", "second"], a: { x: 3, y: 4 }, z: 2 };
    const reversedArray = { items: ["second", "first"], a: { x: 3, y: 4 }, z: 2 };

    expect(canonicalizeOperationValue(left)).toEqual(canonicalizeOperationValue(reordered));
    expect(createOperationFingerprint("place_clips", left)).toBe(createOperationFingerprint("place_clips", reordered));
    expect(createOperationFingerprint("place_clips", left)).not.toBe(createOperationFingerprint("place_clips", reversedArray));
  });

  it("separates different commands and meaningful argument values", () => {
    expect(createOperationFingerprint("place_clips", { at: 1 }))
      .not.toBe(createOperationFingerprint("move_clips", { at: 1 }));
    expect(createOperationFingerprint("place_clips", { at: 1 }))
      .not.toBe(createOperationFingerprint("place_clips", { at: 2 }));
  });

  it("omits undefined object fields consistently with JSON", () => {
    expect(createOperationFingerprint("save", { optional: undefined }))
      .toBe(createOperationFingerprint("save", {}));
  });
});
