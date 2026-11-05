import { describe, expect, it } from "vitest";
import { isFrameAligned, MAX_FRAME_ALIGNMENT_ERROR_SECONDS } from "../../apps/uxp-plugin/src/timing";

describe("frame-aligned timeline comparison", () => {
  it("accepts Premiere 29.97 fps quantization", () => {
    expect(isFrameAligned(8.008, 8)).toBe(true);
    expect(isFrameAligned(7.974633333333333, 8)).toBe(true);
  });

  it("rejects timing differences larger than one slowest-supported frame", () => {
    expect(MAX_FRAME_ALIGNMENT_ERROR_SECONDS).toBeLessThan(0.044);
    expect(isFrameAligned(8.1, 8)).toBe(false);
  });
});
