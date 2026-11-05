import {createHash} from 'node:crypto';
import {archiveDocument,type NativeArchiveSource} from './native-archive-document.js';
import {resolveNativeVideoClip,type MaskArchiveTarget} from './premiere-mask-archive.js';

const key='ECP.Slider.Expanded';
const property=/<ECP\.Slider\.Expanded>([^<]*)<\/ECP\.Slider\.Expanded>/g;
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function object(source:NativeArchiveSource,id:string){
  const rows=archiveDocument(source).objects(id);
  if(rows.length!==1)throw Error('SPEED_GRAPH_OBJECT_NOT_UNIQUE');return rows[0]!;
}
function ref(block:string,tag:string){
  const rows=[...block.matchAll(new RegExp(`<${tag} ObjectRef="(\\d+)"\\s*/>`,'g'))];
  if(rows.length!==1)throw Error('SPEED_GRAPH_OWNER_UNAVAILABLE: '+tag);return rows[0]![1]!;
}
/** A saved ramp owns a TimeComponentParam independently of the ordinary effect
 * chain. Default-speed clips can omit this owner. Never create a speed curve
 * just to change a view, and never mistake the Time Remapping header for it. */
function clipOwner(xml:NativeArchiveSource,target:MaskArchiveTarget){
  const trackItem=resolveNativeVideoClip(xml,target);
  const subclip=object(xml,ref(trackItem,'SubClip'));
  const clip=object(xml,ref(subclip,'Clip'));
  if(!clip.startsWith('<VideoClip '))throw Error('SPEED_GRAPH_VIDEO_CLIP_REQUIRED');
  return {trackItem,subclip,clip};
}
function resolve(xml:NativeArchiveSource,target:MaskArchiveTarget){
  const {trackItem,subclip,clip}=clipOwner(xml,target);
  const ramp=object(xml,ref(clip,'TimeRemapping'));
  if(!/^<TimeRemapping\b[^>]*ClassID="ace5148e-9c9b-40ed-9f82-64cb67308464"[^>]*Version="2"/.test(ramp))throw Error('SPEED_GRAPH_RAMP_FORMAT_UNSUPPORTED');
  const parameterId=ref(ramp,'Keyframes'),parameter=object(xml,parameterId);
  if(!/^<TimeComponentParam\b[^>]*ClassID="278ae1f9-ab7b-4dff-a53c-21029a399a9d"[^>]*Version="9"/.test(parameter)||!parameter.includes('<ParameterID>-1</ParameterID>'))throw Error('SPEED_GRAPH_PARAMETER_FORMAT_UNSUPPORTED');
  const properties=[...parameter.matchAll(property)];
  if(properties.length>1||properties.some(m=>!['true','false'].includes(m[1]!)))throw Error('SPEED_GRAPH_PROPERTY_INVALID');
  return {trackItem,subclip,clip,ramp,parameterId,parameter,expanded:properties.length?properties[0]![1]==='true':null};
}
/** Only the exact Speed owner's Boolean is ignored; keys, curve shape, time
 * limits and every other property remain covered. IDs can be renumbered on save. */
function content(parameter:string){
  return parameter.replace(property,'').replace(/\sObjectID="\d+"/,'').replace(/<Properties Version="1">\s*<\/Properties>/g,'').replace(/<Node Version="1">\s*<\/Node>/g,'').replace(/>\s+</g,'><');
}
export function inspectSpeedGraph(source:NativeArchiveSource,target:MaskArchiveTarget){
  const r=resolve(archiveDocument(source),target);
  return {parameterId:r.parameterId,expanded:r.expanded,contentSha256:digest(content(r.parameter))};
}
export function patchSpeedGraph(source:NativeArchiveSource,target:MaskArchiveTarget,expectedContentSha256:string,expanded:boolean){
  const document=archiveDocument(source),xml=document.xml;
  const r=resolve(document,target),before=inspectSpeedGraph(document,target);
  if(before.contentSha256!==expectedContentSha256)throw Error('SPEED_GRAPH_CONTENT_CHANGED');
  if(typeof expanded!=='boolean')throw Error('SPEED_GRAPH_BOOLEAN_REQUIRED');
  const entry=`<${key}>${expanded}</${key}>`;
  let next=r.parameter;
  if(r.expanded!==null)next=next.replace(property,entry);
  else if(next.includes('<Properties Version="1">'))next=next.replace('<Properties Version="1">','<Properties Version="1">'+entry);
  else if(next.includes('<Node Version="1">'))next=next.replace('<Node Version="1">','<Node Version="1"><Properties Version="1">'+entry+'</Properties>');
  else next=next.replace('</TimeComponentParam>','<Node Version="1"><Properties Version="1">'+entry+'</Properties></Node></TimeComponentParam>');
  if(content(next)!==content(r.parameter))throw Error('SPEED_GRAPH_NON_UI_CHANGE');
  const changed=xml.replace(r.parameter,next);
  // Exact replacement and reinsertion prove that no other project byte changed.
  if(changed.replace(next,r.parameter)!==xml)throw Error('SPEED_GRAPH_PROJECT_CHANGE');
  return {xml:changed,before,after:inspectSpeedGraph(changed,target)};
}

