import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';
import {isDeepStrictEqual as same} from 'node:util';
import {editPlanSchema,projectSnapshotSchema} from '@premiere-uxp/contracts';
import {canonicalizeOperationValue,createOperationFingerprint} from './operation-identity.js';
import {canonicalSnapshot} from './track-relocation-recovery.js';

const localPath=(value:string)=>normalizeLocalPath(value);
const ticks=(seconds:number)=>String(Math.round(seconds*254016000000));
const time=(seconds:number)=>({ticks:ticks(seconds),seconds});
function requireProof(condition:unknown,reason:string):asserts condition {if(!condition)throw Error('RECOVERY_PLACEMENT_'+reason);}

/** One zero-in-point, hard-bounded AV subclip overwritten onto two empty
 * existing tracks. Range comes from an earlier durable create_subclip receipt,
 * never caller recovery arguments. Both streams and all exposed prior content
 * must match. Original uncertain receipts and all project content stay untouched. */
export function assessPlacementRecovery(planValue:unknown,args:Record<string,any>,currentValue:unknown,creation:any){
  const plan=editPlanSchema.parse(planValue),before=plan.baseSnapshot,current=projectSnapshotSchema.parse(currentValue);
  requireProof(plan.operations.length===1&&plan.operations[0]!.command==='place_clips'&&
    same(canonicalizeOperationValue(plan.operations[0]!.args),canonicalizeOperationValue(args)), 'PLAN_MISMATCH');
  requireProof(!before.projectItemsTruncated&&!current.projectItemsTruncated&&before.activeSequence&&current.activeSequence&&
    !before.activeSequence.itemsTruncated&&!current.activeSequence.itemsTruncated&&
    current.activeSequence.id===before.activeSequence.id&&current.activeSequence.name===before.activeSequence.name&&
    localPath(current.projectPath)===localPath(before.projectPath), 'TARGET_CHANGED');
  requireProof(Array.isArray(args.placements)&&args.placements.length===1, 'SCOPE_UNSUPPORTED');
  const placement=args.placements[0],created=creation?.receipt?.after?.created,source=creation?.request?.args;
  requireProof(placement.mode==='overwrite'&&Number.isFinite(placement.timeSeconds)&&placement.timeSeconds>=0&&
    creation?.request?.command==='create_subclip'&&creation.receipt.command==='create_subclip'&&
    creation.request.id===creation.receipt.commandId&&['pass','partial'].includes(creation.receipt.status)&&
    creation.receipt.after?.rangeReadback!=='existing-item'&&
    creation.receipt.requestFingerprint===createOperationFingerprint('create_subclip',source)&&
    created?.id===placement.projectItemId&&source?.hardBoundaries===true&&source.takeVideo===true&&source.takeAudio===true&&
    source.startSeconds===0&&Number.isFinite(source.endSeconds)&&source.endSeconds>0, 'SOURCE_EVIDENCE_MISSING');
  const subclips=before.projectItems.filter(p=>p.id===created.id),masters=before.projectItems.filter(p=>p.id===source.projectItemId);
  requireProof(subclips.length===1&&masters.length===1&&subclips[0]!.name===source.name&&
    subclips[0]!.kind==='clip'&&masters[0]!.kind==='clip'&&subclips[0]!.path&&masters[0]!.path&&
    localPath(subclips[0]!.path)===localPath(masters[0]!.path)&&
    !before.activeSequence.items.some(i=>i.projectItemId===created.id), 'SOURCE_CHANGED');
  const expected=structuredClone(before),addedIds:string[]=[];
  for(const mediaType of ['video','audio'] as const){
    const trackIndex=placement[mediaType==='video'?'videoTrackIndex':'audioTrackIndex'];
    const tracks=before.activeSequence.tracks.filter(t=>t.mediaType===mediaType&&t.index===trackIndex);
    requireProof(Number.isInteger(trackIndex)&&tracks.length===1&&tracks[0]!.itemCount===0&&tracks[0]!.transitionCount===0&&
      !before.activeSequence.items.some(i=>i.mediaType===mediaType&&i.trackIndex===trackIndex), 'DESTINATION_NOT_EMPTY');
    const references=before.activeSequence.items.filter(i=>i.projectItemId===source.projectItemId&&i.mediaType===mediaType);
    requireProof(references.length===1,'REFERENCE_AMBIGUOUS');
    const reference=references[0]!;
    requireProof(reference.speed===1&&reference.reversed===false&&reference.disabled===false&&reference.inPoint?.ticks==='0'&&
      reference.outPoint&&BigInt(reference.outPoint.ticks)>=BigInt(ticks(source.endSeconds)), 'REFERENCE_UNVERIFIED');
    const id=[mediaType,trackIndex,ticks(placement.timeSeconds),created.id].join(':');addedIds.push(id);
    const item={...reference,id,name:subclips[0]!.name,projectItemId:created.id,trackIndex,
      start:time(placement.timeSeconds),end:time(placement.timeSeconds+source.endSeconds),inPoint:time(0),outPoint:time(source.endSeconds)};
    requireProof(before.activeSequence.duration&&BigInt(item.end.ticks)<=BigInt(before.activeSequence.duration.ticks), 'DURATION_EXTENSION_UNSUPPORTED');
    expected.activeSequence!.items.push(item);
    expected.activeSequence!.tracks.find(t=>t.mediaType===mediaType&&t.index===trackIndex)!.itemCount++;
    for(const field of ['effects','audioState','mogrtItems'] as const){
      const rows=(before[field] as any[]).filter(r=>r.trackItemId===reference.id);
      requireProof(field!=='effects'||rows.length===1,'EFFECT_BASELINE_MISSING');
      for(const row of rows){
        requireProof(field!=='mogrtItems','GRAPHIC_SOURCE_UNSUPPORTED');
        requireProof((row.components??[]).every((c:any)=>(c.params??[]).every((p:any)=>
          !p.timeVarying&&!(p.keyframes?.length)&&!(p.keyframeDetails?.length))), 'ANIMATED_REFERENCE');
        expected[field].push({...structuredClone(row),trackItemId:id,...(row.name!==undefined?{name:item.name}:{})});
      }
    }
  }
  if(same(canonicalSnapshot(before),canonicalSnapshot(current)))return {status:'pass',outcome:'observed_original_content',contentChanged:false,contentReplayed:false};
  requireProof(same(canonicalSnapshot(expected),canonicalSnapshot(current)), 'CONTENT_CHANGED_OR_PARTIAL');
  return {status:'pass',outcome:'observed_complete_av_subclip_placement',contentChanged:true,contentReplayed:false,
    projectId:current.projectId,sequenceId:current.activeSequence.id,placedItemIds:addedIds,
    preserved:['full_exposed_project_snapshot','source_clocks','reference_components','unrelated_items','tracks','caption_track_state','transitions']};
}
