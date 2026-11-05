import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../../apps/mcp-server/src/audit.js";
import { freshTestDirectory } from "../helpers/workspace.js";

async function readJsonLines(filePath: string): Promise<unknown[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("AuditLog retention", () => {
  it("serializes concurrent appends into valid JSONL", async () => {
    const directory = await freshTestDirectory("audit-concurrency");
    const file = path.join(directory, "operations.jsonl");
    const audit = new AuditLog(file, { maxBytesPerSegment: 1024 * 1024, retainedSegments: 2 });

    await Promise.all(Array.from({ length: 30 }, (_, index) => audit.append({ kind: "test", index })));

    const records = await readJsonLines(file);
    expect(records).toHaveLength(30);
    expect(new Set(records.map((record) => (record as { index: number }).index)).size).toBe(30);
  });

  it("rotates before the configured limit and prunes old derived segments", async () => {
    const directory = await freshTestDirectory("audit-retention");
    const file = path.join(directory, "operations.jsonl");
    const audit = new AuditLog(file, { maxBytesPerSegment: 96, retainedSegments: 2 });

    for (let index = 0; index < 8; index += 1) {
      await audit.append({ kind: "large-test-record", index, payload: "x".repeat(64) });
    }

    const names = (await readdir(directory)).filter((name) => name.startsWith("operations"));
    const archived = names.filter((name) => name !== "operations.jsonl");
    expect(archived).toHaveLength(2);
    expect(names).toHaveLength(3);
    for (const name of names) {
      const records = await readJsonLines(path.join(directory, name));
      expect(records.length).toBeGreaterThan(0);
    }
  });

  it("rejects retention policies that cannot uphold their units", () => {
    expect(() => new AuditLog("audit.jsonl", { maxBytesPerSegment: 0 })).toThrow(/positive safe integer/);
    expect(() => new AuditLog("audit.jsonl", { retainedSegments: -1 })).toThrow(/non-negative safe integer/);
  });
});
