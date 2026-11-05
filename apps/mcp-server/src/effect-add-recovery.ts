import {canonicalizeOperationValue} from './operation-identity.js';

/** Read-only crash reconciliation for one appended audio effect. The durable
 * request owns the complete prior chain; no lost execution is invented. */
export function assessAudioEffectAddRecovery(args:Record<string,any>,current:Record<string,any>){
  const before=args.expectedEffectState,item=current.items?.[0];
  if(!Array.isArray(before)||!before.length||args.insertionIndex!==undefined||!args.displayName||
    current.items?.length!==1||item?.id!==args.trackItemId||item.projectItemId!==args.expectedProjectItemId||
    item.name!==args.expectedClipName||item.mediaType!=='audio'||args.expectedMediaType!=='audio'||
    item.trackIndex!==args.expectedTrackIndex||item.start?.seconds!==args.expectedStartSeconds||item.end?.seconds!==args.expectedEndSeconds)
    throw Error('RECOVERY_EFFECT_TARGET_CHANGED');
  // Compare every recorded field, including native keys and read health. New
  // descriptive annotations are not content and need not exist in old intents.
  const project=(actual:any,expected:any):any=>Array.isArray(expected)?
    (Array.isArray(actual)&&actual.length===expected.length?expected.map((e,i)=>project(actual[i],e)):null):
    expected&&typeof expected==='object'?Object.fromEntries(Object.keys(expected).map(k=>[k,project(actual?.[k],expected[k])])):actual;
  const after=item.components;
  if(!Array.isArray(after)||![before.length,before.length+1].includes(after.length)||
    JSON.stringify(canonicalizeOperationValue(project(after.slice(0,before.length),before)))!==JSON.stringify(canonicalizeOperationValue(before)))
    throw Error('RECOVERY_EFFECT_PRIOR_CHAIN_CHANGED');
  const added=after[before.length];
  if(added){
    if(added.componentIndex!==before.length||added.displayName!==args.displayName||!added.matchName||!Array.isArray(added.params)||
      added.params.some((p:any)=>p.readStatus?.value!=='pass'||p.readStatus?.animation!=='pass'||p.keyframes?.length!==0||p.keyframeDetails?.length!==0))
      throw Error('RECOVERY_EFFECT_ADDITION_UNVERIFIED');
    for(const requested of args.initialParameters??[]){
      const p=added.params.find((p:any)=>p.paramIndex===requested.paramIndex);
      if(!p||p.displayName!==requested.expectedDisplayName||!(typeof p.value==='number'&&typeof requested.value==='number'?Math.abs(p.value-requested.value)<=Math.max(1,Math.abs(requested.value))*1e-6:p.value===requested.value))
        throw Error('RECOVERY_EFFECT_INITIAL_VALUE_CHANGED');
    }
  }
  return {status:'pass',outcome:added?'verified_current_audio_effect_addition':'verified_audio_effect_not_applied',originalExecution:'unverified',contentReplayed:false,trackItemId:item.id,componentIndex:added?.componentIndex};
}
