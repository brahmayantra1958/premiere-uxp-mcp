import {commandEditTarget} from "./command-edit-target.js";
import {isJobPreservationRead} from '@premiere-uxp/contracts/read-purpose';
import type { BridgeAuthentication, BridgeAuthRequest, BridgeAuthResponse, BridgeRequest, BridgeResponse } from "./wire.js";
import { normalizeLocalBridgeUrl } from "./bridge-url.js";
import type { TaskEvent } from "./task-activity.js";
import type { NativeWorkPanel, NativeProjectItemTarget } from "@premiere-uxp/contracts/panel-work";
import type {EffectDisclosurePhase,EffectDisclosureWork} from "@premiere-uxp/contracts/effect-disclosure";
import type {MaskTrackingPhase,MaskTrackingWork,NativeMaskWork} from "@premiere-uxp/contracts/mask-tracking";
import type {EffectChainProofWork} from '@premiere-uxp/contracts/effect-chain-proof';
import type {EffectNativeSampleWork} from '@premiere-uxp/contracts/effect-native-sample';
import {CommandExecutionLedger} from './command-execution-ledger.js';

export type BridgeClose = { code: number; reason: string; wasAuthenticated: boolean };

export type BridgeDisposeResult = {
  status: 'pass' | 'unverified';
  scope: 'callback_release';
  sockets: number;
  closeRequested: number;
  closedAtRead: number;
  closingAtRead: number;
  registeredSocketListenersReleased: boolean;
  pendingVisibilityRequests: number;
  activeCommands: number;
  errors: string[];
};

function teardownDiagnostic(phase: 'close-request' | 'close-already-closing' | 'close-already-closed' | 'close-unverified', state: number | undefined): void {
  try {
    console.info('[bridge-teardown]', JSON.stringify({phase, ...(Number.isFinite(state) ? {state} : {})}));
  } catch { /* Observation cannot change socket teardown. */ }
}

export function shouldLogBridgeCommand(command: string): boolean {
  return !["get_capabilities", "inspect_host_context", "get_track_command_sequence_status"].includes(command);
}

