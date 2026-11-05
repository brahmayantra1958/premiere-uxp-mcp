import {readActiveEditTarget} from "./active-edit-target.js";
import {readNativeArchiveFile,readNativeArchiveBytes} from './saved-native-archive.js';
import {readCurveChain} from './archive-effect-read.js';
import {observedContent} from './archive-effect-content.js';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import type {HostExecutor} from './host-executor.js';
import {PROJECT_OPEN_TIMEOUT_MS} from './host-command-policy.js';
import type {PathPolicy} from './path-policy.js';
import {runtimePaths} from './config.js';
import {projectLifecyclePath} from './project-lifecycle-path.js';
import {inspectLumetriCurve,patchLumetriCurve,lumetriCurvePreservation,type LumetriCurveTarget} from './lumetri-curve-archive.js';
import {curveDigest,type RgbChannel,type CurvePoint} from './lumetri-curve-codec.js';
import {recoveryPin,ensureArchiveRecoveryProject,type ArchiveRecoveryHost} from './archive-recovery.js';
import type {NativeArchiveSource} from './native-archive-document.js';
import { assertLifecycleStillClosed, lifecyclePreflight, readLifecycleContext, verifiedProjectClose } from './project-lifecycle-preflight.js';

type Row=Record<string,any>;
export type CurveArgs=Row&{expectedProjectId:string;expectedSequenceId:string;expectedSequenceName:string;componentIndex:number;paramIndex:number;expectedDisplayName:string;expectedCurveSha256?:string;points?:CurvePoint[];curveKind?:'hue_saturation'|'rgb';channel?:RgbChannel};
const pass=(r:Row)=>{if(r.status!=='pass')throw Error('LUMETRI_CURVE_PHASE_UNVERIFIED: '+JSON.stringify(r));return r;};
function assertCurveVisible(value:Row){
  const visibility=value.visibility;
  if(visibility?.effectExpansion?.status!=='pass'||visibility?.parameterScroll?.status!=='pass'||visibility.parameterScroll.scope!=='exact_parameter'||visibility.parameterScroll.presentation!=='custom_graph_region')throw Error('LUMETRI_CURVE_VISIBILITY_UNVERIFIED');
}
const same=(a:unknown,b:unknown,label:string)=>{if(!isDeepStrictEqual(a,b))throw Error('LUMETRI_CURVE_'+label+'_CHANGED');};
const archive=(file:string)=>readNativeArchiveFile(file,'LUMETRI_CURVE_FILE_UNBOUNDED');
const archiveBytes=(file:string)=>readNativeArchiveBytes(file,'LUMETRI_CURVE_FILE_UNBOUNDED');
/** Effectful transaction adapter. Called inside mutateLocal's cross-client lease.
 * Typed curve data is written only while independently observed closed. Same
 * target reopen, fresh UXP state and a new host save prove native acceptance.
 * A timeout is never retried, and no blind backup restore overwrites live work. */
