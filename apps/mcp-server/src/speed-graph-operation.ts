import {readActiveEditTarget} from "./active-edit-target.js";
import {readNativeArchiveFile,readNativeArchiveBytes} from './saved-native-archive.js';
import {observedContent as content} from './archive-effect-content.js';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {resolveEffectObservation,type EffectDisclosureWork} from '@premiere-uxp/contracts/effect-disclosure';
import type {HostExecutor} from './host-executor.js';
import {PROJECT_OPEN_TIMEOUT_MS} from './host-command-policy.js';
import type {PathPolicy} from './path-policy.js';
import {runtimePaths} from './config.js';
import {projectLifecyclePath} from './project-lifecycle-path.js';
import { assertLifecycleStillClosed, lifecyclePreflight, readLifecycleContext, verifiedProjectClose } from './project-lifecycle-preflight.js';
import {inspectSpeedGraph,patchSpeedGraph,inspectTransientSpeedGraph,materializeSpeedGraphView} from './speed-graph-archive.js';
import {readCurveChain} from './archive-effect-read.js';
import {runNativeEffectAdapter} from './native-effect-worker.js';
import {inspectPremiereMasks,type MaskArchiveTarget} from './premiere-mask-archive.js';
import {withoutDisclosureProperties} from './effect-tree-archive.js';
import {speedGraphObservationProves,speedGraphScopeProves,speedGraphDisplayName,speedGraphLabelProves} from './speed-graph-proof.js';
import {recoveryPin,ensureArchiveRecoveryProject,type ArchiveRecoveryHost} from './archive-recovery.js';
import {archiveDocument,type NativeArchiveSource} from './native-archive-document.js';

type Row=Record<string,any>;
type Args=Row&{expectedProjectId:string;expectedSequenceId:string;expectedSequenceName:string;expanded?:boolean|undefined};
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const pass=(v:Row)=>{if(v.status!=='pass')throw Error('SPEED_GRAPH_PHASE_UNVERIFIED: '+JSON.stringify(v));return v;};
const equal=(a:unknown,b:unknown,label:string)=>{if(!isDeepStrictEqual(a,b))throw Error('SPEED_GRAPH_'+label+'_CHANGED');};
function masks(xml:string,target:MaskArchiveTarget){return inspectPremiereMasks(withoutDisclosureProperties(xml),target).masks.map(m=>{const {objectId:_id,...value}=m;void _id;return value;});}
const archive=(file:string)=>readNativeArchiveFile(file,'SPEED_GRAPH_FILE_UNBOUNDED','gzip');
const archiveBytes=(file:string)=>readNativeArchiveBytes(file,'SPEED_GRAPH_FILE_UNBOUNDED');

/** Actual SDK samples supplement the default clip's unchanged saved source,
 * speed and bounds. They never infer an identity curve from absent time keys. */
async function sampleSpeedClock(host:HostExecutor,args:Args,chain:Row){
  const item=chain.item,start=Number(item.start.ticks)/254016000000,end=Number(item.end.ticks)/254016000000;
  const observations=[];
  for(const fraction of [0,.5,.9]){
    const timeSeconds=start+(end-start)*fraction,sequenceTicks=String(Math.round(timeSeconds*254016000000));
    const r=pass(await host.read('get_effect_values',{...args,componentIndex:0,componentMatchName:chain.components[0].matchName,detail:'effect',timeSeconds},{timeoutMs:PROJECT_OPEN_TIMEOUT_MS}) as Row);
    const proof=r.nativeTimeProof,sample=proof?.samples?.find((s:Row)=>s.sequenceTicks===sequenceTicks);
    if(proof?.status!=='pass'||proof.exactOnly!==true||proof.startTicks!==item.start.ticks||proof.endTicks!==item.end.ticks||!sample||!/^\d+$/.test(sample.nativeTicks)||!Number.isFinite(sample.rate))throw Error('SPEED_GRAPH_NATIVE_CLOCK_UNVERIFIED');
    equal(r.item,item,'CLOCK_TARGET');
    observations.push({sequenceTicks,nativeTicks:sample.nativeTicks,rate:sample.rate,clock:sample.evidence?.clock??null});
  }
  return observations;
}

/** The ordinary header command provides a causal native header binding. Speed
 * is the single disclosure in that exact intrinsic section, independent of its
 * location, preceding effects, hidden masks, or child indices after scrolling. */