/** Serialization IDs are not content. Resolve each numeric reference to its
 * contents, keeping persistent UIDs and every non-UI field. This covers source,
 * markers, speed, bounds and ClipID while allowing native ID renumbering. */
function referencedContentHash(xml:NativeArchiveSource,block:string):string{
  let budget=0;
  const canonical=(body:string,ancestors:Set<string>):string=>{
    if(++budget>1024||ancestors.size>16)throw Error('SPEED_GRAPH_CONTENT_GRAPH_UNBOUNDED');
    return body.replace(/\sObjectID="\d+"/,'').replace(/ObjectRef="(\d+)"/g,(_all,id:string)=>{
      if(ancestors.has(id))throw Error('SPEED_GRAPH_CONTENT_GRAPH_CYCLE');
      return `ObjectRef="${digest(canonical(object(xml,id),new Set([...ancestors,id])))}"`;
    }).replace(/>\s+</g,'><');
  };
  return digest(canonical(block,new Set()));
}
/** A default Speed view has no time-remapping data. Live Premiere 26.5 accepts
 * a keyless UI owner on load, retains its disclosure in memory, and omits both
 * empty objects on save. That is distinct from creating identity time keys. */
export function inspectTransientSpeedGraph(source:NativeArchiveSource,target:MaskArchiveTarget){
  const document=archiveDocument(source),xml=document.xml;
  const {clip}=clipOwner(document,target);
  if(!/^<VideoClip\b[^>]*ClassID="9308dbef-2440-4acb-9ab2-953b9a4e82ec"[^>]*Version="11"/.test(clip)||!clip.includes('<Clip Version="18">'))throw Error('SPEED_GRAPH_TRANSIENT_CLIP_FORMAT_UNSUPPORTED');
  if(/<TimeRemapping\b/.test(clip))throw Error('SPEED_GRAPH_TRANSIENT_OWNER_NOT_EMPTY');
  const videoClipId=/ObjectID="(\d+)"/.exec(clip)![1]!;
  if([...xml.matchAll(new RegExp(`<Clip ObjectRef="${videoClipId}"\\s*/>`,'g'))].length!==1)throw Error('SPEED_GRAPH_TRANSIENT_OWNER_SHARED');
  return {contentSha256:referencedContentHash(document,clip),videoClipId,
    timeParameterCount:[...xml.matchAll(/<TimeComponentParam\b[^>]*ObjectID=/g)].length,
    timeRemappingCount:[...xml.matchAll(/<TimeRemapping\b[^>]*ObjectID=/g)].length};
}
export function materializeSpeedGraphView(source:NativeArchiveSource,target:MaskArchiveTarget,expectedContentSha256:string,expanded:boolean,displayName:'속도'|'Speed'){
  const document=archiveDocument(source),xml=document.xml;
  const before=inspectTransientSpeedGraph(document,target),{clip}=clipOwner(document,target);
  if(before.contentSha256!==expectedContentSha256)throw Error('SPEED_GRAPH_CONTENT_CHANGED');
  if(typeof expanded!=='boolean')throw Error('SPEED_GRAPH_BOOLEAN_REQUIRED');
  if(displayName!=='속도'&&displayName!=='Speed')throw Error('SPEED_GRAPH_DISPLAY_NAME_UNVERIFIED');
  const ids=[...xml.matchAll(/\bObjectID="(\d+)"/g)].map(m=>Number(m[1]));
  // Embedded view-state serializers can legitimately reuse small IDs. The
  // selected owner/references are individually unique; fresh IDs exceed every
  // observed scope, so nested view-state IDs cannot collide with this insertion.
  if(!ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<0||id>2147483645))throw Error('SPEED_GRAPH_ARCHIVE_IDS_INVALID');
  const remapId=String(ids.reduce((a,b)=>Math.max(a,b),0)+1),parameterId=String(Number(remapId)+1);
  const reference=`<TimeRemapping ObjectRef="${remapId}"/>`;
  const remap=`<TimeRemapping ObjectID="${remapId}" ClassID="ace5148e-9c9b-40ed-9f82-64cb67308464" Version="2"><Keyframes ObjectRef="${parameterId}"/></TimeRemapping>`;
  const parameter=`<TimeComponentParam ObjectID="${parameterId}" ClassID="278ae1f9-ab7b-4dff-a53c-21029a399a9d" Version="9"><Node Version="1"><Properties Version="1"><ECP.Slider.Expanded>${expanded}</ECP.Slider.Expanded></Properties></Node><Name>${displayName}</Name><ParameterID>-1</ParameterID></TimeComponentParam>`;
  const next=clip.replace('</Clip>',reference+'</Clip>'),replacement=next+remap+parameter;
  if(next===clip)throw Error('SPEED_GRAPH_TRANSIENT_CLIP_FORMAT_UNSUPPORTED');
  const changed=xml.replace(clip,replacement);
  if(changed.replace(replacement,clip)!==xml)throw Error('SPEED_GRAPH_PROJECT_CHANGE');
  return {xml:changed,before,after:{kind:'transient_ui_only',expanded,parameterId,displayName}};
}
