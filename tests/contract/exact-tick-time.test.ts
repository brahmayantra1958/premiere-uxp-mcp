import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = path.resolve("apps/uxp-plugin/src");

describe("UXP native time contract", () => {
  it("builds every native time from exact ticks, never the flooring seconds factory", () => {
    // TickTime.createWithSeconds floors the binary product (1.001 s -> one tick
    // short of frame 30). host-context owns the exact conversions.
    const files = readdirSync(SOURCE).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const code = readFileSync(path.join(SOURCE, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, name).not.toMatch(/createWithSeconds\s*\(/);
    }
  });
});
