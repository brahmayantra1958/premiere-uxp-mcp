/** Bounded wire responses include full MOGRT/effect snapshots during planning.
 * The observed 154-clip snapshot was 8,239,652 bytes. Its 200-clip model is
 * 10.20 MiB; the 1,000-clip ceiling with the observed MOGRT shape is 53.98 MiB.
 * 64 MiB supports that shape, not arbitrary effect/keyframe growth. Oversized
 * replies still fail closed and leave dispatched content unverified. */
export const maximumPanelMessageBytes = 64 * 1024 * 1024;
export const maximumAuthenticationBytes = 16 * 1024;

const codes = ['PANEL_DISCONNECTED','PANEL_MESSAGE_TOO_LARGE','PANEL_SEND_FAILED','PANEL_COMMAND_TIMEOUT','RUNTIME_UNAVAILABLE','RUNTIME_REQUEST_FAILED'] as const;
type TransportCode = typeof codes[number];
export type TransportFailure = { code:TransportCode; dispatchState:'not_sent'|'unknown' };

/** `unknown` means dispatch may have reached the host, never proof of a write.
 * Only the layer that has not attempted its request can assert `not_sent`. */
export class BridgeTransportError extends Error {
  constructor(message:string,readonly transport:TransportFailure,options?:ErrorOptions){
    super(message,options);this.name='BridgeTransportError';
  }
}
export function transportFailure(error:unknown):TransportFailure|undefined{
  return error instanceof BridgeTransportError ? error.transport : undefined;
}
export function parseTransportFailure(value:unknown):TransportFailure|undefined{
  if(!value||typeof value!=='object')return;
  const row=value as Record<string,unknown>;
  if(!codes.includes(row.code as TransportCode)||!['not_sent','unknown'].includes(String(row.dispatchState)))return;
  return {code:row.code as TransportCode,dispatchState:row.dispatchState as TransportFailure['dispatchState']};
}
