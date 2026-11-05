import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';
import {isDeepStrictEqual} from 'node:util';
import {editPlanSchema,projectSnapshotSchema,type EditPlan,type ProjectSnapshot} from '@premiere-uxp/contracts';
import {canonicalizeOperationValue} from './operation-identity.js';

const same=(a:unknown,b:unknown)=>isDeepStrictEqual(a,b);
const normalizedPath=(value:string)=>normalizeLocalPath(value);
const by=(key:string)=>(a:any,b:any)=>String(a[key]).localeCompare(String(b[key]));

/** Compare content, not capture time, reopened project GUID, or collection order.
 * Parameter/keyframe arrays remain ordered; no values or unsupported fields are dropped. */
export function canonicalSnapshot(value:ProjectSnapshot){
  const copy=structuredClone(value);
  copy.projectId='reopened-project';copy.capturedAt='capture';copy.projectPath=normalizedPath(copy.projectPath);
  copy.sequences.sort(by('id'));copy.projectItems.sort(by('id'));copy.offlineMediaIds.sort();copy.proxyAttachments.sort(by('projectItemId'));
  for(const key of ['effects','audioState','mogrtItems'] as const)(copy[key] as any[]).sort(by('trackItemId'));
  if(copy.activeSequence){copy.activeSequence.items.sort(by('id'));copy.activeSequence.transitions.sort(by('id'));
    copy.activeSequence.tracks.sort((a,b)=>a.mediaType.localeCompare(b.mediaType)||a.index-b.index);
    copy.activeSequence.captionTrackStates.sort((a,b)=>a.index-b.index);}
  return copy;
}

/** A lost response is never promoted into a terminal execution witness. For one
 * declared relocation only, a durable pre-dispatch baseline can prove either
 * unchanged content or exactly its completed content now. A partial clone,
 * missing item, effect drift or another edit remains quarantined. No edit is run. */
export function assessTrackRelocationRecovery(planValue:unknown,args:Record<string,any>,currentValue:unknown){
  const plan=editPlanSchema.parse(planValue),before=plan.baseSnapshot,current=projectSnapshotSchema.parse(currentValue);
  if(plan.operations.length!==1||plan.operations[0]!.command!=='move_clip_to_track'||
    !same(canonicalizeOperationValue(plan.operations[0]!.args),canonicalizeOperationValue(args)))throw Error('RECOVERY_RELOCATION_PLAN_MISMATCH');
  if(before.projectId!==args.expectedProjectId||before.projectItemsTruncated||current.projectItemsTruncated||
    !before.activeSequence||!current.activeSequence||before.activeSequence.itemsTruncated||current.activeSequence.itemsTruncated||
    before.activeSequence.id!==args.expectedSequenceId||current.activeSequence.id!==args.expectedSequenceId||
    before.activeSequence.name!==args.expectedSequenceName||current.activeSequence.name!==args.expectedSequenceName||
    normalizedPath(current.projectPath)!==normalizedPath(before.projectPath))throw Error('RECOVERY_RELOCATION_TARGET_CHANGED');
  const move=args.move,sequence=before.activeSequence;
  const matches=sequence.items.filter(i=>i.id===move?.trackItemId),source=matches[0];
  if(matches.length!==1||!source||source.projectItemId!==move.expectedProjectItemId||source.mediaType!==move.expectedMediaType||
    source.trackIndex!==move.expectedTrackIndex||source.start.seconds!==move.expectedStartSeconds||source.end.seconds!==move.expectedEndSeconds||
    source.inPoint?.seconds!==move.expectedInPointSeconds||source.outPoint?.seconds!==move.expectedOutPointSeconds||
    source.speed!==1||source.reversed!==false||!Number.isInteger(move.destinationTrackIndex)||move.destinationTrackIndex===source.trackIndex||move.destinationTrackIndex<0||
    move.destinationTrackIndex>=(source.mediaType==='video'?sequence.videoTracks:sequence.audioTracks))throw Error('RECOVERY_RELOCATION_SOURCE_UNVERIFIED');
  if(sequence.items.some(i=>i.projectItemId===source.projectItemId&&i.mediaType!==source.mediaType)||
    sequence.items.some(i=>i.mediaType===source.mediaType&&i.trackIndex===move.destinationTrackIndex&&BigInt(i.start.ticks)<BigInt(source.end.ticks)&&BigInt(i.end.ticks)>BigInt(source.start.ticks)))throw Error('RECOVERY_RELOCATION_DESTINATION_UNVERIFIED');
  const sourceEffects=(before.effects as any[]).filter(i=>i.trackItemId===source.id);
  if(sourceEffects.length!==1||!Array.isArray(sourceEffects[0].components)||!sourceEffects[0].components.length)throw Error('RECOVERY_RELOCATION_EFFECT_BASELINE_MISSING');
  if(same(canonicalSnapshot(before),canonicalSnapshot(current)))return {status:'pass',outcome:'observed_original_content',contentChanged:false,projectId:current.projectId,sequenceId:current.activeSequence.id};
  const expected=structuredClone(before),destination={...source,trackIndex:move.destinationTrackIndex,
    id:[source.mediaType,move.destinationTrackIndex,source.start.ticks,source.projectItemId].join(':')};
  expected.activeSequence!.items=sequence.items.map(i=>i.id===source.id?destination:i);
  for(const t of expected.activeSequence!.tracks)if(t.mediaType===source.mediaType){if(t.index===source.trackIndex)t.itemCount--;if(t.index===destination.trackIndex)t.itemCount++;}
  for(const field of ['effects','audioState','mogrtItems'] as const)expected[field]=(expected[field] as any[]).map(row=>row.trackItemId===source.id?{...row,trackItemId:destination.id}:row);
  if(!same(canonicalSnapshot(expected),canonicalSnapshot(current)))throw Error('RECOVERY_RELOCATION_CONTENT_CHANGED_OR_PARTIAL');
  return {status:'pass',outcome:'observed_relocated_content',contentChanged:true,projectId:current.projectId,sequenceId:current.activeSequence.id,
    sourceId:source.id,destinationId:destination.id,preserved:['full_exposed_project_snapshot','source_ticks','components','keyframes','unrelated_items','tracks','captions','transitions']};
}

export function validateRelocationPlan(plan:EditPlan,commandId:string,args:Record<string,unknown>){
  if(plan.operations.length!==1||plan.operations[0]!.command!=='move_clip_to_track'||!same(canonicalizeOperationValue(plan.operations[0]!.args),canonicalizeOperationValue(args)))throw Error('RECOVERY_RELOCATION_PLAN_MISMATCH: '+commandId);
  return plan;
}
