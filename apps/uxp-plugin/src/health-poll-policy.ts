export const HEALTH_POLL_BASE_DELAY_MS = 15_000;
export const HEALTH_POLL_MAX_DELAY_MS = 120_000;

export type HealthPollState = {
  consecutiveFailures: number;
  delayMs: number;
  lastError?: string;
};

export type HealthPollTransition = {
  state: HealthPollState;
  logMessage?: string;
};

export function initialHealthPollState(): HealthPollState {
  return {
    consecutiveFailures: 0,
    delayMs: HEALTH_POLL_BASE_DELAY_MS,
  };
}

export function healthPollSucceeded(previous: HealthPollState): HealthPollTransition {
  return {
    state: initialHealthPollState(),
    ...(previous.lastError ? { logMessage: "Model bridge connection restored." } : {}),
  };
}

export function healthPollFailed(previous: HealthPollState, errorMessage: string): HealthPollTransition {
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const delayMs = Math.min(
    HEALTH_POLL_MAX_DELAY_MS,
    HEALTH_POLL_BASE_DELAY_MS * (2 ** Math.min(consecutiveFailures, 3)),
  );
  return {
    state: {
      consecutiveFailures,
      delayMs,
      lastError: errorMessage,
    },
    ...(previous.lastError !== errorMessage
      ? { logMessage: `Model bridge unavailable: ${errorMessage}` }
      : {}),
  };
}
