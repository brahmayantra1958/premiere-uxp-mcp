/** A job sequences verified steps but is not an atomic transaction across all steps. Cancellation/restart cannot imply rollback or replay; terminal preservation proof is separate from event delivery. */
import {z} from 'zod/v4';
import {randomUUID} from 'node:crypto';
import {exactEffectTarget,effectParameters,effectKeyframes,effectKeyframeEdits,effectDependencies,index,seconds} from './tool-inputs.js';
import {effectStateProjection} from '@premiere-uxp/contracts/effect-state';
import {JOB_PRESERVATION_READ,type BridgeReadPurpose} from '@premiere-uxp/contracts/read-purpose';
import {createOperationFingerprint} from './operation-identity.js';
import type {RuntimeEvents} from './runtime-events.js';

const ref=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const selected={effectRef:ref};
export const effectCommandSequenceSchema=z.object({protocolVersion:z.literal(1),
  clips:z.array(z.object({...exactEffectTarget,ref}).strict()).min(1).max(20),
  effects:z.array(z.object({ref,clipRef:ref,componentIndex:index,componentMatchName:z.string().min(1)}).strict()).max(64).default([]),
  steps:z.array(z.discriminatedUnion('op',[
    z.object({op:z.literal('add_video'),clipRef:ref,effectRef:ref,matchName:z.string().min(1),insertionIndex:index.optional(),initialParameters:effectParameters.optional()}).strict(),
    z.object({op:z.literal('add_audio'),clipRef:ref,effectRef:ref,displayName:z.string().min(1),insertionIndex:index.optional(),initialParameters:effectParameters.optional()}).strict(),
    z.object({op:z.literal('read'),...selected,paramIndex:index.optional(),expectedDisplayName:z.string().optional(),detail:z.enum(['effect','parameter']).default('effect'),timeSeconds:seconds.optional()}).strict(),
    z.object({op:z.literal('set_values'),...selected,parameters:effectParameters,preserveEmptyAnimation:z.boolean().default(false),dependencies:effectDependencies.optional(),expectedDerivedParameters:effectParameters.optional()}).strict(),
    z.object({op:z.literal('set_keys'),...selected,keyframes:effectKeyframes}).strict(),
    z.object({op:z.literal('edit_keys'),...selected,operations:effectKeyframeEdits,disableAnimationWhenEmpty:z.boolean().default(false)}).strict(),
    z.object({op:z.literal('remove'),...selected}).strict(),
    z.object({op:z.literal('disclosure'),...selected,expanded:z.boolean()}).strict(),
  ])).min(1).max(256),maxRunMs:z.number().int().min(1000).max(900000).default(240000)
}).strict();
export type EffectSequence=z.output<typeof effectCommandSequenceSchema>;
type Binding={clipRef:string;componentIndex:number;componentMatchName:string};
const persistenceFailureSchema=z.object({phase:z.enum(['admission','running','step_intent','step_result','final']),at:z.iso.datetime(),message:z.string(),completedSteps:index.max(256),durableCompletedSteps:index.max(256),pendingDispatch:z.enum(['none','not_sent','unknown']),mainRecord:z.enum(['recorded','failed']),journal:z.enum(['recorded','failed','unavailable']),journalError:z.string().optional(),finalError:z.string().optional()}).strict();
type PersistencePhase=z.infer<typeof persistenceFailureSchema>['phase'];
type Job={id:string;fingerprint:string;plan:EffectSequence;state:'queued'|'running'|'pass'|'fail'|'unverified'|'cancelled';completedSteps:number;results:any[];pendingStep?:{index:number;commandId:string;command:string;dispatchState?:'not_sent'|'unknown'};cancelRequested:boolean;elapsedMs:number;error?:string;preservation?:{expectedState:'pass'|'unverified';errors:string[]};persistenceFailure?:z.infer<typeof persistenceFailureSchema>;acceptedAt:string;completedAt?:string};
export type EffectSequenceJob=Job;
type Services={execute:(command:string,args:Record<string,unknown>,id:string,read:boolean,readPurpose?:BridgeReadPurpose)=>Promise<any>;persist:(job:Job)=>Promise<void>;recordPersistenceFailure?:(job:Job)=>Promise<void>;load?:(id:string)=>Promise<unknown>;events:RuntimeEvents};

