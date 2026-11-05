import { describe, expect, it } from "vitest";
import { assessExactClipTrim, planExactClipTrim, type TrimTimelineItem } from "../../apps/uxp-plugin/src/timeline-trim.js";

const target: TrimTimelineItem = {
  id: "video:7:0:source-a",
  projectItemId: "source-a",
  mediaType: "video",
  trackIndex: 7,
  start: { seconds: 0 },
  end: { seconds: 5 },
  inPoint: { seconds: 0 },
  outPoint: { seconds: 5 },
  speed: 1,
  reversed: false,
};

const base = {
  trackItemId: target.id,
  expectedProjectItemId: target.projectItemId,
  expectedMediaType: "video" as const,
  expectedTrackIndex: 7,
  expectedStartSeconds: 0,
  expectedEndSeconds: 5,
  expectedInPointSeconds: 0,
  expectedOutPointSeconds: 5,
};

describe("exact one-item timeline trim", () => {
  it("plans a bounded end trim while retaining the complete original range", () => {
    expect(planExactClipTrim({ ...base, endSeconds: 4 }, target, [target], 30)).toMatchObject({
      original: { startSeconds: 0, endSeconds: 5, inPointSeconds: 0, outPointSeconds: 5 },
      expected: { startSeconds: 0, endSeconds: 4, inPointSeconds: 0, outPointSeconds: 4 },
      writes: { endSeconds: 4 },
    });
  });

  it("rejects stale source identity, no-op requests, and occupied expansions", () => {
    expect(() => planExactClipTrim({ ...base, expectedOutPointSeconds: 7, endSeconds: 4 }, target, [target], 30)).toThrow(/exact trim target/);
    expect(() => planExactClipTrim({ ...base, expectedEndSeconds: 5.01, endSeconds: 4 }, target, [target], 30)).toThrow(/exact trim target/);
    expect(() => planExactClipTrim({ ...base, endSeconds: 5 }, target, [target], 30)).toThrow(/no-op/);
    const other = { ...target, id: "video:7:6:source-b", projectItemId: "source-b", start: { seconds: 6 }, end: { seconds: 8 }, inPoint: { seconds: 0 }, outPoint: { seconds: 2 } };
    expect(() => planExactClipTrim({ ...base, endSeconds: 7 }, target, [target, other], 30)).toThrow(/overlaps/);
  });

  it("passes only when one exact trimmed item and all unrelated IDs read back", () => {
    const other = { ...target, id: "video:6:0:source-b", projectItemId: "source-b", trackIndex: 6 };
    const plan = planExactClipTrim({ ...base, endSeconds: 4 }, target, [target, other], 30);
    const trimmed = { ...target, end: { seconds: 4 }, outPoint: { seconds: 4 } };
    expect(assessExactClipTrim([target, other], [trimmed, other], plan)).toMatchObject({ status: "pass", trimmedItemId: target.id, missingUnrelatedIds: [], unexpectedIds: [] });
    expect(assessExactClipTrim([target, other], [trimmed], plan)).toMatchObject({ status: "fail", missingUnrelatedIds: [other.id] });
  });

  it("derives a coupled source in-point and accepts the new ID after a start trim", () => {
    const plan = planExactClipTrim({ ...base, startSeconds: 1 }, target, [target], 30);
    const trimmed = { ...target, id: "video:7:new-start:source-a", start: { seconds: 1 }, inPoint: { seconds: 1 } };
    expect(plan.expected).toEqual({ startSeconds: 1, endSeconds: 5, inPointSeconds: 1, outPointSeconds: 5 });
    expect(assessExactClipTrim([target], [trimmed], plan)).toMatchObject({
      status: "pass",
      trimmedItemId: trimmed.id,
      sourceRangeMatches: true,
      missingUnrelatedIds: [],
      unexpectedIds: [],
    });
  });

  it("identifies a timeline-trimmed target even when the coupled source readback is wrong", () => {
    const plan = planExactClipTrim({ ...base, endSeconds: 4 }, target, [target], 30);
    const wrongSourceRange = { ...target, end: { seconds: 4 } };
    expect(assessExactClipTrim([target], [wrongSourceRange], plan)).toMatchObject({
      status: "fail",
      observedTargetId: target.id,
      sourceRangeMatches: false,
    });
  });
});