export async function observeSpeedGraph(host:HostExecutor,args:Args,chain:Row){
  const receipt=pass(await host.mutate('set_effect_disclosure',{...args,componentMatchName:'BE.TimeRemapping',expanded:true}));
  const visibility=(receipt.hostResult as Row).visibility,readback=visibility?.effectExpansion?.readback;
  const item=chain.item;
  const work:EffectDisclosureWork={sequenceName:args.expectedSequenceName,componentMatchNames:chain.components.map((c:Row)=>c.matchName),target:{mediaType:'video',trackIndex:item.trackIndex,startTicks:item.start.ticks,endTicks:item.end.ticks,clipName:item.name,mediaPath:'',componentMatchName:'BE.TimeRemapping',disclosureScope:'match_name'},expanded:true};
  const bound=resolveEffectObservation(work,readback);
  if(visibility?.effectExpansion?.status!=='pass'||!bound)throw Error('SPEED_GRAPH_HEADER_UNVERIFIED');
  const expected={pid:readback.premierePid,panelHandle:readback.panelHandle,tab:readback.selectedClipTab,headerIndex:bound.index};
  const payload={pid:expected.pid,tab:expected.tab,hints:readback.hints,headerIndex:bound.index,ordinal:0,speedRow:true};
  const request=(scroll:boolean)=>runNativeEffectAdapter('parameter',[Buffer.from(JSON.stringify({...payload,scroll})).toString('base64')],18000);
  let observation=await request(false);
  if(!speedGraphScopeProves(observation,expected))throw Error('SPEED_GRAPH_NATIVE_ARROW_UNVERIFIED: '+JSON.stringify(observation));
  if(!speedGraphObservationProves(observation,expected))observation=await request(true);
  if(!speedGraphObservationProves(observation,expected))throw Error('SPEED_GRAPH_NATIVE_ARROW_UNVERIFIED: '+JSON.stringify(observation));
  const row=observation.rows[0];
  return {expanded:(row.state&8)!==0,displayName:speedGraphDisplayName(observation),scope:'speed_disclosure_and_initial_graph',headerBinding:readback.binding,native:observation};
}

/** Feature-specific UI lifecycle, held under mutateLocal's cross-client lease.
 * It never adds/changes time keys. A keyless default UI owner must disappear on
 * native save while its actual disclosure and original clocks survive. A dispatched
 * timeout remains UNVERIFIED; only a proven closed, never-reopened project gets
 * one recovery open. Every changed native state is freshly observed. */