const savedJobSchema=z.object({id:z.string().uuid(),fingerprint:z.string(),plan:effectCommandSequenceSchema,
  state:z.enum(['queued','running','pass','fail','unverified','cancelled']),completedSteps:index.max(256),
  results:z.array(z.record(z.string(),z.unknown())).max(256),
  pendingStep:z.object({index:index.max(255),commandId:z.string().uuid(),command:z.string(),dispatchState:z.enum(['not_sent','unknown']).optional()}).strict().optional(),
  cancelRequested:z.boolean(),elapsedMs:z.number().finite().nonnegative(),error:z.string().optional(),
  preservation:z.object({expectedState:z.enum(['pass','unverified']),errors:z.array(z.string())}).strict().optional(),
  persistenceFailure:persistenceFailureSchema.optional(),
  acceptedAt:z.iso.datetime(),completedAt:z.iso.datetime().optional()
}).strict();

/** Durable records are observations, never resumable executable state. A
 * damaged record must not become an unknown ID that silently admits a replay. */
function savedJob(value:unknown,id:string):Job {
  const record=savedJobSchema.parse(value);
  const plan=planEffectSequence(record.plan);
  if(record.id!==id||record.fingerprint!==createOperationFingerprint('effect_sequence',plan as any))throw Error('JOB_RECORD_IDENTITY_MISMATCH');
  if(record.completedSteps>plan.steps.length||record.completedSteps>record.results.length||record.results.length>plan.steps.length||record.state==='pass'&&(record.completedSteps!==plan.steps.length||record.preservation?.expectedState!=='pass'))throw Error('JOB_RECORD_PROOF_MISMATCH');
  return record as Job;
}

/** Validate symbolic dependencies without host access or executing a command. */
export function planEffectSequence(value:unknown):EffectSequence{
  const plan=effectCommandSequenceSchema.parse(value),clips=new Set<string>(),effects=new Set<string>();
  const first=plan.clips[0]!,used=new Set<string>();
  for(const clip of plan.clips){if(clips.has(clip.ref)||clip.expectedProjectId!==first.expectedProjectId||clip.expectedSequenceId!==first.expectedSequenceId||clip.expectedSequenceName!==first.expectedSequenceName)throw Error('SEQUENCE_CLIP_IDENTITY_MISMATCH');clips.add(clip.ref);}
  if(new Set(plan.clips.map(c=>c.trackItemId)).size!==plan.clips.length)throw Error('DUPLICATE_SEQUENCE_CLIP');
  const slots=new Set<string>();
  for(const effect of plan.effects){const slot=effect.clipRef+':'+effect.componentIndex;if(effects.has(effect.ref)||!clips.has(effect.clipRef)||slots.has(slot))throw Error('INVALID_EFFECT_BINDING');effects.add(effect.ref);used.add(effect.ref);slots.add(slot);}
  for(const step of plan.steps){
    if(step.op==='add_video'||step.op==='add_audio'){
      if(!clips.has(step.clipRef)||used.has(step.effectRef))throw Error('INVALID_CREATED_EFFECT_REF');
      const clip=plan.clips.find(c=>c.ref===step.clipRef)!;
      if(clip.expectedMediaType!==(step.op==='add_video'?'video':'audio'))throw Error('EFFECT_MEDIA_TYPE_MISMATCH');
      effects.add(step.effectRef);used.add(step.effectRef);
    }else{if(!effects.has(step.effectRef))throw Error('UNKNOWN_OR_REMOVED_EFFECT_REF');if(step.op==='remove')effects.delete(step.effectRef);}
    if(step.op==='read'&&((step.paramIndex!==undefined&&step.expectedDisplayName===undefined)||(step.detail==='parameter'&&step.paramIndex===undefined)))throw Error('EXACT_PARAMETER_REQUIRED');
  }
  return structuredClone(plan);
}
const same=(a:unknown,b:unknown)=>createOperationFingerprint('state',a as any)===createOperationFingerprint('state',b as any);
const commandFor={add_video:'apply_video_effect',add_audio:'apply_audio_effect',read:'get_effect_values',set_values:'set_effect_values',set_keys:'set_effect_keyframes',edit_keys:'edit_effect_keyframes',remove:'remove_effect',disclosure:'set_effect_disclosure'} as const;