export async function runLumetriCurve(host:HostExecutor,paths:PathPolicy,args:CurveArgs,operationId:string){
  const report:Row={route:'typed_lumetri_curve_archive',phases:[],operationId};let uncertain=false,closed=false,lifecycleStarted=false,openDispatched=false,wrote=false,projectPath:string|undefined;
  const directory=path.join(runtimePaths.runtimeDirectory,'curve-operations'),journal=path.join(directory,operationId+'.json');
  await mkdir(directory,{recursive:true});
  const persist=()=>writeFile(journal,JSON.stringify(report,null,2),{flush:true});
  let lifecycle:Row|undefined;
  async function mutate(command:string,input:Row){
    uncertain=true;
    // A freshly reopened project may still be resolving media while save is
    // queued. Retain its one receipt through the same bounded lifecycle budget;
    // increasing the deadline adds no delay and never resends the mutation.
    const r=command==='open_working_project'||command==='close_working_project'?await host.mutateLifecycle(command,input):await host.mutate(command,{...input,expectedProjectId:args.expectedProjectId,expectedProjectPath:projectPath,expectedSequenceId:args.expectedSequenceId,expectedSequenceName:args.expectedSequenceName},undefined,{timeoutMs:PROJECT_OPEN_TIMEOUT_MS});
    report.phases.push({command,receipt:r});await persist();pass(r);uncertain=false;return r;
  }
  try{
    const pin=await readActiveEditTarget(host,args);report.editTarget=pin;await persist();
    if(pin.projectId!==args.expectedProjectId||pin.sequenceId!==args.expectedSequenceId||pin.sequenceName!==args.expectedSequenceName)throw Error('LUMETRI_CURVE_DESIGNATED_TARGET_REQUIRED');
    projectPath=projectLifecyclePath(paths,pin.projectPath,pin.sequenceName,pin.sequenceId,pin);
    lifecycle={projectPath,sequenceId:pin.sequenceId,sequenceName:pin.sequenceName,requireExclusiveProject:true};
    if(args.points!==undefined){const preflight=await lifecyclePreflight(host,pin);if(preflight){Object.assign(report,preflight.result,{status:'fail'});await persist();return {...preflight,result:report};}}
    const readArgs={...args,componentMatchName:'AE.ADBE Lumetri',detail:'chain'};
    report.readReacquisitions=[];
    const readChain=()=>readCurveChain(async()=>await host.read('get_effect_values',readArgs,{timeoutMs:PROJECT_OPEN_TIMEOUT_MS}) as Row,report.readReacquisitions);
    const before=pass(await readChain()),item=before.item,component=before.component;
    const target:LumetriCurveTarget={sequenceId:pin.sequenceId,mediaType:'video',trackIndex:item.trackIndex,startTicks:item.start.ticks,endTicks:item.end.ticks,projectItemId:item.projectItemId,clipName:item.name,componentIndex:args.componentIndex,componentMatchName:'AE.ADBE Lumetri',componentMatchNames:before.components.map((c:Row)=>c.matchName),parameterNames:component.params.map((p:Row)=>p.displayName),paramIndex:args.paramIndex,expectedDisplayName:args.expectedDisplayName};
    target.curveKind=args.curveKind;target.channel=args.channel;
    await mutate('save_working_project',{});
    const initial=await archive(projectPath),curve=inspectLumetriCurve(initial.document,target);
    report.before=curve;report.visibilityBefore=before.visibility;await persist();
    assertCurveVisible(before);
    if(args.points===undefined)return {status:'pass' as const,result:{...report,curve,visibility:before.visibility},changedFiles:[projectPath],errors:[]};
    if(!args.expectedCurveSha256)throw Error('LUMETRI_CURVE_EXPECTED_DIGEST_REQUIRED');
    // Plan before closing; guards reject stale/unsupported values with no edit.
    const planned=patchLumetriCurve(initial.document,target,args.expectedCurveSha256,args.points);
    report.recoveryBaseline={target,publicContent:observedContent(before),preservation:lumetriCurvePreservation(initial.document,target),beforeSha256:curve.sha256,afterSha256:planned.after.sha256};await persist();
    if(planned.after.sha256===curve.sha256)return {status:'pass' as const,result:{...report,curve,changed:false,visibility:before.visibility},changedFiles:[projectPath],errors:[]};
    // Release the old selected effect's native editor before closing. The
    // post-open guarded read reselects the exact target and proves its graph.
    lifecycleStarted=true;const closeReceipt=await mutate('close_working_project',{...lifecycle,releaseEffectControls:true});
    report.closeVerification=verifiedProjectClose(closeReceipt,pin);closed=true;
    const final=await archive(projectPath);
    same(lumetriCurvePreservation(final.document,target),lumetriCurvePreservation(initial.document,target),'CLOSE_CONTENT');
    const patch=patchLumetriCurve(final.document,target,args.expectedCurveSha256,args.points);
    const backup=path.join(directory,operationId+'.before.prproj'),stage=path.join(directory,operationId+'.stage.prproj');
    await writeFile(backup,final.bytes,{flag:'wx',flush:true});await writeFile(stage,gzipSync(Buffer.from(patch.xml)),{flag:'wx',flush:true});
    report.backup=backup;report.originalSha256=curveDigest(final.bytes);report.expectedAfter=patch.after;await persist();
    // A failed/newly-active fresh observation revokes the earlier close state;
    // the catch path must not reopen over a concurrent user's project.
    closed=false;assertLifecycleStillClosed(await readLifecycleContext(host));closed=true;
    if(curveDigest(await archiveBytes(projectPath))!==report.originalSha256)throw Error('LUMETRI_CURVE_FILE_CHANGED');
    await rename(stage,projectPath);wrote=true;report.archiveWritten=true;await persist();
    openDispatched=true;await mutate('open_working_project',lifecycle);closed=false;
    // Drain project reconstruction through the native save before requesting
    // CEP targeting or MSAA visibility. Those shorter feature deadlines cannot
    // be used as the project's load-readiness barrier.
    await mutate('save_working_project',{});
    const fresh=await archive(projectPath),nativeAfter=inspectLumetriCurve(fresh.document,target);
    same(nativeAfter.points,args.points,'NATIVE_POINTS');
    same(lumetriCurvePreservation(fresh.document,target),lumetriCurvePreservation(final.document,target),'OTHER_NATIVE_PARAMETERS');
    report.curve=nativeAfter;report.nativeAcceptance='fresh_host_save_after_reopen';report.otherNativeParametersPreserved=true;await persist();
    // Reopen may finish before media/UI reconstruction. The final native save
    // drains that work; reveal again only after it completes, without replaying
    // content. A visible graph before reopen cannot prove the final screen.
    const displayed=pass(await readChain());same(observedContent(displayed),observedContent(before),'FINAL_PUBLIC_CONTENT');report.publicContentPreserved=true;
    report.visibility=displayed.visibility;assertCurveVisible(displayed);report.status='pass';await persist();
    return {status:'pass' as const,result:report,changedFiles:[projectPath,backup],errors:[]};
  }catch(error){
    report.error=String(error);report.status=uncertain||wrote||lifecycleStarted?'unverified':'fail';
    // Only a definitely closed project whose reopen has never been dispatched
    // can be reopened here. Unknown host operations must be inspected first.
    if(closed&&!openDispatched&&!uncertain&&lifecycle){openDispatched=true;try{report.recoveryOpen=await host.mutateLifecycle('open_working_project',lifecycle);}catch(e){report.recoveryError=String(e);}}
    report.recovery='Inspect the journal and current project. Never replay an unknown operation or restore a whole backup over live edits.';await persist();
    return {status:report.status as 'unverified'|'fail',result:report,changedFiles:wrote&&projectPath?[projectPath]:[],errors:[String(error)]};
  }
}

