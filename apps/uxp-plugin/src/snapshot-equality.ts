/** Exact snapshot comparison without sorting/copying/stringifying both trees.
 * Object key order and omitted undefined fields are immaterial, as on the JSON
 * wire. Array order, scalar types and every other present field are significant.
 * Inputs are acyclic readback snapshots, never cached native wrappers. */
export function equalSnapshotValue(left: any, right: any): boolean {
  if (left === right) return true;
  if (left == null || right == null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!equalSnapshotValue(left[i], right[i])) return false;
    return true;
  }
  let count = 0;
  for (const key of Object.keys(left)) {
    if (left[key] === undefined) continue;
    count++;
    if (!Object.prototype.hasOwnProperty.call(right, key) || !equalSnapshotValue(left[key], right[key])) return false;
  }
  for (const key of Object.keys(right)) if (right[key] !== undefined) count--;
  return count === 0;
}
