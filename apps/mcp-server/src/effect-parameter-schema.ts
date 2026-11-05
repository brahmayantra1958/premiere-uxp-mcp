/** Pure native parameter rules: scalar definitions plus exact clip/instance/
 * slot correlation. File access belongs to native-archive-readers.ts; a saved
 * definition never proves live selection, visibility or effect values. */
import {createHash} from "node:crypto";
import {resolveNativeClip,type MaskArchiveTarget} from "./premiere-mask-archive.js";
import {archiveDocument,type NativeArchiveSource} from './native-archive-document.js';

export type ParameterSchema={paramIndex:number;name:string;nativeId:number|null;storageType:string;controlType:number;kind:"group_start"|"group_end"|"value"|"opaque";ancestors:number[];disclosureKey:string|null;range:{min:number|null;max:number|null}|null;uiRange:{min:number|null;max:number|null}|null;choices:string[]|null};
/** Native Point records expose temporal mode separately from spatial handles.
 * This format is version-checked; raw fields are retained for comparison. */
export function pointAnimationFromBlock(block:string,paramIndex:number){
  if(!/^<PointComponentParam\b[^>]*Version="4"/.test(block))return undefined;
  const body=value(block,"Keyframes")??"";
  const keys=body.split(';').filter(Boolean).map(record=>{
    const fields=record.split(','),xy=fields[1]?.split(':');
    if(fields.length!==14||!/^\d+$/.test(fields[0]!)||xy?.length!==2||!xy.every(x=>x.trim()!==''&&Number.isFinite(Number(x)))||!fields.slice(2).every(v=>v.trim()!==''&&Number.isFinite(Number(v)))||!Number.isInteger(Number(fields[2])))throw Error('POINT_ANIMATION_FORMAT_UNVERIFIED');
    return {ticks:fields[0]!,value:{x:Number(xy[0]),y:Number(xy[1])},interpolationMode:Number(fields[2]),nativeFields:fields.slice(2).map(Number)};
  });
  if(new Set(keys.map(k=>k.ticks)).size!==keys.length)throw Error('POINT_ANIMATION_DUPLICATE_TIME');
  return {paramIndex,keys};
}
const decode=(s:string)=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,k=>({"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"})[k]!);
const value=(b:string,k:string)=>{const m=new RegExp(`<${k}>([^<]*)</${k}>`).exec(b);return m?decode(m[1]!):null;};
const numeric=(b:string,k:string)=>{const v=value(b,k);return v!==null&&v.trim()!==""&&Number.isFinite(Number(v))?Number(v):null;};
const ref=(b:string,k:string)=>{const id=new RegExp(`<${k}\\b[^>]*ObjectRef="(\\d+)"`).exec(b)?.[1];if(!id)throw Error("PARAMETER_SCHEMA_REFERENCE_MISSING: "+k);return id;};
/** L1: retain literal native bounds. Missing serialized defaults are unknown,
 * never assumed to be zero. A group marker's Boolean is not editable content. */
export function parameterSchemaFromBlock(block:string,paramIndex:number,ancestors:number[]):ParameterSchema {
  const storageType=/^<([\w]+)/.exec(block)?.[1]??"",name=value(block,"Name")??"",controlType=numeric(block,"ParameterControlType")??0;
  const kind=controlType===11?"group_start":controlType===12?"group_end":storageType==="ArbVideoComponentParam"?"opaque":"value";
  const point=storageType==="PointComponentParam",scalar=/^(?:Video|Audio)ComponentParam$/.test(storageType);
  const boolean=/,(?:true|false),/.test(value(block,"StartKeyframe")??"")||storageType==="AudioComponentParam"&&/ClassID="32657501-3aa4-445f-a49b-d09ecb9fa1ae"/.test(block);
  const custom=kind==='opaque'&&controlType===9&&/<ECP.Custom.Expanded>(?:true|false)<\/ECP.Custom.Expanded>/.test(block);
  const disclosureKey=kind==="group_start"?"ECP.Group.Expanded":custom?'ECP.Custom.Expanded':kind!=="value"?null:point?"ECP.PointParameter.Expanded":controlType===3?"ECP.Angle.Expanded":scalar&&controlType===0&&!boolean?"ECP.Slider.Expanded":null;
  const range=(lo:string,hi:string)=>{const min=numeric(block,lo),max=numeric(block,hi);if(min!==null&&max!==null&&min>max)throw Error("PARAMETER_SCHEMA_INVALID_BOUNDS");return min===null&&max===null?null:{min,max};};
  // Choices remain unknown unless the archive actually supplies them. Do not
  // fabricate enum labels from an integer's range or a localized display name.
  return {paramIndex,name,nativeId:numeric(block,"ParameterID"),storageType,controlType,kind,ancestors:[...ancestors],disclosureKey,range:range("LowerBound","UpperBound"),uiRange:range("LowerUIBound","UpperUIBound"),choices:null};
}
const schemaObjects=Symbol('native parameter objects');
/** Exact saved clip -> chain -> instance -> parameter slots. UXP's live
 * match name and complete name vector guard archive/native-owner mismatches. */
function schemaContext(source:NativeArchiveSource,target:MaskArchiveTarget&{mediaType:'video'|'audio'}){
  const document=archiveDocument(source),clip=resolveNativeClip(document,target,target.mediaType);
  const objects=document.memo(schemaObjects,()=>{
    const index=new Map<string,string>();
    for(const m of document.xml.matchAll(/<([A-Za-z0-9_]+)\b[^>]*ObjectID="(\d+)"[^>]*>[\s\S]*?<\/\1>/g)){if(index.has(m[2]!))throw Error("PARAMETER_SCHEMA_DUPLICATE_OBJECT");index.set(m[2]!,m[0]);}
    return index;
  });
  return {clip,objects};
}
export type SchemaTarget=MaskArchiveTarget&{mediaType:"video"|"audio";componentIndex:number;componentMatchName:string;parameterNames:string[];componentMatchNames?:string[]};
/** Same exact occurrence/name contract for typed opaque codecs. Never select an
 * archive effect by its compacted index or localized name alone. */
