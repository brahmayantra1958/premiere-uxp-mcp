import { equalSnapshotValue } from './snapshot-equality.js';

type Difference = { path: string; pathLength?: number; before: unknown; after: unknown };

function summary(value: unknown): unknown {
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'string' && value.length > 256) return { type: 'string', prefix: value.slice(0, 256), length: value.length, truncated: true };
  if (typeof value === 'number' && !Number.isFinite(value)) return { type: 'number', value: String(value) };
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (value !== null && typeof value === 'object') return { type: 'object', fields: Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).length };
  return value;
}

/** Bounded evidence from detached readbacks only. This diagnoses the existing
 * exact comparison; it neither establishes preservation nor changes its result.
 * Added/removed subtrees count as one differing path, with a bounded type summary. */
export function graphicDurationDiagnostics(before: readonly unknown[], after: readonly unknown[]) {
  const differences: Difference[] = [];
  let totalDifferences = 0;
  const record = (path: string, left: unknown, right: unknown) => {
    totalDifferences++;
    if (differences.length < 32) differences.push({
      path: path.slice(0, 512), ...(path.length > 512 ? { pathLength: path.length } : {}),
      before: summary(left), after: summary(right),
    });
  };
  const visit = (left: any, right: any, path: string): void => {
    if (equalSnapshotValue(left, right)) return;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
      || Array.isArray(left) !== Array.isArray(right)) { record(path, left, right); return; }
    if (Array.isArray(left)) {
      if (left.length !== right.length) record(path + '/length', left.length, right.length);
      for (let i = 0; i < Math.max(left.length, right.length); i++) visit(left[i], right[i], path + '/' + i);
      return;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const leftValue = Object.prototype.hasOwnProperty.call(left, key) ? left[key] : undefined;
      const rightValue = Object.prototype.hasOwnProperty.call(right, key) ? right[key] : undefined;
      // The comparison intentionally treats absent and undefined object fields alike.
      if (leftValue === undefined && rightValue === undefined) continue;
      visit(leftValue, rightValue, path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'));
    }
  };
  visit(before, after, '');
  return {
    status: totalDifferences ? 'fail' as const : 'pass' as const,
    beforeComponentCount: before.length, afterComponentCount: after.length,
    totalDifferences, truncated: totalDifferences > differences.length, differences,
  };
}
