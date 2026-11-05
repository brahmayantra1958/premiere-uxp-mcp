import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {localProjectPath} from './active-edit-target.js';
import {snapshotPremiereSequenceArchive} from './premiere-sequence-archive.js';
import type {HostExecutor} from './host-executor.js';

export const textHash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
/** A saved archive is evidence of the last save, never a live text guard. */
export async function inspectCaption(host:HostExecutor,args:Record<string,unknown>) {
  const live=await host.read('inspect_caption_track',args) as Record<string,any>;
  const file=localProjectPath(live.projectPath);
  const before=await stat(file),bytes=await readFile(file);
  let saved:Record<string,any>;
  try {
    const archive=await snapshotPremiereSequenceArchive(file,live.sequenceName);
    if(archive.sequenceUid!==live.sequenceId)throw Error('SAVED_CAPTION_SEQUENCE_MISMATCH');
    const track=archive.tracks.find(t=>t.mediaType==='caption'&&t.index===live.track.index);
    if(!track||String(track.id)!==live.track.id||track.name!==live.track.name)throw Error('SAVED_CAPTION_TRACK_MISMATCH');
    const afterBytes=await readFile(file);
    if(!bytes.equals(afterBytes))throw Error('SAVED_PROJECT_CHANGED_DURING_READ');
    const cues=track.captionCues??[];
    const timingMatches=cues.length===live.items.length&&cues.every((c,i)=>c.startTicks===live.items[i].startTicks&&c.endTicks===live.items[i].endTicks);
    saved={source:'saved_project_archive',liveTextFreshness:'unverified',guardEligible:false,fileSha256:textHashBytes(bytes),modifiedAt:before.mtime.toISOString(),
      timingMatchesLive:timingMatches,trackUid:track.uid,trackStyle:track.style??null,
      unsupportedStyleFields:['styleName','fillAlpha','stroke','shadow','background','alignment','position','lineSpacing','perItemOverrideFlag'],
      items:cues.map(c=>({index:c.index,id:null,archiveObjectId:c.itemObjectId,idStability:'archive_object_ids_can_change_on_save',startTicks:c.startTicks,endTicks:c.endTicks,
        text:c.text,textSha256:textHash(c.text),style:{fontPostScriptName:c.fontPostScriptName,fontSize:c.fontSize,fillColor:c.fillColor,fillColorSource:c.fillColor?'stored_rgb_override':'no_stored_override',formattedContentSha256:c.contentSha256},styleOverride:null})),
      fingerprint:textHash(JSON.stringify({uid:track.uid,count:cues.length,cues:cues.map(c=>[c.startTicks,c.endTicks,textHash(c.text)])}))};
  }catch(e){saved={status:'unverified',source:'saved_project_archive',guardEligible:false,error:String(e)};}
  return {...live,savedSnapshot:saved,fingerprint:{value:saved.fingerprint??null,source:'saved_project_archive',guardEligible:false},
    limitations:['Live caption text/style access is not verified. Saved text cannot detect unsaved concurrent edits. No save was performed.']};
}
function textHashBytes(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}

export type SrtCue={number:number;startTicks:string;endTicks:string;text:string};
/** Preserve every text code point and line break; never normalize NFC/NFD. */
export function parseCaptionSrt(source:string):SrtCue[] {
  const lines=source.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  const cues:SrtCue[]=[];let i=0;
  const clock=(h:string,m:string,s:string,ms:string)=>{
    if(Number(m)>59||Number(s)>59)throw Error('SRT_INVALID_CLOCK');
    return ((BigInt(h)*3600000n+BigInt(m)*60000n+BigInt(s)*1000n+BigInt(ms))*254016000n).toString();
  };
  while(i<lines.length){
    if(lines[i]===''){i++;continue;}
    const number=Number(lines[i++]);
    if(!Number.isSafeInteger(number)||number!==cues.length+1)throw Error('SRT_NUMBER_SEQUENCE_MISMATCH');
    const match=/^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/.exec(lines[i++]??'');
    if(!match)throw Error('SRT_INVALID_TIMECODE');
    const startTicks=clock(match[1]!,match[2]!,match[3]!,match[4]!),endTicks=clock(match[5]!,match[6]!,match[7]!,match[8]!);
    if(BigInt(endTicks)<=BigInt(startTicks))throw Error('SRT_INVALID_DURATION');
    const text:string[]=[];while(i<lines.length&&lines[i]!=='')text.push(lines[i++]!);
    if(!text.length)throw Error('SRT_EMPTY_TEXT');
    cues.push({number,startTicks,endTicks,text:text.join('\n')});
  }
  if(!cues.length||cues.length>10000)throw Error('SRT_ITEM_COUNT_OUT_OF_RANGE');
  return cues;
}

