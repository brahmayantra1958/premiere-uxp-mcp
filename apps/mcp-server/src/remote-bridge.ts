import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { bridgeResponseSchema, type BridgeRequest, type BridgeResponse } from "@premiere-uxp/contracts";
import type { BridgeStatus, HostBridge } from "./bridge-port.js";
import {eventQuerySchema,type EventQuery,type EventPage} from './runtime-events.js';
import {BridgeTransportError,parseTransportFailure} from './bridge-transport.js';
import {maximumCallWaitMs,runtimeCallWaitHeader,supportsCallAdmission} from './runtime-call-admission.js';

type EnsureRuntime = () => Promise<unknown>;
type ResolveControlUrl = () => Promise<string>;
type RuntimeErrorBody = { error?: unknown; transport?:unknown };

export class RemoteBridge implements HostBridge {
  private lastEnsureAt = 0;
  private serverWaitSupported = false;

  constructor(
    private readonly controlUrl: string | ResolveControlUrl,
    private readonly tokenPath: string,
    private readonly ensureRuntime: EnsureRuntime,
    private readonly connectionTimeoutMs = 20_000,
  ) {}

  async getStatus(): Promise<BridgeStatus> {
    await this.ensureBeforeRequest();
    return this.request<BridgeStatus>("GET", "/status");
  }

  async call(request: BridgeRequest): Promise<BridgeResponse> {
    // Ensure only before sending. Never replay a host command after a lost response.
    try{await this.ensureBeforeRequest();if(!this.serverWaitSupported)await this.waitForPanel();}
    catch(error){throw new BridgeTransportError(error instanceof Error?error.message:String(error),{code:'RUNTIME_UNAVAILABLE',dispatchState:'not_sent'},{cause:error});}
    const waitMs = this.serverWaitSupported ? Math.min(maximumCallWaitMs,Math.max(1,Math.floor(this.connectionTimeoutMs))) : undefined;
    return bridgeResponseSchema.parse(await this.request("POST", "/call", request, request.timeoutMs + 5_000 + (waitMs ?? 0),waitMs));
  }

  /** Daemon readiness precedes UXP authentication. Wait BEFORE dispatch only;
   * no content request is sent twice when a response is lost. */
  private async waitForPanel(): Promise<void> {
    const deadline = Date.now() + this.connectionTimeoutMs;
    do {
      const status = await this.request<BridgeStatus>("GET", "/status", undefined, Math.max(1, deadline - Date.now()));
      if (status.connected) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(250, remaining));
    } while (Date.now() < deadline);
    // Preserve the exact known pre-send rejection contract.
    throw new Error("Premiere runtime POST /call failed: Premiere UXP panel is not connected");
  }

  async armNextLocalProject(): Promise<void> {
    await this.ensureBeforeRequest();
    await this.request("POST", "/approve-next-project", {});
  }
  async waitEvents(input:EventQuery):Promise<EventPage>{
    const query=eventQuerySchema.parse(input);await this.ensureBeforeRequest();
    return this.request<EventPage>('POST','/events/wait',query,query.timeoutMs+5000);
  }

  async shutdown(): Promise<void> {
    await this.request("POST", "/shutdown", {});
  }

  private async ensureBeforeRequest(): Promise<void> {
    if (Date.now() - this.lastEnsureAt < 1_000) return;
    const runtime = await this.ensureRuntime();
    this.serverWaitSupported = supportsCallAdmission(typeof runtime === 'object' && runtime !== null && 'health' in runtime ? runtime.health : undefined);
    this.lastEnsureAt = Date.now();
  }

  private async request<T = unknown>(method: "GET" | "POST", pathname: string, value?: unknown, timeoutMs = 20_000, callWaitMs?: number): Promise<T> {
    let attempted=false;
    try{
    const token = (await readFile(this.tokenPath, "utf8")).trim();
    const controlUrl = typeof this.controlUrl === "string" ? this.controlUrl : await this.controlUrl();
    attempted=true;
    const response = await fetch(new URL(pathname, controlUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(value === undefined ? {} : { "content-type": "application/json" }),
        ...(callWaitMs === undefined ? {} : {[runtimeCallWaitHeader]:String(callWaitMs)}),
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json() as T & RuntimeErrorBody;
    if (!response.ok) {
      const message=`Premiere runtime ${method} ${pathname} failed: ${String(payload.error ?? response.status)}`;
      const transport=parseTransportFailure(payload.transport);
      if(transport)throw new BridgeTransportError(message,transport);
      throw new Error(message);
    }
    return payload;
    }catch(error){
      if(error instanceof BridgeTransportError)throw error;
      throw new BridgeTransportError(error instanceof Error?error.message:String(error),{code:'RUNTIME_REQUEST_FAILED',dispatchState:attempted?'unknown':'not_sent'},{cause:error});
    }
  }
}
