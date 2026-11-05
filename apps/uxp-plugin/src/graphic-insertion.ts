import {equalSnapshotValue} from "./snapshot-equality.js";
type RecordValue=Record<string,any>;
/** Exact structural proof, independent of the insertion API's return count. */
export function assessGraphicInsertion(before:RecordValue,after:RecordValue,args:RecordValue) {
  const oldItems=new Map<string,RecordValue>(before.items.map((i:RecordValue)=>[i.id,i]));
  const current=new Map<string,RecordValue>(after.items.map((i:RecordValue)=>[i.id,i]));
  const newItems:RecordValue[]=after.items.filter((i:RecordValue)=>!oldItems.has(i.id));
  const missingUnrelatedIds=[...oldItems.keys()].filter(id=>!current.has(id));
  const changedUnrelatedIds=[...oldItems].filter(([id,item])=>current.has(id)&&!equalSnapshotValue(item,current.get(id))).map(([id])=>id);
  const insertedItem=newItems[0];
  const trackCountsUnchanged=before.videoTracks===after.videoTracks&&before.audioTracks===after.audioTracks&&before.captionTracks===after.captionTracks;
  const transitionsUnchanged=equalSnapshotValue(before.transitions,after.transitions);
  const expectedTracks=before.tracks.map((track:RecordValue)=>({...track,itemCount:Number(track.itemCount)+(track.mediaType==='video'&&track.index===args.videoTrackIndex?1:0)}));
  const tracksPreserved=equalSnapshotValue(expectedTracks,after.tracks);
  const sequenceSettingsUnchanged=['id','name','width','height','frameRate'].every(key=>equalSnapshotValue(before[key],after[key]));
  const ticks=String(Math.round(Number(args.timeSeconds)*254016000000));
  const errors=[...(after.itemsTruncated?["Insertion readback was truncated"]:[]),
    ...(oldItems.size!==before.items.length||current.size!==after.items.length?["Timeline item identities are duplicated"]:[]),
    ...(newItems.length===1&&insertedItem?.mediaType==="video"&&insertedItem.trackIndex===args.videoTrackIndex&&insertedItem.start.ticks===ticks?[]:["Exactly one video-only graphic must appear at the requested track and exact tick"]),
    ...missingUnrelatedIds.map(id=>`Unrelated timeline item disappeared: ${id}`),...changedUnrelatedIds.map(id=>`Unrelated timeline item changed: ${id}`),
    ...(!trackCountsUnchanged?["Track counts changed"]:[]),...(!transitionsUnchanged?["Timeline transitions changed"]:[]),
    ...(!tracksPreserved?["Track metadata or item counts changed unexpectedly"]:[]),
    ...(!sequenceSettingsUnchanged?["Sequence identity or settings changed"]:[]),
    ...(!equalSnapshotValue(before.captionTrackStates,after.captionTrackStates)?["Caption track state changed"]:[])];
  if(args.durationSeconds!==undefined&&insertedItem&&BigInt(insertedItem.end.ticks)-BigInt(insertedItem.start.ticks)!==BigInt(Math.round(args.durationSeconds*254016000000)))errors.push("Graphic duration differs from the exact requested ticks");
  return {newItems,insertedItem,missingUnrelatedIds,changedUnrelatedIds,trackCountsUnchanged,transitionsUnchanged,tracksPreserved,sequenceSettingsUnchanged,errors};
}
