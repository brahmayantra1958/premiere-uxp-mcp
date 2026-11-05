/** Bound outstanding READS and drain the whole window before returning/throwing.
 * Never use for mutations or advance a native item traversal while reads remain. */
export async function boundedRead<T, R>(items: readonly T[], read: (item: T) => Promise<R>, width = 8): Promise<R[]> {
  if (!Number.isInteger(width) || width < 1 || width > 8) throw Error("Read window must be between 1 and 8");
  const results: R[] = [];
  for (let start = 0; start < items.length; start += width) {
    const settled = await Promise.allSettled(items.slice(start, start + width).map(item => Promise.resolve().then(() => read(item))));
    const failed = settled.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const result of settled) if (result.status === "fulfilled") results.push(result.value);
  }
  return results;
}
