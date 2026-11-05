import { describe, expect, it, vi } from "vitest";
import type { MaskSeedFrame, ObjectSegmentationRequest, ObjectSegmentationResult } from "@premiere-uxp/contracts";
import { HttpSegmentationEngine } from "../../apps/mcp-server/src/segmentation-engine.js";

const checkpointSha256 = "a".repeat(64);
const seedSha256 = "b".repeat(64);
const maskSha256 = "c".repeat(64);

function seed(): MaskSeedFrame {
  return {
    status: "pass",
    capturedAt: "2026-09-03T00:00:00.000Z",
    project: { id: "project-1", name: "WORKING.prproj", path: "C:\\repo\\artifacts\\scratch\\WORKING.prproj", stateSha256: "d".repeat(64) },
    sequence: { id: "sequence-1", name: "WORKING__sequence", width: 1920, height: 1080, frameRate: 30 },
    target: { trackItemId: "video:0:0:item", projectItemId: "item", trackIndex: 0, clipStartSeconds: 0, clipEndSeconds: 10, sourceTimeSeconds: 1, speed: 1, reversed: false },
    frame: { requestedTimelineTimeSeconds: 1, timelineFrameIndex: 30, timelineTimeSeconds: 1, outputPath: "C:\\repo\\artifacts\\output\\seed.png", sha256: seedSha256, sizeBytes: 100, width: 1920, height: 1080 },
    hostReceipt: { commandId: "command-1", status: "pass" },
    errors: [],
  };
}

function request(): ObjectSegmentationRequest {
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    objectId: "main-subject",
    expectedModel: "sam2.1_hiera_small",
    seed: seed(),
    prompt: { coordinateSpace: "image_pixels", points: [{ x: 800, y: 400, label: "positive" }] },
    outputMaskPath: "C:\\repo\\artifacts\\output\\mask.png",
  };
}

function online() {
  return {
    status: "online" as const,
    service: "premiere-object-segmentation" as const,
    protocolVersion: "1" as const,
    processId: 1234,
    engineVersion: "0.1.0",
    model: { name: "sam2.1_hiera_small", version: "2.1", checkpointSha256 },
    device: { kind: "cuda" as const, name: "RTX 5070 Ti" },
    capabilities: { imageSegmentation: true as const, videoTracking: true, pointPrompts: true as const, boxPrompts: true as const },
  };
}

describe("authenticated loopback segmentation client", () => {
  it("rejects non-loopback, credential-bearing, privileged, and Fetch-forbidden URLs", () => {
    for (const baseUrl of ["https://example.com:8127", "http://user:pass@127.0.0.1:8127", "http://127.0.0.1:80", "http://127.0.0.1:6000"]) {
      expect(() => new HttpSegmentationEngine({ baseUrl, tokenPath: "unused", timeoutMs: 1_000 })).toThrow(/SEGMENTATION_URL/);
    }
  });

  it("reports an unavailable token as offline without starting a process", async () => {
    const engine = new HttpSegmentationEngine(
      { baseUrl: "http://127.0.0.1:8127", tokenPath: "unused", timeoutMs: 1_000 },
      { readToken: async () => { throw new Error("token file missing"); } },
    );
    await expect(engine.inspect()).resolves.toMatchObject({ status: "offline", reason: "token file missing" });
  });

  it("authenticates health and segmentation requests and validates the response contract", async () => {
    const segmented: ObjectSegmentationResult = {
      status: "pass",
      requestId: request().requestId,
      objectId: "main-subject",
      seedSha256,
      engine: online(),
      mask: { path: request().outputMaskPath, sha256: maskSha256, width: 1920, height: 1080, foregroundPixelCount: 500_000, bounds: { left: 200, top: 100, right: 1200, bottom: 1000 }, confidence: 0.97 },
      timing: { queuedMs: 2, inferenceMs: 80, totalMs: 82 },
      createdAt: "2026-09-03T00:00:01.000Z",
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${"s".repeat(32)}`);
      const pathname = new URL(String(input)).pathname;
      return new Response(JSON.stringify(pathname === "/v1/health" ? online() : segmented), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const engine = new HttpSegmentationEngine(
      { baseUrl: "http://127.0.0.1:8127", tokenPath: "unused", timeoutMs: 1_000 },
      { fetchImpl, readToken: async () => "s".repeat(32) },
    );
    await expect(engine.inspect()).resolves.toEqual(online());
    await expect(engine.segment(request())).resolves.toEqual(segmented);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("POST");
  });
});
