import { describe, expect, it, vi } from "vitest";
import { uxpModules } from "../helpers/uxp-modules.js";
import { exactTickOffsetFromSeconds, nearestFrameTicks } from "../../apps/uxp-plugin/src/tick-conversion.js";
import { exactTrimTicks, planExactClipTrim, trimTicksMatch, type TrimTimelineItem } from "../../apps/uxp-plugin/src/timeline-trim.js";
import { exactMoveTicks, moveTicksMatch } from "../../apps/uxp-plugin/src/timeline-move.js";
import { followFailureReason } from "../../apps/uxp-plugin/src/work-follow.js";

const TPS = 254016000000;
const FRAME = 8475667200n; // 30000/1001 fps
const frames = (count: number) => BigInt(count) * FRAME;
const tickTime = (ticks: bigint | string) => ({ ticks: String(ticks), seconds: Number(ticks) / TPS });

/** Fake Premiere whose float factory floors like the 2026-11-04 production run
 * (1.001 s -> 254270015999 ticks). `store` models native quantization faults. */
function fixture(options: { store?: (ticks: bigint) => bigint; negativeTicks?: boolean; startFrame?: number } = {}) {
  const store = options.store ?? ((ticks: bigint) => ticks);
  const createWithSeconds = vi.fn((seconds: number) => tickTime(BigInt(Math.floor(seconds * TPS))));
  const createWithTicks = vi.fn((ticks: string) => options.negativeTicks === false && ticks.startsWith("-") ? tickTime(0n) : tickTime(ticks));
  const subtract = vi.fn((other: { ticks: string }) => tickTime(-BigInt(other.ticks)));
  const startFrame = options.startFrame ?? 60;
  let start = frames(startFrame), end = frames(120), sourceIn = 0n, sourceOut = frames(120 - startFrame);
  const source = { name: "a.mov", getId: () => "source", getMediaFilePath: () => "C:/a.mov", getMedia: () => ({ duration: Promise.resolve(tickTime(frames(600))) }),
    isSequence: () => false, isOffline: () => false, getInPoint: () => tickTime(0n), getOutPoint: () => tickTime(frames(600)) };
  const clip = { getName: () => "clip", getProjectItem: () => source, getStartTime: () => tickTime(start), getEndTime: () => tickTime(end),
    getInPoint: () => tickTime(sourceIn), getOutPoint: () => tickTime(sourceOut), isDisabled: () => false, getSpeed: () => 1, isSpeedReversed: () => false,
    getComponentChain: () => ({ getComponentCount: () => 0 }),
    createSetStartAction: (next: any) => () => { const value = store(BigInt(next.ticks)); sourceIn += value - start; start = value; },
    createSetEndAction: (next: any) => () => { const value = store(BigInt(next.ticks)); sourceOut += value - end; end = value; },
    createMoveAction: (offset: any) => () => { const delta = BigInt(offset.ticks); start += delta; end += delta; } };
  const track = { getTrackItems: (type: number) => type === 1 ? [clip] : [], isMuted: () => false };
  const sequence = { guid: "s", name: "Sequence", getTimebase: () => String(FRAME), getVideoTrackCount: () => 1, getAudioTrackCount: () => 0, getCaptionTrackCount: () => 0,
    getVideoTrack: () => track, getEndTime: () => tickTime(frames(900)),
    getSettings: () => ({ getVideoFrameRect: () => ({ width: 1920, height: 1080 }), getVideoFrameRate: () => ({ value: 30000 / 1001 }) }) };
  const root = { getId: () => "root", getItems: () => [source] };
  const project = { guid: "p", path: "C:/scratch/project.prproj", getActiveSequence: () => sequence, getRootItem: () => root, lockedAccess: (work: any) => work(),
    executeTransaction: (work: any) => { const deferred: any[] = []; work({ addAction: (action: any) => deferred.push(action) }); deferred.forEach(action => action()); return true; } };
  const load = uxpModules({ Project: { getActiveProject: () => project }, ClipProjectItem: { cast: (raw: any) => raw }, FolderItem: { cast: (raw: any) => raw === root ? raw : null },
    Constants: { TrackItemType: { CLIP: 1, TRANSITION: 2 }, MediaType: { VIDEO: "video", AUDIO: "audio" } },
    TickTime: { createWithSeconds, createWithTicks, TIME_ZERO: { ticks: "0", seconds: 0, subtract } } });
  load("apps/uxp-plugin/src/work-follow.ts").workFollow.enabled = false;
  const host = new (load("apps/uxp-plugin/src/premiere-host.ts").PremiereHost)();
  const pins = { expectedProjectId: "p", expectedSequenceId: "s", expectedSequenceName: "Sequence" };
  const target = { trackItemId: `video:0:${frames(startFrame)}:source`, expectedProjectItemId: "source", expectedMediaType: "video", expectedTrackIndex: 0 };
  return { createWithSeconds, createWithTicks, subtract, load, ticks: () => ({ start, end, sourceIn, sourceOut }),
    trim: (trim: Record<string, number>) => host.dispatch({ version: 1, id: "trim", command: "trim_clip_exact", timeoutMs: 5000,
      args: { ...pins, trim: { ...target, expectedStartSeconds: Number(frames(startFrame)) / TPS, expectedEndSeconds: 4.004, expectedInPointSeconds: 0, expectedOutPointSeconds: Number(frames(120 - startFrame)) / TPS, ...trim } } }),
    move: (offsetSeconds: number) => host.dispatch({ version: 1, id: "move", command: "move_clips", timeoutMs: 5000,
      args: { ...pins, move: { ...target, expectedStartSeconds: 2.002, expectedEndSeconds: 4.004, offsetSeconds } } }) };
}

