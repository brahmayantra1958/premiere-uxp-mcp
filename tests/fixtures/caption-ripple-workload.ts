import {planRippleGaps} from '@premiere-uxp/contracts/ripple-plan';
import type {SequenceArchiveSnapshot} from '../../apps/mcp-server/src/sequence-archive-types.js';

/** Synthetic saved-track workload: 23.976 fps, one +28-frame gap at frame 615.
 * It models B1's ObjectID reassignment without reading a production project. */
export function captionRippleWorkload(cueCount:number,trackCount=1) {
  const frame=10594584000n,t=(n:number)=>String(BigInt(n)*frame);
  const tracks:SequenceArchiveSnapshot['tracks']=Array.from({length:trackCount},(_,index)=>({
    mediaType:'caption',index,id:index,uid:`track-${index}`,name:`Captions ${index}`,
    itemCount:cueCount,transitionCount:0,empty:false,
    style:{binaryHash:'style',contentSha256:'style-sha',fontPostScriptName:'font',fontSize:32,byteLength:128},
    captionCues:Array.from({length:cueCount},(_,ordinal)=>({
      index:ordinal,itemObjectId:`old-${index}-${ordinal}`,blockObjectId:`block-${index}-${ordinal}`,
      startTicks:t(10+ordinal*60),endTicks:t(50+ordinal*60),
      binaryHash:`bytes-${ordinal}`,contentSha256:`sha-${index}-${ordinal}`,text:`자막 ${index}:${ordinal}`,
      fontPostScriptName:'font',fontSize:32,byteLength:128,
    })),
  }));
  const before:SequenceArchiveSnapshot={projectPath:'',sequenceName:'Fixture',sequenceUid:'sequence',tracks,
    trackCounts:{video:0,audio:0,caption:trackCount},totalItems:cueCount*trackCount};
  const plan=planRippleGaps(String(frame),[{atTicks:t(615),frames:28}],tracks.flatMap(track=>track.captionCues!.map(cue=>({
    id:`caption:${track.index}:${cue.index}`,mediaType:'caption' as const,trackIndex:track.index,startTicks:cue.startTicks,endTicks:cue.endTicks,
  }))));
  const after=structuredClone(before);
  for(const track of after.tracks)for(const cue of track.captionCues!)cue.itemObjectId=`new-${track.index}-${cue.index}`;
  for(const change of plan.changes){
    const ordinal=Number(change.id.split(':')[2]),cue=after.tracks[change.trackIndex]!.captionCues![ordinal]!;
    cue.startTicks=change.pieces[0]!.startTicks;cue.endTicks=change.pieces[0]!.endTicks;
  }
  return {before,after,plan};
}
