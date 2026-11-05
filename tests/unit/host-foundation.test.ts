import { describe, expect, it } from "vitest";
import {
  assertLocalScratchPath, durationBetween, LOCAL_SCRATCH_ROOT, normalizeHostPath, splitWindowsPath,
} from "../../apps/uxp-plugin/src/host-foundation.js";

function expectHostError(action: () => void, code: string): void {
  try {
    action();
    throw new Error(`Expected host error ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("Premiere host foundation", () => {
  it("normalizes Windows device paths and separator/case variants", () => {
    expect(normalizeHostPath("\\\\?\\C:\\Temp\\Folder\\")).toBe("c:\\temp\\folder");
    expect(normalizeHostPath("\\\\?\\UNC\\server\\share\\file.mov")).toBe("\\\\server\\share\\file.mov");
    expect(normalizeHostPath("C:/Temp/File.MOV")).toBe("c:\\temp\\file.mov");
  });

  it("accepts only the exact scratch root or descendants with the requested extension", () => {
    expect(() => assertLocalScratchPath(`${LOCAL_SCRATCH_ROOT}\\working.prproj`, ".prproj")).not.toThrow();
    expect(() => assertLocalScratchPath(`${LOCAL_SCRATCH_ROOT.toUpperCase()}\\WORKING.PRPROJ`, ".prproj")).not.toThrow();
    expectHostError(() => assertLocalScratchPath(`${LOCAL_SCRATCH_ROOT}-escape\\working.prproj`, ".prproj"), "PATH_NOT_ALLOWED");
    expectHostError(() => assertLocalScratchPath(`${LOCAL_SCRATCH_ROOT}\\working.mp4`, ".prproj"), "EXTENSION_NOT_ALLOWED");
  });

  it("derives non-negative tick durations and Windows output parts", () => {
    expect(durationBetween(
      { ticks: "100", seconds: 1 },
      { ticks: "250", seconds: 2.5 },
    )).toEqual({ ticks: "150", seconds: 1.5 });
    expect(durationBetween(
      { ticks: "250", seconds: 2.5 },
      { ticks: "100", seconds: 1 },
    )).toEqual({ ticks: "0", seconds: 0 });
    expect(splitWindowsPath("C:/output/frame.png")).toEqual({
      directory: "C:\\output\\",
      filename: "frame.png",
    });
  });
});
