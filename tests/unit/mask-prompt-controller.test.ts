import { describe, expect, it } from "vitest";
import { containImageBounds, mapClientPointToImage } from "../../apps/uxp-plugin/src/mask-prompt-controller.js";

describe("mask prompt image coordinates", () => {
  it("maps a 16:9 image into a square stage without including letterbox pixels", () => {
    expect(containImageBounds({ left: 10, top: 20, width: 400, height: 400 }, 1920, 1080)).toEqual({
      left: 10,
      top: 107.5,
      width: 400,
      height: 225,
    });
  });

  it("centers a portrait image inside a wide stage", () => {
    const result = containImageBounds({ left: 0, top: 0, width: 800, height: 200 }, 1080, 1920);
    expect(result.top).toBe(0);
    expect(result.height).toBe(200);
    expect(result.width).toBe(112.5);
    expect(result.left).toBe(343.75);
  });

  it("rejects letterbox clicks and keeps the bottom-right edge inside image dimensions", () => {
    const bounds = containImageBounds({ left: 10, top: 20, width: 400, height: 400 }, 1920, 1080);
    expect(mapClientPointToImage(bounds, 200, 50, 1920, 1080)).toBeUndefined();
    expect(mapClientPointToImage(bounds, 410, 332.5, 1920, 1080)).toEqual({
      x: 1919.999999,
      y: 1079.999999,
    });
  });
});