describe("exact tick conversions", () => {
  it("rounds signed offsets symmetrically and snaps absolute ticks to the frame grid", () => {
    expect(exactTickOffsetFromSeconds(1.001)).toBe("254270016000");
    expect(exactTickOffsetFromSeconds(-1.001)).toBe("-254270016000");
    expect(exactTickOffsetFromSeconds(-0)).toBe("0");
    expect(() => exactTickOffsetFromSeconds(Number.NaN)).toThrow("INVALID_TIME");
    // 33.366667 s is frame 1000 within float/decimal noise, 84672 ticks off-grid.
    expect(nearestFrameTicks("8475667284672", FRAME)).toBe(String(frames(1000)));
    expect(() => nearestFrameTicks(-1n, FRAME)).toThrow("INVALID_TIME");
  });

  it("builds absolute, signed and fallback native times only from proven ticks", () => {
    const f = fixture({ negativeTicks: false }), context = f.load("apps/uxp-plugin/src/host-context.ts");
    expect(context.tickFromSeconds(1.001).ticks).toBe("254270016000");
    expect(context.tickOffsetFromSeconds(-1.001).ticks).toBe("-254270016000");
    expect(f.subtract).toHaveBeenCalledOnce();
    expect(f.createWithSeconds).not.toHaveBeenCalled();
    expect(() => context.tickTimeFromTicks("1.5")).toThrow("Invalid tick time");
    f.createWithTicks.mockImplementationOnce(() => tickTime(254270015999n));
    expect(() => context.tickFromSeconds(1.001)).toThrow("exact 254270016000-tick time");
  });
});

