/** Premiere 26.5 crashed in AsyncScriptTaskQueue::ProcessPromise while resolving
 * a ScriptObject during concurrent reads. Keep proxy-returning native promises
 * single-flight; item/component consumers also serialize primitive leaves because
 * their native resolver ownership cannot be inferred from a plain JS value. Convert transient
 * values to plain data inside `read`, before allowing the next object response.
 * A rejection releases the lane; callers still drain their whole read window.
 * This is a mitigation for the observed crash, not proof of Adobe's root cause. */
let tail: Promise<void> = Promise.resolve();
export function readNativeObject<T>(read: () => Promise<T>): Promise<T> {
  const result = tail.then(read);
  tail = result.then(() => {}, () => {});
  return result;
}
