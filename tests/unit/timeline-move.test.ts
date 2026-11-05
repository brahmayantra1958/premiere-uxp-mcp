import { describe, expect, it } from "vitest";
import { assessExactClipMove, planExactClipMove, type MoveTimelineItem } from "../../apps/uxp-plugin/src/timeline-move.js";

const target: MoveTimelineItem = {
  id: "video:7:0:source-a",
  projectItemId: "source-a",
  mediaType: "video",
  trackIndex: 7,
  start: { seconds: 0 },
  end: { seconds: 2 },
};

describe("exact one-item timeline move", () => {
  it("plans an exact frame-aligned move into an empty range", () => {
    expect(planExactClipMove({
      trackItemId: target.id,
      expectedProjectItemId: target.projectItemId,
      expectedMediaType: "video",
      expectedTrackIndex: 7,
      expectedStartSeconds: 0,
      expectedEndSeconds: 2,
      offsetSeconds: 3,
    }, target, [target], 30)).toMatchObject({ expectedStartSeconds: 3, expectedEndSeconds: 5 });
  });

  it("rejects stale identity, sub-frame offsets, and occupied destinations", () => {
    const base = {
      trackItemId: target.id,
      expectedProjectItemId: target.projectItemId,
      expectedMediaType: "video" as const,
      expectedTrackIndex: 7,
      expectedStartSeconds: 0,
      expectedEndSeconds: 2,
      offsetSeconds: 3,
    };
    expect(() => planExactClipMove({ ...base, expectedProjectItemId: "stale" }, target, [target], 30)).toThrow(/exact move target/);
    expect(() => planExactClipMove({ ...base, offsetSeconds: 3.01 }, target, [target], 30)).toThrow(/frame grid/);
    expect(() => planExactClipMove(base, target, [target, { ...target, id: "video:7:4:source-b", projectItemId: "source-b", start: { seconds: 4 }, end: { seconds: 6 } }], 30)).toThrow(/overlaps/);
  });

  it("passes only for one replacement ID with all unrelated IDs preserved", () => {
    const other = { ...target, id: "video:7:10:source-b", projectItemId: "source-b", start: { seconds: 10 }, end: { seconds: 12 } };
    const plan = planExactClipMove({
      trackItemId: target.id,
      expectedProjectItemId: target.projectItemId,
      expectedMediaType: "video",
      expectedTrackIndex: 7,
      expectedStartSeconds: 0,
      expectedEndSeconds: 2,
      offsetSeconds: 3,
    }, target, [target, other], 30);
    const moved = { ...target, id: "video:7:3:source-a", start: { seconds: 3 }, end: { seconds: 5 } };
    expect(assessExactClipMove([target, other], [moved, other], plan)).toMatchObject({
      status: "pass",
      movedItemId: moved.id,
      missingUnrelatedIds: [],
      unexpectedIds: [],
    });
    expect(assessExactClipMove([target, other], [moved], plan)).toMatchObject({
      status: "fail",
      missingUnrelatedIds: [other.id],
    });
  });
});
