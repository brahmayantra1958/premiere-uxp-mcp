import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Premiere clip-speed command probe", () => {
  it("remains a version-locked read-only menu inventory", async () => {
    const source = await readFile(
      path.resolve("scripts/runtime/probe-premiere-clip-speed-command.ps1"),
      "utf8",
    );

    expect(source).toContain("$version.FileMajorPart -ne 26");
    expect(source).toContain("$version.FileMinorPart -ne 3");
    expect(source).toContain("GetMenuItemID");
    expect(source).toContain("premiere_win32_read_only_menu_probe");
    expect(source).not.toMatch(/SendMessage|PostMessage|mouse_event|keybd_event|SendInput/);
  });
});
