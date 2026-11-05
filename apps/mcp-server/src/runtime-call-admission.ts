import {setTimeout as delay} from 'node:timers/promises';
import {BridgeTransportError} from './bridge-transport.js';

/** Optional protocol-1 capability: wait for authentication before dispatching a
 * single call. Older owners retain the client's separate status preflight. */
export const runtimeCallAdmission = 'wait-before-dispatch-v1';
export const runtimeCallWaitHeader = 'x-premiere-wait-ms';
export const maximumCallWaitMs = 90_000;

export function supportsCallAdmission(health: unknown): boolean {
  return typeof health === 'object' && health !== null &&
    'callAdmission' in health && health.callAdmission === runtimeCallAdmission;
}

/** Header validation is pure; malformed admission never reaches the host. */
export function parseCallWaitMs(value: string | string[] | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const ms = Number(value);
    if (Number.isSafeInteger(ms) && ms >= 1 && ms <= maximumCallWaitMs) return ms;
  }
  throw new BridgeTransportError('Invalid runtime call wait budget', {code:'RUNTIME_REQUEST_FAILED',dispatchState:'not_sent'});
}

/** I/O adapter: only cached connection state is read here. Cancellation or
 * expiry means no host call was sent. The caller dispatches exactly once after
 * this returns; a later transport failure never authorizes replay. */
export async function waitForCallAdmission(
  getStatus: () => Promise<{connected:boolean}>, waitMs: number, signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  do {
    signal.throwIfAborted();
    const status = await getStatus();
    signal.throwIfAborted();
    if (status.connected) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(250,remaining),undefined,{signal});
  } while (Date.now() < deadline);
  throw new BridgeTransportError('Premiere UXP panel is not connected', {code:'PANEL_DISCONNECTED',dispatchState:'not_sent'});
}
