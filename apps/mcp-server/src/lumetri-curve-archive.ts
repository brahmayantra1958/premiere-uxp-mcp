import {resolveEffectParameterBlocks,type SchemaTarget} from './effect-parameter-schema.js';
import {curveDigest,decodeHueSaturationCurve,encodeHueSaturationCurve,decodeRgbCurve,encodeRgbCurve,type RgbChannel,type CurvePoint} from './lumetri-curve-codec.js';
import {archiveDocument,type NativeArchiveSource} from './native-archive-document.js';

export type LumetriCurveTarget=SchemaTarget&{paramIndex:number;expectedDisplayName:string;curveKind?:'hue_saturation'|'rgb'|undefined;channel?:RgbChannel|undefined};
const decode=(bytes:Buffer,target:LumetriCurveTarget)=>target.curveKind==='rgb'?decodeRgbCurve(bytes,target.channel!):decodeHueSaturationCurve(bytes);
type RecordValue={literal:string;hash:string;encoded:string|null};
/** Resolve Adobe's deduplicated binary values before editing their owner. A
 * self-closing reference is never an empty payload; conflicting aliases fail. */
const binaryIndex=Symbol('lumetri binary records'),curveContexts=Symbol('lumetri contexts');
function binaryRecords(source:NativeArchiveSource):RecordValue[]{
  const document=archiveDocument(source);
  return document.memo(binaryIndex,()=>[...document.xml.matchAll(/<([\w.]+)\b([^<>]*\bBinaryHash="([a-fA-F0-9-]+)"[^<>]*)(?:\/>|>([^<]*)<\/\1>)/g)].map(m=>({literal:m[0],hash:m[3]!,encoded:m[4]?.replace(/\s/g,'')||null})));
}
function payload(records:RecordValue[],hash:string) {
  const values=[...new Set(records.filter(r=>r.hash===hash&&r.encoded!==null).map(r=>r.encoded!))];
  if(values.length!==1||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(values[0]!))throw Error('LUMETRI_CURVE_PAYLOAD_AMBIGUOUS');
  const bytes=Buffer.from(values[0]!,'base64');
  if(bytes.toString('base64')!==values[0])throw Error('LUMETRI_CURVE_PAYLOAD_INVALID');
  return bytes;
}
function buildContext(source:NativeArchiveSource,target:LumetriCurveTarget){
  const document=archiveDocument(source);
  if(target.mediaType!=='video'||target.componentMatchName!=='AE.ADBE Lumetri')throw Error('LUMETRI_CURVE_EFFECT_UNSUPPORTED');
  const resolved=resolveEffectParameterBlocks(document,target),block=resolved.blocks[target.paramIndex];
  if(!block||target.parameterNames[target.paramIndex]!==target.expectedDisplayName)throw Error('LUMETRI_CURVE_PARAMETER_CHANGED');
  const nativeId=target.curveKind==='rgb'?39:42;
  if(!/^<ArbVideoComponentParam\b[^>]*ClassID="313e54d4-6903-49ad-b0bf-8262cdd10f4e"[^>]*Version="3"/.test(block)||!block.includes('<ParameterControlType>9</ParameterControlType>')||!block.includes(`<ParameterID>${nativeId}</ParameterID>`))throw Error('LUMETRI_CURVE_PARAMETER_UNSUPPORTED');
  if(/<Keyframes(?:\s|>)/.test(block))throw Error('LUMETRI_CURVE_ANIMATION_UNSUPPORTED');
  const entries=binaryRecords(block).filter(r=>r.literal.startsWith('<StartKeyframeValue '));
  if(entries.length!==1)throw Error('LUMETRI_CURVE_VALUE_NOT_UNIQUE');
  const records=binaryRecords(document),entry=entries[0]!,bytes=payload(records,entry.hash);
  return {...resolved,block,records,entry,bytes,nativeId};
}
function context(source:NativeArchiveSource,target:LumetriCurveTarget){
  const document=archiveDocument(source),key=JSON.stringify(target);
  const contexts=document.memo(curveContexts,()=>new Map<string,ReturnType<typeof buildContext>>());
  if(!contexts.has(key))contexts.set(key,buildContext(document,target));
  return contexts.get(key)!;
}
export function inspectLumetriCurve(source:NativeArchiveSource,target:LumetriCurveTarget){
  const c=context(source,target);return {...decode(c.bytes,target),paramIndex:target.paramIndex,displayName:target.expectedDisplayName,nativeParameterId:c.nativeId,source:'saved_native_curve' as const};
}
/** Retain every other serialized parameter value, including opaque bytes.
 * Only Boolean UI disclosure metadata and serialization IDs/alias placement
 * are excluded. This is independent of UXP's unsupported opaque value fields. */
