import { describe, expect, it } from "vitest";
import { trimEditPhases } from "../../apps/uxp-plugin/src/trim-phases";

describe("trimEditPhases", () => {
  it("isolates source range before timeline boundaries for one item", () => {
    const edit = { trackItemId: "video:0:0:item", inPointSeconds: 55, outPointSeconds: 63, endSeconds: 8 };
    expect(trimEditPhases(edit).map((phase) => phase.kind)).toEqual(["source", "timeline"]);
    expect(trimEditPhases(edit).every((phase) => phase.edit === edit)).toBe(true);
  });

  it("omits empty phases", () => {
    expect(trimEditPhases({ trackItemId: "a", endSeconds: 8 }).map((phase) => phase.kind)).toEqual(["timeline"]);
    expect(trimEditPhases({ trackItemId: "a", inPointSeconds: 2 }).map((phase) => phase.kind)).toEqual(["source"]);
    expect(trimEditPhases({ trackItemId: "a" })).toEqual([]);
  });
});
