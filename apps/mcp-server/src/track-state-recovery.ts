import {canonicalizeOperationValue} from './operation-identity.js';

/** A completed scope error can occur between mute writes. Never classify the
 * error code alone as pre-dispatch. Prove the entire only-writable track vector
 * is unchanged against an earlier, durable successful native receipt instead. */
export function assessRejectedTrackStateRecovery(args:Record<string,unknown>,baseline:any,current:any){
  if(!Array.isArray(args.edits)||!args.edits.length||Object.keys(args).some(k=>k!=='edits')||args.edits.some((e:any)=>!e||Object.keys(e).sort().join(',')!=='mediaType,muted,trackIndex'||!['audio','video'].includes(e.mediaType)||!Number.isInteger(e.trackIndex)||e.trackIndex<0||typeof e.muted!=='boolean'))throw Error('RECOVERY_TRACK_MUTE_ONLY_REQUIRED');
  if(current?.status!=='pass'||!baseline||current.projectId!==baseline.projectId||current.sequenceId!==baseline.sequenceId||current.sequenceName!==baseline.sequenceName||!Array.isArray(baseline.tracks)||!Array.isArray(current.tracks)||!baseline.tracks.length)throw Error('RECOVERY_TRACK_BASELINE_MISMATCH');
  const vector=(rows:any[])=>rows.map(t=>{
    if(!['audio','video'].includes(t.mediaType)||!Number.isInteger(t.index)||t.id==null||typeof t.name!=='string'||typeof t.muted!=='boolean')throw Error('RECOVERY_TRACK_VECTOR_INVALID');
    return {mediaType:t.mediaType,index:t.index,id:t.id,name:t.name,muted:t.muted,itemCount:t.itemCount,transitionCount:t.transitionCount};
  });
  const before=vector(baseline.tracks),after=vector(current.tracks);
  if(new Set(before.map(t=>t.mediaType+':'+t.index)).size!==before.length||args.edits.some((e:any)=>!before.some(t=>t.mediaType===e.mediaType&&t.index===e.trackIndex))||JSON.stringify(canonicalizeOperationValue(before))!==JSON.stringify(canonicalizeOperationValue(after)))throw Error('RECOVERY_TRACK_STATE_CHANGED');
  return {status:'pass',outcome:'verified_track_state_unchanged_after_terminal_error',baselineOperationId:baseline.commandId,projectId:current.projectId,sequenceId:current.sequenceId,tracks:after,contentReplayed:false};
}