export class BridgeClient {
  publishJobProgress(event:{jobId:string;state:string;completedSteps:number;totalSteps:number;durationMs:number}):void{
    if(this.authenticated&&this.socket)this.socket.send(JSON.stringify({version:1,type:'track_job_progress',...event}));
  }
  private socket: WebSocket | undefined;
  private detachSocket: (() => boolean) | undefined;
  private listenerCleanupFailed = false;
  private socketStateFailed = false;
  private socketCloseFailed = false;
  private disposed = false;
  private disposeResult: BridgeDisposeResult | undefined;
  private readonly execution = new CommandExecutionLedger();
  private authenticated = false;
  private authenticationTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly visibility = new Map<string,{resolve:(value:Record<string,unknown>)=>void;timer:ReturnType<typeof setTimeout>}>();
  private visibilityIndex=0;
  private nativePanelProtocol=false;
  private programFrameProtocol=false;
  private nativeVisualProtocol=false;
  private effectDisclosureProtocol=false;
  private maskTrackingProtocol=false;
  private effectChainProofProtocol=false;
  private effectNativeSampleProtocol=false;
  private effectNativeTimeProtocol=0;
  requestEffectNativeSample(parentId:string,work:EffectNativeSampleWork):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.effectNativeSampleProtocol)return Promise.resolve({status:'unsupported',reason:'Native evaluated read requires the updated runtime'});
    if((work.purpose==='time_mapping'||work.reversed||(work.speed??1)!==1)&&!this.effectNativeTimeProtocol)return Promise.resolve({status:'unsupported',reason:'Native time proof requires the updated runtime'});
    if(work.exactMapping&&this.effectNativeTimeProtocol<2)return Promise.resolve({status:'unsupported',reason:'Exact non-linear mapping requires native time protocol 2'});
    const id=`${parentId}:native-sample:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:'unverified',reason:'Native evaluated read timed out; inspect before retry'});},26000);
      this.visibility.set(id,{resolve,timer});this.socket!.send(JSON.stringify({version:1,type:'native_effect_sample',id,parentId,work,editTarget:commandEditTarget(parentId)}));
    });
  }
  requestEffectChainProof(parentId:string,work:EffectChainProofWork):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.effectChainProofProtocol)return Promise.resolve({status:'unsupported',reason:'Saved effect-chain proof requires the updated runtime'});
    const id=`${parentId}:effect-chain:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:'unverified',reason:'Saved effect-chain proof timed out'});},14000);
      this.visibility.set(id,{resolve,timer});this.socket!.send(JSON.stringify({version:1,type:'native_effect_chain_proof',id,parentId,work,editTarget:commandEditTarget(parentId)}));
    });
  }
  requestNativeMaskArchive(parentId:string,work:NativeMaskWork):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.maskTrackingProtocol)return Promise.resolve({status:"unsupported",reason:"Native mask inspection requires the updated runtime"});
    const id=`${parentId}:mask-archive:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:"unverified",reason:"Native mask archive response timed out"});},8000);
      this.visibility.set(id,{resolve,timer});this.socket!.send(JSON.stringify({version:1,type:"native_mask_archive",id,parentId,work,editTarget:commandEditTarget(parentId)}));
    });
  }
  requestMaskTracking(parentId:string,phase:MaskTrackingPhase,step:number,work:MaskTrackingWork):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.maskTrackingProtocol)return Promise.resolve({status:"unsupported",reason:"Mask tracking requires the updated runtime"});
    const id=`${parentId}:mask:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:"unverified",reason:"Mask tracking timed out; inspect before retry"});},8000);
      this.visibility.set(id,{resolve,timer});this.socket!.send(JSON.stringify({version:1,type:"mask_tracking",id,parentId,phase,step,work,editTarget:commandEditTarget(parentId)}));
    });
  }
  requestEffectDisclosure(parentId:string,phase:EffectDisclosurePhase,work:EffectDisclosureWork):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.effectDisclosureProtocol)return Promise.resolve({status:"unsupported",available:false,reason:"Effect disclosure requires the updated runtime"});
    const id=`${parentId}:disclosure:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:"unverified",reason:"Effect disclosure timed out; inspect before retry"});},(work.target.parameterCount??0)>64?35000:14000);
      this.visibility.set(id,{resolve,timer});this.socket!.send(JSON.stringify({version:1,type:"effect_disclosure",id,parentId,phase,work,editTarget:commandEditTarget(parentId)}));
    });
  }
  requestNativeVisual(parentId:string):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.nativeVisualProtocol)return Promise.resolve({status:"unsupported",reason:"Native visual SDK protocol requires the updated runtime"});
    const id=`${parentId}:native:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:"unverified",reason:"Native SDK response timeout; inspect before retrying"});},6000);
      this.visibility.set(id,{resolve,timer});
      this.socket!.send(JSON.stringify({version:1,type:"native_visual",id,parentId}));
    });
  }
  private projectSelectionProtocol=false;
  requestProjectSelection(parentId:string,target:NativeProjectItemTarget):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.projectSelectionProtocol)return Promise.resolve({status:"unsupported",reason:"Project selection requires the updated owner runtime and approved helper"});
    const id=`${parentId}:project:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:"unverified",reason:"Project selection timeout; inspect before retrying"});},13000);
      this.visibility.set(id,{resolve,timer});
      this.socket!.send(JSON.stringify({version:1,type:"project_selection",id,parentId,target,editTarget:commandEditTarget(parentId)}));
    });
  }
  requestProgramFrameReady(parentId:string):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.programFrameProtocol)return Promise.resolve({status:"unsupported",reason:"Update the owner runtime for frame finalization"});
    const id=`${parentId}:frame:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:"unverified",reason:"Frame finalization timeout"});},6000);
      this.visibility.set(id,{resolve,timer});
      this.socket!.send(JSON.stringify({version:1,type:"program_frame_ready",id,parentId}));
    });
  }

  requestNativeVisibility(parentId:string,panel:NativeWorkPanel,projectName:string,sequenceName:string):Promise<Record<string,unknown>> {
    if(!this.authenticated||!this.socket||!this.nativePanelProtocol)return Promise.resolve({status:"unsupported",panel,reason:"Native visibility requires the updated owner runtime"});
    const id=`${parentId}:visibility:${++this.visibilityIndex}`;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{this.visibility.delete(id);resolve({status:"unverified",panel,reason:"Native panel response timeout; content operation retains its own verification"});},3000);
      this.visibility.set(id,{resolve,timer});
      this.socket!.send(JSON.stringify({version:1,type:"native_visibility",id,parentId,panel,projectName,sequenceName}));
    });
  }

  constructor(
    private readonly dispatch: (request: BridgeRequest) => Promise<unknown>,
    private readonly status: (state: "disconnected" | "connecting" | "connected") => void,
    private readonly log: (message: string) => void,
    private readonly onAuthenticated: (response: BridgeAuthResponse) => void | Promise<void>,
    private readonly onClosed: (close: BridgeClose) => void | Promise<void>,
    private readonly onTask: (event: TaskEvent) => void = () => {},
  ) {}

  connect(serverUrl: string, authentication: BridgeAuthentication): void {
    if (this.disposed) throw new Error('BRIDGE_DISPOSED');
    this.disconnect("reconnect");
    const target = normalizeLocalBridgeUrl(serverUrl);
    this.status("connecting");
    const socket = new WebSocket(target);
    this.socket = socket;
    const failConnection = (reason: string): void => {
      if (this.disposed || this.socket !== socket) return;
      const wasAuthenticated = this.authenticated;
      this.disconnect(reason);
      void this.onClosed({ code: 1006, reason, wasAuthenticated });
    };
    // Some UXP network failures emit error without open/close. Bound the
    // handshake from socket creation so Load never sticks at "connecting".
    this.authenticationTimer = setTimeout(() => failConnection("bridge connection timeout"), 10_000);
    const onOpen = (): void => {
      if (this.disposed || this.socket !== socket) return;
      this.clearAuthenticationTimer();
      const auth: BridgeAuthRequest = {
        version: 1,
        type: "authenticate",
        client: "premiere-uxp-panel",
        ...authentication,
      };
      socket.send(JSON.stringify(auth));
      this.authenticationTimer = setTimeout(() => {
        if (this.disposed || this.socket !== socket) return;
        this.log("Bridge authentication timed out.");
        failConnection("authentication timeout");
      }, 5_000);
    };
    const onClose = (event: CloseEvent): void => {
      if (this.disposed || this.socket !== socket) return;
      const wasAuthenticated = this.authenticated;
      this.takeSocket();
      this.clearAuthenticationTimer();
      this.clearVisibility();
      this.authenticated = false;
      this.socket = undefined;
      this.status("disconnected");
      this.log(`Bridge closed (${event.code}${event.reason ? `: ${event.reason}` : ""}).`);
      void this.onClosed({ code: event.code, reason: event.reason, wasAuthenticated });
    };
    const onError = (): void => {
      if (this.disposed || this.socket !== socket) return;
      this.status("disconnected");
      this.log("Bridge connection failed. The local server may still be starting.");
      failConnection("bridge connection failed");
    };
    const onMessage = (event: MessageEvent): void => {
      if (!this.disposed && this.socket === socket) void this.onMessage(String(event.data));
    };
    const listeners: [string, EventListener][] = [
      ['open', onOpen], ['close', onClose as EventListener],
      ['error', onError], ['message', onMessage as EventListener],
    ];
    this.detachSocket = () => {
      let complete = true;
      for (const [type, listener] of listeners) {
        try { socket.removeEventListener(type, listener); } catch { complete = false; }
      }
      return complete;
    };
    for (const [type, listener] of listeners) socket.addEventListener(type, listener);
  }

  disconnect(reason = "panel disconnect"): void {
    if (this.disposed) return;
    const socket = this.takeSocket();
    this.clearVisibility();
    this.clearAuthenticationTimer();
    this.authenticated = false;
    if (socket) this.requestSocketClose(socket, reason);
    this.status("disconnected");
  }

  private takeSocket(): WebSocket | undefined {
    const socket = this.socket;
    this.socket = undefined; // Keep the guard for events already queued natively.
    const detach = this.detachSocket;
    this.detachSocket = undefined;
    if (detach && !detach()) this.listenerCleanupFailed = true;
    return socket;
  }

  private readSocketState(socket: WebSocket): number | undefined {
    try {
      const state = socket.readyState;
      if (Number.isInteger(state) && state >= 0 && state <= 3) return state;
    } catch { /* A retired native socket may no longer expose its state. */ }
    this.socketStateFailed = true;
    return undefined;
  }

  /** Synchronous callback release only: no new listener, timer or continuation
   * may outlive this hook. closeRequested counts attempts, not transport close
   * completion or host safety. Existing native promises/receipts are untouched.
   * Ordinary disconnect allows reconnect; final dispose permanently forbids it. */
  dispose(): BridgeDisposeResult {
    if (this.disposeResult) return this.disposeResult;
    this.disposed = true;
    const activeCommands = this.execution.inspect([]).active.length;
    const pendingVisibilityRequests = this.visibility.size;
    const socket = this.takeSocket();
    this.clearAuthenticationTimer();
    this.authenticated = false;
    this.clearVisibility();
    const close = socket ? this.requestSocketClose(socket, 'plugin destroyed', true) : undefined;
    const errors: string[] = [];
    if (this.listenerCleanupFailed) errors.push('socket_listener_cleanup_failed');
    if (this.socketStateFailed) errors.push('socket_state_unavailable');
    if (this.socketCloseFailed) errors.push('socket_close_failed');
    if (activeCommands > 0) errors.push('host_commands_still_pending');
    this.disposeResult = {
      status: errors.length ? 'unverified' : 'pass', scope: 'callback_release',
      sockets: socket ? 1 : 0, closeRequested: close?.requested ? 1 : 0,
      closedAtRead: close?.state === 3 ? 1 : 0, closingAtRead: close?.state === 2 ? 1 : 0,
      registeredSocketListenersReleased: !this.listenerCleanupFailed,
      pendingVisibilityRequests, activeCommands, errors,
    };
    return this.disposeResult;
  }

  private requestSocketClose(socket: WebSocket, reason: string, diagnose = false): { state: number | undefined; requested: boolean } {
    const state = this.readSocketState(socket);
    if (state === undefined || state === 2 || state === 3) {
      if (diagnose) teardownDiagnostic(state === 3 ? 'close-already-closed' : state === 2 ? 'close-already-closing' : 'close-unverified', state);
      return {state, requested: false};
    }
    if (diagnose) teardownDiagnostic('close-request', state);
    try { socket.close(1000, reason); }
    catch {
      this.socketCloseFailed = true;
      if (diagnose) teardownDiagnostic('close-unverified', undefined);
    }
    return {state, requested: true};
  }

  private clearVisibility(): void {
    this.nativePanelProtocol=false;
    this.programFrameProtocol=false;
    this.nativeVisualProtocol=false;
    this.effectDisclosureProtocol=false;
    this.maskTrackingProtocol=false;
    this.effectChainProofProtocol=false;
    this.effectNativeSampleProtocol=false;
    this.effectNativeTimeProtocol=0;
    this.projectSelectionProtocol=false;
    for(const request of this.visibility.values()){clearTimeout(request.timer);request.resolve({status:"unverified",reason:"Panel disconnected during native visibility"});}
    this.visibility.clear();
  }

  private async onMessage(raw: string): Promise<void> {
    if (this.disposed) return;
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch {
      this.log("Rejected malformed bridge message.");
      return;
    }

    if (this.isAuthResponse(value)) {
      this.nativePanelProtocol=value.nativePanelProtocol===1;
      // Older Windows owners coupled PNG finalization to native panel support.
      this.programFrameProtocol=value.programFrameProtocol===1 || value.nativePanelProtocol===1;
      this.nativeVisualProtocol=value.nativeVisualProtocol===1;
      this.effectDisclosureProtocol=value.effectDisclosureProtocol===1;
      this.maskTrackingProtocol=value.maskTrackingProtocol===1;
      this.effectChainProofProtocol=value.effectChainProofProtocol===1;
      this.effectNativeSampleProtocol=value.effectNativeSampleProtocol===1;
      this.effectNativeTimeProtocol=value.effectNativeTimeProtocol===2?2:value.effectNativeTimeProtocol===1?1:0;
      this.projectSelectionProtocol=value.projectSelectionProtocol===1;
      this.clearAuthenticationTimer();
      this.authenticated = true;
      this.status("connected");
      await this.onAuthenticated(value);
      if (this.disposed) return;
      this.log(value.credentialIssued ? "Project paired. Future server starts will reconnect automatically." : "Authenticated with the saved project connection.");
      return;
    }
    if (!this.authenticated) {
      this.log("Rejected bridge command before authentication completed.");
      this.socket?.close(1008, "command before authentication");
      return;
    }

    if(value && typeof value==="object" && (value as {type?:unknown}).type==="native_visibility_result") {
      const message=value as {id:string;result:Record<string,unknown>}, pending=this.visibility.get(message.id);
      if(pending){clearTimeout(pending.timer);this.visibility.delete(message.id);pending.resolve(message.result);}
      return;
    }

    let request: BridgeRequest;
    try {
      request = value as BridgeRequest;
      if (request.version !== 1 || !request.id || !request.command) throw new Error("Invalid bridge request");
      if (request.readPurpose !== undefined && !isJobPreservationRead(request.command, request.readPurpose)) throw new Error('Invalid internal read purpose');
    } catch (error) {
      this.log(`Rejected malformed request: ${String(error)}`);
      return;
    }

    // Read execution state without waiting behind the potentially stuck host
    // queue. Fixed-label stage/native-call diagnostics are memory-only and do
    // not change running/terminal evidence. No Premiere call or view is touched.
    if(request.command==='inspect_command_execution'){
      try{this.socket?.send(JSON.stringify({version:1,id:request.id,ok:true,result:this.execution.inspect(request.args.commandIds),durationMs:0}));}
      catch(e){this.socket?.send(JSON.stringify({version:1,id:request.id,ok:false,error:{code:'EXECUTION_QUERY_INVALID',message:String(e)},durationMs:0}));}return;
    }
    let prior:BridgeResponse|undefined;
    try{prior=this.execution.begin(request);}catch(e){this.socket?.send(JSON.stringify({version:1,id:request.id,ok:false,error:{code:String(e).replace(/^Error: /,''),message:'Command was not dispatched'},durationMs:0}));return;}
    if (prior) {
      this.socket?.send(JSON.stringify(prior));
      return;
    }

    const started = performance.now();
    let response: BridgeResponse;
    const announce = shouldLogBridgeCommand(request.command);
    if (announce) this.log(`Running ${request.command}…`);
    if (announce) this.publishTask({ phase: "started", id: request.id, command: request.command, startedAt: Date.now() });
    try {
      const result = await this.dispatch(request);
      response = { version: 1, id: request.id, ok: true, result, durationMs: performance.now() - started };
    } catch (error) {
      console.error("[host-command-failure]", request.command, error instanceof Error ? error.stack : String(error));
      response = {
        version: 1,
        id: request.id,
        ok: false,
        error: { code: error instanceof HostCommandError ? error.code : "HOST_COMMAND_FAILED", message: error instanceof Error ? error.message : String(error), ...(error instanceof HostCommandError && error.details ? { details: error.details } : {}) },
        durationMs: performance.now() - started,
      };
    }
    const resultStatus = response.ok && response.result && typeof response.result === "object"
      ? String((response.result as { status?: unknown }).status ?? "completed")
      : "failed";
    if (announce && !this.disposed) this.log(`${request.command}: ${resultStatus} (${Math.round(response.durationMs)} ms)`);
    if (announce) this.publishTask({ phase: "finished", id: request.id, response });
    this.execution.complete(response);
    this.socket?.send(JSON.stringify(response));
  }

  private isAuthResponse(value: unknown): value is BridgeAuthResponse {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<BridgeAuthResponse>;
    return candidate.version === 1
      && candidate.type === "authenticated"
      && candidate.ok === true
      && typeof candidate.projectId === "string"
      && typeof candidate.credentialIssued === "boolean";
  }

  private publishTask(event: TaskEvent): void {
    if (this.disposed) return;
    // Monitoring must never prevent execution or delivery of the host receipt.
    try { this.onTask(event); } catch { /* A detached panel is not a command failure. */ }
  }

  private clearAuthenticationTimer(): void {
    if (this.authenticationTimer !== undefined) clearTimeout(this.authenticationTimer);
    this.authenticationTimer = undefined;
  }
}

export class HostCommandError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: { contentDispatched: false; retryable: boolean; errorClassification: 'preflight' | 'host_transient'; actualTarget?: unknown }) {
    super(message);
    this.name = "HostCommandError";
  }
}

/** Use only around a side-effect-free validation, never around a transaction. */
export function preflightValue<T>(validate: () => T): T {
  try { return validate(); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HostCommandError(error instanceof HostCommandError ? error.code : message.match(/^([A-Z][A-Z_]+):/)?.[1] ?? 'PREFLIGHT_REFUSED', message,
      { contentDispatched: false, retryable: false, errorClassification: 'preflight' });
  }
}