export async function reconcileLumetriCurve(host:ArchiveRecoveryHost,input:Row,operationId:string){
 const args=input as CurveArgs,directory=path.join(runtimePaths.runtimeDirectory,'curve-operations');
 const report=JSON.parse(await readFile(path.join(directory,operationId+'.json'),'utf8')),baseline=report.recoveryBaseline,pin=await recoveryPin(args,report.editTarget);
 if(report.operationId!==operationId||!baseline?.target||!baseline.publicContent||!baseline.preservation)throw Error('RECOVERY_CURVE_BASELINE_UNAVAILABLE');
 const check=(xml:NativeArchiveSource)=>{
  same(lumetriCurvePreservation(xml,baseline.target),baseline.preservation,'RECOVERY_OTHER_PARAMETERS');
  const curve=inspectLumetriCurve(xml,baseline.target);
  if(curve.sha256!==baseline.beforeSha256&&curve.sha256!==baseline.afterSha256)throw Error('RECOVERY_CURVE_DIFFERENT_FROM_BEFORE_AND_EXPECTED');return curve;
 };
 await ensureArchiveRecoveryProject(host,pin,directory,operationId,async()=>{check((await archive(pin.projectPath)).document);});
 const current=pass(await readCurveChain(async()=>await host.read('get_effect_values',{...args,componentMatchName:'AE.ADBE Lumetri',detail:'chain'},{timeoutMs:PROJECT_OPEN_TIMEOUT_MS}) as Row,[]));
 same(observedContent(current),baseline.publicContent,'RECOVERY_PUBLIC_CONTENT');
 pass(await host.mutate('save_working_project',{expectedProjectId:args.expectedProjectId,expectedProjectPath:pin.projectPath,expectedSequenceId:args.expectedSequenceId,expectedSequenceName:args.expectedSequenceName}) as Row);
 const curve=check((await archive(pin.projectPath)).document);
 const displayed=pass(await readCurveChain(async()=>await host.read('get_effect_values',{...args,componentMatchName:'AE.ADBE Lumetri',detail:'chain'},{timeoutMs:PROJECT_OPEN_TIMEOUT_MS}) as Row,[]));assertCurveVisible(displayed);same(observedContent(displayed),baseline.publicContent,'RECOVERY_FINAL_PUBLIC_CONTENT');
 return {status:'pass',outcome:curve.sha256===baseline.afterSha256?'requested_curve_observed':'original_curve_observed',curve,otherContentPreserved:true,visibility:displayed.visibility,contentReplayed:false};
}
