import { describe, expect, it } from "vitest";
import { frameIndexToTickTime, tickTimeToFrameIndex, type RationalFrameRate } from "@premiere-uxp/contracts";

const rates: RationalFrameRate[] = [
  { numerator: 24n, denominator: 1n },
  { numerator: 25n, denominator: 1n },
  { numerator: 30n, denominator: 1n },
  { numerator: 24_000n, denominator: 1_001n },
  { numerator: 30_000n, denominator: 1_001n },
  { numerator: 60_000n, denominator: 1_001n },
];

describe("Premiere frame time", () => {
  it("round-trips exact frame boundaries across common rates", () => {
    for (const rate of rates) {
      for (let frame = 0n; frame <= 10_000n; frame += 137n) {
        expect(tickTimeToFrameIndex(frameIndexToTickTime(frame, rate), rate)).toBe(frame);
      }
    }
  });

  it("rejects ambiguous or invalid time values", () => {
    expect(() => frameIndexToTickTime(-1n, rates[0]!)).toThrow(/non-negative/);
    expect(() => tickTimeToFrameIndex({ ticks: "1", seconds: 0 }, rates[0]!)).toThrow(/frame boundary/);
    expect(() => frameIndexToTickTime(1n, { numerator: 0n, denominator: 1n })).toThrow(/positive/);
  });
});
