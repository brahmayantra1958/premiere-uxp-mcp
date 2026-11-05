import { describe, expect, it } from "vitest";
import { componentWriteStatus, hostNumericValuesEqual, isTransientHostObjectInvalidation } from "../../apps/uxp-plugin/src/component-write.js";

describe("transient Premiere host object invalidation", () => {
  it("recognizes only the known stale script-object failure", () => {
    expect(isTransientHostObjectInvalidation(new Error("The script object is no longer valid."))).toBe(true);
    expect(isTransientHostObjectInvalidation(new Error("Effect parameter not found"))).toBe(false);
  });
});
describe("component write classification", () => {
  it("passes an idempotent no-op when readback already matches the target", () => {
    expect(componentWriteStatus(false, { missing: [], animated: [] }, { missing: [], mismatched: [] })).toBe("pass");
  });

  it("keeps a no-change mismatch as fail", () => {
    expect(componentWriteStatus(false, { missing: [], animated: [] }, { missing: [], mismatched: ["Scale"] })).toBe("fail");
  });

  it("reports a changed but incomplete write as partial", () => {
    expect(componentWriteStatus(true, { missing: ["Scale"], animated: [] }, { missing: [], mismatched: [] })).toBe("partial");
  });
});

describe("host numeric readback tolerance", () => {
  it("accepts Premiere float32 rounding for a percentage parameter", () => {
    expect(hostNumericValuesEqual(106.66666412353516, 106.66666666666667)).toBe(true);
  });

  it("accepts sub-micro coordinate rounding", () => {
    expect(hostNumericValuesEqual(0.49999994, 0.5)).toBe(true);
  });

  it("still rejects a visually material parameter mismatch", () => {
    expect(hostNumericValuesEqual(106.65, 106.66666666666667)).toBe(false);
  });
});
