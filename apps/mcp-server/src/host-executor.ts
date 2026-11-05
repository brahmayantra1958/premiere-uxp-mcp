import {hostResponseReceipt,type HostResult} from './host-operation-receipt.js';
import {contractReceipt} from './receipt-contract.js';
import {isJobPreservationRead,type BridgeReadPurpose} from '@premiere-uxp/contracts/read-purpose';
import {leaseOwner} from './receipt-store.js';
import {prepareHostMutation} from './host-mutation-plan.js';
import {assertFreshArtifacts,verifyCreatedFiles} from './operation-artifacts.js';
import { randomUUID } from "node:crypto";
import type { BridgeRequest, EditPlan, OperationReceipt } from "@premiere-uxp/contracts";
import { capabilitySetSchema, projectSnapshotSchema } from "@premiere-uxp/contracts";
import type { AuditLog, ReceiptStore } from "./audit.js";
import type { HostBridge } from "./bridge-port.js";
import { createOperationFingerprint, resolveOperationReplay } from "./operation-identity.js";
import { snapshotPremiereProjectTransitions, verifyTransitionArchiveMutation } from "./premiere-project-archive.js";
import { verifySavedRectangle } from "./premiere-graphic-archive.js";
import type { EditableRectangleMogrtSpec } from "./editable-rectangle-mogrt.js";
import {recoveryExecutionProof} from './mutation-recovery.js';
import {reconcileSpeedGraph} from './speed-graph-operation.js';
import {reconcileLumetriCurve} from './lumetri-curve-operation.js';
import {assessTrackRelocationRecovery,validateRelocationPlan} from './track-relocation-recovery.js';
import {isHostNotConnectedBeforeDispatch} from './host-dispatch-rejection.js';
import {transportFailure} from './bridge-transport.js';
import {assessRejectedTrackStateRecovery} from './track-state-recovery.js';
import {assessAudioEffectAddRecovery} from './effect-add-recovery.js';
import {assessPlacementRecovery} from './placement-recovery.js';
import {PROJECT_OPEN_TIMEOUT_MS,EFFECT_PROOF_TIMEOUT_MS,HOST_PLANNED_EFFECTS} from './host-command-policy.js';
export {PROJECT_OPEN_TIMEOUT_MS,EFFECT_PROOF_TIMEOUT_MS} from './host-command-policy.js';

/** Serialized mutation owner: lease, dispatch, postconditions and durable
 * receipts remain ordered here. Planning, file effects and pure receipt
 * projection have separate owners; none can release this execution's lease. */
export class HostExecutor {
  constructor(
    private readonly bridge: HostBridge,
    private readonly audit: AuditLog,
    private readonly receipts: ReceiptStore,
    private readonly defaultTimeoutMs: number,
  ) {}

