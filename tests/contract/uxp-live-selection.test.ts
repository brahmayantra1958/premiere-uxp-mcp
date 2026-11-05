import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Premiere native editor selection contract", () => {
  it("uses the active sequence live selection and never a detached callback selection", async () => {
    const [host, apiContract] = await Promise.all([
      readFile(path.resolve("apps/uxp-plugin/src/premiere-host.ts"), "utf8"),
      readFile(path.resolve("apps/uxp-plugin/src/api-contract.ts"), "utf8"),
    ]);
    const start = host.indexOf("async function liveTrackItemSelection");
    const end = host.indexOf("function toHostValue", start);
    const helper = host.slice(start, end);

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(host).not.toContain("TrackItemSelection.createEmptySelection");
    expect(helper.indexOf("sequence.clearSelection()")).toBeLessThan(helper.indexOf("sequence.getSelection()"));
    expect(helper).toContain("selection.addItem(entry.raw, true)");
    expect(helper).toContain("selection.getTrackItems()");
    // The helper may gain callers (effect disclosure/initialization). A fixed
    // call-site count does not prove the native live-selection contract.
    expect(apiContract).toContain('| "clearSelection"');
    expect(apiContract).toContain('| "getSelection"');
  });
});