export function captionSrtDiff(snapshot:Record<string,any>,cues:SrtCue[],replaceTiming=false) {
  const saved=snapshot.savedSnapshot,items=saved?.items,errors:string[]=[];
  if(!Array.isArray(items))return {status:'unverified',canApply:false,errors:['SAVED_CAPTION_TEXT_UNAVAILABLE'],changes:[]};
  if(items.length!==cues.length)errors.push('SRT_CAPTION_COUNT_MISMATCH');
  if(!saved.timingMatchesLive)errors.push('SAVED_TIMING_DIFFERS_FROM_LIVE');
  const frame=BigInt(snapshot.frameTicks),distance=(a:string,b:string)=>{const d=BigInt(a)-BigInt(b);return d<0n?-d:d;};
  const changes=cues.map((c,i)=>{
    const prior=items[i];
    if(!prior)return {index:i,error:'CAPTION_ITEM_MISSING'};
    if(distance(prior.startTicks,c.startTicks)>frame||distance(prior.endTicks,c.endTicks)>frame)errors.push(`SRT_CAPTION_TIME_MISMATCH:${i}`);
    const round=(ticks:string)=>((BigInt(ticks)+frame/2n)/frame*frame).toString();
    return {index:i,before:{text:prior.text,startTicks:prior.startTicks,endTicks:prior.endTicks},
      after:{text:c.text,startTicks:replaceTiming?round(c.startTicks):prior.startTicks,endTicks:replaceTiming?round(c.endTicks):prior.endTicks},textChanged:prior.text!==c.text};
  });
  return {status:errors.length?'fail':'partial',dryRun:true,canApply:false,mappingMatches:errors.length===0,
    itemCount:cues.length,textChanges:changes.filter(c=>c.textChanged).length,changes,errors,
    blockedBy:['LIVE_CAPTION_TEXT_READ_UNAVAILABLE','CAPTION_TEXT_WRITE_ROUTE_UNAVAILABLE'],contentDispatched:false};
}

/** Preview guards compare saved evidence only. They cannot authorize a native
 * mutation until live text/style readback and a setter are both available. */
export function captionItemDiff(snapshot:Record<string,any>,args:Record<string,any>) {
  const saved=snapshot.savedSnapshot,items=saved?.items;
  if(!Array.isArray(items))throw Error('SAVED_CAPTION_TEXT_UNAVAILABLE');
  if(saved.fingerprint!==args.expectedFingerprint)throw Error('CAPTION_SAVED_FINGERPRINT_CHANGED');
  const frame=BigInt(snapshot.frameTicks),changes:Record<string,any>[]=[],conflicts:Record<string,any>[]=[],seen=new Set<number>();
  for(const edit of args.items) {
    const item=items[edit.itemIndex];
    let error='';
    if(seen.has(edit.itemIndex))error='DUPLICATE_CAPTION_EDIT';
    seen.add(edit.itemIndex);
    if(!item)error='CAPTION_ITEM_MISSING';
    else if(item.startTicks!==edit.expectedStartTicks||(edit.expectedText!==undefined&&item.text!==edit.expectedText)||(edit.expectedTextSha256!==undefined&&item.textSha256!==edit.expectedTextSha256))error='CAPTION_ITEM_GUARD_MISMATCH';
    if(error){conflicts.push({itemIndex:edit.itemIndex,error});continue;}
    const after={text:edit.newText??item.text,startTicks:edit.newStartTicks??item.startTicks,endTicks:edit.newEndTicks??item.endTicks};
    if(BigInt(after.startTicks)<0n||BigInt(after.endTicks)<=BigInt(after.startTicks)||(edit.newStartTicks!==undefined&&BigInt(after.startTicks)%frame!==0n)||(edit.newEndTicks!==undefined&&BigInt(after.endTicks)%frame!==0n)) {
      conflicts.push({itemIndex:edit.itemIndex,error:'CAPTION_TIME_INVALID_OR_NOT_FRAME_ALIGNED'});continue;
    }
    changes.push({itemIndex:edit.itemIndex,before:{text:item.text,startTicks:item.startTicks,endTicks:item.endTicks},after});
  }
  const aborted=conflicts.length>0&&args.conflictPolicy!=='skip';
  return {status:args.dryRun===false?'unsupported':aborted?'fail':'partial',dryRun:args.dryRun!==false,changes,conflicts,aborted,
    plannedItems:aborted?0:changes.length,appliedItems:0,canApply:false,contentDispatched:false,guardSource:'saved_project_only',
    blockedBy:['LIVE_CAPTION_TEXT_READ_UNAVAILABLE','CAPTION_TEXT_WRITE_ROUTE_UNAVAILABLE'],
    recovery:'No write dispatched. No new track, save, project patch or lease.'};
}
