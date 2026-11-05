import type { BridgeRequest, BridgeResponse } from "@premiere-uxp/contracts";
import type {EventQuery,EventPage} from './runtime-events.js';

export type BridgeStatus = {
  connected: boolean;
  connectedAt: string | undefined;
  authenticationMethod: "pairing_token" | "project_credential" | "local_approval" | undefined;
  projectKey: string | undefined;
  host: string;
  port: number;
  tokenPath: string;
  localApprovalPending: boolean;
};

/** Bounded host-command transport used by both the owner daemon and MCP proxies. */
export interface HostBridge {
  getStatus(): Promise<BridgeStatus>;
  call(request: BridgeRequest): Promise<BridgeResponse>;
  waitEvents?(query:EventQuery,signal?:AbortSignal):Promise<EventPage>;
}