describe("tick-exact trim and move plans", () => {
  const current: TrimTimelineItem = { id: "clip", projectItemId: "source", mediaType: "audio", trackIndex: 0,
    start: { seconds: 0, ticks: "0" }, end: { seconds: 2.002, ticks: String(frames(60)) }, inPoint: { seconds: 0 }, outPoint: { seconds: 2.002 } };
  const request = { trackItemId: "clip", expectedProjectItemId: "source", expectedMediaType: "audio" as const, expectedTrackIndex: 0,
    expectedStartSeconds: 0, expectedEndSeconds: 2.002, expectedInPointSeconds: 0, expectedOutPointSeconds: 2.002 };

  it("writes the nearest frame tick and keeps the unwritten boundary exactly", () => {
    const plan = planExactClipTrim({ ...request, endSeconds: 24 * 1001 / 24000 }, current, [current], 30000 / 1001);
    const ticks = exactTrimTicks(plan, current, String(FRAME));
    expect(ticks).toEqual({ startTicks: "0", endTicks: "254270016000", writes: { endTicks: "254270016000" } });
    expect(trimTicksMatch({ start: { seconds: 0, ticks: "0" }, end: { seconds: 1.001, ticks: "254270016000" } }, ticks)).toBe(true);
    // The production defect: one tick short still matched the frame-tolerant readback.
    expect(trimTicksMatch({ start: { seconds: 0, ticks: "0" }, end: { seconds: 1.001, ticks: "254270015999" } }, ticks)).toBe(false);
    expect(() => exactTrimTicks(plan, { start: { seconds: 0 }, end: current.end }, String(FRAME))).toThrow("current start ticks");
  });

  it("moves by an exact signed frame offset and preserves duration", () => {
    const at = { start: { seconds: 2.002, ticks: String(frames(60)) }, end: { seconds: 4.004, ticks: String(frames(120)) } };
    const ticks = exactMoveTicks(at, -1.001, String(FRAME));
    expect(ticks).toEqual({ offsetTicks: String(-frames(30)), startTicks: String(frames(30)), endTicks: String(frames(90)) });
    expect(moveTicksMatch({ start: { seconds: 1.001, ticks: String(frames(30)) }, end: { seconds: 3.003, ticks: String(frames(90)) } }, ticks)).toBe(true);
    expect(moveTicksMatch({ start: { seconds: 1.001, ticks: String(frames(30) - 1n) }, end: { seconds: 3.003, ticks: String(frames(90) - 1n) } }, ticks)).toBe(false);
    expect(() => exactMoveTicks(at, -3, String(FRAME))).toThrow("non-negative timeline");
  });
});

describe("native trim/move writes (fake Premiere that floors float seconds)", () => {
  it("trims the end to 2.002 s at frame 60 exactly, never through createWithSeconds", async () => {
    // The flooring float factory would have written one tick short of frame 60.
    expect(Math.floor(2.002 * TPS)).toBe(Number(frames(60)) - 1);
    const f = fixture({ startFrame: 0 });
    const result = await f.trim({ endSeconds: 2.002 });
    expect(result).toMatchObject({ status: "pass", hostResult: { exactTicks: { pass: true, expected: { startTicks: "0", endTicks: String(frames(60)) } } } });
    expect(f.ticks()).toMatchObject({ start: 0n, end: frames(60), sourceOut: frames(60) });
    expect(f.createWithSeconds).not.toHaveBeenCalled();
    expect(f.createWithTicks).toHaveBeenCalledWith(String(frames(60)));
  });

  it("fails a trim that lands one tick short and restores the original ticks", async () => {
    let faulty = true;
    const f = fixture({ startFrame: 0, store: ticks => { if (!faulty) return ticks; faulty = false; return ticks - 1n; } });
    const result = await f.trim({ endSeconds: 2.002 });
    expect(result).toMatchObject({ status: "fail", hostResult: { exactTicks: { pass: false, observed: { endTicks: String(frames(60) - 1n) } }, rollback: { attempted: true, verified: true } } });
    expect(result.errors).toContain("Trimmed clip boundary ticks differ from the exact frame boundary");
    expect(f.ticks()).toMatchObject({ start: 0n, end: frames(120), sourceOut: frames(120) });
  });

  it.each([true, false])("moves left by an exact negative offset (negative string factory: %s)", async negativeTicks => {
    const f = fixture({ negativeTicks });
    const result = await f.move(-1.001);
    expect(result).toMatchObject({ status: "pass", hostResult: { exactTicks: { pass: true, expected: { offsetTicks: String(-frames(30)) } } } });
    expect(f.ticks()).toMatchObject({ start: frames(30), end: frames(90) });
    // Fallback: once for the pre-dispatch proof, once inside the move action.
    expect(f.subtract).toHaveBeenCalledTimes(negativeTicks ? 0 : 2);
    expect(f.createWithSeconds).not.toHaveBeenCalled();
  });
});

describe("automatic follow failure reason", () => {
  it("drops only the false not-dispatched clause and keeps every other reason", () => {
    expect(followFailureReason(Error("Track targeting helper request failed: TypeError: Network request failed; dependent content command was not dispatched")))
      .toBe("Track targeting helper request failed: TypeError: Network request failed");
    expect(followFailureReason(Error("Playhead readback differs; content command was not dispatched"))).toBe("Playhead readback differs");
    expect(followFailureReason("CLEAR_APPLIED_THEN_FAILED")).toBe("CLEAR_APPLIED_THEN_FAILED");
    expect(followFailureReason(Error("; content command was not dispatched"))).toBe("Work follow failed");
  });
});