/** One shared runtime owns the job across MCP clients; each native step still
 * uses the normal UXP queue, visibility adapters and persistent receipt path.
 * No arbitrary tool/script, concurrent host mutation, replay or hidden rollback. */
export class EffectCommandSequences{
  private jobs=new Map<string,Job>();
  private active:string|undefined;
  private persistenceBlocked:string|undefined;
  private durableCompletedSteps=new Map<string,number>();
  get busy(){return this.active!==undefined;}
  get activeJobId(){return this.active;}
  constructor(private readonly services:Services){}
  async submit(id:string,input:unknown){
    z.string().uuid().parse(id);
    const plan=planEffectSequence(input),fingerprint=createOperationFingerprint('effect_sequence',plan as any),prior=this.jobs.get(id)??await this.restore(id);
    if(prior){if(prior.fingerprint!==fingerprint)throw Error('OPERATION_ID_REUSED');return this.status(id);}
    if(this.persistenceBlocked)throw Error('JOB_PERSISTENCE_UNVERIFIED: '+this.persistenceBlocked+' has only in-memory failure evidence; repair storage before admitting new work');
    if(this.active)throw Error('EFFECT_SEQUENCE_BUSY');
    const job:Job={id,plan,fingerprint,state:'queued',completedSteps:0,results:[],cancelRequested:false,elapsedMs:0,acceptedAt:new Date().toISOString()};
    this.jobs.set(id,job);this.active=id;
    this.pruneCache();
    try{await this.checkpoint(job,'admission');}catch(error){job.completedAt=new Date().toISOString();this.active=undefined;this.emit(job);throw error;}
    void this.run(job);return this.status(id);
  }
  async inspect(id:string,cursor=0){z.string().uuid().parse(id);if(!this.jobs.has(id))await this.restore(id);return this.status(id,cursor);}
  private pruneCache(){
    for(const id of this.jobs.keys()){
      if(this.jobs.size<=8)break;
      if(id!==this.active&&id!==this.persistenceBlocked){this.jobs.delete(id);this.durableCompletedSteps.delete(id);}
    }
  }
  private async restore(id:string){const value=await this.services.load?.(id);
    // Another admission may have completed while disk I/O yielded. Never
    // replace a live in-memory job with its older queued disk record.
    const current=this.jobs.get(id);if(current)return current;
    if(value===undefined)return;
    const archived=savedJob(value,id);
    if(['queued','running'].includes(archived.state)){archived.state='unverified';if(archived.pendingStep)archived.pendingStep.dispatchState='unknown';archived.error='Runtime interrupted this job. Inspect current host state before a new plan; no steps replayed.';}
    this.jobs.set(id,archived);this.pruneCache();return archived;
  }
  status(id:string,cursor=0){
    if(!Number.isInteger(cursor)||cursor<0||cursor>256)throw Error('INVALID_JOB_CURSOR');
    const job=this.jobs.get(id);if(!job)return {jobId:id,state:'unverified',status:'unverified',error:'Unknown in this runtime session; inspect affected clips. Never replay an unknown job.'};
    const end=Math.min(cursor+25,job.results.length);
    return {protocolVersion:1,jobId:id,state:job.state,status:['queued','running','cancelled'].includes(job.state)?'partial':job.state,completedSteps:job.completedSteps,totalSteps:job.plan.steps.length,results:job.results.slice(cursor,end),nextCursor:end,hasMore:end<job.results.length,pendingStep:job.pendingStep,cancelRequested:job.cancelRequested,elapsedMs:job.elapsedMs,error:job.error,preservation:job.preservation,persistenceFailure:job.persistenceFailure,acceptedAt:job.acceptedAt,completedAt:job.completedAt};
  }
  cancel(id:string){const job=this.jobs.get(id);if(job&&['queued','running'].includes(job.state))job.cancelRequested=true;return this.status(id);}
  private emit(job:Job,stepIndex?:number){this.services.events.append({kind:'job',id:job.id,jobId:job.id,state:job.state,stepIndex,completedSteps:job.completedSteps,totalSteps:job.plan.steps.length,durationMs:job.elapsedMs});}
  private async checkpoint(job:Job,phase:PersistencePhase){
    const snapshot=structuredClone(job);
    if(snapshot.persistenceFailure)snapshot.persistenceFailure.mainRecord='recorded';
    try{
      await this.services.persist(snapshot);this.durableCompletedSteps.set(job.id,job.completedSteps);
      if(job.persistenceFailure)job.persistenceFailure.mainRecord='recorded';
      if(this.persistenceBlocked===job.id)this.persistenceBlocked=undefined;
    }catch(error){
      // The step intent must be durable before execute is called. Failure of
      // that checkpoint proves this pending step was never sent; an interrupted
      // successfully written intent is conservatively unknown after restart.
      if(phase==='step_intent'&&job.pendingStep)job.pendingStep.dispatchState='not_sent';
      job.state='unverified';
      if(!job.persistenceFailure)job.persistenceFailure={phase,at:new Date().toISOString(),message:String(error),completedSteps:job.completedSteps,durableCompletedSteps:this.durableCompletedSteps.get(job.id)??0,pendingDispatch:job.pendingStep?.dispatchState??'none',mainRecord:'failed',journal:'unavailable'};
      else{job.persistenceFailure.mainRecord='failed';job.persistenceFailure.finalError=String(error);}
      job.error='Job persistence failed ('+job.persistenceFailure.phase+'); completed host proofs retained, no remaining steps replayed: '+job.persistenceFailure.message;
      if(this.services.recordPersistenceFailure){
        try{await this.services.recordPersistenceFailure(structuredClone(job));job.persistenceFailure.journal='recorded';delete job.persistenceFailure.journalError;}
        catch(journalError){job.persistenceFailure.journal='failed';job.persistenceFailure.journalError=String(journalError);}
      }
      if(job.persistenceFailure.journal==='recorded'){if(this.persistenceBlocked===job.id)this.persistenceBlocked=undefined;}
      else this.persistenceBlocked=job.id;
      throw error;
    }
  }
  private async run(job:Job){
    const started=performance.now(),plan=job.plan,clips=new Map(plan.clips.map(c=>[c.ref,c])),bindings=new Map<string,Binding>(plan.effects.map(e=>[e.ref,{...e}]));
    const expected=new Map<string,any[]>();let dispatched=false;
    const first=plan.clips[0]!,identity={expectedProjectId:first.expectedProjectId,expectedSequenceId:first.expectedSequenceId,expectedSequenceName:first.expectedSequenceName};
    const readState=async()=>{
      // Baseline/final proof reads retain the last visible work location. The
      // plan's explicit read steps and Point/native proof below keep follow.
      const result=await this.services.execute('query_timeline',{...identity,ids:plan.clips.map(c=>c.trackItemId),limit:plan.clips.length,includeEffects:true,effectSampleTimeSeconds:0},randomUUID(),true,JOB_PRESERVATION_READ);
      for(const item of result.items??[]){
        if(!item.components?.some((c:any)=>c.params?.some((p:any)=>p.descriptor?.inputKind==='point'&&p.keyframes?.length)))continue;
        const clip=plan.clips.find(c=>c.trackItemId===item.id);if(!clip)throw Error('UNEXPECTED_EFFECT_STATE_CLIP');
        const first=item.components[0];
        const proof=await this.services.execute('get_effect_values',{...clip,detail:'chain',componentIndex:first.componentIndex,componentMatchName:first.matchName},randomUUID(),true);
        const {components:_components,...bounds}=item;void _components;
        if(proof.status!=='pass'||!Array.isArray(proof.components)||!same(bounds,proof.item)||proof.visibility?.effectExpansion?.status!=='pass')throw Error('POINT_CHAIN_BASELINE_UNVERIFIED');
        item.components=proof.components;
      }
      return result;
    };
    try{
      job.state='running';await this.checkpoint(job,'running');this.emit(job);
      const baseline=await readState();if(baseline.items?.length!==clips.size||baseline.page?.hasMore||baseline.page?.scanTruncated)throw Error('SEQUENCE_BASELINE_INCOMPLETE');
      for(const clip of clips.values()){
        const item=baseline.items.find((i:any)=>i.id===clip.trackItemId);
        if(!item||item.projectItemId!==clip.expectedProjectItemId||item.mediaType!==clip.expectedMediaType||item.trackIndex!==clip.expectedTrackIndex||item.start.seconds!==clip.expectedStartSeconds||item.end.seconds!==clip.expectedEndSeconds)throw Error('SEQUENCE_BASELINE_TARGET_CHANGED');
        expected.set(clip.ref,item.components);
      }
      for(const binding of bindings.values())if(expected.get(binding.clipRef)?.[binding.componentIndex]?.matchName!==binding.componentMatchName)throw Error('SEQUENCE_EFFECT_CHANGED');
      for(const [i,step] of plan.steps.entries()){
        if(job.cancelRequested){job.state='cancelled';break;}
        if(performance.now()-started>=plan.maxRunMs){job.state='fail';job.error='Deadline reached between verified steps';break;}
        const add=step.op==='add_video'||step.op==='add_audio',binding=bindings.get(step.effectRef),clipRef=add?step.clipRef:binding!.clipRef,clip=clips.get(clipRef)!;
        const {op:_op,effectRef:_ref,...parameters}=step;void _op;void _ref;
        const args:any={...clip,...parameters,expectedEffectState:effectStateProjection(expected.get(clipRef)!),...(!add?{componentIndex:binding!.componentIndex,componentMatchName:binding!.componentMatchName}:{})};
        delete args.ref;delete args.clipRef;
        const command=commandFor[step.op],stepStart=performance.now();this.emit(job,i);
        const commandId=randomUUID();job.pendingStep={index:i,commandId,command,dispatchState:'unknown'};await this.checkpoint(job,'step_intent');
        dispatched=true;
        const result=await this.services.execute(command,args,commandId,step.op==='read');
        const visibility=result.hostResult?.visibility??result.visibility;
        const contentMutation=add||['remove','set_values','set_keys','edit_keys'].includes(step.op);
        const afterPresent=Array.isArray(result.after);
        const addedIndex=Number(result.hostResult?.componentIndex);
        const afterEvidence=afterPresent&&(add
          ?Number.isInteger(addedIndex)&&addedIndex>=0&&!!result.after[addedIndex]
          :step.op==='remove'||result.after[binding!.componentIndex]?.matchName===binding!.componentMatchName);
        // A mutation receipt proves values only after terminal host success and
        // its required after-state. Non-read is not evidence: disconnects can
        // return UNVERIFIED without a host response or any value readback.
        const valueProof=result.status==='pass'&&(step.op==='read'
          ?Array.isArray(result.component?.params)&&result.component.params.length>0&&result.component.params.every((p:any)=>p.readStatus?.value==='pass'&&p.readStatus?.animation==='pass')
          :step.op==='disclosure'||contentMutation&&afterEvidence);
        const needsParameter=step.op==='read'&&step.paramIndex!==undefined||['set_values','set_keys','edit_keys'].includes(step.op);
        const visible=visibility?.effectExpansion?.status==='pass'&&(step.op==='disclosure'||visibility?.parameterScroll?.status==='pass'&&(!needsParameter||visibility?.parameterScroll?.scope==='exact_parameter'));
        // Full mutation proof already has its own atomic receipt. Keep cached
        // job pages bounded instead of copying every chain snapshot per step.
        job.results.push({index:i,op:step.op,effectRef:step.effectRef,command,commandId:result.commandId??commandId,status:result.status,visibilityStatus:visible?'pass':'unverified',valueProof: valueProof?'pass':'unverified',durationMs:performance.now()-stepStart,
          componentIndex:args.componentIndex??result.hostResult?.componentIndex,errors:result.errors??[],
          ...(step.op==='read'?{values:result.component?.params?.map((p:any)=>({paramIndex:p.paramIndex,value:p.value,readStatus:p.readStatus}))}:{}),
          ...(result.hostResult?.derivedValues?{derivedValues:result.hostResult.derivedValues}:{}),
          proof:{effectExpansion:visibility?.effectExpansion?.status,parameterScroll:visibility?.parameterScroll?.status,scope:visibility?.parameterScroll?.scope}});
        delete job.pendingStep;job.elapsedMs=performance.now()-started;
        // Ordinary follow is observational, not a content-success gate. Keep its
        // result in the receipt and advance the expected chain after proven edits.
        // Explicit disclosure still requires native expansion proof; specialized
        // Point/time/color proofs remain enforced by the ordinary host command.
        if(valueProof&&contentMutation){
          if(!Array.isArray(result.after))throw Error('STEP_AFTER_STATE_REQUIRED');expected.set(clipRef,result.after);
          if(add){const at=Number(result.hostResult?.componentIndex);const component=result.after[at];if(!component)throw Error('NEW_EFFECT_IDENTITY_MISSING');
            for(const value of bindings.values())if(value.clipRef===clipRef&&value.componentIndex>=at)value.componentIndex++;
            bindings.set(step.effectRef,{clipRef,componentIndex:at,componentMatchName:component.matchName});
          }else if(step.op==='remove'){const at=binding!.componentIndex;bindings.delete(step.effectRef);for(const value of bindings.values())if(value.clipRef===clipRef&&value.componentIndex>at)value.componentIndex--;}
        }
        if(result.status!=='pass'||!valueProof||step.op==='disclosure'&&!visible){
          job.state=result.status==='fail'?'fail':'unverified';job.error=step.op==='disclosure'&&!visible?'Explicit disclosure lacks native proof; not replayed':'Step lacks content proof; not replayed';
          // An uncertain command may have lost its native connection/owner.
          // Preserve this failure without dispatching an automatic final query
          // that can overwrite the cause or start new follow/native reads.
          job.preservation={expectedState:'unverified',errors:['Final readback skipped after an unproven step; inspect the host before a new plan.']};
          await this.checkpoint(job,'step_result');return;
        }
        job.completedSteps++;await this.checkpoint(job,'step_result');this.emit(job,i);
      }
      const final=await readState(),errors:string[]=[];
      for(const clip of clips.values()){
        const item=final.items?.find((v:any)=>v.id===clip.trackItemId);
        const original=baseline.items.find((v:any)=>v.id===clip.trackItemId);
        const bounds=(v:any)=>{const {components,...rest}=v;void components;return rest;};
        if(!item||!same(bounds(original),bounds(item))||!same(effectStateProjection(expected.get(clip.ref)!),effectStateProjection(item.components)))errors.push('Final state differs: '+clip.ref);
      }
      job.preservation={expectedState:errors.length?'unverified':'pass',errors};
      if(errors.length){job.state='unverified';job.error=errors.join('; ');}else if(job.completedSteps===plan.steps.length)job.state='pass';
    }catch(error){if(!job.persistenceFailure){job.state=dispatched?'unverified':'fail';job.error=String(error);}}
    finally{job.elapsedMs=performance.now()-started;job.completedAt=new Date().toISOString();
      try{await this.checkpoint(job,'final');}catch{/* checkpoint recorded the failure or marked evidence as memory-only. */}
      this.active=undefined;this.emit(job);
    }
  }
}
