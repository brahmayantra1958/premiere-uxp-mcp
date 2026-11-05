import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MaskSeedFrame, ObjectSegmentationRequest, ObjectSegmentationResult } from "@premiere-uxp/contracts";
import {
  assertMaskSeedArtifact,
  assertOutputPathAvailable,
  validateObjectMaskPrompt,
  verifyObjectSegmentationResult,
} from "../../apps/mcp-server/src/object-segmentation.js";

function png(width: number, height: number, marker = 0): Buffer {
  const bytes = Buffer.alloc(26, marker);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function seed(filePath: string, bytes: Buffer): MaskSeedFrame {
  return {
    status: "pass",
    capturedAt: "2026-09-03T00:00:00.000Z",
    project: { id: "project-1", name: "WORKING.prproj", path: "C:\\repo\\artifacts\\scratch\\WORKING.prproj", stateSha256: "d".repeat(64) },
    sequence: { id: "sequence-1", name: "WORKING__sequence", width: 1920, height: 1080, frameRate: 30 },
    target: { trackItemId: "video:0:0:item", projectItemId: "item", trackIndex: 0, clipStartSeconds: 0, clipEndSeconds: 10, sourceTimeSeconds: 1, speed: 1, reversed: false },
    frame: { requestedTimelineTimeSeconds: 1, timelineFrameIndex: 30, timelineTimeSeconds: 1, outputPath: filePath, sha256: hash(bytes), sizeBytes: bytes.length, width: 1920, height: 1080 },
    hostReceipt: { commandId: "command-1", status: "pass" },
    errors: [],
  };
}

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("object segmentation evidence", () => {
  it("accepts bounded point/box prompts and rejects coordinates outside the seed", () => {
    const value = seed("C:\\seed.png", png(1920, 1080));
    expect(validateObjectMaskPrompt(value, {
      coordinateSpace: "image_pixels",
      points: [{ x: 300, y: 200, label: "positive" }, { x: 700, y: 500, label: "negative" }],
      box: { left: 100, top: 100, right: 800, bottom: 900 },
    }).points).toHaveLength(2);
    expect(() => validateObjectMaskPrompt(value, { coordinateSpace: "image_pixels", points: [{ x: 1920, y: 2, label: "positive" }] })).toThrow(/POINT_OUTSIDE/);
    expect(() => validateObjectMaskPrompt(value, { coordinateSpace: "image_pixels", points: [{ x: 200, y: 200, label: "negative" }] })).toThrow(/positive point or a box/);
    expect(() => validateObjectMaskPrompt(value, { coordinateSpace: "image_pixels", points: [], box: { left: 800, top: 10, right: 700, bottom: 30 } })).toThrow(/BOX_EMPTY/);
  });

  it("binds the seed and result to exact PNG bytes, dimensions, paths, and identities", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "object-segmentation-"));
    const seedPath = path.join(directory, "seed.png");
    const maskPath = path.join(directory, "mask.png");
    const seedBytes = png(1920, 1080, 1);
    const maskBytes = png(1920, 1080, 2);
    await writeFile(seedPath, seedBytes);
    const seedReceipt = seed(seedPath, seedBytes);
    await expect(assertMaskSeedArtifact(seedReceipt, seedPath)).resolves.toBeUndefined();
    await expect(assertOutputPathAvailable(maskPath)).resolves.toBeUndefined();
    await writeFile(maskPath, maskBytes);
    await expect(assertOutputPathAvailable(maskPath)).rejects.toThrow(/OUTPUT_ALREADY_EXISTS/);

    const request: ObjectSegmentationRequest = {
      requestId: "11111111-1111-4111-8111-111111111111",
      objectId: "main-subject",
      expectedModel: "sam2.1_hiera_small",
      seed: seedReceipt,
      prompt: { coordinateSpace: "image_pixels", points: [{ x: 300, y: 200, label: "positive" }] },
      outputMaskPath: maskPath,
    };
    const result: ObjectSegmentationResult = {
      status: "pass",
      requestId: request.requestId,
      objectId: request.objectId,
      seedSha256: seedReceipt.frame.sha256,
      engine: {
        status: "online",
        service: "premiere-object-segmentation",
        protocolVersion: "1",
        processId: 123,
        engineVersion: "0.1.0",
        model: { name: request.expectedModel, version: "2.1", checkpointSha256: "a".repeat(64) },
        device: { kind: "cuda", name: "RTX 5070 Ti" },
        capabilities: { imageSegmentation: true, videoTracking: true, pointPrompts: true, boxPrompts: true },
      },
      mask: { path: maskPath, sha256: hash(maskBytes), width: 1920, height: 1080, foregroundPixelCount: 200_000, bounds: { left: 100, top: 100, right: 800, bottom: 900 }, confidence: 0.95 },
      timing: { queuedMs: 1, inferenceMs: 20, totalMs: 21 },
      createdAt: "2026-09-03T00:00:01.000Z",
    };
    await expect(verifyObjectSegmentationResult(request, result, maskPath)).resolves.toBeUndefined();
    await expect(verifyObjectSegmentationResult(request, { ...result, seedSha256: "e".repeat(64) }, maskPath)).rejects.toThrow(/SEED_MISMATCH/);
  });
});
