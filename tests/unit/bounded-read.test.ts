import { describe, expect, it } from "vitest";
import { boundedRead } from "../../apps/uxp-plugin/src/bounded-read.js";

describe("bounded native read windows", () => {
  it("bounds concurrency and returns source order despite reverse completion", async () => {
    let running = 0; let maximum = 0;
    const releases: (() => void)[] = [];
    const results = boundedRead([0, 1, 2, 3], async value => {
      running++; maximum = Math.max(maximum, running);
      await new Promise<void>(resolve => { releases[value] = resolve; }); running--; return value;
    }, 2);
    await Promise.resolve(); expect(releases).toHaveLength(2);
    releases[1]!(); releases[0]!();
    for (let i = 0; i < 10 && releases.length < 4; i++) await Promise.resolve();
    releases[3]!(); releases[2]!();
    expect(await results).toEqual([0, 1, 2, 3]); expect(maximum).toBe(2); expect(running).toBe(0);
  });
  it("drains in-flight reads on failure and never starts the next window", async () => {
    let release!: () => void; const started: number[] = []; let rejected = false;
    const result = boundedRead([0, 1, 2], async value => {
      started.push(value); if (value === 0) throw Error("broken wrapper");
      await new Promise<void>(resolve => { release = resolve; }); return value;
    }, 2);
    const finished = result.catch(error => { rejected = true; return String(error); });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(rejected).toBe(false); expect(started).toEqual([0, 1]);
    release(); expect(await finished).toContain("broken wrapper"); expect(started).toEqual([0, 1]);
  });
  it.each([0, -1, 9, 1.5])("rejects an invalid concurrency bound %s", async width => {
    await expect(boundedRead([1], async value => value, width)).rejects.toThrow("between 1 and 8");
  });
});
