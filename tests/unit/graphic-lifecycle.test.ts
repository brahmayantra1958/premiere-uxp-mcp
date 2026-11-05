import { beforeEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function clock() {
  let time = 0;
  const waits: number[] = [];
  return {
    now: () => time,
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
      time += milliseconds;
    },
    advance: (milliseconds: number) => { time += milliseconds; },
    waits,
  };
}

function signatures(...values: string[]) {
  return vi.fn(async () => {
    const value = values.shift();
    if (value === undefined) throw new Error("Unexpected extra probe");
    return value;
  });
}

beforeEach(() => { vi.resetModules(); });

describe("native graphic lifecycle reads", () => {
  it("waits only the remaining quiet interval before the first metadata read", async () => {
    const { noteGraphicMutation, waitGraphicMutationQuiet } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    noteGraphicMutation(time.now());
    time.advance(150);

    await waitGraphicMutationQuiet(time);
    expect(time.now()).toBe(250);
    expect(time.waits).toEqual([100]);
  });

  it("extends quiet when another mutation is noted during the wait", async () => {
    const { noteGraphicMutation, waitGraphicMutationQuiet } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    let time = 0;
    noteGraphicMutation(time);
    const wait = vi.fn(async (milliseconds: number) => {
      if (wait.mock.calls.length === 1) {
        time += 125;
        noteGraphicMutation(time);
        time += milliseconds - 125;
      } else {
        time += milliseconds;
      }
    });

    await waitGraphicMutationQuiet({ now: () => time, wait });
    expect(time).toBe(375);
    expect(wait.mock.calls).toEqual([[250], [125]]);
  });

  it("does not schedule a quiet wait without a pending mutation interval", async () => {
    const { noteGraphicMutation, waitGraphicMutationQuiet } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    await waitGraphicMutationQuiet(time);
    noteGraphicMutation(time.now());
    time.advance(250);
    await waitGraphicMutationQuiet(time);
    expect(time.waits).toEqual([]);
  });

  it("waits for quiet and matching component counts and identities before reading", async () => {
    const { noteGraphicMutation, settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    noteGraphicMutation(time.now());
    const probe = signatures("a:2", "a:3", "a:3", "b:3", "b:3", "b:3", "b:3");
    const value = { text: "Premiere UXP MCP" };
    const read = vi.fn(async () => {
      expect(probe).toHaveBeenCalledTimes(6);
      expect(time.now()).toBe(1_050);
      return value;
    });

    expect(await settledGraphicRead(probe, read, time)).toBe(value);
    expect(read).toHaveBeenCalledTimes(1);
    expect(time.waits).toEqual([250, 100, 250, 100, 250, 100]);
  });

  it("discards a value when the post-read graph drifts, then waits for new quiet", async () => {
    const { settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    const probe = signatures("a", "a", "b", "b", "b", "b");
    const read = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("current");

    expect(await settledGraphicRead(probe, read, time)).toBe("current");
    expect(read).toHaveBeenCalledTimes(2);
    expect(time.waits).toEqual([100, 250, 100]);
  });

  it.each(["GRAPHIC_OBJECT_NOT_READY", "stale"])("retries only completed recognized %s failures", async kind => {
    const { settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    const error = kind === "stale"
      ? new Error("The script object is no longer valid.")
      : Object.assign(new Error("Native getParam returned null"), { code: kind });
    const probe = vi.fn(async () => "same");
    const read = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("ready");

    expect(await settledGraphicRead(probe, read, time)).toBe("ready");
    expect(read).toHaveBeenCalledTimes(2);
    expect(time.waits).toEqual([100, 250, 100]);
  });

  it("retries a typed incomplete probe without attempting the native value read", async () => {
    const { settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    const error = Object.assign(new Error("Native graph not ready"), { code: "GRAPHIC_OBJECT_NOT_READY" });
    const probe = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("same");
    const read = vi.fn(async () => "ready");

    expect(await settledGraphicRead(probe, read, time)).toBe("ready");
    expect(probe).toHaveBeenCalledTimes(4);
    expect(read).toHaveBeenCalledTimes(1);
    expect(time.waits).toEqual([250, 100]);
  });

  it.each(["probe", "read"])("propagates target identity/precondition errors from %s", async source => {
    const { settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const error = Object.assign(new Error("Target clip identity changed"), { code: "TARGET_CHANGED" });
    const probe = source === "probe" ? vi.fn().mockRejectedValue(error) : vi.fn(async () => "same");
    const read = source === "read" ? vi.fn().mockRejectedValue(error) : vi.fn(async () => "unused");

    await expect(settledGraphicRead(probe, read, clock())).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(source === "read" ? 1 : 0);
  });

  it("does not treat an untyped null access failure as proof of a transient graph", async () => {
    const { settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const error = new TypeError("Cannot read properties of null (reading 'getValueAtTime')");
    const read = vi.fn().mockRejectedValue(error);

    await expect(settledGraphicRead(async () => "same", read, clock())).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending native read in flight regardless of elapsed clock time", async () => {
    const { settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    const entered = deferred<void>();
    const pending = deferred<string>();
    const probe = vi.fn(async () => "same");
    const read = vi.fn(() => { entered.resolve(); return pending.promise; });
    let completed = false;
    const result = settledGraphicRead(probe, read, time).then(value => { completed = true; return value; });
    await entered.promise;
    time.advance(1_000_000_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(time.waits).toEqual([100]);
    pending.resolve("complete");
    expect(await result).toBe("complete");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("invalidates a read on a noted mutation even when all structural signatures match", async () => {
    const { noteGraphicMutation, settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    const time = clock();
    const read = vi.fn()
      .mockImplementationOnce(async () => { noteGraphicMutation(time.now()); return "old"; })
      .mockResolvedValueOnce("new");

    expect(await settledGraphicRead(async () => "same", read, time)).toBe("new");
    expect(time.waits).toEqual([100, 250, 100]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("bounds completed attempts at eight and exports a typed not-settled failure", async () => {
    const { GraphicNotSettledError, settledGraphicRead } = await import("../../apps/uxp-plugin/src/graphic-lifecycle.js");
    let revision = 0;
    const probe = vi.fn(async () => String(revision++));
    const read = vi.fn(async () => "unused");
    const result = settledGraphicRead(probe, read, clock());

    await expect(result).rejects.toBeInstanceOf(GraphicNotSettledError);
    await expect(result).rejects.toMatchObject({ code: "GRAPHIC_NOT_SETTLED", attempts: 8 });
    expect(probe).toHaveBeenCalledTimes(16);
    expect(read).not.toHaveBeenCalled();
  });
});
