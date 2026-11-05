import { operationReceiptSchema, type OperationReceipt } from "@premiere-uxp/contracts";

const ISSUE_LIMIT = 20;

/** Final receipt validation that never discards dispatched evidence.
 *
 * 2026-11-04: a verified clone carried an automatic-follow failure in
 * workTarget, the strict parse threw, and the operation kept its lease with no
 * receipt, so archive_inactive_operation refused it. A receipt that does not
 * match the contract is still persisted, but it never claims success: the
 * original projection is kept as unvalidated evidence, a dispatched operation
 * becomes UNVERIFIED (quarantined for archive/reconcile), and an undispatched
 * one becomes a preflight FAIL. */
export function contractReceipt(receipt: OperationReceipt, dispatched: boolean): OperationReceipt {
  const parsed = operationReceiptSchema.safeParse(receipt);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.slice(0, ISSUE_LIMIT).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  const raw = receipt as Partial<OperationReceipt>;
  return operationReceiptSchema.parse({
    commandId: raw.commandId,
    command: raw.command,
    ...(typeof raw.requestFingerprint === "string" && /^[a-f0-9]{64}$/.test(raw.requestFingerprint) ? { requestFingerprint: raw.requestFingerprint } : {}),
    status: dispatched ? "unverified" : "fail",
    retryable: false,
    errorClassification: dispatched ? "postcondition" : "preflight",
    hostResult: { receiptContractViolation: { issues, truncated: parsed.error.issues.length > ISSUE_LIMIT }, unvalidatedReceipt: receipt },
    changedFiles: [],
    errors: [`RECEIPT_CONTRACT_INVALID: ${issues.join("; ")}`],
    recovery: dispatched
      ? "The host result did not match the receipt contract, so success is not claimed. Do not repeat the mutation. Inspect the exact state; archive_inactive_operation archives this receipt and reconcile_mutation can adjudicate it."
      : "No content dispatch was recorded. Correct the receipt contract before another request.",
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
}
