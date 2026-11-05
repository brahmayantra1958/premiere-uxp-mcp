import {assertEditTarget,withEditTarget,type ActiveEditTarget} from "./active-edit-target.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { bridgeAuthRequestSchema, bridgeResponseSchema, nativePanelForCommand, followsProjectItem, nativeVisualFeatureForCommand, type BridgeRequest, type BridgeResponse } from "@premiere-uxp/contracts";
import {requestNativeVisual} from "./native-visual-bridge.js";
import { focusNativePanel } from "./native-panel-bridge.js";
import { waitForProgramFrame } from "./program-frame-artifact.js";
import { selectNativeProjectItem } from "./project-selection-bridge.js";
import {effectDisclosureWorkSchema,requestEffectDisclosure,invalidateEffectDisclosureBindings,type EffectDisclosureSession} from "./effect-disclosure-bridge.js";
import {parameterScrollCanContinue,parameterRebindReason,isEffectValueQuery,effectQueryScopeProves,effectParameterScopeProves,type EffectDisclosurePhase} from "@premiere-uxp/contracts/effect-disclosure";
import {MaskTrackingSession} from "./mask-tracking-session.js";
import {nativeMaskWorkSchema,nativeMaskWorkMatches,readMaskTrackingArchive} from "./mask-tracking-bridge.js";
import { PairingCredentialStore } from "./pairing-credentials.js";
import type { BridgeStatus, HostBridge } from "./bridge-port.js";
import {RuntimeEvents,type EventQuery} from './runtime-events.js';
import {EffectCommandSequences} from './effect-command-sequence.js';
import {HostExecutor} from './host-executor.js';
import {AuditLog,ReceiptStore} from './audit.js';
import {runtimePaths,bridgeConfig} from './config.js';
import {z} from 'zod/v4';
import {effectChainProofScopeMatches} from '@premiere-uxp/contracts/effect-chain-proof';
import {effectChainProofWorkSchema,requestEffectChainProof} from './effect-chain-proof.js';
import {effectNativeSampleScopeMatches} from '@premiere-uxp/contracts/effect-native-sample';
import {effectNativeSampleWorkSchema,requestEffectNativeSample} from './effect-native-sample.js';
import {ExecutionEvidenceStore,type ExecutionIdentity} from './execution-evidence.js';
import {BridgeTransportError,maximumPanelMessageBytes,maximumAuthenticationBytes} from './bridge-transport.js';
import {EffectJobStore} from './effect-job-store.js';

const trackProgressSchema=z.object({version:z.literal(1),type:z.literal('track_job_progress'),jobId:z.string().uuid(),state:z.enum(['queued','running','pass','fail','unverified','cancelled']),completedSteps:z.number().int().min(0).max(256),totalSteps:z.number().int().min(1).max(256),durationMs:z.number().finite().nonnegative()}).strict();

