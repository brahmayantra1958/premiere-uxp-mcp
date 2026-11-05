import { describe, expect, it } from "vitest";
import {
  assessSceneCutReadback,
  type SceneDetectionItem,
} from "../../apps/uxp-plugin/src/scene-edit-detection.js";

function item(
  id: string,
  projectItemId: string,
  start: number,
  end: number,
  mediaType: "video" | "audio" = "video",
  trackIndex = 0,
): SceneDetectionItem {
  return { id, projectItemId, mediaType, trackIndex, start: { seconds: start }, end: { seconds: end } };
}

describe("native scene edit detection readback", () => {
  it("accepts contiguous native cuts and proves unselected items stayed intact", () => {
    const before = [item("target", "source-a", 0, 10), item("untouched", "source-b", 12, 20)];
    const after = [
      item("target", "source-a", 0, 3),
      item("cut-2", "source-a", 3, 7),
      item("cut-3", "source-a", 7, 10),
      item("untouched", "source-b", 12, 20),
    ];

    expect(assessSceneCutReadback(before, after, ["target"], 24)).toEqual({
      selectedCount: 1,
      detectedCutCount: 2,
      unaffectedItemCount: 1,
      targets: [{
        trackItemId: "target",
        projectItemId: "source-a",
        trackIndex: 0,
        startSeconds: 0,
        endSeconds: 10,
        segmentCount: 3,
        detectedCutCount: 2,
        segments: [
          { id: "target", startSeconds: 0, endSeconds: 3 },
          { id: "cut-2", startSeconds: 3, endSeconds: 7 },
          { id: "cut-3", startSeconds: 7, endSeconds: 10 },
        ],
      }],
      errors: [],
    });
  });

  it("accepts a completed analysis that legitimately finds no cuts", () => {
    const timeline = [item("target", "source-a", 0, 10)];
    const result = assessSceneCutReadback(timeline, timeline, ["target"], 24);
    expect(result.detectedCutCount).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("rejects coverage gaps and collateral changes", () => {
    const before = [item("target", "source-a", 0, 10), item("untouched", "source-b", 12, 20)];
    const after = [item("target", "source-a", 0, 3), item("cut-2", "source-a", 4, 10)];
    const result = assessSceneCutReadback(before, after, ["target"], 24);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("gap or overlap"),
      expect.stringContaining("unselected timeline item"),
    ]));
  });

  it("rejects audio targets and ambiguous overlapping source instances", () => {
    const audio = assessSceneCutReadback([item("audio", "source-a", 0, 10, "audio")], [], ["audio"], 24);
    expect(audio.errors).toContain("Scene detection accepts video clips only: audio");

    const overlapping = [item("target", "source-a", 0, 10), item("other", "source-a", 5, 12)];
    const ambiguous = assessSceneCutReadback(overlapping, overlapping, ["target"], 24);
    expect(ambiguous.errors).toContain("Scene detection target cannot be distinguished from an overlapping source instance: target");
  });
});
