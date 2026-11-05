import { isTransientHostObjectInvalidation } from "./component-write.js";

export type GraphicReadOptions = Readonly<{
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  intervalMs?: number;
  quietMs?: number;
  maxAttempts?: number;
}>;

export class GraphicNotSettledError extends Error {
  readonly code = "GRAPHIC_NOT_SETTLED";

  constructor(readonly attempts: number) {
    super(`The native graphic graph did not settle after ${attempts} completed attempts.`);
    this.name = "GraphicNotSettledError";
  }
}

let lastMutationAt = Number.NEGATIVE_INFINITY;
let mutationRevision = 0;

/** Call after a completed graphic mutation; use the same clock as the read options. */
export function noteGraphicMutation(at = Date.now()): void {
  lastMutationAt = at;
  mutationRevision += 1;
}

function retryableGraphicReadFailure(error: unknown): boolean {
  return isTransientHostObjectInvalidation(error)
    || (typeof error === "object" && error !== null
      && "code" in error && error.code === "GRAPHIC_OBJECT_NOT_READY");
}

function nonnegativeDuration(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number.`);
  }
  return value;
}

/** Wait before the first metadata read after a completed graphic structure mutation. */
export async function waitGraphicMutationQuiet(
  options: Pick<GraphicReadOptions, "now" | "wait" | "quietMs"> = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  }));
  const quietMs = nonnegativeDuration(options.quietMs ?? 250, "quietMs");
  while (true) {
    const revision = mutationRevision;
    const remaining = quietMs - (now() - lastMutationAt);
    if (remaining <= 0) return;
    await wait(remaining);
    if (revision === mutationRevision && now() - lastMutationAt >= quietMs) return;
  }
}

/**
 * Read-only graph access after two equal structural probes and a mutation quiet period.
 * Both callbacks must reacquire native objects. Never pass a mutation as `read`.
 * There is deliberately no deadline: an unresolved native call still owns its lane.
 */
export async function settledGraphicRead<T>(
  probe: () => Promise<string>,
  read: () => Promise<T>,
  options: GraphicReadOptions = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  }));
  const intervalMs = nonnegativeDuration(options.intervalMs ?? 100, "intervalMs");
  const quietMs = nonnegativeDuration(options.quietMs ?? 250, "quietMs");
  const maxAttempts = options.maxAttempts ?? 8;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
    throw new RangeError("maxAttempts must be an integer from 1 through 8.");
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const quietRemaining = quietMs - (now() - lastMutationAt);
    if (quietRemaining > 0) await wait(quietRemaining);
    // Another completed mutation during the wait starts its own quiet period.
    if (now() - lastMutationAt < quietMs) continue;
    const revision = mutationRevision;

    try {
      const firstSignature = await probe();
      if (revision !== mutationRevision) continue;
      await wait(intervalMs);
      if (revision !== mutationRevision) continue;
      const stableSignature = await probe();
      if (revision !== mutationRevision || firstSignature !== stableSignature) {
        noteGraphicMutation(now());
        continue;
      }

      const value = await read();
      const finalSignature = await probe();
      if (revision === mutationRevision && stableSignature === finalSignature) return value;
      // A read spanning a rebuild cannot certify the old graph, even with identical values.
      noteGraphicMutation(now());
    } catch (error) {
      // Identity/precondition failures and unclassified native errors stay authoritative.
      // Only a completed, specifically recognized graph invalidation can be retried.
      if (!retryableGraphicReadFailure(error)) throw error;
      noteGraphicMutation(now());
    }
  }
  throw new GraphicNotSettledError(maxAttempts);
}
