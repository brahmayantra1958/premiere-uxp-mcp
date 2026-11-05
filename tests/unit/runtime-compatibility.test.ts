import { describe, expect, it } from "vitest";
import {
  assessRuntimeCompatibility,
  compareAdobeVersions,
  REQUIRED_PREMIERE_VERSION,
} from "../../apps/uxp-plugin/src/runtime-compatibility.js";

describe("Premiere runtime compatibility", () => {
  it("compares Adobe dotted versions numerically instead of lexically", () => {
    expect(compareAdobeVersions("26.10.0", "26.3.0")).toBe(1);
    expect(compareAdobeVersions("26.3", "26.3.0")).toBe(0);
    expect(compareAdobeVersions("26.2.9", "26.3.0")).toBe(-1);
  });

  it("accepts the installed 26.3.2 runtime against the plugin requirement", () => {
    expect(assessRuntimeCompatibility("26.3.2")).toEqual({
      requiredPremiereVersion: REQUIRED_PREMIERE_VERSION,
      status: "compatible",
    });
  });

  it("fails closed when the runtime is too old or cannot be parsed", () => {
    expect(assessRuntimeCompatibility("26.2.9").status).toBe("incompatible");
    expect(assessRuntimeCompatibility("").status).toBe("unknown");
  });
});