export function lumetriCurvePreservation(source:NativeArchiveSource,target:LumetriCurveTarget){
  const c=context(source,target);
  const retained=target.curveKind==='rgb'?decodeRgbCurve(c.bytes,target.channel!).channels.filter(row=>row.channel!==target.channel).map(row=>`${row.channel}:${row.sha256}`).join(','):'';
  return c.blocks.map((b,i)=>{
    let block=b.replace(/\s*<ECP\.(?:Custom|Group|Slider|Angle|PointParameter)\.Expanded>(?:true|false)<\/ECP\.(?:Custom|Group|Slider|Angle|PointParameter)\.Expanded>/g,'')
      .replace(/\s*<Properties Version="1">\s*<\/Properties>/g,'').replace(/\s*<Node Version="1">\s*<\/Node>/g,'');
    for(const r of binaryRecords(b))block=block.replace(r.literal,i===target.paramIndex&&r.literal.startsWith('<StartKeyframeValue ')?`<TypedCurve>${retained}</TypedCurve>`:`<NativeBinary>${curveDigest(payload(c.records,r.hash))}</NativeBinary>`);
    return block.replace(/ ObjectID="\d+"/g,'').replace(/>\s+</g,'><').trim();
  });
}
function archiveHash(bytes:Buffer){
  // Existing typed caption archive route's content-address format. Native
  // acceptance is established separately by reopen + fresh Premiere save.
  const h=curveDigest(bytes).slice(0,24)+(bytes.length+12).toString(16).padStart(8,'0');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
/** L2: isolate exactly one known curve. References sharing its old BinaryHash
 * receive the unchanged payload before its sole owner can be replaced. No raw
 * XML, bytes, storage IDs, arbitrary property paths or file paths are inputs. */
export function patchLumetriCurve(source:NativeArchiveSource,target:LumetriCurveTarget,expectedSha256:string,points:CurvePoint[]) {
  const document=archiveDocument(source),xml=document.xml;
  const c=context(document,target),encoded=target.curveKind==='rgb'?encodeRgbCurve(c.bytes,expectedSha256,target.channel!,points):encodeHueSaturationCurve(c.bytes,expectedSha256,points),hash=archiveHash(encoded.bytes);
  if(encoded.after.sha256===encoded.before.sha256)return {xml,before:encoded.before,after:encoded.after};
  if(c.records.some(r=>r.hash===hash)&&!payload(c.records,hash).equals(encoded.bytes))throw Error('LUMETRI_CURVE_HASH_COLLISION');
  // Materialize every old reference outside the exact target block. It changes
  // serialization ownership only, preserving each other logical binary value.
  let preserved=xml.replace(c.block,'<LUMETRI_TYPED_TARGET/>');
  if(preserved.indexOf('<LUMETRI_TYPED_TARGET/>')!==preserved.lastIndexOf('<LUMETRI_TYPED_TARGET/>'))throw Error('LUMETRI_CURVE_TARGET_NOT_UNIQUE');
  for(const r of c.records.filter(r=>r.hash===c.entry.hash&&r.encoded===null)){
    const expanded=r.literal.replace(/\/>$/,`>${c.bytes.toString('base64')}</${/^<([\w.]+)/.exec(r.literal)![1]}>`);
    preserved=preserved.replaceAll(r.literal,expanded);
  }
  const value=`<StartKeyframeValue Encoding="base64" BinaryHash="${hash}">${encoded.bytes.toString('base64')}</StartKeyframeValue>`;
  const output=preserved.replace('<LUMETRI_TYPED_TARGET/>',c.block.replace(c.entry.literal,value));
  const outputDocument=archiveDocument(output),after=inspectLumetriCurve(outputDocument,target);
  if(after.sha256!==encoded.after.sha256)throw Error('LUMETRI_CURVE_PATCH_READBACK_FAILED');
  // Every preexisting binary hash referenced outside the replaced block must
  // still resolve to exactly the same bytes, including all deduplicated aliases.
  const records=binaryRecords(outputDocument);
  if(binaryRecords(preserved).some(r=>r.hash===c.entry.hash)&&!c.bytes.equals(payload(records,c.entry.hash)))throw Error('LUMETRI_CURVE_OTHER_PAYLOAD_CHANGED');
  return {xml:output,before:encoded.before,after:encoded.after};
}
