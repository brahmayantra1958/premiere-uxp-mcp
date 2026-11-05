import { describe, expect, it } from "vitest";
import { assessTimelineSelection } from "../../apps/uxp-plugin/src/timeline-selection.js";

describe("timeline selection readback", () => {
  it("accepts the same exact IDs regardless of host return order", () => {
    expect(assessTimelineSelection(["video:1", "audio:1"], ["audio:1", "video:1"]))
      .toEqual({
        status: "pass",
        expectedIds: ["audio:1", "video:1"],
        actualIds: ["audio:1", "video:1"],
        missingIds: [],
        unexpectedIds: [],
        duplicateExpectedIds: [],
        duplicateActualIds: [],
      });
  });

  it("reports missing, unrelated, and duplicate host selections", () => {
    expect(assessTimelineSelection(["video:1", "video:2"], ["video:2", "video:3", "video:3"]))
      .toMatchObject({
        status: "fail",
        missingIds: ["video:1"],
        unexpectedIds: ["video:3"],
        duplicateExpectedIds: [],
        duplicateActualIds: ["video:3"],
      });
  });
});
