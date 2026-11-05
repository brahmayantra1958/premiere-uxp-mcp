import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { operationReceiptSchema, workTargetSchema, type BridgeRequest, type OperationReceipt } from "@premiere-uxp/contracts";
import { contractReceipt } from "../../apps/mcp-server/src/receipt-contract.js";
import { HostExecutor } from "../../apps/mcp-server/src/host-executor.js";
import { AuditLog, ReceiptStore } from "../../apps/mcp-server/src/audit.js";
import { freshTestDirectory } from "../helpers/workspace.js";

// The exact automatic-follow failure a verified clone returned on 2026-11-04.
const followFailure = { status: "unverified", phase: "before_command",
  reason: "Track targeting helper request failed: TypeError: Network request failed" } as const;
const base = { commandId: "op", command: "clone_clips", startedAt: "2026-11-04T12:54:00.000Z", completedAt: "2026-11-04T12:54:01.000Z", changedFiles: [], errors: [] };

describe("receipt contract", () => {
  it("accepts an automatic-follow failure beside a passing content result", () => {
    expect(workTargetSchema.safeParse(followFailure).success).toBe(true);
    const receipt = operationReceiptSchema.parse({ ...base, status: "pass", workTarget: followFailure });
    expect(contractReceipt(receipt, true)).toMatchObject({ status: "pass", workTarget: followFailure });
    expect(workTargetSchema.safeParse({ status: "unverified", phase: "later", reason: "x" }).success).toBe(false);
  });

  it("persists a contract-invalid dispatched receipt as UNVERIFIED evidence, never as PASS", () => {
    const invalid = { ...base, status: "pass", workTarget: { status: "bogus" } } as unknown as OperationReceipt;
    const kept = contractReceipt(invalid, true);
    expect(kept).toMatchObject({ commandId: "op", command: "clone_clips", status: "unverified", retryable: false, errorClassification: "postcondition",
      hostResult: { unvalidatedReceipt: invalid, receiptContractViolation: { truncated: false } } });
    expect(kept.errors[0]).toMatch(/^RECEIPT_CONTRACT_INVALID: workTarget/);
    expect(kept.recovery).toMatch(/Do not repeat the mutation/);
    expect(contractReceipt(invalid, false)).toMatchObject({ status: "fail", errorClassification: "preflight" });
  });
});

describe("host executor receipt persistence", () => {
  async function run(name: string, workTarget: unknown) {
    const directory = await freshTestDirectory(name), store = new ReceiptStore(path.join(directory, "receipts.json"));
    const result = { status: "pass", before: { items: [{ id: "clip" }] }, after: { items: [{ id: "clip", end: 2 }] }, hostResult: { componentsPreserved: true }, errors: [], workTarget };
    const call = vi.fn(async (request: BridgeRequest) => ({ version: 1, id: request.id, ok: true, result, durationMs: 1 }));
    const host = new HostExecutor({ call } as any, new AuditLog(path.join(directory, "audit.jsonl")), store, 1000);
    const receipt = await host.mutate("trim_clip_exact", { expectedProjectId: "p", expectedSequenceId: "s", expectedSequenceName: "Sequence", trim: { trackItemId: "clip" } }, "trim");
    return { receipt, stored: await store.get("trim"), lease: await store.inspectRecovery(), call };
  }

  it("keeps a verified edit PASS with its follow failure and releases the lease", async () => {
    const { receipt, stored, lease, call } = await run("receipt-follow-failure", followFailure);
    expect(receipt).toMatchObject({ status: "pass", workTarget: followFailure });
    expect(stored).toMatchObject({ status: "pass", workTarget: followFailure });
    expect(lease).toBeUndefined();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("stores a contract-invalid result instead of throwing, so the quarantined operation can be archived", async () => {
    const { receipt, stored, lease, call } = await run("receipt-contract-invalid", { status: "bogus" });
    expect(receipt).toMatchObject({ status: "unverified", errors: [expect.stringMatching(/^RECEIPT_CONTRACT_INVALID/)] });
    expect(stored).toEqual(receipt);
    expect(lease?.commandId).toBe("trim");
    expect(call).toHaveBeenCalledTimes(1);
  });
});
