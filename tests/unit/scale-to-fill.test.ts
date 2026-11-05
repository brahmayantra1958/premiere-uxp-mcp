import { describe, expect, it } from "vitest";
import { computeScaleToFill } from "../../apps/uxp-plugin/src/scale-to-fill.js";

describe("computeScaleToFill", () => {
  it("maps 16:9 Full HD into 16:9 2K without crop or bars", () => {
    const plan = computeScaleToFill(2048, 1152, 1920, 1080);
    expect(plan.scalePercent).toBeCloseTo(106.6666667, 6);
    expect(plan.scaledWidth).toBeCloseTo(2048, 6);
    expect(plan.scaledHeight).toBeCloseTo(1152, 6);
    expect(plan.cropLeftRightPixels).toBeCloseTo(0, 6);
    expect(plan.cropTopBottomPixels).toBeCloseTo(0, 6);
  });

  it("crops the wide sides of the Juknokwon field recording and still fills 2K", () => {
    const plan = computeScaleToFill(2048, 1152, 2336, 1080);
    expect(plan.scalePercent).toBeCloseTo(106.6666667, 6);
    expect(plan.scaledWidth).toBeGreaterThan(2048);
    expect(plan.scaledHeight).toBeCloseTo(1152, 6);
    expect(plan.cropLeftRightPixels).toBeGreaterThan(0);
    expect(plan.cropTopBottomPixels).toBeCloseTo(0, 6);
  });

  it("fills a landscape frame with portrait media by cropping only vertically", () => {
    const plan = computeScaleToFill(2048, 1152, 1080, 1920);
    expect(plan.scaledWidth).toBeCloseTo(2048, 6);
    expect(plan.scaledHeight).toBeGreaterThan(1152);
    expect(plan.cropLeftRightPixels).toBeCloseTo(0, 6);
    expect(plan.cropTopBottomPixels).toBeGreaterThan(0);
  });

  it("rejects invalid dimensions", () => {
    expect(() => computeScaleToFill(2048, 1152, 0, 1080)).toThrow(/sourceWidth/);
  });
});