export function resolveEffectParameterBlocks(source:NativeArchiveSource,target:SchemaTarget) {
  const context=schemaContext(source,target);
  const resolved=resolveParameterInstance(context,target,false);
  if(!target.componentMatchNames&&resolved.matchingInstances!==1)throw Error('PARAMETER_SCHEMA_AMBIGUOUS_INSTANCE');
  return {clip:context.clip,component:resolved.component,blocks:resolved.blocks};
}
/** Definitions are returned only after occurrence, slot order, names and group
 * balance match the supplied live target. Missing bounds remain unknown. */
export function inspectEffectParameterSchema(source:NativeArchiveSource,target:SchemaTarget,includePointAnimation=false) {
  return resolveParameterInstance(schemaContext(source,target),target,includePointAnimation).schema;
}
/** One authoritative instance selection feeds both schema and typed-codec
 * readers. Retain error order: instance -> slots/names/groups -> animation. */
function resolveParameterInstance({clip,objects}:ReturnType<typeof schemaContext>,target:SchemaTarget,includePointAnimation:boolean){
  const get=(id:string)=>{const b=objects.get(id);if(!b)throw Error("PARAMETER_SCHEMA_OBJECT_MISSING");return b;};
  if(!Number.isInteger(target.componentIndex)||target.componentIndex<0||target.componentIndex>63)throw Error("PARAMETER_SCHEMA_INDEX_INVALID");
  const chain=get(ref(clip,"Components"));
  // Premiere omits default intrinsic components from saved chains. Align the
  // selected occurrence by match name, not the compacted archive index.
  const nativeMatch=(block:string)=>value(block,"MatchName")??value(block,"FilterMatchName");
  const candidates=[...chain.matchAll(/<Component Index="\d+" ObjectRef="(\d+)"/g)].filter(m=>nativeMatch(get(m[1]!))===target.componentMatchName);
  const occurrence=target.componentMatchNames?.slice(0,target.componentIndex).filter(n=>n===target.componentMatchName).length??0;
  const publicCount=target.componentMatchNames?.filter(n=>n===target.componentMatchName).length;
  if(publicCount!==undefined&&candidates.length!==publicCount)throw Error("PARAMETER_SCHEMA_EFFECT_OCCURRENCES_CHANGED");
  const componentRef=candidates[occurrence]?.[1];
  if(!componentRef)throw Error("PARAMETER_SCHEMA_COMPONENT_MISSING");const component=get(componentRef);
  const matchName=nativeMatch(component);
  if(matchName!==target.componentMatchName)throw Error("PARAMETER_SCHEMA_EFFECT_CHANGED: "+matchName);
  const entries=[...component.matchAll(/<Param Index="(\d+)" ObjectRef="(\d+)"/g)];
  if(entries.length!==target.parameterNames.length||entries.length>4096)throw Error("PARAMETER_SCHEMA_COUNT_CHANGED");
  const stack:number[]=[],blocks:string[]=[],parameters=entries.map((m,i)=>{
    if(Number(m[1])!==i)throw Error("PARAMETER_SCHEMA_SLOT_ORDER_CHANGED");
    const block=get(m[2]!);blocks.push(block);
    const row=parameterSchemaFromBlock(block,i,stack);
    if(row.name!==target.parameterNames[i])throw Error(`PARAMETER_SCHEMA_NAME_CHANGED: ${i}:${row.name}`);
    if(row.kind==="group_start")stack.push(i);
    if(row.kind==="group_end"){if(!stack.length)throw Error("PARAMETER_SCHEMA_UNBALANCED_GROUP");stack.pop();}
    return row;
  });
  if(stack.length)throw Error("PARAMETER_SCHEMA_UNBALANCED_GROUP");
  // The audio "Individual Parameters" group belongs to the native Boolean
  // bypass parameter (slot 0), not to the effect/clip. Manual false→true save
  // comparison proves this owner class and fixed UI key on Premiere 26.5.
  const container=/^<AudioFilterComponent\b/.test(component)&&blocks[0]&&/ClassID="32657501-3aa4-445f-a49b-d09ecb9fa1ae"/.test(blocks[0])?{paramIndex:0,name:parameters[0]!.name,key:"ECP.NonParamGroup.Expanded"}:undefined;
  const schema={status:"pass",source:"saved_premiere_parameter_definitions",componentIndex:target.componentIndex,matchName,parameters,...(container?{containerDisclosure:container}:{}),definitionHash:createHash("sha256").update(JSON.stringify([parameters,container])).digest("hex"),...(includePointAnimation?{pointAnimation:blocks.map(pointAnimationFromBlock).filter(Boolean)}:{})};
  return {schema,component,blocks,matchingInstances:candidates.length};
}
export type ChainAnimationTarget=MaskArchiveTarget&{mediaType:'video'|'audio';componentMatchNames:string[];components:Array<{componentIndex:number;componentMatchName:string;parameterNames:string[]}>};
/** One document and one index for all requested Point-bearing components.
 * No file access; exact occurrence/name vectors remain independently checked. */
export function inspectEffectChainAnimation(source:NativeArchiveSource,target:ChainAnimationTarget) {
  const context=schemaContext(source,target);
  const components=target.components.map(component=>resolveParameterInstance(context,{...target,...component},true).schema);
  return {status:'pass',components};
}