  async inspectMutationRecovery(){
    const lease=await this.receipts.inspectRecovery();if(!lease)return {status:'pass',quarantined:false};
    const ids=lease.operations.filter(s=>s.kind==='host'&&s.dispatched).map(s=>s.commandId);
    let execution:unknown;try{execution=await this.read('inspect_command_execution',{commandIds:ids},{timeoutMs:5000});}catch(e){execution={status:'unverified',reason:String(e)};}
    return {status:'pass',quarantined:true,owner:leaseOwner(lease),lease,execution,receipt:await this.receipts.get(lease.commandId),recovery:'Wait if active; archive this exact inactive operation with archive_inactive_operation to allow new work. Reconciliation is optional. Do not replay the original edit.'};
  }
  async archiveInactiveMutation(commandId:string){
    return this.receipts.archiveInactive(commandId,async(lease,actions)=>{
      const ids=[...new Set([...lease.operations,...actions].filter(step=>step.kind==='host'&&step.dispatched).map(step=>step.commandId))];
      if(ids.length>128)throw Error('ARCHIVE_EXECUTION_SCOPE_TOO_LARGE');
      const observe=async()=>{
        const ledger=await this.read('inspect_command_execution',{commandIds:ids},{timeoutMs:5000}) as any;
        const activity=await this.read('inspect_host_activity',{}, {timeoutMs:5000}) as any;
        if(ledger.status!=='pass'||ledger.protocol!==1||typeof ledger.sessionId!=='string'||
          !Array.isArray(ledger.active)||ledger.active.length||!Array.isArray(ledger.commands)||ledger.commands.length!==ids.length||
          ledger.commands.some((c:any,i:number)=>c.id!==ids[i]||!['unknown','complete'].includes(c.state))||
          activity.status!=='pass'||activity.protocol!==1||!Array.isArray(activity.commands)||activity.commands.length||activity.activeJobId!==null)
          throw Error('ARCHIVE_HOST_STILL_ACTIVE');
        return {ledger,activity};
      };
      const before=await observe(),after=await observe();
      if(before.ledger.sessionId!==after.ledger.sessionId)throw Error('ARCHIVE_HOST_SESSION_CHANGED');
      return {inactive:true,sessionId:after.ledger.sessionId,commands:after.ledger.commands.map((c:any)=>({id:c.id,state:c.state})),
        originalExecution:'unverified',verification:'live_execution_ledger_and_host_queue_only',timelineInspected:false};
    });
  }
  async reconcileMutation(commandId:string){
    return this.receipts.reconcile(commandId,async(lease,recovery)=>{
      try{
        const root=lease.operations.find(s=>s.commandId===commandId);if(!root)throw Error('RECOVERY_INTENT_UNAVAILABLE');
        // Migrate an old over-conservative receipt only when the runtime's
        // exact pre-send rejection was already durably observed. This is a
        // negative dispatch proof, not a missing-response/empty-ledger inference.
        const prior=await this.receipts.get(commandId);
        if(root.kind==='host'&&root.command==='open_working_project'&&lease.operations.length===1&&recovery.actions.length===0&&prior?.status==='unverified'&&prior.command===root.command&&
          prior.requestFingerprint===createOperationFingerprint(root.command,root.args)&&prior.errors.length===1&&isHostNotConnectedBeforeDispatch(prior.errors[0]!))
          return {status:'pass',outcome:'verified_runtime_predispatch_rejection',contentDispatched:false,contentReplayed:false};
        const ids=lease.operations.filter(s=>s.kind==='host'&&s.dispatched).map(s=>s.commandId);
        const observed=await this.recoveryExecution(ids);
        // The read-only relocation verifier may resolve current content after a
        // process crash without fabricating a lost terminal host response.
        if(root.kind==='host'&&root.command==='move_clip_to_track'&&root.dispatched&&lease.operations.length===1&&recovery.actions.length===0&&
          observed.commands.length===1&&observed.commands[0].id===commandId&&observed.commands[0].state==='unknown'){
          const stored=await this.receipts.relocationPlan(commandId)??await this.audit.relocationPlanEvidence(commandId);
          if(!stored)throw Error('RECOVERY_RELOCATION_BASELINE_MISSING');
          const plan=validateRelocationPlan(stored,commandId,root.args);
          const context=await this.read('inspect_host_context') as any;
          if(!context.activeProject||!context.activeSequence||context.sequenceId!==root.args.expectedSequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          const current=await this.read('inspect_project',{expectedProjectId:context.projectId,expectedSequenceId:root.args.expectedSequenceId,expectedSequenceName:root.args.expectedSequenceName});
          const proof=assessTrackRelocationRecovery(plan,root.args,current);
          const finalContext=await this.read('inspect_host_context') as any;
          if(finalContext.projectId!==context.projectId||finalContext.sequenceId!==context.sequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          await this.recoveryExecution(ids);
          return {...proof,originalExecution:'unverified',verification:'current_full_content_against_durable_plan',contentReplayed:false};
        }
        if(root.kind==='host'&&root.command==='apply_audio_effect'&&root.dispatched&&lease.operations.length===1&&recovery.actions.length===0&&
          observed.commands.length===1&&observed.commands[0].id===commandId&&observed.commands[0].state==='unknown'){
          const args=root.args;
          const context=await this.read('inspect_host_context') as any;
          if(context.projectId!==args.expectedProjectId||context.sequenceId!==args.expectedSequenceId||context.sequenceName!==args.expectedSequenceName)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          const query=Object.fromEntries(Object.entries(args).filter(([key])=>key.startsWith('expected')&&key!=='expectedEffectState'||key==='trackItemId'));
          Object.assign(query,{componentIndex:0,componentMatchName:(args.expectedEffectState as any[])?.[0]?.matchName,detail:'chain'});
          const observe=async()=>{const r=await this.read('get_effect_values',query) as any;if(r.status!=='pass')throw Error('RECOVERY_EFFECT_READ_UNVERIFIED');return {items:[{...r.item,components:r.components}]};};
          const proof=assessAudioEffectAddRecovery(args,await observe());
          assessAudioEffectAddRecovery(args,await observe());
          const finalContext=await this.read('inspect_host_context') as any;
          if(finalContext.projectId!==context.projectId||finalContext.sequenceId!==context.sequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          await this.recoveryExecution(ids);
          return proof;
        }
        if(root.kind==='host'&&root.command==='place_clips'&&root.dispatched&&lease.operations.length===1&&recovery.actions.length===0&&
          observed.commands.length===1&&observed.commands[0].id===commandId&&observed.commands[0].state==='unknown'){
          const plan=await this.audit.relocationPlanEvidence(commandId);
          if(!plan?.baseSequenceId||!plan.workingSequenceName)throw Error('RECOVERY_PLACEMENT_BASELINE_MISSING');
          const placements=root.args.placements as any[];
          if(!Array.isArray(placements)||placements.length!==1)throw Error('RECOVERY_PLACEMENT_SCOPE_UNSUPPORTED');
          const creation=await this.audit.subclipCreationEvidence(placements[0].projectItemId,lease.startedAt);
          const context=await this.read('inspect_host_context') as any;
          if(!context.activeProject||context.sequenceId!==plan.baseSequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          const current=await this.read('inspect_project',{expectedProjectId:context.projectId,expectedSequenceId:plan.baseSequenceId,expectedSequenceName:plan.workingSequenceName});
          const proof=assessPlacementRecovery(plan,root.args,current,creation);
          const finalContext=await this.read('inspect_host_context') as any;
          if(finalContext.projectId!==context.projectId||finalContext.sequenceId!==context.sequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          await this.recoveryExecution(ids);
          return {...proof,originalExecution:'unverified',verification:'current_full_content_against_durable_placement_plan'};
        }
        const execution=recoveryExecutionProof(lease,observed);
        // focusWorkTarget resolves every clip before any navigation; this exact
        // terminal lookup rejection cannot have dispatched a content action.
        if(root.kind==='host'&&root.command==='focus_timeline'&&root.dispatched&&lease.operations.length===1&&recovery.actions.length===0&&execution.steps.length===1&&
          !execution.steps[0]!.response.ok&&execution.steps[0]!.response.error?.code==='TRACK_ITEM_NOT_FOUND'){
          const context=await this.read('inspect_host_context') as any;
          if(!root.args.expectedProjectId||!root.args.sequenceId||context.projectId!==root.args.expectedProjectId||context.sequenceId!==root.args.sequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          recoveryExecutionProof(lease,await this.recoveryExecution(ids));
          return {status:'pass',outcome:'verified_navigation_target_rejection',contentDispatched:false,contentReplayed:false,context};
        }

        if(root.kind==='host'&&root.command==='set_track_state'&&root.dispatched&&lease.operations.length===1&&recovery.actions.length===0&&execution.steps.length===1&&
          !execution.steps[0]!.response.ok&&execution.steps[0]!.response.error?.code==='DESIGNATED_SEQUENCE_MISMATCH'){
          const current=await this.read('inspect_designated_track_state') as any;
          const baseline=await this.audit.trackStateBaselineBefore(lease.startedAt,current.projectId,current.sequenceId);
          const proof=assessRejectedTrackStateRecovery(root.args,baseline,current);
          assessRejectedTrackStateRecovery(root.args,baseline,await this.read('inspect_designated_track_state'));
          recoveryExecutionProof(lease,await this.recoveryExecution(ids));
          return proof;
        }
        if(root.kind==='host'&&root.command==='submit_track_command_sequence'&&root.dispatched&&lease.operations.length===1&&recovery.actions.length===0){
          if(execution.steps.length!==1||!execution.steps[0]!.response.ok||execution.steps[0]!.response.result?.status!=='partial')throw Error('RECOVERY_TRACK_ACCEPTANCE_UNVERIFIED');
          const total=(root.args.steps as any[])?.length;if(!Number.isInteger(total)||total<1||total>256)throw Error('RECOVERY_TRACK_PLAN_UNVERIFIED');
          let cursor=0;const steps:any[]=[];let status:any;
          do{
            status=await this.read('get_track_command_sequence_status',{jobId:commandId,cursor});
            if(status.protocolVersion!==1||status.jobId!==commandId||status.state!=='pass'||status.completedSteps!==total||status.totalSteps!==total||
              status.preservation?.expectedState!=='pass'||status.preservation.errors?.length!==0||!Array.isArray(status.results)||status.nextCursor!==cursor+status.results.length||status.nextCursor>total||status.nextCursor<=cursor)throw Error('RECOVERY_TRACK_TERMINAL_UNVERIFIED');
            steps.push(...status.results);cursor=status.nextCursor;
          }while(status.hasMore);
          if(steps.length!==total||steps.some((step,index)=>step.index!==index||step.status!=='pass'||step.clipRef!==(root.args.steps as any[])[index].clipRef||step.destinationTrackIndex!==(root.args.steps as any[])[index].destinationTrackIndex))throw Error('RECOVERY_TRACK_STEPS_UNVERIFIED');
          const context=await this.read('inspect_host_context') as any;
          if(context.projectId!==root.args.expectedProjectId||context.sequenceId!==root.args.expectedSequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
          return {status:'pass',outcome:'verified_track_job_completion',jobId:commandId,completedSteps:total,preservation:status.preservation,context,contentReplayed:false};
        }
        if(recovery.actions.length){
          const previous=recoveryExecutionProof({...lease,operations:recovery.actions},await this.recoveryExecution(recovery.actions.map(s=>s.commandId)));
          if(previous.steps.some(s=>!s.response.ok||(s.response.result?.status!=='pass'&&!(s.step.command==='set_effect_disclosure'&&s.response.result?.hostResult?.contentChanged===false))))throw Error('RECOVERY_PREVIOUS_ACTION_UNVERIFIED');
        }
        // Feature-specific archive reconciliation may save/reveal the scoped
        // existing state or reopen its proven closed file. It cannot patch an
        // archive, restore a backup or dispatch any content edit.
        const recoveryHost={read:(command:string,args:Record<string,unknown>={},options={})=>command==='inspect_command_execution'?this.recoveryExecution(args.commandIds as string[]):this.read(command,args,options),
          mutate:async(command:string,args:Record<string,unknown>,id?:string)=>{
            if(!['set_effect_disclosure','save_working_project','open_working_project'].includes(command))throw Error('RECOVERY_ACTION_FORBIDDEN');
            const request=this.request(command,args,id,PROJECT_OPEN_TIMEOUT_MS);
            await recovery.record({commandId:request.id,command,args,kind:'host',state:'dispatched',dispatched:true});
            const response=await this.bridge.call(request);
            await this.audit.append({kind:'recovery-verification',commandId,command,args,response});
            if(!response.ok)throw Error('RECOVERY_ACTION_UNVERIFIED: '+response.error?.message);return response.result;
          }};
        if(root.kind==='local'&&/^(get|set)_speed_graph_disclosure$/.test(root.command))return await reconcileSpeedGraph(recoveryHost,root.args,commandId);
        if(root.kind==='local'&&/^(get|set)_lumetri_(rgb|hue_saturation)_curve$/.test(root.command))return await reconcileLumetriCurve(recoveryHost,root.args,commandId);
        if(root.kind!=='host'&&root.status!=='pass')throw Error('RECOVERY_LOCAL_POSTCONDITION_REQUIRED');
        if(!execution.steps.length&&root.dispatched)throw Error('RECOVERY_TERMINAL_EVIDENCE_REQUIRED');
        for(const {response} of execution.steps)if(!response.ok||response.result?.status!=='pass')throw Error('RECOVERY_TERMINAL_POSTCONDITION_UNVERIFIED');
        const context=await this.read('inspect_host_context') as any;
        if(!root.args.expectedProjectId||!root.args.expectedSequenceId||context.projectId!==root.args.expectedProjectId||context.sequenceId!==root.args.expectedSequenceId)throw Error('RECOVERY_CURRENT_TARGET_CHANGED');
        return {status:'pass',outcome:'late_verified_completion',execution,context};
      }catch(e){return {status:'unverified',reason:String(e)};}
    });
  }

  /** Accepted jobs keep the cross-client lease until terminal native proof.
   * Status is cached navigation-free host data; only its exact owner's PASS
   * may reconcile the lease, never a progress event or another client's job. */
  async trackSequenceStatus(args:{jobId:string;cursor:number}){
    const status=await this.read('get_track_command_sequence_status',args) as Record<string,any>;
    if(status.state==='pass'&&(await this.receipts.inspectRecovery())?.commandId===args.jobId)return {...status,mutationRecovery:await this.reconcileMutation(args.jobId)};
    return status;
  }

  private async recoveryExecution(ids:string[]):Promise<Record<string,any>>{
    const current=await this.read('inspect_command_execution',{commandIds:ids},{timeoutMs:5000}) as any;
    if(current.status!=='pass'||current.protocol!==1||!Array.isArray(current.active)||current.active.length||!Array.isArray(current.commands))throw Error('RECOVERY_HOST_NOT_QUIESCENT');
    const unknown=current.commands.filter((c:any)=>c.state==='unknown').map((c:any)=>c.id);
    if(!unknown.length)return current;
    const durable=await this.receipts.executionEvidence.find(unknown);
    const remaining=unknown.filter((id:string)=>!durable.some(h=>h.id===id));
    const historical=[...durable,...(remaining.length?await this.audit.terminalExecutionEvidence(remaining):[])];
    return {...current,commands:current.commands.map((c:any)=>c.state==='unknown'?(historical.find(h=>h.id===c.id)??c):c)};
  }

  async read(command: string, args: Record<string, unknown> = {}, options:{timeoutMs?:number;readPurpose?:BridgeReadPurpose}={}): Promise<unknown> {
    if(options.readPurpose!==undefined&&!isJobPreservationRead(command,options.readPurpose))throw Error('INVALID_INTERNAL_READ_PURPOSE');
    const request = {...this.request(command, args,undefined,options.timeoutMs),...(options.readPurpose?{readPurpose:options.readPurpose}:{})};
    const startedAt = new Date().toISOString();
    try {
      const response = await this.bridge.call(request);
      const completedAt = new Date().toISOString();
      await this.audit.append({ kind: "read", request, response, startedAt, completedAt });
      if (!response.ok) throw Object.assign(new Error(`${response.error?.code ?? "HOST_ERROR"}: ${response.error?.message ?? "Unknown Premiere error"}`), {details:response.error?.details});
      if (command === "get_capabilities") return capabilitySetSchema.parse(response.result);
      if (command === "inspect_project") return {...projectSnapshotSchema.parse(response.result), ...((response.result as any)?.actualTarget ? {actualTarget:(response.result as any).actualTarget}:{})};
      return response.result;
    } catch (error) {
      await this.audit.append({ kind: "read-error", request, error: error instanceof Error ? error.message : String(error), startedAt, completedAt: new Date().toISOString() });
      throw error;
    }
  }

  async mutate(
    command: string,
    args: Record<string, unknown>,
    requestedId?: string,
    options: { lifecycleWithoutActiveProject?: boolean; timeoutMs?: number } = {},
  ): Promise<OperationReceipt> {
    const id = requestedId || randomUUID();
    const prior = await this.receipts.get(id);
    if (prior) return resolveOperationReplay(prior, command, createOperationFingerprint(command, args), new Date().toISOString());
    return this.receipts.runExclusive(id, () => this.performMutation(command, args, id, options));
  }

  private async performMutation(
    command: string, args: Record<string, unknown>, commandId: string,
    options: { lifecycleWithoutActiveProject?: boolean; timeoutMs?: number },
  ): Promise<OperationReceipt> {
    const fingerprint = createOperationFingerprint(command, args);
    const prior = await this.receipts.get(commandId);
    if (prior) return resolveOperationReplay(prior, command, fingerprint, new Date().toISOString());

    const startedAt = new Date().toISOString();
    const request = this.request(command, args, commandId, options.timeoutMs);
    const startedMs = performance.now();
    let plannedMs = startedMs, bridgeMs = 0;
    let receipt: OperationReceipt;
    let plan: EditPlan | undefined;
    let dispatched=false;
    let rootRejectedBeforeSend=false;
    try {
      await this.receipts.intent(commandId,command,args,'host');
      assertFreshArtifacts(args);
      plan = await prepareHostMutation(command,args,commandId,options.lifecycleWithoutActiveProject,this.read.bind(this),this.audit);
      if(command==='move_clip_to_track'&&plan)await this.receipts.saveRelocationPlan(commandId,plan);
      const transitionCommand = command === "apply_transition" || command === "remove_transition" ? command : undefined;
      const transitionProjectPath = transitionCommand ? plan?.workingProjectPath : undefined;
      let transitionBefore;
      if (transitionCommand) {
        if (!transitionProjectPath) throw new Error("Transition archive verification requires a saved local working project");
        await this.persistProjectForTransitionVerification();
        transitionBefore = await snapshotPremiereProjectTransitions(transitionProjectPath);
      }
      plannedMs = performance.now();
      await this.receipts.dispatched(commandId);dispatched=true;
      let response;
      try{response=await this.bridge.call(request);}
      catch(error){rootRejectedBeforeSend=transportFailure(error)?.dispatchState==='not_sent'||isHostNotConnectedBeforeDispatch(error instanceof Error?error.message:String(error));throw error;}
      bridgeMs = performance.now() - plannedMs;
      let result = (response.result ?? {}) as HostResult;
      if(response.ok && command==="insert_editable_graphic" && args.expectedGraphicKind==="rectangle"
        && (result.hostResult as any)?.shapeVerification==="requires_saved_archive_readback" && result.status==="unverified") {
        const detail=result.hostResult as any, item=detail.insertedItem;
        try {
          if(!plan?.workingProjectPath || !item) throw Error("Rectangle verification lacks exact project/item evidence");
          await this.persistProjectForTransitionVerification();
          const proof=await verifySavedRectangle(plan.workingProjectPath,{sequenceId:String(args.expectedSequenceId),trackIndex:item.trackIndex,startTicks:item.start.ticks,endTicks:item.end.ticks},args.expectedShapeState as EditableRectangleMogrtSpec);
          if(proof.status!=="pass") throw Error(proof.errors.join("; "));
          result={...result,status:"pass",errors:[],hostResult:{...detail,shapeVerification:"pass",archiveVerification:proof},changedFiles:[plan.workingProjectPath]};
        } catch(error) {
          // Saved native shape data is part of the postcondition. A failed
          // proof cannot leave a nominally successful, partially checked clip.
          const rollback=await this.bridge.call(this.request("remove_clips",{expectedProjectId:args.expectedProjectId,expectedSequenceId:args.expectedSequenceId,expectedSequenceName:args.expectedSequenceName,ripple:false,
            targets:[{trackItemId:item.id,expectedProjectItemId:item.projectItemId,expectedClipName:item.name,expectedMediaType:"video",expectedTrackIndex:item.trackIndex,expectedStartSeconds:item.start.seconds,expectedEndSeconds:item.end.seconds}]}));
          const recovered=rollback.ok && (rollback.result as HostResult)?.status==="pass";
          if(recovered) await this.persistProjectForTransitionVerification();
          result={...result,status:recovered?"fail":"unverified",errors:[String(error)],hostResult:{...detail,shapeVerification:"fail",archiveRollback:{verified:recovered,result:rollback.result}},recovery:recovered?"Inserted graphic removed and project saved after archive verification failed":"Inspect exact timeline before saving or retrying"};
        }
      }
      if (response.ok && transitionCommand && transitionProjectPath && transitionBefore) {
        await this.persistProjectForTransitionVerification();
        const transitionAfter = await snapshotPremiereProjectTransitions(transitionProjectPath);
        const verification = verifyTransitionArchiveMutation({
          command: transitionCommand,
          args,
          hostBefore: result.before,
          before: transitionBefore,
          after: transitionAfter,
        });
        const rawHostResult = result.hostResult ?? result;
        result = {
          ...result,
          status: verification.status,
          hostResult: { host: rawHostResult, archiveVerification: verification.report },
          after: { host: result.after, archiveVerification: verification.report },
          changedFiles: [...new Set([...(result.changedFiles ?? []), transitionProjectPath])],
          errors: verification.errors,
        };
      }
      receipt = hostResponseReceipt(response,result,{commandId,command,requestFingerprint:fingerprint,startedAt,completedAt:new Date().toISOString()});
      if(response.ok)receipt = await verifyCreatedFiles(receipt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transport=transportFailure(error);
      // A later save/rollback can be rejected before its own send even though
      // the original mutation already ran. Only the root call's rejection (or
      // an undispatched planning failure) proves this operation did not run.
      const rejectedBeforeSend=rootRejectedBeforeSend||!dispatched&&isHostNotConnectedBeforeDispatch(message);
      if(rejectedBeforeSend)dispatched=false;
      const indeterminate = !rejectedBeforeSend&&(dispatched || !transport&&/timed out|disconnected while a command was running/i.test(message));
      receipt = {
        commandId,
        command,
        requestFingerprint: fingerprint,
        status: indeterminate ? "unverified" : "fail",
        retryable:rejectedBeforeSend,
        errorClassification:indeterminate?'postcondition':rejectedBeforeSend||transport?'host_transient':'preflight',
        changedFiles: [],
        ...(!indeterminate?{hostResult:{contentDispatched:false,...(transport?{transport,dispatchRejection:rootRejectedBeforeSend?'transport_not_sent':'planning_transport_failure'}:rejectedBeforeSend?{dispatchRejection:'panel_not_connected'}:{})}}:transport?{hostResult:{transport}}:{}),
        errors: [message],
        recovery: indeterminate
          ? "Do not repeat the mutation. Wait for active execution; archive this exact inactive operation with archive_inactive_operation to allow new requests while keeping this receipt unchanged. Use reconcile_mutation only to adjudicate the old result."
          : "Inspect the UXP panel activity log and retry only after the cause is corrected.",
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    if (HOST_PLANNED_EFFECTS.has(command)) receipt.hostResult = {
      ...(receipt.hostResult && typeof receipt.hostResult === "object" ? receipt.hostResult : { result: receipt.hostResult }),
      serverTimingsMs: { planning: plannedMs - startedMs, bridge: bridgeMs, total: performance.now() - startedMs },
    };
    const valid = contractReceipt(receipt, dispatched);
    if(dispatched&&command==='submit_track_command_sequence'&&valid.status==='partial')await this.receipts.quarantine('Accepted track job requires terminal proof: '+commandId);
    const splitRollback=command==='split_clips'&&(valid.hostResult as any)?.rollbackVerified===true&&(valid.hostResult as any)?.rollback?.errors?.length===0&&(valid.hostResult as any)?.rollback?.removalResult===true&&(valid.hostResult as any)?.rollback?.restoreResult===true;
    if(dispatched&&valid.status==='fail'&&(valid.hostResult as any)?.contentDispatched!==false&&!splitRollback)await this.receipts.quarantine('Failed post-dispatch proof: '+commandId);
    await this.receipts.set(valid);
    await this.audit.append({ kind: "mutation", request, receipt: valid });
    return valid;
  }

  async mutateLifecycle(
    command: "close_working_project" | "open_working_project",
    args: Record<string, unknown>,
    requestedId?: string,
  ): Promise<OperationReceipt> {
    return this.mutate(command, args, requestedId, {
      lifecycleWithoutActiveProject: true,
      timeoutMs: command === "open_working_project"
        ? Math.max(this.defaultTimeoutMs, PROJECT_OPEN_TIMEOUT_MS)
        : this.defaultTimeoutMs,
    });
  }

  async mutateLocal(
    command: string,
    args: Record<string, unknown>,
    action: () => Promise<{ status: OperationReceipt["status"]; result: unknown; changedFiles?: string[]; errors?: string[] }>,
    requestedId?: string,
  ): Promise<OperationReceipt> {
    const id = requestedId || randomUUID();
    const prior = await this.receipts.get(id);
    if (prior) return resolveOperationReplay(prior, command, createOperationFingerprint(command, args), new Date().toISOString());
    return this.receipts.runExclusive(id, () => this.performLocalMutation(command, args, action, id));
  }

  private async performLocalMutation(
    command: string, args: Record<string, unknown>,
    action: () => Promise<{ status: OperationReceipt["status"]; result: unknown; changedFiles?: string[]; errors?: string[] }>,
    commandId: string,
  ): Promise<OperationReceipt> {
    const fingerprint = createOperationFingerprint(command, args);
    const prior = await this.receipts.get(commandId);
    if (prior) return resolveOperationReplay(prior, command, fingerprint, new Date().toISOString());
    const startedAt = new Date().toISOString();
    await this.receipts.intent(commandId,command,args,'local');
    await this.audit.append({
      kind: "local-plan",
      commandId,
      plan: { command, args, expectedChange: `Create verified local artifact for ${command}`, preconditions: ["Input is authorized for read", "Output is authorized for local write"] },
      createdAt: startedAt,
    });
    let receipt: OperationReceipt;
    let dispatched=false;
    try {
      assertFreshArtifacts(args);
      await this.receipts.dispatched(commandId);dispatched=true;
      const outcome = await action();
      receipt = {
        commandId,
        command,
        requestFingerprint: fingerprint,
        status: outcome.status,
        hostResult: outcome.result,
        changedFiles: outcome.changedFiles ?? [],
        errors: outcome.errors ?? [],
        startedAt,
        completedAt: new Date().toISOString(),
      };
      receipt = await verifyCreatedFiles(receipt);
    } catch (error) {
      receipt = {
        commandId,
        command,
        requestFingerprint: fingerprint,
        status: dispatched?'unverified':"fail",
        changedFiles: [],
        errors: [error instanceof Error ? error.message : String(error)],
        recovery: dispatched?"Local action may have run. Inspect recovery; never repeat an unknown project lifecycle or restore over newer edits.":"Correct the authorized input/output paths before another operation.",
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    const valid = contractReceipt(receipt, dispatched);
    if(dispatched&&valid.status==='fail'&&(valid.hostResult as any)?.contentDispatched!==false)await this.receipts.quarantine('Failed local postcondition: '+commandId);
    await this.receipts.set(valid);
    await this.audit.append({ kind: "local-mutation", commandId, args, receipt: valid });
    return valid;
  }

  private async persistProjectForTransitionVerification(): Promise<void> {
    const response = await this.bridge.call(this.request("save_working_project", {}));
    const result = (response.result ?? {}) as HostResult;
    if (!response.ok || result.status !== "pass") {
      throw new Error(`Premiere project could not be saved for transition verification: ${response.error?.message ?? result.errors?.join("; ") ?? "unknown error"}`);
    }
  }

  private request(command: string, args: Record<string, unknown>, id: string = randomUUID(), timeoutMs = this.defaultTimeoutMs): BridgeRequest {
    // Source-track cloning can commit and prove the whole timeline per item.
    // The bounded 16..115s floor never lowers a larger configured/internal budget.
    if(command==='clone_clips'&&Array.isArray(args.clones)&&args.clones.length>=1&&args.clones.length<=100)
      timeoutMs=Math.max(timeoutMs,15_000+args.clones.length*1_000);
    const effectProof=HOST_PLANNED_EFFECTS.has(command)||command==='get_effect_values'||command==='set_effect_disclosure';
    return { version: 1, id, command, args, timeoutMs:effectProof?Math.max(timeoutMs,EFFECT_PROOF_TIMEOUT_MS):timeoutMs };
  }
}
