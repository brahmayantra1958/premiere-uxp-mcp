import {createHash} from "node:crypto";
import {archiveDocument,type NativeArchiveSource} from './native-archive-document.js';

export type MaskArchiveTarget={sequenceId:string;trackIndex:number;startTicks:string;endTicks:string;projectItemId:string;clipName:string};
const sha=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const decode=(value:string)=>value.replace(/&(?:amp|lt|gt|quot|apos);/g,s=>({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"})[s]!);
function value(block:string,name:string){return decode(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim()??"");}
function object(source:NativeArchiveSource,id:string,uid=false){
  const matches=archiveDocument(source).objects(id,uid);
  if(matches.length!==1)throw Error("MASK_ARCHIVE_OBJECT_NOT_UNIQUE: "+id);return matches[0]!;
}
function reference(block:string,tag:string,uid=false){const id=new RegExp(`<${tag}\\b[^>]*Object${uid?"URef":"Ref"}="([^"]+)"`).exec(block)?.[1];if(!id)throw Error("MASK_ARCHIVE_REFERENCE_MISSING: "+tag);return id;}
function clipRangeMatches(block:string,target:MaskArchiveTarget):boolean {
  const owner=/<TrackItem\b[^>]*>[\s\S]*?<\/TrackItem>/.exec(block)?.[0]??block;
  // The saved Premiere TrackItem v4 omits Start for a clip at sequence zero.
  // This default was correlated with public ticks and the exact source. Never
  // treat a malformed explicit Start or an unknown archive version as zero.
  const start=value(owner,"Start")||(!/<Start\b/.test(owner)&&/^<TrackItem Version="4">/.test(owner)?"0":"");
  return start===target.startTicks&&value(owner,"End")===target.endTicks;
}
function dataHash(block:string,xml:string){
  const node=/<StartKeyframeValue\b([^>]*?)(?:\/>|>([\s\S]*?)<\/StartKeyframeValue>)/.exec(block);if(!node)return undefined;
  const hash=/\bBinaryHash="([^"]+)"/.exec(node[1]!)?.[1];let text=node[2]?.trim();
  // Premiere deduplicates identical binary values with hash-only references.
  if(!text&&hash){
    const matches=[...xml.matchAll(/<StartKeyframeValue\b([^>]*?)(?:\/>|>([\s\S]*?)<\/StartKeyframeValue>)/g)]
      .filter(m=>m[2]&&/\bBinaryHash="([^"]+)"/.exec(m[1]!)?.[1]===hash).map(m=>m[2]!.replace(/\s/g,""));
    if(new Set(matches).size>1)throw Error("MASK_ARCHIVE_BINARY_HASH_CONFLICT");text=matches[0];
  }
  if(!text)throw Error("MASK_ARCHIVE_BINARY_REFERENCE_UNRESOLVED");
  const encoded=text.replace(/\s/g,"");if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw Error("MASK_ARCHIVE_BINARY_ENCODING_INVALID");
  const bytes=Buffer.from(encoded,"base64");if(!bytes.length)throw Error("MASK_ARCHIVE_BINARY_EMPTY");return {sha256:sha(bytes),bytes:bytes.length};
}
export type NativeMaskArchive={name:string;objectId:string;nativeType:number;parameters:Array<{id:number;name:string;controlType:number;stateHash:string;scalar?:string;structureHash?:string;binary?:{sha256:string;bytes:number}}>};
/** Follow the exact sequence/track/clip/source to SelectionComponents. An
 * ordinary effect chain and project-wide mask presence cannot prove this clip.
 * Binary tracking records are opaque; a byte count is NOT a tracked frame count.
 */