export async function runSpeedGraph(host:HostExecutor,paths:PathPolicy,args:Args,operationId:string){
  const directory=path.join(runtimePaths.runtimeDirectory,'speed-graph-operations');await mkdir(directory,{recursive:true});
  const report:Row={operationId,route:'native_speed_graph_ui_property',phases:[],readReacquisitions:[]};
  const persist=()=>writeFile(path.join(directory,operationId+'.json'),JSON.stringify(report,null,2),{flush:true});
  let uncertain=false,closed=false,openDispatched=false,wrote=false,lifecycleStarted=false,file:string|undefined,lifecycle:Row|undefined;
  async function mutate(command:string,input:Row){
    uncertain=true;
    const receipt=command==='close_working_project'||command==='open_working_project'
      ?await host.mutateLifecycle(command,input)
      :await host.mutate(command,{...input,expectedProjectId:args.expectedProjectId,expectedProjectPath:file,expectedSequenceId:args.expectedSequenceId,expectedSequenceName:args.expectedSequenceName},undefined,{timeoutMs:PROJECT_OPEN_TIMEOUT_MS});
    report.phases.push({command,receipt});await persist();pass(receipt);uncertain=false;return receipt;
  }
  try{
    const pin=await readActiveEditTarget(host,args);report.editTarget=pin;await persist();
    if(pin.projectId!==args.expectedProjectId||pin.sequenceId!==args.expectedSequenceId||pin.sequenceName!==args.expectedSequenceName)throw Error('SPEED_GRAPH_DESIGNATED_TARGET_REQUIRED');
    file=projectLifecyclePath(paths,pin.projectPath,pin.sequenceName,pin.sequenceId,pin);
    lifecycle={projectPath:file,sequenceId:pin.sequenceId,sequenceName:pin.sequenceName,requireExclusiveProject:true};
    if(args.expanded!==undefined){const preflight=await lifecyclePreflight(host,pin);if(preflight){Object.assign(report,preflight.result,{status:'fail'});await persist();return {...preflight,result:report};}}
    const read=()=>readCurveChain(async()=>await host.read('get_effect_values',{...args,componentIndex:0,componentMatchName:undefined,detail:'chain'},{timeoutMs:PROJECT_OPEN_TIMEOUT_MS}) as Row,report.readReacquisitions);
    const before=pass(await read()),item=before.item;
    if(item.mediaType!=='video')throw Error('SPEED_GRAPH_VIDEO_REQUIRED');
    const target:MaskArchiveTarget={sequenceId:pin.sequenceId,trackIndex:item.trackIndex,startTicks:item.start.ticks,endTicks:item.end.ticks,projectItemId:item.projectItemId,clipName:item.name};
    report.recoveryBaseline={target,publicContent:content(before)};
    report.before=await observeSpeedGraph(host,args,before);await mutate('save_working_project',{});
    const initial=await archive(file);let owner:ReturnType<typeof inspectSpeedGraph>|undefined;
    try{owner=inspectSpeedGraph(initial.document,target);}catch(e){if(!String(e).includes('SPEED_GRAPH_OWNER_UNAVAILABLE'))throw e;report.ownerUnavailable=true;}
    report.owner=owner;report.ownerStorage=owner?'saved':'transient';await persist();
    if(args.expanded===undefined||report.before.expanded===args.expanded){
      if(!owner&&report.before.expanded&&!speedGraphLabelProves(report.before.native,report.before.displayName))throw Error('SPEED_GRAPH_VISIBLE_LABEL_UNVERIFIED');
      report.status='pass';report.changed=false;await persist();
      return {status:'pass' as const,result:report,changedFiles:[file],errors:[]};
    }
    const transient=owner?undefined:inspectTransientSpeedGraph(initial.document,target);
    const plan=(xml:NativeArchiveSource)=>owner?patchSpeedGraph(xml,target,owner.contentSha256,args.expanded!):materializeSpeedGraphView(xml,target,transient!.contentSha256,args.expanded!,report.before.displayName);
    report.ownerKind=owner?'saved_ramp':'transient_ui_only';report.transientBefore=transient;
    const initialMasks=masks(initial.xml,target);report.recoveryBaseline.masks=initialMasks;plan(initial.document);
    if(transient)report.clockBefore=await sampleSpeedClock(host,args,before);
    await persist();
    lifecycleStarted=true;const closeReceipt=await mutate('close_working_project',{...lifecycle,releaseEffectControls:true});
    report.closeVerification=verifiedProjectClose(closeReceipt,pin);closed=true;
    const final=await archive(file),patch=plan(final.document);
    equal(masks(final.xml,target),initialMasks,'CLOSE_MASKS');
    const backup=path.join(directory,operationId+'.before.prproj'),stage=path.join(directory,operationId+'.stage.prproj');
    const staged=gzipSync(Buffer.from(patch.xml));await writeFile(backup,final.bytes,{flag:'wx',flush:true});await writeFile(stage,staged,{flag:'wx',flush:true});report.stagedSha256=sha(staged);
    report.backup=backup;report.expectedAfter=patch.after;report.originalSha256=sha(final.bytes);await persist();
    // Revoke the old witness while obtaining fresh state, so an unknown or
    // reopened project cannot trigger the recovery-open path below.
    closed=false;assertLifecycleStillClosed(await readLifecycleContext(host));closed=true;
    if(sha(await archiveBytes(file))!==report.originalSha256)throw Error('SPEED_GRAPH_FILE_CHANGED');
    await rename(stage,file);wrote=true;report.archiveWritten=true;await persist();
    openDispatched=true;await mutate('open_working_project',lifecycle);closed=false;await mutate('save_working_project',{});
    const native=await archive(file);
    // Premiere may canonicalize false by dropping the default Boolean on its
    // next native save. Independent visible-arrow proof remains mandatory.
    if(owner){
      const actual=inspectSpeedGraph(native.document,target);
      equal(actual.contentSha256,owner.contentSha256,'TIME_CURVE');equal(actual.expanded??false,args.expanded,'NATIVE_DISCLOSURE');report.ownerAfter=actual;
    }else{
      const actual=inspectTransientSpeedGraph(native.document,target);
      equal(actual.contentSha256,transient!.contentSha256,'DEFAULT_CLIP_CONTENT');
      equal(actual.timeParameterCount,transient!.timeParameterCount,'TIME_PARAMETER_COUNT');equal(actual.timeRemappingCount,transient!.timeRemappingCount,'TIME_REMAPPING_COUNT');
      report.transientAfter=actual;report.emptyOwnerRemovedOnSave=true;
    }
    equal(masks(native.xml,target),initialMasks,'MASKS');
    const after=pass(await read());equal(content(after),content(before),'PUBLIC_CONTENT');
    if(transient){report.clockAfter=await sampleSpeedClock(host,args,after);equal(report.clockAfter,report.clockBefore,'NATIVE_CLOCK');}
    report.after=await observeSpeedGraph(host,args,after);equal(report.after.expanded,args.expanded,'ACTUAL_ARROW');
    equal(report.after.displayName,report.before.displayName,'DISPLAY_LANGUAGE');
    equal(report.after.native.rows[0].animationControl.state&8,report.before.native.rows[0].animationControl.state&8,'ANIMATION_STATE');
    if(transient&&args.expanded&&!speedGraphLabelProves(report.after.native,report.after.displayName))throw Error('SPEED_GRAPH_VISIBLE_LABEL_UNVERIFIED');
    report.contentPreserved=true;report.status='pass';report.changed=true;await persist();
    return {status:'pass' as const,result:report,changedFiles:[file,backup],errors:[]};
  }catch(e){
    report.error=String(e);report.status=uncertain||wrote||lifecycleStarted||/unverified|timeout|timed out|disconnect/i.test(report.error)?'unverified':'fail';
    if(closed&&!openDispatched&&!uncertain&&lifecycle){openDispatched=true;try{report.recoveryOpen=await host.mutateLifecycle('open_working_project',lifecycle);}catch(error){report.recoveryError=String(error);}}
    report.recovery='Inspect current state and this journal. Never replay an unknown mutation or restore a backup over later edits.';await persist();
    return {status:report.status as 'unverified'|'fail',result:report,changedFiles:wrote&&file?[file]:[],errors:[String(e)]};
  }
}

