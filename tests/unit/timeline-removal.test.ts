import { describe, expect, it } from "vitest";
import { assessLiftRemoval } from "../../apps/uxp-plugin/src/timeline-removal.js";

describe("non-ripple timeline lift readback", () => {
  it("passes only when exact targets disappear and every unrelated ID stays", () => {
    expect(assessLiftRemoval(["video:1", "video:2", "audio:1"], ["video:1", "audio:1"], ["video:2"]))
      .toMatchObject({
        status: "pass",
        removedTargetIds: ["video:2"],
        remainingTargetIds: [],
        missingUnrelatedIds: [],
        unexpectedIds: [],
      });
  });

  it("fails when an unrelated item disappears or an unexpected item appears", () => {
    expect(assessLiftRemoval(["video:1", "video:2", "audio:1"], ["video:new", "audio:1"], ["video:2"]))
      .toMatchObject({
        status: "fail",
        removedTargetIds: ["video:2"],
        missingUnrelatedIds: ["video:1"],
        unexpectedIds: ["video:new"],
      });
  });

  it("fails on duplicate or nonexistent target IDs", () => {
    expect(assessLiftRemoval(["video:1"], [], ["video:1", "video:1"]))
      .toMatchObject({ status: "fail", duplicateTargetIds: ["video:1"] });
    expect(assessLiftRemoval(["video:1"], ["video:1"], ["video:missing"]))
      .toMatchObject({ status: "fail", removedTargetIds: [] });
  });
});
