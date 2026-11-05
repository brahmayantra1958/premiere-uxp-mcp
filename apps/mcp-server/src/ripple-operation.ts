import {randomUUID} from 'node:crypto';
import {localProjectPath} from './active-edit-target.js';
import {snapshotPremiereSequenceArchive} from './premiere-sequence-archive.js';
import {prepareCaptionProof,verifyCaptionProof} from './caption-ripple-proof.js';
import type {HostExecutor} from './host-executor.js';

type Plan=Parameters<typeof prepareCaptionProof>[1];

/** One durable root operation, with deduplicated saves/apply children. Never
 * patch, restore, close or reopen a project. Unknown writes are never replayed. */
export async function rippleTimelineOperation(host:HostExecutor,args:Record<string,unknown>,operationId?:string) {
  const id=operationId??randomUUID();
  return host.mutateLocal('ripple_timeline',args,async()=>{
    let contentDispatched=false;const steps:unknown[]=[],changedFiles:string[]=[];
    try{
      const prepared=await host.read('inspect_timeline_ripple',args) as {projectPath:string;projectId:string;sequenceId:string;sequenceName:string;plan:Plan;items:unknown[]};
      if(prepared.projectId!==args.expectedProjectId||prepared.sequenceId!==args.expectedSequenceId||prepared.sequenceName!==args.expectedSequenceName||prepared.plan.frameTicks!==args.expectedFrameTicks)throw Error('RIPPLE_TARGET_CHANGED');
      const projectPath=localProjectPath(prepared.projectPath);
      if(!prepared.plan.changes.length)return {status:'pass',result:{contentDispatched:false,plan:prepared.plan,noAffectedItems:true}};
      const pins={expectedProjectId:prepared.projectId,expectedSequenceId:prepared.sequenceId,expectedSequenceName:prepared.sequenceName};
      const saveBefore=await host.mutate('save_working_project',pins,id+':save-before');steps.push(saveBefore);
      if(saveBefore.status!=='pass')return {status:saveBefore.status,result:{contentDispatched:false,steps},errors:['Could not save the current caption baseline']};
      changedFiles.push(projectPath);
      const baseline=await snapshotPremiereSequenceArchive(projectPath,prepared.sequenceName);
      if(baseline.sequenceUid!==prepared.sequenceId)throw Error('RIPPLE_ARCHIVE_SEQUENCE_CHANGED');
      const proof=prepareCaptionProof(baseline,prepared.plan);
      contentDispatched=true;
      const applied=await host.mutate('ripple_timeline',{...args,expectedPlan:prepared.plan,expectedItems:prepared.items,
        captionBaseline:proof.map(p=>({id:p.id,startTicks:p.cue.startTicks,endTicks:p.cue.endTicks}))},id+':apply',{timeoutMs:120_000});
      steps.push(applied);
      if(applied.status!=='pass'){
        contentDispatched=(applied.hostResult as {contentDispatched?:boolean})?.contentDispatched!==false;
        return {status:contentDispatched?'unverified':'fail',result:{contentDispatched,steps},changedFiles,errors:applied.errors};
      }
      const saved=await host.mutate('save_working_project',pins,id+':save-after');steps.push(saved);
      if(saved.status!=='pass')return {status:'unverified',result:{contentDispatched,steps},changedFiles,errors:['Ripple applied; final project save is unverified. Do not replay the operation.']};
      const after=await snapshotPremiereSequenceArchive(projectPath,prepared.sequenceName);
      const errors=after.sequenceUid===prepared.sequenceId?verifyCaptionProof(after,proof):['RIPPLE_ARCHIVE_SEQUENCE_CHANGED'];
      return {status:errors.length?'unverified':'pass',changedFiles,errors,result:{contentDispatched,steps,plan:prepared.plan,
        captionProof:{cueCount:proof.length,timingVerified:!errors.length,textAndStyleBytesPreserved:!errors.length},archiveEdited:false}};
    }catch(error){return {status:contentDispatched?'unverified':'fail',result:{contentDispatched,steps},changedFiles,errors:[String(error)]};}
  },id);
}
