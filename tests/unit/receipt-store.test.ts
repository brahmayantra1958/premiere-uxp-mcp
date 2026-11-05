import path from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { OperationReceipt } from "@premiere-uxp/contracts";
import { ReceiptStore } from "../../apps/mcp-server/src/audit.js";
import { freshTestDirectory } from "../helpers/workspace.js";

describe("ReceiptStore", () => {
  const receiptFor = (id: string): OperationReceipt => ({ commandId: id, command: "test", status: "pass", changedFiles: [], errors: [],
    startedAt: "2026-09-14T00:00:00.000Z", completedAt: "2026-09-14T00:00:01.000Z" });

  it("keeps legacy bytes untouched, detects new receipts across clients, and bounds new records", async () => {
    const directory = await freshTestDirectory("receipt-legacy");
    const file = path.join(directory, "receipts.json");
    const legacy = JSON.stringify([receiptFor("old")], null, 2);
    await writeFile(file, legacy);
    const first = new ReceiptStore(file, 2), second = new ReceiptStore(file, 2);
    expect(await second.get("old")).toEqual(receiptFor("old"));
    await first.set(receiptFor("one"));
    expect(await second.get("one")).toEqual(receiptFor("one"));
    await second.set(receiptFor("two"));
    expect(await first.get("two")).toEqual(receiptFor("two"));
    await first.set(receiptFor("three"));
    expect((await readdir(`${file}.d`)).filter(name => name.endsWith(".json"))).toHaveLength(2);
    expect(await readFile(file, "utf8")).toBe(legacy);
  });

  it("does not lose concurrent independent writes", async () => {
    const directory = await freshTestDirectory("receipt-concurrent");
    const file = path.join(directory, "receipts.json");
    const stores = [new ReceiptStore(file), new ReceiptStore(file)];
    await Promise.all(Array.from({ length: 12 }, (_, i) => stores[i % 2]!.set(receiptFor(String(i)))));
    for (let i = 0; i < 12; i++) expect(await stores[0]!.get(String(i))).toEqual(receiptFor(String(i)));
  });

  it("leases are exclusive across clients, reentrant for composed workflows, and retained on uncertainty", async () => {
    const directory = await freshTestDirectory("receipt-lease");
    const file = path.join(directory, "receipts.json");
    const first = new ReceiptStore(file), second = new ReceiptStore(file);
    await first.runExclusive("parent", async () => {
      await expect(second.runExclusive("other", async () => 1)).rejects.toThrow("MUTATION_IN_PROGRESS_OR_UNVERIFIED");
      expect(await first.runExclusive("save-substep", async () => 2)).toBe(2);
    });
    expect(await second.runExclusive("next", async () => 3)).toBe(3);
    await expect(first.runExclusive("uncertain", async () => { throw Error("receipt write failed"); })).rejects.toThrow("receipt write failed");
    await expect(second.runExclusive("later", async () => 4)).rejects.toThrow("MUTATION_IN_PROGRESS_OR_UNVERIFIED");
  });

  it("persists and reloads a command receipt for idempotent replay", async () => {
    const directory = await freshTestDirectory("receipt-store");
    const file = path.join(directory, "receipts.json");
    const receipt: OperationReceipt = {
      commandId: "fixed-operation-id",
      command: "place_clips",
      status: "pass",
      changedFiles: [],
      errors: [],
      startedAt: "2026-08-24T00:00:00.000Z",
      completedAt: "2026-08-24T00:00:01.000Z",
    };
    const writer = new ReceiptStore(file);
    await writer.set(receipt);
    const reader = new ReceiptStore(file);
    await reader.load();
    expect(await reader.get(receipt.commandId)).toEqual(receipt);
  });
});
