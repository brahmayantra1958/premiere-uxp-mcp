import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "@premiere-uxp/contracts";
import { planMaskSeedFrame, probePngEvidence, verifyMaskSeedState } from "../../apps/mcp-server/src/mask-seed-frame.js";

function snapshot(overrides: Record<string, unknown> = {}): ProjectSnapshot {
  return {
    projectId: "project-1",
    projectName: "WORKING.prproj",
    projectPath: "C:\\repo\\artifacts\\scratch\\WORKING.prproj",
    capturedAt: "2026-09-03T00:00:00.000Z",
    activeSequence: {
      id: "sequence-1",
      name: "WORKING__sequence",
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: { ticks: "7620480000000", seconds: 30 },
      videoTracks: 1,
      audioTracks: 1,
      captionTracks: 0,
      itemLimit: 5000,
      itemsTruncated: false,
      items: [{
        id: "video:0:10:source-1",
        name: "clip.mp4",
        mediaType: "video",
        trackIndex: 0,
        start: { ticks: "2540160000000", seconds: 10 },
        end: { ticks: "5080320000000", seconds: 20 },
        inPoint: { ticks: "508032000000", seconds: 2 },
        outPoint: { ticks: "3048192000000", seconds: 12 },
        projectItemId: "source-1",
        speed: 1,
        reversed: false,
      }],
      tracks: [{ mediaType: "video", index: 0, id: 1, name: "V1", muted: false, itemCount: 1, transitionCount: 0 }],
      captionTrackStates: [],
      transitions: [],
      ...overrides,
    },
    sequences: [{ id: "sequence-1", name: "WORKING__sequence" }],
    projectItems: [],
    projectItemLimit: 2000,
    projectItemsTruncated: false,
    offlineMediaIds: [],
    proxyAttachments: [],
    markers: [],
    mogrtItems: [],
    effects: [],
    audioState: [],
    unsupportedFields: [],
  };
}

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("mask seed frame contract", () => {
  it("snaps the requested timeline time to a frame and maps it to source time", () => {
    const plan = planMaskSeedFrame(snapshot(), "video:0:10:source-1", 12.01);
    expect(plan.timelineFrameIndex).toBe(360);
    expect(plan.timelineTimeSeconds).toBe(12);
    expect(plan.sourceTimeSeconds).toBe(4);
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
  });

  it("maps reversed clips from the out point and rejects times outside the clip", () => {
    const value = snapshot();
    const item = value.activeSequence!.items[0]!;
    item.speed = 2;
    item.reversed = true;
    expect(planMaskSeedFrame(value, item.id, 12).sourceTimeSeconds).toBe(8);
    expect(() => planMaskSeedFrame(value, item.id, 20)).toThrow(/TIME_OUTSIDE_CLIP/);
  });

  it("detects any visible sequence, marker, effect, or target drift", () => {
    const before = snapshot();
    const plan = planMaskSeedFrame(before, "video:0:10:source-1", 12);
    expect(verifyMaskSeedState(plan, structuredClone(before))).toEqual([]);
    const changed = structuredClone(before);
    changed.activeSequence!.items[0]!.end.seconds = 19;
    expect(verifyMaskSeedState(plan, changed)).toContain("MASK_SEED_VISIBLE_STATE_DRIFT");
  });

  it("reads PNG dimensions and returns a content hash without FFmpeg", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "mask-seed-png-"));
    const filePath = path.join(temporaryDirectory, "seed.png");
    const bytes = Buffer.alloc(25);
    Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
    bytes.write("IHDR", 12, "ascii");
    bytes.writeUInt32BE(1920, 16);
    bytes.writeUInt32BE(1080, 20);
    await writeFile(filePath, bytes);
    const evidence = await probePngEvidence(filePath);
    expect(evidence).toMatchObject({ status: "pass", exists: true, width: 1920, height: 1080, sizeBytes: 25 });
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