/** Reconcile existing bytes and live state only; never calls the patcher. */
export async function reconcileSpeedGraph(host:ArchiveRecoveryHost,input:Row,operationId:string){
 const args=input as Args,directory=path.join(runtimePaths.runtimeDirectory,'speed-graph-operations');
 const report=JSON.parse(await readFile(path.join(directory,operationId+'.json'),'utf8')),baseline=report.recoveryBaseline,pin=await recoveryPin(args,report.editTarget);
 if(report.operationId!==operationId||!baseline?.target||!baseline.publicContent||!baseline.masks)throw Error('RECOVERY_SPEED_BASELINE_UNAVAILABLE');
 const checkArchive=(source:NativeArchiveSource)=>{
  const xml=archiveDocument(source);
  equal(masks(xml.xml,baseline.target),baseline.masks,'RECOVERY_MASKS');
  if(report.owner){equal(inspectSpeedGraph(xml,baseline.target).contentSha256,report.owner.contentSha256,'RECOVERY_TIME_CURVE');}
  else {const current=inspectTransientSpeedGraph(xml,baseline.target),before=report.transientBefore;
   if(!before)throw Error('RECOVERY_DEFAULT_BASELINE_UNAVAILABLE');
   equal(current.contentSha256,before.contentSha256,'RECOVERY_DEFAULT_CONTENT');equal(current.timeParameterCount,before.timeParameterCount,'RECOVERY_PARAMETER_COUNT');equal(current.timeRemappingCount,before.timeRemappingCount,'RECOVERY_REMAP_COUNT');}
 };
 await ensureArchiveRecoveryProject(host,pin,directory,operationId,async()=>{
  const file=await archive(pin.projectPath);
  if(report.stagedSha256&&sha(file.bytes)===report.stagedSha256)return;
  checkArchive(file.document);
 });
 const read=()=>readCurveChain(async()=>await host.read('get_effect_values',{...args,componentIndex:0,componentMatchName:undefined,detail:'chain'},{timeoutMs:PROJECT_OPEN_TIMEOUT_MS}) as Row,[]);
 const current=pass(await read());equal(content(current),baseline.publicContent,'RECOVERY_PUBLIC_CONTENT');
 pass(await host.mutate('save_working_project',{expectedProjectId:args.expectedProjectId,expectedProjectPath:pin.projectPath,expectedSequenceId:args.expectedSequenceId,expectedSequenceName:args.expectedSequenceName}) as Row);
 checkArchive((await archive(pin.projectPath)).document);
 let clocks:unknown;
 if(!report.owner){if(!report.clockBefore)throw Error('RECOVERY_CLOCK_BASELINE_UNAVAILABLE');clocks=await sampleSpeedClock(host as unknown as HostExecutor,args,current);equal(clocks,report.clockBefore,'RECOVERY_CLOCK');}
 const observed=await observeSpeedGraph(host as unknown as HostExecutor,args,current);
 equal(content(pass(await read())),baseline.publicContent,'RECOVERY_FINAL_PUBLIC_CONTENT');
 equal(observed.native.rows[0].animationControl.state&8,report.before.native.rows[0].animationControl.state&8,'RECOVERY_ANIMATION_STATE');
 if(observed.expanded&&!speedGraphLabelProves(observed.native,observed.displayName))throw Error('RECOVERY_SPEED_LABEL_UNVERIFIED');
 return {status:'pass',outcome:observed.expanded===args.expanded?'requested_view_observed':'current_view_reconciled',contentPreserved:true,clocks,observed,contentReplayed:false};
}
