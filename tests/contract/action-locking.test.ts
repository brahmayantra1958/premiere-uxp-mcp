import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Premiere 26.3 action lifetime contract", () => {
  it("accepts only action factories at the shared locked transaction boundary", async () => {
    const source = await readFile(path.resolve("apps/uxp-plugin/src/premiere-host.ts"), "utf8");
    expect(source).toContain("type ActionFactory = () => any[];");
    expect(source).toMatch(/function executeTransaction\(project: any, label: string, createActions: ActionFactory(?:,|\))/);
    expect(source).toContain("project.lockedAccess(() => {");
    expect(source).toContain("const actions = createActions();");
    expect(source).not.toMatch(/executeTransaction\([^;\n]*,\s*\[/);
    // Bin reacquisition is exercised with invalidated wrappers and >500 items
    // in production-project-items.test.ts, rather than requiring a capped scan.
    // Pinned readback during user navigation is exercised through the actual
    // host queue in production-gap-fixes.test.ts.
    expect(source).toContain("const availableItems = await trackItems(sequence);");
    expect(source).not.toContain("selection.addItem(await findTrackItem(sequence, id), false)");
  });
});
