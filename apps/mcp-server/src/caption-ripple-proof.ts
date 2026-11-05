/** Pure caption preservation proof. The operation adapter owns saves and reads;
 * this module compares supplied evidence without touching files or host state. */
import type {planRippleGaps} from '@premiere-uxp/contracts/ripple-plan';
import type {ArchiveTrackSnapshot,CaptionCueSnapshot,SequenceArchiveSnapshot} from './sequence-archive-types.js';

type Plan=ReturnType<typeof planRippleGaps>;
type CaptionProof={
  id:string;trackUid:string;trackIndex:number;trackStyleHash:string|undefined;
  cue:CaptionCueSnapshot;ordinal:number;trackCues:readonly CaptionCueSnapshot[];
  expectedStartTicks:string;expectedEndTicks:string;
};
type IndexedCue={cue:CaptionCueSnapshot;start:bigint;end:bigint;ordinal:number};
type TrackIndex={track:ArchiveTrackSnapshot;entries:IndexedCue[];cues:CaptionCueSnapshot[];orderVerified:boolean};

// One microsecond, matching the host/archive correlation contract; never round
// a boundary to a sequence frame or widen tolerance to make a proof pass.
const toleranceTicks=254016n;
const near=(a:bigint,b:bigint)=>{const delta=a-b;return (delta<0n?-delta:delta)<=toleranceTicks;};

/** Convert and order once per track; caller-owned cue order stays untouched. */
function indexCues(cues:readonly CaptionCueSnapshot[]):IndexedCue[] {
  const entries=cues.map(cue=>({cue,start:BigInt(cue.startTicks),end:BigInt(cue.endTicks),ordinal:0}));
  entries.sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:a.end<b.end?-1:a.end>b.end?1:0);
  entries.forEach((entry,index)=>{entry.ordinal=index;});
  return entries;
}

/** Find exactly one baseline cue. A lower bound skips unrelated earlier cues;
 * all candidates inside the inclusive start window still need an end check. */
function matchCue(entries:readonly IndexedCue[],change:Plan['changes'][number]):IndexedCue {
  const start=BigInt(change.startTicks),end=BigInt(change.endTicks);
  const minimum=start-toleranceTicks,maximum=start+toleranceTicks;
  let low=0,high=entries.length;
  while(low<high){
    const middle=Math.floor((low+high)/2);
    if(entries[middle]!.start<minimum)low=middle+1;else high=middle;
  }
  let match:IndexedCue|undefined;
  for(let index=low;index<entries.length&&entries[index]!.start<=maximum;index++){
    const candidate=entries[index]!;
    if(!near(candidate.end,end))continue;
    if(match)throw Error('RIPPLE_CAPTION_ARCHIVE_BASELINE_MISMATCH: '+change.id);
    match=candidate;
  }
  if(!match)throw Error('RIPPLE_CAPTION_ARCHIVE_BASELINE_MISMATCH: '+change.id);
  return match;
}

/** Prepare complete-track evidence for affected captions. Missing bytes, tied
 * timing or ambiguous correlation fail before the operation dispatches content.
 * Cues are shared within this call, never cached across saves or operations. */
export function prepareCaptionProof(snapshot:SequenceArchiveSnapshot,plan:Plan):CaptionProof[] {
  const tracks=new Map<number,TrackIndex>();
  return plan.changes.filter(change=>change.mediaType==='caption').map(change=>{
    let indexed=tracks.get(change.trackIndex);
    if(!indexed){
      const track=snapshot.tracks.find(t=>t.mediaType==='caption'&&t.index===change.trackIndex);
      if(!track)throw Error('RIPPLE_CAPTION_ARCHIVE_BASELINE_MISMATCH: '+change.id);
      const entries=indexCues(track.captionCues??[]);
      indexed={track,entries,cues:entries.map(entry=>entry.cue),orderVerified:false};
      tracks.set(change.trackIndex,indexed);
    }
    const entry=matchCue(indexed.entries,change),cue=entry.cue,piece=change.pieces[0]!;
    const {track,cues}=indexed;
    if(!cue.contentSha256||(track.style&&!track.style.contentSha256))throw Error('RIPPLE_CAPTION_BYTES_UNVERIFIED');
    if(!indexed.orderVerified){
      if(cues.some((c,i)=>!c.contentSha256||(i>0&&c.startTicks===cues[i-1]!.startTicks&&c.endTicks===cues[i-1]!.endTicks)))throw Error('RIPPLE_CAPTION_ORDER_AMBIGUOUS');
      indexed.orderVerified=true;
    }
    return {id:change.id,trackUid:track.uid,trackIndex:track.index,trackStyleHash:track.style?.contentSha256,
      cue,ordinal:entry.ordinal,trackCues:cues,expectedStartTicks:piece.startTicks,expectedEndTicks:piece.endTicks};
  });
}

/** Compare every ordered cue in each affected track, including unchanged cues.
 * ObjectID is a save-time address. Identity comes from the pinned track, ordered
 * multiplicity, planned timing and exact text/style bytes. Errors retain order. */
export function verifyCaptionProof(snapshot:SequenceArchiveSnapshot,proof:readonly CaptionProof[]):string[] {
  const errors:string[]=[];
  const tracks=new Map<string,{before:CaptionProof;changes:Map<number,CaptionProof>}>();
  for(const change of proof){
    let track=tracks.get(change.trackUid);
    if(!track){track={before:change,changes:new Map()};tracks.set(change.trackUid,track);}
    if(!track.changes.has(change.ordinal))track.changes.set(change.ordinal,change);
  }
  for(const {before,changes} of tracks.values()){
    const matches=snapshot.tracks.filter(t=>t.mediaType==='caption'&&t.uid===before.trackUid&&t.index===before.trackIndex);
    if(matches.length!==1){errors.push('Caption track identity changed: '+before.id);continue;}
    const track=matches[0]!,cues=indexCues(track.captionCues??[]);
    if(cues.length!==before.trackCues.length){errors.push('Caption count differs: '+before.id);continue;}
    for(let index=0;index<cues.length;index++){
      const original=before.trackCues[index]!,entry=cues[index]!,cue=entry.cue,change=changes.get(index);
      const id=change?.id??`caption:${before.trackIndex}:${index}`;
      if(!near(entry.start,BigInt(change?.expectedStartTicks??original.startTicks))||!near(entry.end,BigInt(change?.expectedEndTicks??original.endTicks)))errors.push('Caption timing differs: '+id);
      if(cue.contentSha256!==original.contentSha256||cue.text!==original.text||track.style?.contentSha256!==before.trackStyleHash)errors.push('Caption text/style differs: '+id);
    }
  }
  return errors;
}
