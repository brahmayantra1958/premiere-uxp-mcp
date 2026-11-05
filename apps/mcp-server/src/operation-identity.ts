import { createHash } from "node:crypto";
import { operationReceiptSchema, type OperationReceipt } from "@premiere-uxp/contracts";

/** Pure replay decision; the caller supplies time, storage and dispatch. */
export function resolveOperationReplay(prior: OperationReceipt, command: string, fingerprint: string, now: string): OperationReceipt {
  if (prior.command === command && (!prior.requestFingerprint || prior.requestFingerprint === fingerprint)) return prior;
  return operationReceiptSchema.parse({
    commandId: prior.commandId, command, requestFingerprint: fingerprint, status: "fail",
    changedFiles: [], errors: [`IDEMPOTENCY_CONFLICT: command ID already belongs to ${prior.command} with different inputs`],
    recovery: "Generate a new operation ID for a different command or argument set.", startedAt: now, completedAt: now,
  });
}

/**
 * Produces the canonical JSON value used by the idempotency contract.
 *
 * Object key order is intentionally erased; array order is intentionally kept.
 * Undefined object fields are omitted to match JSON serialization semantics.
 */
export function canonicalizeOperationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeOperationValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeOperationValue(child)]),
    );
  }
  return value;
}

/** Same command plus canonically equal arguments implies the same fingerprint. */
export function createOperationFingerprint(command: string, args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify([command, canonicalizeOperationValue(args)])).digest("hex");
}