type Pending = {
  editTarget?:ActiveEditTarget;
  evidence?:ExecutionIdentity;
  request: BridgeRequest;
  visibilityCalls: number;
  frameRequested?:boolean;
  projectSelectionRequested?: boolean;
  nativeVisualRequested?: boolean;
  effectDisclosureStep?: "inspecting"|"inspected"|"clearing"|"cleared"|"calibrating"|"calibrated"|"calibration_reading"|"calibration_read"|"final_clearing"|"final_cleared"|"writing"|"written"|"verifying"|"verified"|"scrolling"|"scrolled";
  effectDisclosureWork?: string;
  effectDisclosureSession?:EffectDisclosureSession;
  effectMetadataRequested?:boolean;
  keyframeArchiveReads?:number;
  effectChainArchiveReads?:number;
  effectChainArchiveBusy?:boolean;
  nativeSampleReads?:number;
  nativeSampleBusy?:boolean;
  parameterStep?:"inspected"|"baseline"|"verified"|"scrolled";
  parameterClears?:number;
  parameterRebindAllowed?:boolean;
  parameterRebinds?:number;
  parameterScrollContinuationAllowed?:boolean;
  parameterScrollContinuations?:number;
  maskTracking?: MaskTrackingSession;
  maskArchiveRequested?:boolean;
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type AuthenticationMethod = "pairing_token" | "project_credential" | "local_approval";

type BridgeOptions = { allowNextLocalProject?: boolean };

export class PremiereDisconnectedError extends BridgeTransportError {
  constructor(message = "Premiere UXP panel is not connected", dispatchState:'not_sent'|'unknown'='unknown') {
    super(message,{code:'PANEL_DISCONNECTED',dispatchState});
    this.name = "PremiereDisconnectedError";
  }
}

export class UxpBridgeServer implements HostBridge {
  readonly events=new RuntimeEvents();
  waitEvents(query:EventQuery,signal?:AbortSignal){return this.events.wait(query,signal);}
  private readonly token = randomBytes(32).toString("hex");
  private readonly pending = new Map<string, Pending>();
  private readonly lateEvidence=new Map<string,ExecutionIdentity>();
  private readonly executionEvidence:ExecutionEvidenceStore;
  private readonly evidenceWrites=new Set<Promise<void>>();
  private readonly credentials: PairingCredentialStore;
  private socket: WebSocket | undefined;
  private server: WebSocketServer | undefined;
  private connectedAt: string | undefined;
  private authenticationMethod: AuthenticationMethod | undefined;
  private projectKey: string | undefined;
  private allowNextLocalProject: boolean;
  private effectJobs:EffectCommandSequences|undefined;
  private trackJobs=new Map<string,{totalSteps:number;completedSteps:number;terminal:boolean}>();
  private interruptTrackObservations():void {
    for(const [jobId,job] of this.trackJobs){
      if(!job.terminal)this.events.append({kind:'job',id:jobId,jobId,state:'unverified',completedSteps:job.completedSteps,totalSteps:job.totalSteps});
    }
    // A replacement panel cannot report completion for the previous panel's
    // job. Inspect its cached status/current host state; never replay it.
    this.trackJobs.clear();
  }
  private getEffectJobs(){
    if(!this.effectJobs){
      const executor=new HostExecutor({getStatus:()=>this.getStatus(),call:r=>this.callNative(r)},new AuditLog(runtimePaths.audit),new ReceiptStore(runtimePaths.idempotency),bridgeConfig.defaultTimeoutMs);
      const directory=path.join(path.dirname(this.tokenPath),'effect-jobs'),store=new EffectJobStore(directory);
      this.effectJobs=new EffectCommandSequences({events:this.events,
        execute:(command,args,id,read,readPurpose)=>read?executor.read(command,args,readPurpose?{readPurpose}:{}):executor.mutate(command,args,id),
        persist:job=>store.persist(job),recordPersistenceFailure:job=>store.recordFailure(job),load:id=>store.load(id)
      });
    }return this.effectJobs;
  }

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly tokenPath: string,
    credentialPath: string,
    options: BridgeOptions = {},
  ) {
    this.credentials = new PairingCredentialStore(credentialPath);
    this.executionEvidence=new ExecutionEvidenceStore(path.join(path.dirname(tokenPath),'idempotency.json'));
    this.allowNextLocalProject = options.allowNextLocalProject === true;
  }

  async start(): Promise<void> {
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    await this.credentials.load();

    this.server = new WebSocketServer({ host: this.host, port: this.port, maxPayload: maximumPanelMessageBytes });
    this.server.on('error',error=>this.logBridgeEvent('listener_error',{message:error.message}));
    this.server.on("connection", (socket, request) => this.accept(socket, request.socket.remoteAddress));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("listening", resolve);
      this.server?.once("error", reject);
    });
    // Publish the token only after this process owns the listener.
    await writeFile(this.tokenPath, this.token, { encoding: "utf8", mode: 0o600 });
  }

  status(): BridgeStatus {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN,
      connectedAt: this.connectedAt,
      authenticationMethod: this.authenticationMethod,
      projectKey: this.projectKey,
      host: this.host,
      port: this.port,
      tokenPath: this.tokenPath,
      localApprovalPending: this.allowNextLocalProject,
    };
  }

  async getStatus(): Promise<BridgeStatus> {
    return this.status();
  }

  armNextLocalProject(): void {
    this.allowNextLocalProject = true;
  }

  async call(request: BridgeRequest): Promise<BridgeResponse> {
    // Only the owner job adapter can attach this purpose via callNative.
    // External/control callers cannot turn targeted reads into hidden work.
    if(request.readPurpose!==undefined)throw Error('INTERNAL_READ_PURPOSE_FORBIDDEN');
    if(['submit_effect_command_sequence','get_effect_command_sequence_status','cancel_effect_command_sequence'].includes(request.command)){
      const started=performance.now(),jobs=this.getEffectJobs();let result;
      if(request.command==='submit_effect_command_sequence'){
        if(this.pending.size)throw Error('HOST_COMMAND_IN_FLIGHT: submit after the current command completes');
        result=await jobs.submit(String(request.args.operationId),request.args.sequence);
      }else if(request.command==='cancel_effect_command_sequence'){await jobs.inspect(String(request.args.jobId));result=jobs.cancel(String(request.args.jobId));}
      else result=await jobs.inspect(String(request.args.jobId),Number(request.args.cursor??0));
      return {version:1,id:request.id,ok:true,result,durationMs:performance.now()-started};
    }
    if(this.effectJobs?.busy)throw Error('EFFECT_SEQUENCE_BUSY: '+this.effectJobs.activeJobId+' owns Premiere; use cached status/events or cancel');
    return this.callNative(request);
  }

  private async callNative(request: BridgeRequest): Promise<BridgeResponse> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new PremiereDisconnectedError(undefined,'not_sent');
    if (this.pending.has(request.id)||this.lateEvidence.has(request.id)) throw new Error(`Command ${request.id} is already in flight or unverified`);
    const evidence=await this.executionEvidence.prepare(request);
    // Disk intent lookup yields: another caller/panel may have changed ownership.
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new PremiereDisconnectedError(undefined,'not_sent');
    if(this.pending.has(request.id)||this.lateEvidence.has(request.id))throw Error('HOST_COMMAND_IN_FLIGHT_OR_UNVERIFIED');
    if(evidence&&this.lateEvidence.size>=128)throw Error('EXECUTION_EVIDENCE_PENDING_LIMIT');
    if(request.command==='submit_track_command_sequence'&&Array.isArray(request.args.steps)&&request.args.steps.length>0&&request.args.steps.length<=256){
      this.trackJobs.set(request.id,{totalSteps:request.args.steps.length,completedSteps:0,terminal:false});
      while(this.trackJobs.size>8)this.trackJobs.delete(this.trackJobs.keys().next().value!);
    }

    const observe=!['get_track_command_sequence_status','get_effect_command_sequence_status'].includes(request.command);
    if(observe)this.events.append({kind:'command',id:request.id,command:request.command,state:'started'});
    try{
    const response=await new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        if(evidence)this.lateEvidence.set(request.id,evidence);
        reject(new BridgeTransportError(`Premiere command timed out after ${request.timeoutMs} ms: ${request.command}`,{code:'PANEL_COMMAND_TIMEOUT',dispatchState:'unknown'}));
      }, request.timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer, request, visibilityCalls:0,...(evidence?{evidence}:{}) });
      this.socket?.send(JSON.stringify(request), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(new BridgeTransportError(error.message,{code:'PANEL_SEND_FAILED',dispatchState:'unknown'},{cause:error}));
      });
    });
    if(observe)this.events.append({kind:'command',id:request.id,command:request.command,state:response.ok?String((response.result as {status?:unknown})?.status??'unverified'):'fail',durationMs:response.durationMs});
    return response;
    }catch(error){if(observe)this.events.append({kind:'command',id:request.id,command:request.command,state:'unverified'});throw error;}
  }

  async stop(): Promise<void> {
    this.interruptTrackObservations();
    this.events.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new PremiereDisconnectedError("Bridge server stopped"));
    }
    this.pending.clear();
    await Promise.allSettled(this.evidenceWrites);
    this.socket?.close();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  private accept(socket: WebSocket, remoteAddress: string | undefined): void {
    this.logBridgeEvent("connection_open", { remoteAddress: remoteAddress ?? "unknown" });
    const authTimer = setTimeout(() => socket.close(1008, "authentication timeout"), 5_000);
    // ws emits protocol/size errors on each accepted socket, not just on the
    // listener. Handle them before authentication so malformed peers cannot
    // terminate the owner daemon. Only this socket's pending work is rejected.
    socket.on('error',error=>{
      clearTimeout(authTimer);
      const code=(error as Error&{code?:string}).code;
      this.logBridgeEvent('connection_error',{code:code??'WEBSOCKET_ERROR',message:error.message,maximumPayloadBytes:maximumPanelMessageBytes,authenticated:this.socket===socket});
      this.disconnectSocket(socket,new BridgeTransportError(error.message,{code:code==='WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'?'PANEL_MESSAGE_TOO_LARGE':'PANEL_DISCONNECTED',dispatchState:'unknown'},{cause:error}));
      socket.terminate();
    });
    socket.once("message", (data) => {
      clearTimeout(authTimer);
      if(Buffer.byteLength(data.toString(),'utf8')>maximumAuthenticationBytes){socket.close(1009,'authentication message too large');return;}
      void this.authenticate(socket, data.toString(), remoteAddress).catch((error) => {
        this.logBridgeEvent("authentication_rejected", { reason: "credential_store_error", message: error instanceof Error ? error.message : String(error) });
        socket.close(1011, "credential store error");
      });
    });
    socket.once("close", (code, reason) => {
      clearTimeout(authTimer);
      this.logBridgeEvent("connection_close", { code, reason: reason.toString() });
    });
  }

  private async authenticate(socket: WebSocket, raw: string, remoteAddress: string | undefined): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch {
      this.logBridgeEvent("authentication_rejected", { reason: "invalid_json" });
      socket.close(1008, "invalid authentication message");
      return;
    }
    const parsed = bridgeAuthRequestSchema.safeParse(value);
    if (!parsed.success) {
      this.logBridgeEvent("authentication_rejected", { reason: "invalid_contract" });
      socket.close(1008, "invalid authentication message");
      return;
    }

    const request = parsed.data;
    let issuedCredential: string | undefined;
    if (request.method === "pairing_token") {
      if (!this.tokenMatches(request.token)) {
        this.logBridgeEvent("authentication_rejected", { reason: "token_mismatch", suppliedLength: request.token.length });
        socket.close(1008, "invalid pairing token");
        return;
      }
      issuedCredential = await this.credentials.issue(request.projectId);
    } else if (request.method === "project_credential") {
      if (this.credentials.verify(request.projectId, request.credential)) {
        // The credential is already project-scoped and remains valid across server restarts.
      } else {
        this.logBridgeEvent("authentication_rejected", { reason: "project_credential_mismatch", projectKey: this.publicProjectKey(request.projectId) });
        socket.close(1008, "invalid project credential");
        return;
      }
    } else if (!this.allowNextLocalProject || !this.isLoopback(remoteAddress)) {
      this.logBridgeEvent("authentication_rejected", { reason: "local_approval_not_active", projectKey: this.publicProjectKey(request.projectId) });
      socket.close(1008, "local approval not active");
      return;
    } else {
      issuedCredential = await this.credentials.issue(request.projectId);
      this.allowNextLocalProject = false;
    }

    if(socket.readyState!==WebSocket.OPEN)return;
    if(this.socket) {
      this.interruptTrackObservations();
      for(const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new PremiereDisconnectedError("Panel replaced while a command was running; inspect before retrying"));
      }
      this.pending.clear();
      this.lateEvidence.clear();
      this.socket.close(1012, "replaced by a new authenticated panel");
    }
    this.socket = socket;
    this.events.append({kind:'connection',id:this.events.sessionId,state:'connected'});
    this.connectedAt = new Date().toISOString();
    this.authenticationMethod = request.method;
    this.projectKey = this.publicProjectKey(request.projectId);
    this.logBridgeEvent("authentication_pass", { client: request.client, method: request.method, projectKey: this.projectKey, connectedAt: this.connectedAt });
    socket.send(JSON.stringify({
      version: 1,
      type: "authenticated",
      ok: true,
      projectId: request.projectId,
      credential: issuedCredential,
      credentialIssued: Boolean(issuedCredential),
      nativePanelProtocol: process.platform === "win32" ? 1 : undefined,
      programFrameProtocol: 1,
      nativeVisualProtocol: process.platform === "win32" ? 1 : undefined,
      projectSelectionProtocol: 1,
      effectDisclosureProtocol: 1,
      maskTrackingProtocol: process.platform === "win32" ? 1 : undefined,
      effectChainProofProtocol: 1,
      effectNativeSampleProtocol: process.platform === "win32" ? 1 : undefined,
      effectNativeTimeProtocol: process.platform === "win32" ? 2 : undefined,
    }));
    socket.on("message", (data) => { if(this.socket===socket)this.onMessage(data.toString()); });
    socket.on("close", () => this.disconnectSocket(socket,new PremiereDisconnectedError("Premiere panel disconnected while a command was running")));
  }

  private disconnectSocket(socket:WebSocket,error:BridgeTransportError):void{
    if(this.socket!==socket)return;
    this.interruptTrackObservations();
    this.events.append({kind:'connection',id:this.events.sessionId,state:'disconnected'});
    this.socket=undefined;this.authenticationMethod=undefined;this.projectKey=undefined;
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();this.lateEvidence.clear();
  }

  private tokenMatches(suppliedToken: string): boolean {
    const expected = Buffer.from(this.token, "utf8");
    const supplied = Buffer.from(suppliedToken, "utf8");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  }

  private isLoopback(remoteAddress: string | undefined): boolean {
    const normalized = remoteAddress?.toLocaleLowerCase("en-US");
    return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
  }

  private publicProjectKey(projectId: string): string {
    return createHash("sha256").update(projectId, "utf8").digest("hex").slice(0, 12);
  }

  private logBridgeEvent(event: string, details: Record<string, unknown>): void {
    process.stderr.write(`${JSON.stringify({ component: "uxp_bridge", event, ...details })}\n`);
  }

  private onMessage(raw: string): void {
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { return; }
    const message=value as Record<string,unknown>;
    if(message&&['native_effect_sample','native_effect_chain_proof','native_mask_archive','mask_tracking','effect_disclosure','project_selection'].includes(String(message.type))){
      const pending=this.pending.get(String(message.parentId));
      if(!pending)return;
      try{
        const target=assertEditTarget(message.editTarget,pending.request.args);
        if(pending.editTarget&&JSON.stringify(pending.editTarget)!==JSON.stringify(target))throw Error('COMMAND_EDIT_TARGET_CHANGED');
        pending.editTarget=target;
        return withEditTarget(target,()=>this.onScopedMessage(value));
      }catch(error){
        if(typeof message.id==='string')this.socket?.send(JSON.stringify({version:1,type:'native_visibility_result',id:message.id,result:{status:'fail',reason:String(error)}}));
        return;
      }
    }
    this.onScopedMessage(value);
  }

  private onScopedMessage(value:unknown):void {
    if(value&&typeof value==='object'&&(value as {type?:unknown}).type==='native_effect_sample'){
      const message=value as Record<string,unknown>,pending=this.pending.get(String(message.parentId)),socket=this.socket;
      if(!pending||typeof message.id!=='string'||message.id.length>200||pending.nativeSampleBusy||(pending.nativeSampleReads??0)>=16)return;
      const parsed=effectNativeSampleWorkSchema.safeParse(message.work);
      if(!parsed.success||!effectNativeSampleScopeMatches(pending.request.command,pending.request.args,parsed.data))return;
      pending.nativeSampleBusy=true;pending.nativeSampleReads=(pending.nativeSampleReads??0)+1;
      void requestEffectNativeSample(parsed.data).catch(error=>({status:'unverified',reason:String(error)})).then(result=>{
        pending.nativeSampleBusy=false;
        if(this.socket===socket&&this.pending.get(String(message.parentId))===pending)socket?.send(JSON.stringify({version:1,type:'native_visibility_result',id:message.id,result}));
      });return;
    }
    if(value&&typeof value==='object'&&(value as {type?:unknown}).type==='native_effect_chain_proof'){
      const message=value as Record<string,unknown>,pending=this.pending.get(String(message.parentId)),socket=this.socket;
      if(!pending||typeof message.id!=='string'||message.id.length>200||pending.effectChainArchiveBusy||(pending.effectChainArchiveReads??0)>=32)return;
      const parsed=effectChainProofWorkSchema.safeParse(message.work);
      if(!parsed.success||!effectChainProofScopeMatches(pending.request.command,pending.request.args,parsed.data))return;
      pending.effectChainArchiveBusy=true;pending.effectChainArchiveReads=(pending.effectChainArchiveReads??0)+1;
      void requestEffectChainProof(parsed.data).catch(error=>({status:'unverified',reason:String(error)})).then(result=>{
        pending.effectChainArchiveBusy=false;
        if(this.socket===socket&&this.pending.get(String(message.parentId))===pending)socket?.send(JSON.stringify({version:1,type:'native_visibility_result',id:message.id,result}));
      });return;
    }
    if(value&&typeof value==='object'&&(value as {type?:unknown}).type==='track_job_progress'){
      const parsed=trackProgressSchema.safeParse(value);if(!parsed.success)return;
      const e=parsed.data,known=this.trackJobs.get(e.jobId);
      if(!known||known.terminal||known.totalSteps!==e.totalSteps||e.completedSteps<known.completedSteps||e.completedSteps>e.totalSteps||e.state==='pass'&&e.completedSteps!==e.totalSteps)return;
      known.completedSteps=e.completedSteps;known.terminal=!['queued','running'].includes(e.state);
      this.events.append({kind:'job',id:e.jobId,jobId:e.jobId,state:e.state,completedSteps:e.completedSteps,totalSteps:e.totalSteps,durationMs:e.durationMs});return;
    }
    if(value&&typeof value==="object"&&(value as {type?:unknown}).type==="native_mask_archive"){
      const message=value as Record<string,unknown>,pending=this.pending.get(String(message.parentId)),socket=this.socket;
      if(!pending||pending.request.command!=="inspect_native_masks"||pending.maskArchiveRequested||typeof message.id!=="string"||message.id.length>200)return;
      const parsed=nativeMaskWorkSchema.safeParse(message.work);if(!parsed.success||!nativeMaskWorkMatches(pending.request.args,parsed.data))return;
      pending.maskArchiveRequested=true;
      void readMaskTrackingArchive(parsed.data).then(archive=>({status:"pass",archive} as Record<string,any>)).catch(error=>({status:"unverified",reason:String(error)})).then(result=>{
        if(this.socket===socket&&this.pending.get(String(message.parentId))===pending)socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));
      });return;
    }
    if(value&&typeof value==="object"&&(value as {type?:unknown}).type==="mask_tracking"){
      const message=value as Record<string,unknown>,pending=this.pending.get(String(message.parentId)),socket=this.socket;
      if(!pending||pending.request.command!=="track_object_mask_frames"||typeof message.id!=="string"||message.id.length>200)return;
      pending.maskTracking??=new MaskTrackingSession(pending.request.args);
      void pending.maskTracking.request(message.phase,message.step,message.work).then(result=>{
        if(result&&this.socket===socket&&this.pending.get(String(message.parentId))===pending)socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));
      });return;
    }
    if(value&&typeof value==="object"&&(value as {type?:unknown}).type==="effect_disclosure"){
      const message=value as Record<string,unknown>,pending=this.pending.get(String(message.parentId)),socket=this.socket;
      if(!pending||nativePanelForCommand(pending.request.command,pending.request.args)!=="effect_controls"||typeof message.id!=="string"||message.id.length>200)return;
      const query=isEffectValueQuery(pending.request.command,pending.request.args);
      const parsed=effectDisclosureWorkSchema.safeParse(message.work);if(!parsed.success||(!query||pending.request.args.expectedSequenceName!==undefined)&&parsed.data.sequenceName!==pending.request.args.expectedSequenceName)return;
      const target=parsed.data.target,args=pending.request.args;
      if((parsed.data.expanded!==false)!==(pending.request.command==="set_effect_disclosure"?args.expanded:true))return;
      if(query&&!effectQueryScopeProves(pending.request.command,args,parsed.data))return;
      const expectedMatch=["set_transform","scale_clip_to_fill"].includes(pending.request.command)?args.componentMatchName??"AE.ADBE Motion"
        :pending.request.command==="apply_video_effect"?args.matchName
        :args.componentMatchName??(Number.isInteger(args.componentIndex)?parsed.data.componentMatchNames[Number(args.componentIndex)]:undefined);
      if(expectedMatch&&target.componentMatchName!==expectedMatch)return;
      if(!query&&Number.isInteger(args.componentIndex)&&target.componentIndex!==undefined&&target.componentIndex!==args.componentIndex)return;
      if(!query&&(target.mediaType!==args.expectedMediaType||target.trackIndex!==args.expectedTrackIndex||(args.expectedClipName&&target.clipName!==args.expectedClipName)
        ||!Number.isFinite(args.expectedStartSeconds)||!Number.isFinite(args.expectedEndSeconds)
        ||Math.abs(Number(target.startTicks)/254016000000-Number(args.expectedStartSeconds))>1e-7||Math.abs(Number(target.endTicks)/254016000000-Number(args.expectedEndSeconds))>1e-7))return;
      const work=JSON.stringify(parsed.data),phase=message.phase;
      if(phase==="keyframes_readback"&&["get_effect_values","set_effect_keyframes","edit_effect_keyframes"].includes(pending.request.command)&&(pending.keyframeArchiveReads??0)<2){
        const {schemaTarget:_schema,...base}=parsed.data;void _schema;
        if(JSON.stringify(base)!==pending.effectDisclosureWork||!["inspected","verified","scrolled"].includes(pending.effectDisclosureStep??""))return;
        if(parsed.data.schemaTarget?.projectItemId!==args.expectedProjectItemId)return;
        pending.keyframeArchiveReads=(pending.keyframeArchiveReads??0)+1;
        void requestEffectDisclosure("keyframes_readback",parsed.data).catch(error=>({status:"unverified",reason:String(error)})).then(result=>{if(this.socket===socket&&this.pending.get(String(message.parentId))===pending)socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));});return;
      }
      if(phase==="metadata"&&!pending.effectMetadataRequested&&!pending.effectDisclosureStep){
        if(parsed.data.schemaTarget?.projectItemId!==args.expectedProjectItemId)return;
        pending.effectMetadataRequested=true;
        void requestEffectDisclosure("metadata",parsed.data).catch(error=>({status:"unverified",reason:String(error)})).then(result=>{if(this.socket===socket&&this.pending.get(String(message.parentId))===pending)socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));});return;
      }
      if(typeof phase==="string"&&phase.startsWith("parameter_")){
        const {parameter,...base}=parsed.data;
        if(!effectParameterScopeProves(args,parameter)||JSON.stringify(base)!==pending.effectDisclosureWork||!["inspected","verified","scrolled"].includes(pending.effectDisclosureStep??""))return;
        if(phase==='parameter_inspect'&&pending.parameterStep==='scrolled'&&pending.parameterRebindAllowed&&(pending.parameterRebinds??0)===0){
          delete pending.parameterStep;pending.parameterClears=0;pending.parameterRebindAllowed=false;pending.parameterRebinds=1;
        }
        const clear=phase==="parameter_clear_verify"&&["inspected","baseline"].includes(pending.parameterStep??"")&&(pending.parameterClears??0)<2;
        if(clear)pending.parameterClears=(pending.parameterClears??0)+1;
        const continuation=phase==='parameter_scroll'&&pending.parameterStep==='scrolled'&&pending.parameterScrollContinuationAllowed&&(pending.parameterScrollContinuations??0)===0;
        if(continuation){pending.parameterScrollContinuationAllowed=false;pending.parameterScrollContinuations=1;}
        const next=continuation?'scrolled':clear?pending.parameterStep:phase==="parameter_inspect"&&!pending.parameterStep?"inspected":phase==="parameter_baseline"&&pending.parameterStep==="inspected"?"baseline":phase==="parameter_verify"&&pending.parameterStep==="baseline"?"verified":phase==="parameter_scroll"&&["inspected","verified"].includes(pending.parameterStep??"")?"scrolled":undefined;
        if(!next)return;pending.parameterStep=next;
        void requestEffectDisclosure(phase as EffectDisclosurePhase,parsed.data,pending.effectDisclosureSession).catch(error=>({status:"unverified",reason:String(error)} as Record<string,any>)).then(result=>{
          if(phase==='parameter_scroll'&&parameterRebindReason(parsed.data,result))pending.parameterRebindAllowed=true;
          if(phase==='parameter_scroll'&&parameterScrollCanContinue(result)&&(pending.parameterScrollContinuations??0)===0)pending.parameterScrollContinuationAllowed=true;
          if(this.socket===socket&&this.pending.get(String(message.parentId))===pending)socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));});return;
      }
      if(phase==="inspect"&&!pending.effectDisclosureStep){pending.effectDisclosureStep="inspecting";pending.effectDisclosureWork=work;pending.effectDisclosureSession={};if(["apply_video_effect","apply_audio_effect"].includes(pending.request.command))invalidateEffectDisclosureBindings();}
      else if(phase==="clear_verify"&&["inspected","calibration_read"].includes(pending.effectDisclosureStep??"")&&pending.effectDisclosureWork===work)pending.effectDisclosureStep=pending.effectDisclosureStep==="inspected"?"clearing":"final_clearing";
      else if(phase==="calibrate_write"&&pending.effectDisclosureStep==="cleared"&&pending.effectDisclosureWork===work)pending.effectDisclosureStep="calibrating";
      else if(phase==="calibrate_verify"&&pending.effectDisclosureStep==="calibrated"&&pending.effectDisclosureWork===work)pending.effectDisclosureStep="calibration_reading";
      else if(phase==="write"&&["cleared","final_cleared"].includes(pending.effectDisclosureStep??"")&&pending.effectDisclosureWork===work)pending.effectDisclosureStep="writing";
      else if(phase==="verify"&&pending.effectDisclosureStep==="written"&&pending.effectDisclosureWork===work)pending.effectDisclosureStep="verifying";
      else if(phase==="scroll"&&["inspected","verified"].includes(pending.effectDisclosureStep??"")&&pending.effectDisclosureWork===work)pending.effectDisclosureStep="scrolling";
      else return;
      void requestEffectDisclosure(phase,parsed.data,pending.effectDisclosureSession).catch(error=>({status:"unverified",reason:String(error)} as Record<string,any>)).then(result=>{
        if(phase==="inspect"&&result.layoutVerified===true)pending.effectDisclosureStep="inspected";
        if(phase==="clear_verify"&&result.status==="pass"&&result.empty===true)pending.effectDisclosureStep=pending.effectDisclosureStep==="clearing"?"cleared":"final_cleared";
        if(phase==="write")pending.effectDisclosureStep="written";
        if(phase==="calibrate_write"&&result.status==="pass")pending.effectDisclosureStep="calibrated";
        if(phase==="calibrate_verify"&&result.layoutVerified===true)pending.effectDisclosureStep="calibration_read";
        if(phase==="verify")pending.effectDisclosureStep="verified";
        if(phase==="scroll")pending.effectDisclosureStep="scrolled";
        if(this.socket===socket&&this.pending.has(String(message.parentId)))socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));
      });return;
    }
    if(value && typeof value === "object" && (value as {type?:unknown}).type === "native_visual") {
      const message=value as Record<string,unknown>, pending=this.pending.get(String(message.parentId)), socket=this.socket;
      const feature=pending?nativeVisualFeatureForCommand(pending.request.command,pending.request.args):undefined;
      if(!pending||!feature||pending.nativeVisualRequested||typeof message.id!=="string"||message.id.length>200)return;
      pending.nativeVisualRequested=true;
      // No action, context, process, pipe or credential is accepted from the callback.
      void requestNativeVisual(feature,pending.request.id).catch(error=>({status:"unverified",reason:String(error)})).then(result=>{
        if(this.socket===socket&&this.pending.has(String(message.parentId)))socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));
      });return;
    }
    if(value && typeof value === "object" && (value as {type?:unknown}).type === "project_selection") {
      const message = value as Record<string,unknown>, pending = this.pending.get(String(message.parentId)), socket = this.socket;
      if(!pending || !followsProjectItem(pending.request.command) || pending.projectSelectionRequested || typeof message.id !== "string" || message.id.length > 200)return;
      pending.projectSelectionRequested = true;
      void selectNativeProjectItem(message.target).then(result => {
        if(this.socket === socket && this.pending.has(String(message.parentId)))socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));
      });return;
    }
    if(value && typeof value==="object" && (value as {type?:unknown}).type==="program_frame_ready") {
      const message=value as Record<string,unknown>,pending=this.pending.get(String(message.parentId)),socket=this.socket;
      if(!pending||pending.request.command!=="capture_program_frame"||pending.frameRequested||typeof message.id!=="string")return;
      pending.frameRequested=true;
      // The file is supplied by the original server request, never by the panel callback.
      void waitForProgramFrame(String(pending.request.args.outputPath)).catch(error=>({status:"unverified",reason:String(error)})).then(result=>{
        if(this.socket===socket&&this.pending.has(String(message.parentId)))socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));
      });return;
    }
    if(value && typeof value==="object" && (value as {type?:unknown}).type==="native_visibility") {
      const message=value as Record<string,unknown>;
      const pending=this.pending.get(String(message.parentId));
      const panel=pending ? nativePanelForCommand(pending.request.command,pending.request.args) : undefined;
      const socket=this.socket;
      if(!pending||!panel||message.panel!==panel||pending.visibilityCalls>=2||typeof message.id!=="string"||typeof message.projectName!=="string"||typeof message.sequenceName!=="string"||message.projectName.length>500||message.sequenceName.length>500)return;
      pending.visibilityCalls++;
      void focusNativePanel(panel,message.projectName,message.sequenceName).then(result=>{
        if(this.socket===socket && this.pending.has(String(message.parentId)))socket?.send(JSON.stringify({version:1,type:"native_visibility_result",id:message.id,result}));
      });
      return;
    }
    const parsed = bridgeResponseSchema.safeParse(value);
    if (!parsed.success) return;
    const pending = this.pending.get(parsed.data.id);
    const evidence=pending?.evidence??this.lateEvidence.get(parsed.data.id);
    if (!pending&&!evidence) return;
    if(!pending&&evidence){this.lateEvidence.delete(parsed.data.id);this.persistExecution(evidence,parsed.data);return;}
    if(!pending)return;
    if(pending.request.command==="remove_effect"||["apply_video_effect","apply_audio_effect"].includes(pending.request.command)&&!pending.effectDisclosureStep)invalidateEffectDisclosureBindings();
    clearTimeout(pending.timer);
    this.pending.delete(parsed.data.id);
    if(evidence)this.persistExecution(evidence,parsed.data,pending);
    else pending.resolve(parsed.data);
  }
  private persistExecution(identity:ExecutionIdentity,response:BridgeResponse,pending?:Pending):void{
    const write=this.executionEvidence.complete(identity,response).then(()=>{pending?.resolve(response);},error=>{
      this.logBridgeEvent('execution_evidence_failed',{id:identity.id,message:String(error)});
      pending?.reject(Error('EXECUTION_EVIDENCE_NOT_DURABLE: '+String(error)));
    });
    this.evidenceWrites.add(write);void write.finally(()=>this.evidenceWrites.delete(write));
  }
}