export function resolveNativeClip(source:NativeArchiveSource,target:MaskArchiveTarget,mediaType:"video"|"audio"="video"):string{
  const document=archiveDocument(source),xml=document.xml;
  if(xml.length>256*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error("MASK_ARCHIVE_UNSAFE_OR_UNBOUNDED");
  if(!Number.isSafeInteger(target.trackIndex)||target.trackIndex<0||target.trackIndex>99||![target.startTicks,target.endTicks].every(s=>/^\d+$/.test(s)))throw Error("MASK_ARCHIVE_TARGET_INVALID");
  const sequence=object(document,target.sequenceId,true);if(!sequence.startsWith("<Sequence "))throw Error("MASK_ARCHIVE_SEQUENCE_TYPE");
  const kind=mediaType==="video"?"Video":"Audio";
  const videoGroups=[...sequence.matchAll(/<Second ObjectRef="(\d+)"\s*\/>/g)].map(m=>object(document,m[1]!)).filter(b=>b.startsWith(`<${kind}TrackGroup `));
  if(videoGroups.length!==1)throw Error("MASK_ARCHIVE_VIDEO_GROUP_NOT_UNIQUE");
  const trackId=new RegExp(`<Track Index="${target.trackIndex}" ObjectURef="([^"]+)"`).exec(videoGroups[0]!)?.[1];if(!trackId)throw Error("MASK_ARCHIVE_TRACK_MISSING");
  const track=object(document,trackId,true);
  const clips=[...track.matchAll(/<TrackItem Index="\d+" ObjectRef="(\d+)"\s*\/>/g)].map(m=>object(document,m[1]!)).filter(b=>b.startsWith(`<${kind}ClipTrackItem `)&&clipRangeMatches(b,target));
  if(clips.length!==1)throw Error("MASK_ARCHIVE_CLIP_NOT_UNIQUE");
  const subclip=object(document,reference(clips[0]!,"SubClip")),item=object(document,target.projectItemId,true);
  if(!item.startsWith("<ClipProjectItem ")||reference(item,"MasterClip",true)!==reference(subclip,"MasterClip",true)||value(subclip,"Name")!==target.clipName)throw Error("MASK_ARCHIVE_SOURCE_CHANGED");
  return clips[0]!;
}
export function resolveNativeVideoClip(source:NativeArchiveSource,target:MaskArchiveTarget):string{return resolveNativeClip(source,target,"video");}
export function inspectPremiereMasks(source:NativeArchiveSource,target:MaskArchiveTarget):{target:MaskArchiveTarget;masks:NativeMaskArchive[]}{
  const document=archiveDocument(source),xml=document.xml;
  const clip=resolveNativeVideoClip(document,target);
  if(!/<SelectionComponents\b/.test(clip))return {target,masks:[]};
  const chain=object(document,reference(clip,"SelectionComponents"));
  const roots=[...chain.matchAll(/<Component Index="\d+" ObjectRef="(\d+)"\s*\/>/g)].map(m=>object(document,m[1]!));
  const masks:NativeMaskArchive[]=[];
  for(const root of roots){
    if(value(root,"MatchName")!=="AE.ADBE AEMask2")throw Error("MASK_ARCHIVE_SELECTION_TYPE_UNVERIFIED");
    for(const child of root.matchAll(/<SubComponent Index="\d+" ObjectRef="(\d+)"\s*\/>/g)){
      if(masks.length>=32)throw Error("MASK_ARCHIVE_MASK_COUNT_UNBOUNDED");
      const mask=object(document,child[1]!);if(value(mask,"MatchName")!=="AE.ADBE AEMask2")throw Error("MASK_ARCHIVE_MASK_TYPE_UNVERIFIED");
      const params=[...mask.matchAll(/<Param Index="\d+" ObjectRef="(\d+)"\s*\/>/g)].map(m=>object(document,m[1]!));
      if(!params.length||params.length>64)throw Error("MASK_ARCHIVE_PARAMETER_COUNT_UNBOUNDED");
      const parameters=params.map(block=>{
        const binary=dataHash(block,xml),normalized=block.replace(/\sObjectID="[^"]+"/g,"").replace(/<StartKeyframeValue\b[^>]*?(?:\/>|>[\s\S]*?<\/StartKeyframeValue>)/g,binary?`<StartKeyframeValue>${binary.sha256}</StartKeyframeValue>`:"").replace(/>\s+</g,"><");
        const scalar=value(block,"StartKeyframe");
        return {id:Number(value(block,"ParameterID")),name:value(block,"Name"),controlType:Number(value(block,"ParameterControlType")),stateHash:sha(normalized),...(scalar?{scalar,structureHash:sha(normalized.replace(/<StartKeyframe>[\s\S]*?<\/StartKeyframe>/,"<StartKeyframe/>"))}:{}),...(binary?{binary}:{})};
      });
      if(new Set(parameters.map(p=>p.id)).size!==parameters.length)throw Error("MASK_ARCHIVE_PARAMETER_IDS_AMBIGUOUS");
      const kind=params.find(b=>value(b,"ParameterID")==="22"),nativeType=Number(value(kind??"","StartKeyframe").split(",")[1]);
      if(!Number.isInteger(nativeType))throw Error("MASK_ARCHIVE_NATIVE_TYPE_MISSING");
      masks.push({name:value(mask,"InstanceName"),objectId:child[1]!,nativeType,parameters});
    }
  }
  return {target,masks};
}
