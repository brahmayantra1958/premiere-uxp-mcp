export type ComponentWriteFindings = Readonly<{
  missing: readonly string[];
  animated: readonly string[];
}>;

export type ComponentWriteReadback = Readonly<{
  missing: readonly string[];
  mismatched: readonly string[];
}>;

export function hostNumericValuesEqual(actual: number, expected: number): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return Object.is(actual, expected);
  const float32ReadbackTolerance = 0.000_001
    + (0.000_000_1 * Math.max(1, Math.abs(actual), Math.abs(expected)));
  return Math.abs(actual - expected) <= float32ReadbackTolerance;
}

export function isTransientHostObjectInvalidation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /script object is no longer valid/i.test(message);
}
export function componentWriteStatus(
  changed: boolean,
  findings: ComponentWriteFindings,
  readback: ComponentWriteReadback,
): "pass" | "partial" | "fail" {
  const targetMatches = findings.missing.length === 0
    && findings.animated.length === 0
    && readback.missing.length === 0
    && readback.mismatched.length === 0;
  if (targetMatches) return "pass";
  return changed ? "partial" : "fail";
}
