import { describe, expect, it } from "vitest";
import {
  HEALTH_POLL_BASE_DELAY_MS,
  HEALTH_POLL_MAX_DELAY_MS,
  healthPollFailed,
  healthPollSucceeded,
  initialHealthPollState,
} from "../../apps/uxp-plugin/src/health-poll-policy.js";

describe("model bridge health poll policy", () => {
  it("backs off repeated offline checks and caps them at two minutes", () => {
    let state = initialHealthPollState();
    const delays: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const transition = healthPollFailed(state, "connection refused");
      state = transition.state;
      delays.push(state.delayMs);
    }
    expect(delays).toEqual([30_000, 60_000, 120_000, 120_000, 120_000, 120_000]);
    expect(state.delayMs).toBe(HEALTH_POLL_MAX_DELAY_MS);
  });

  it("logs a repeated failure once and logs recovery once", () => {
    const first = healthPollFailed(initialHealthPollState(), "connection refused");
    const repeated = healthPollFailed(first.state, "connection refused");
    const changed = healthPollFailed(repeated.state, "timed out");
    const recovered = healthPollSucceeded(changed.state);
    const stillHealthy = healthPollSucceeded(recovered.state);

    expect(first.logMessage).toBe("Model bridge unavailable: connection refused");
    expect(repeated.logMessage).toBeUndefined();
    expect(changed.logMessage).toBe("Model bridge unavailable: timed out");
    expect(recovered.logMessage).toBe("Model bridge connection restored.");
    expect(stillHealthy.logMessage).toBeUndefined();
    expect(recovered.state.delayMs).toBe(HEALTH_POLL_BASE_DELAY_MS);
  });
});
