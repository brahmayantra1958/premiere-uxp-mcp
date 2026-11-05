import { describe, expect, it } from "vitest";
import { readNativeObject } from "../../apps/uxp-plugin/src/native-object-read.js";
import { boundedRead } from "../../apps/uxp-plugin/src/bounded-read.js";

describe("native object response lane", () => {
  it("serializes object responses across independent windows through plain-value conversion", async () => {
    let active = 0, peak = 0;
    const read = (n: number) => readNativeObject(async () => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve();
      const native = { value: n };
      await Promise.resolve();
      const plain = { value: native.value }; active--;
      return plain;
    });
    const values = await Promise.all([boundedRead([1, 2, 3], read), boundedRead([4, 5, 6], read)]);
    expect(values.flat()).toEqual([1, 2, 3, 4, 5, 6].map(value => ({ value })));
    expect(peak).toBe(1); expect(active).toBe(0);
  });
  it("releases after failure without losing queued completion or allowing early mutation", async () => {
    const events: string[] = [];
    await expect(boundedRead([1, 2], n => readNativeObject(async () => {
      await Promise.resolve(); events.push(`read ${n}`);
      if (n === 1) throw Error("read failed");
      return n;
    }))).rejects.toThrow("read failed");
    events.push("drained");
    expect(await readNativeObject(async () => 3)).toBe(3);
    expect(events).toEqual(["read 1", "read 2", "drained"]);
  });
});
