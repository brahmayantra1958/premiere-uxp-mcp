import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import type {
  ArchiveMediaType, ArchiveTrackSnapshot, CaptionStyleSnapshot,
  CaptionCueBinarySnapshot, CaptionCueSnapshot, SequenceArchiveSnapshot,
} from './sequence-archive-types.js';

// Preserve the archive API's type exports; pure consumers use the type module.
export type {
  ArchiveMediaType, ArchiveTrackSnapshot, CaptionStyleSnapshot,
  CaptionCueBinarySnapshot, CaptionCueSnapshot, SequenceArchiveSnapshot,
} from './sequence-archive-types.js';

const unzip = promisify(gunzip);
const zip = promisify(gzip);

const media = {
  video: { guid: "228cda18-3625-4d2d-951e-348879e4ed93", groupTag: "VideoTrackGroup", trackTag: "VideoClipTrack", expectedUidReferences: 2 },
  audio: { guid: "80b8e3d5-6dca-4195-aefb-cb5f407ab009", groupTag: "AudioTrackGroup", trackTag: "AudioClipTrack", expectedUidReferences: 3 },
  caption: { guid: "d8143ffe-eec4-4d2a-a909-d5f7bf094dc5", groupTag: "DataTrackGroup", trackTag: "CaptionDataClipTrack", expectedUidReferences: 2 },
} as const satisfies Record<ArchiveMediaType, {
  guid: string; groupTag: string; trackTag: string; expectedUidReferences: number;
}>;

export type RemoveTrackTarget = Pick<ArchiveTrackSnapshot, "mediaType" | "index" | "id" | "uid" | "name"> & {
  expectedItemCount: 0;
  expectedTransitionCount: 0;
};

export type CaptionCueStyleOverride = {fontPostScriptName?:string|undefined;fontSize?:number|undefined;fillColor?:{r:number;g:number;b:number}|undefined};
export type CaptionCueStyleItem = CaptionCueStyleOverride & {itemIndex:number;expectedStartTicks:string;expectedEndTicks:string};
export type CaptionStyleTarget = {
  trackUid: string;
  expectedTrackId: number;
  expectedTrackName: string;
  expectedItemCount: number;
  fontPostScriptName?: string|undefined;
  fontSize?: number|undefined;
  items?: CaptionCueStyleItem[]|undefined;
};

/** Also used before any host save/close; direct archive callers do not bypass
 * the public schema's mode, identity and supported-field checks. */
export function assertCaptionStyleTarget(target:CaptionStyleTarget):void{
  if(Object.keys(target).some(key=>!['trackUid','expectedTrackId','expectedTrackName','expectedItemCount','fontPostScriptName','fontSize','items'].includes(key)))throw Error('UNSUPPORTED_CAPTION_STYLE_FIELD');
  if(!target.trackUid||!Number.isInteger(target.expectedTrackId)||target.expectedTrackId<0||!Number.isInteger(target.expectedItemCount)||target.expectedItemCount<1)throw Error('INVALID_CAPTION_STYLE_TARGET');
  const validate=(style:CaptionCueStyleOverride)=>{
    if(style.fontPostScriptName!==undefined&&!/^[\x20-\x7e]{3,100}$/.test(style.fontPostScriptName))throw Error('INVALID_POSTSCRIPT_FONT_NAME');
    if(style.fontSize!==undefined&&(!Number.isFinite(style.fontSize)||style.fontSize<1||style.fontSize>1000))throw Error('INVALID_CAPTION_FONT_SIZE');
    if(style.fillColor!==undefined&&(!style.fillColor||Object.keys(style.fillColor).sort().join(',')!=='b,g,r'||![style.fillColor.r,style.fillColor.g,style.fillColor.b].every(v=>Number.isInteger(v)&&v>=0&&v<=255)))throw Error('INVALID_CAPTION_FILL_COLOR');
  };
  if(target.items!==undefined){
    if(target.fontPostScriptName!==undefined||target.fontSize!==undefined)throw Error('CAPTION_STYLE_MODES_CONFLICT');
    if(!Array.isArray(target.items)||target.items.length<1||target.items.length>1000)throw Error('INVALID_CAPTION_STYLE_ITEMS');
    const indexes=new Set<number>();
    for(const item of target.items){
      if(Object.keys(item).some(key=>!['itemIndex','expectedStartTicks','expectedEndTicks','fontPostScriptName','fontSize','fillColor'].includes(key)))throw Error('UNSUPPORTED_CAPTION_CUE_STYLE_FIELD');
      if(!Number.isInteger(item.itemIndex)||item.itemIndex<0||indexes.has(item.itemIndex))throw Error('DUPLICATE_OR_INVALID_CAPTION_ITEM_INDEX');indexes.add(item.itemIndex);
      if(!/^(0|[1-9]\d*)$/.test(item.expectedStartTicks)||!/^(0|[1-9]\d*)$/.test(item.expectedEndTicks)||BigInt(item.expectedEndTicks)<=BigInt(item.expectedStartTicks))throw Error('INVALID_CAPTION_ITEM_TICKS');
      if(item.fontPostScriptName===undefined&&item.fontSize===undefined&&item.fillColor===undefined)throw Error('EMPTY_CAPTION_STYLE_OVERRIDE');validate(item);
    }
  }else{if(target.fontPostScriptName===undefined||target.fontSize===undefined)throw Error('CAPTION_TRACK_FONT_AND_SIZE_REQUIRED');validate(target);}
}

export type PatchSequenceArchiveInput = {
  projectPath: string;
  sequenceName: string;
  expectedSequenceUid: string;
  /** Hash of the exact saved bytes used for pre-close candidate validation. */
  expectedSourceSha256?: string;
  removeTracks?: RemoveTrackTarget[];
  captionStyle?: CaptionStyleTarget;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attr(attributes: string, name: string): string {
  return new RegExp(String.raw`\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? "";
}

function tag(block: string, name: string): string {
  return new RegExp(String.raw`<${escapeRegExp(name)}>([\s\S]*?)<\/${escapeRegExp(name)}>`).exec(block)?.[1]?.trim() ?? "";
}

function objectBlock(xml: string, objectTag: string, attributeName: "ObjectID" | "ObjectUID", value: string): string {
  const pattern = new RegExp(String.raw`<${objectTag}\b[^>]*\b${attributeName}="${escapeRegExp(value)}"[^>]*>[\s\S]*?<\/${objectTag}>`, "g");
  const blocks = [...xml.matchAll(pattern)];
  if (blocks.length === 0) throw new Error(`PROJECT_ARCHIVE_OBJECT_NOT_FOUND: ${objectTag} ${attributeName}=${value}`);
  if (blocks.length !== 1) throw new Error(`PROJECT_ARCHIVE_OBJECT_NOT_UNIQUE: ${objectTag} ${attributeName}=${value}`);
  return blocks[0]![0];
}

function sequenceBlock(xml: string, sequenceName: string): string {
  // SequenceSource stores self-closing ObjectURef tags before the actual
  // definitions. A generic paired-tag regex can consume from such a reference
  // through a later definition and silently return an empty ObjectUID.
  const matches = [...xml.matchAll(/<Sequence\b(?=[^>]*\bObjectUID="[^"]+")(?![^>]*\/\s*>)[^>]*>[\s\S]*?<\/Sequence>/g)]
    .filter(match => tag(match[0], "Name") === sequenceName);
  if (matches.length === 0) throw new Error(`PROJECT_ARCHIVE_SEQUENCE_NOT_FOUND: ${sequenceName}`);
  if (matches.length !== 1) throw new Error(`PROJECT_ARCHIVE_SEQUENCE_NOT_UNIQUE: ${sequenceName}`);
  return matches[0]![0];
}

function groupReference(sequence: string, mediaType: ArchiveMediaType): string {
  const groups = [...sequence.matchAll(/<TrackGroup\b[^>]*>([\s\S]*?)<\/TrackGroup>/g)]
    .filter(match => tag(match[1] ?? "", "First") === media[mediaType].guid);
  if (!groups.length) throw new Error(`PROJECT_ARCHIVE_TRACK_GROUP_NOT_FOUND: ${mediaType}`);
  const references = [...(groups[0]?.[1] ?? "").matchAll(/<Second\b[^>]*ObjectRef="([^"]+)"[^>]*\/>/g)];
  if (groups.length !== 1 || references.length !== 1) throw new Error(`PROJECT_ARCHIVE_TRACK_GROUP_NOT_UNIQUE: ${mediaType}`);
  return references[0]![1]!;
}

function referenceCount(xml: string, attribute: "ObjectRef" | "ObjectURef" | "ObjectUID", value: string): number {
  return [...xml.matchAll(new RegExp(String.raw`\b${attribute}="${escapeRegExp(value)}"`, "g"))].length;
}

function uniqueObjectReference(block: string, ownerTag: string, label: string): string {
  const references = [...block.matchAll(new RegExp(String.raw`<${ownerTag}\b[^>]*\bObjectRef="([^"]+)"[^>]*\/>`, "g"))];
  if (references.length !== 1) throw new Error(`UNSUPPORTED_AUDIO_INLET_OWNERSHIP: ${label}`);
  return references[0]![1]!;
}

/** Removing a group entry can affect another sequence even when each track UID
 * still has the expected reference count. Prove exclusive group ownership and
 * every survivor's graph before changing any shared definition or index.
 * Audio supports the observed group -> master mix track -> inlet graph only;
 * a submix/shared/unknown graph must not become a global inlet rewrite. */
function assertTrackRemovalOwnership(xml: string, before: SequenceArchiveSnapshot, removals: RemoveTrackTarget[]): { audioInlet?: string } {
  const sequence = sequenceBlock(xml, before.sequenceName);
  let audioInlet: string | undefined;
  for (const mediaType of Object.keys(media) as ArchiveMediaType[]) {
    if (!removals.some(target => target.mediaType === mediaType)) continue;
    const groupId = groupReference(sequence, mediaType);
    const group = objectBlock(xml, media[mediaType].groupTag, "ObjectID", groupId);
    // The sole ObjectRef is the selected sequence's Second reference. A second
    // sequence sharing this group is rejected even though track counts match.
    if (referenceCount(xml, "ObjectRef", groupId) !== 1) {
      throw new Error(`UNSUPPORTED_TRACK_GROUP_OWNERSHIP: ${mediaType} ${groupId}`);
    }
    const tracks = before.tracks.filter(track => track.mediaType === mediaType);
    for (const track of tracks) {
      if (referenceCount(xml, "ObjectUID", track.uid) !== 1
        || referenceCount(xml, "ObjectURef", track.uid) !== media[mediaType].expectedUidReferences - 1) {
        throw new Error(`UNSUPPORTED_TRACK_REFERENCE_GRAPH: ${track.uid}`);
      }
    }
    if (mediaType === "audio") {
      const masterId = uniqueObjectReference(group, "MasterTrack", "master track");
      const master = objectBlock(xml, "AudioMixTrack", "ObjectID", masterId);
      const inletId = uniqueObjectReference(master, "Inlet", "master inlet");
      audioInlet = objectBlock(xml, "AudioTrackInlet", "ObjectID", inletId);
      if (referenceCount(xml, "ObjectRef", masterId) !== 1 || referenceCount(xml, "ObjectRef", inletId) !== 1) {
        throw new Error(`UNSUPPORTED_AUDIO_INLET_OWNERSHIP: ${inletId}`);
      }
      const containers = [...audioInlet.matchAll(/<Sources\b[^>]*>([\s\S]*?)<\/Sources>/g)];
      const sources = [...(containers[0]?.[1] ?? "").matchAll(/<Source\b([^>]*)\/>/g)]
        .map(match => ({ index: Number(attr(match[1] ?? "", "Index")), uid: attr(match[1] ?? "", "ObjectURef") }));
      if (containers.length !== 1 || JSON.stringify(sources) !== JSON.stringify(tracks.map(track => ({ index: track.index, uid: track.uid })))) {
        throw new Error(`UNSUPPORTED_AUDIO_INLET_OWNERSHIP: source layout ${inletId}`);
      }
    }
  }
  return audioInlet === undefined ? {} : { audioInlet };
}

function trackReferences(group: string): Array<{ index: number; uid: string; raw: string }> {
  const tracks = /<Tracks\b[^>]*>([\s\S]*?)<\/Tracks>/.exec(group)?.[1];
  if (tracks == null) throw new Error("PROJECT_ARCHIVE_TRACK_LIST_NOT_FOUND");
  return [...tracks.matchAll(/<Track\b([^>]*)\/>/g)].map((match) => ({
    index: Number(attr(match[1] ?? "", "Index")),
    uid: attr(match[1] ?? "", "ObjectURef"),
    raw: match[0],
  }));
}

type IndexedTrackContainer = "Track" | "ClipItems" | "TransitionItems";

function indexedContainer(
  definition: string,
  containerTag: IndexedTrackContainer,
  trackUid: string,
): { block: string; index: number } {
  const pattern = new RegExp(String.raw`<${containerTag}\b[^>]*>[\s\S]*?<\/${containerTag}>`, "g");
  const matches = [...definition.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`TRACK_CONTAINER_NOT_UNIQUE: ${trackUid} ${containerTag}`);
  const block = matches[0]![0];
  const indexes = [...block.matchAll(/<Index>(\d+)<\/Index>/g)];
  if (indexes.length !== 1) throw new Error(`TRACK_CONTAINER_INDEX_NOT_UNIQUE: ${trackUid} ${containerTag}`);
  return { block, index: Number(indexes[0]![1]) };
}

function patchIndexedContainer(
  definition: string,
  containerTag: IndexedTrackContainer,
  trackUid: string,
  expectedIndex: number,
  nextIndex: number,
): string {
  const container = indexedContainer(definition, containerTag, trackUid);
  if (container.index !== expectedIndex) {
    throw new Error(`TRACK_CONTAINER_INDEX_MISMATCH: ${trackUid} ${containerTag} expected ${expectedIndex}, found ${container.index}`);
  }
  const patched = container.block.replace(/<Index>\d+<\/Index>/, `<Index>${nextIndex}</Index>`);
  return replaceOnce(definition, container.block, patched, `TRACK_CONTAINER_AMBIGUOUS: ${trackUid} ${containerTag}`);
}

function flatBufferFontRecord(bytes: Buffer): { name: string; vectorOffset: number; referenceOffset: number } {
  if (bytes.length < 64 || bytes.readUInt32LE(0) + 12 !== bytes.length || bytes.readUInt32LE(8) !== 0x11223344) {
    throw new Error("UNSUPPORTED_CAPTION_STYLE_BINARY_HEADER");
  }
  const candidates: Array<{ name: string; vectorOffset: number; referenceOffset: number }> = [];
  for (let vectorOffset = 12; vectorOffset <= bytes.length - 8; vectorOffset += 4) {
    const length = bytes.readUInt32LE(vectorOffset);
    if (length < 3 || length > 100 || vectorOffset + 5 + length > bytes.length) continue;
    const value = bytes.subarray(vectorOffset + 4, vectorOffset + 4 + length);
    if (bytes[vectorOffset + 4 + length] !== 0 || [...value].some((byte) => byte < 0x20 || byte > 0x7e)) continue;
    const name = value.toString("utf8");
    if (!/[A-Za-z]/.test(name)) continue;
    const references: number[] = [];
    for (let offset = 12; offset < vectorOffset; offset += 4) {
      if (offset + bytes.readUInt32LE(offset) === vectorOffset) references.push(offset);
    }
    const typedReferences = references.filter((offset) => offset >= 4 && bytes.readUInt32LE(offset - 4) === 1);
    if (typedReferences.length === 1) candidates.push({ name, vectorOffset, referenceOffset: typedReferences[0]! });
  }
  if (candidates.length !== 1) throw new Error(`UNSUPPORTED_CAPTION_STYLE_FONT_LAYOUT: found ${candidates.length} active string vectors`);
  return candidates[0]!;
}

type FlatBufferTableLayout = {
  tableOffset: number;
  vtableOffset: number;
  vtableLength: number;
  objectLength: number;
  fieldOffsets: number[];
};

function flatBufferTableAt(bytes: Buffer, tableOffset: number): FlatBufferTableLayout {
  if (tableOffset < 12 || tableOffset + 4 > bytes.length) throw new Error("UNSUPPORTED_CAPTION_CUE_TABLE_OFFSET");
  const vtableDistance = bytes.readInt32LE(tableOffset);
  if (vtableDistance === 0) throw new Error("UNSUPPORTED_CAPTION_CUE_VTABLE_DISTANCE");
  const vtableOffset = tableOffset - vtableDistance;
  if (vtableOffset < 12 || vtableOffset + 4 > bytes.length || vtableOffset%2 || tableOffset%4) throw new Error("UNSUPPORTED_CAPTION_CUE_VTABLE_OFFSET");
  const vtableLength = bytes.readUInt16LE(vtableOffset);
  const objectLength = bytes.readUInt16LE(vtableOffset + 2);
  if (vtableLength < 4 || vtableLength % 2 !== 0 || vtableOffset + vtableLength > bytes.length) {
    throw new Error("UNSUPPORTED_CAPTION_CUE_VTABLE_LENGTH");
  }
  if (objectLength < 4 || tableOffset + objectLength > bytes.length) throw new Error("UNSUPPORTED_CAPTION_CUE_OBJECT_LENGTH");
  const fieldOffsets: number[] = [];
  for (let offset = 4; offset < vtableLength; offset += 2) {
    const fieldOffset = bytes.readUInt16LE(vtableOffset + offset);
    if (fieldOffset !== 0 && (fieldOffset < 4 || fieldOffset >= objectLength)) {
      throw new Error("UNSUPPORTED_CAPTION_CUE_FIELD_OFFSET");
    }
    fieldOffsets.push(fieldOffset);
  }
  return { tableOffset, vtableOffset, vtableLength, objectLength, fieldOffsets };
}

function flatBufferStringAt(bytes: Buffer, referenceOffset: number): { text: string; vectorOffset: number } {
  if (referenceOffset < 12 || referenceOffset + 4 > bytes.length) throw new Error("UNSUPPORTED_CAPTION_CUE_STRING_REFERENCE");
  const relativeOffset = bytes.readUInt32LE(referenceOffset);
  const vectorOffset = referenceOffset + relativeOffset;
  if (relativeOffset === 0 || vectorOffset + 5 > bytes.length) throw new Error("UNSUPPORTED_CAPTION_CUE_STRING_VECTOR");
  const length = bytes.readUInt32LE(vectorOffset);
  if (length > 1024 * 1024 || vectorOffset + 5 + length > bytes.length || bytes[vectorOffset + 4 + length] !== 0) {
    throw new Error("UNSUPPORTED_CAPTION_CUE_STRING_LENGTH");
  }
  const raw = bytes.subarray(vectorOffset + 4, vectorOffset + 4 + length);
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) throw new Error("UNSUPPORTED_CAPTION_CUE_TEXT_ENCODING");
  return { text, vectorOffset };
}

function tableField(table:FlatBufferTableLayout,slot:number,width=4):number|undefined{
  const offset=table.fieldOffsets[slot];if(!offset)return;
  const next=Math.min(table.objectLength,...table.fieldOffsets.filter(v=>v>offset));
  if(offset+width>next)throw Error('UNSUPPORTED_CAPTION_FIELD_WIDTH');return table.tableOffset+offset;
}
function tablePointer(bytes:Buffer,table:FlatBufferTableLayout,slot:number):number{
  const field=tableField(table,slot);if(field===undefined)throw Error('UNSUPPORTED_CAPTION_REQUIRED_FIELD');
  const relative=bytes.readUInt32LE(field);if(!relative||field+relative>=bytes.length)throw Error('UNSUPPORTED_CAPTION_REFERENCE');return field+relative;
}
function flatBufferCueRecord(bytes: Buffer) {
  if (bytes.length < 64 || bytes.readUInt32LE(0) + 12 !== bytes.length || bytes.readUInt32LE(8) !== 0x11223344) {
    throw new Error("UNSUPPORTED_CAPTION_CUE_BINARY_HEADER");
  }
  const root=flatBufferTableAt(bytes,12+bytes.readUInt32LE(12)),document=flatBufferTableAt(bytes,tablePointer(bytes,root,0));
  if(root.fieldOffsets.length!==1)throw Error('UNSUPPORTED_CAPTION_ROOT_LAYOUT');
  const fonts=tablePointer(bytes,document,1);if(fonts+8>bytes.length||bytes.readUInt32LE(fonts)!==1)throw Error('UNSUPPORTED_CAPTION_MULTIPLE_FONTS');
  const vector=tablePointer(bytes,document,0);
  if(vector+8>bytes.length||bytes.readUInt32LE(vector)!==1)throw Error('UNSUPPORTED_CAPTION_MULTIPLE_TEXT_RUNS');
  const run=flatBufferTableAt(bytes,vector+4+bytes.readUInt32LE(vector+4));
  if(run.fieldOffsets.length!==2)throw Error('UNSUPPORTED_CAPTION_TEXT_RUN_LAYOUT');
  const textReferenceOffset=tableField(run,0)!,styleReferenceOffset=tableField(run,1)!;
  const styleTable=flatBufferTableAt(bytes,tablePointer(bytes,run,1)),fontSizeOffset=tableField(styleTable,1);
  const fontSize=fontSizeOffset===undefined?100:bytes.readFloatLE(fontSizeOffset);
  if(!Number.isFinite(fontSize)||fontSize<1||fontSize>1000)throw Error('UNSUPPORTED_CAPTION_CUE_SIZE_LAYOUT');
  return {text:flatBufferStringAt(bytes,textReferenceOffset).text,textReferenceOffset,styleReferenceOffset,styleTable,fontSizeOffset,fontSize,document};
}

/** Format facts independently checked against py-premiere's MIT style-sweep
 * fixture 82 (commit 38e72ef5): style slot 2 -> RGB ubyte slots 0/1/2,
 * sentinel 11/22/33. Alpha is not stored here. No upstream code is copied. */
function cueFillColor(bytes:Buffer,style:FlatBufferTableLayout):CaptionCueBinarySnapshot['fillColor']{
  if(tableField(style,2)===undefined)return null;
  const color=flatBufferTableAt(bytes,tablePointer(bytes,style,2));
  if(color.fieldOffsets.length!==3)throw Error('UNSUPPORTED_CAPTION_FILL_COLOR_LAYOUT');
  const fields=[0,1,2].map(slot=>tableField(color,slot,1));
  if(fields.some(v=>v===undefined)||new Set(fields).size!==3)throw Error('UNSUPPORTED_CAPTION_FILL_COLOR_LAYOUT');
  return {r:bytes[fields[0]!]!,g:bytes[fields[1]!]!,b:bytes[fields[2]!]!};
}

/** Compare rooted values, not relocatable addresses or unreachable old tables.
 * Unknown fields fail closed instead of disappearing from preservation proof. */
function cuePreservedStyle(bytes:Buffer,cue:ReturnType<typeof flatBufferCueRecord>):string{
  const scalar=(table:FlatBufferTableLayout,slot:number,width:number)=>{const field=tableField(table,slot,width);return field===undefined?null:bytes.subarray(field,field+width).toString('hex');};
  const nested=(parent:FlatBufferTableLayout,slot:number,kind:'rgb'|'empty')=>{
    const child=flatBufferTableAt(bytes,tablePointer(bytes,parent,slot));
    if(kind==='empty'){if(child.fieldOffsets.length)throw Error('UNSUPPORTED_CAPTION_PRESERVATION_NESTED_TABLE');return [];}
    if(child.fieldOffsets.length!==3)throw Error('UNSUPPORTED_CAPTION_PRESERVATION_COLOR');
    return [0,1,2].map(i=>{const field=tableField(child,i,1);if(field===undefined)throw Error('UNSUPPORTED_CAPTION_PRESERVATION_COLOR');return bytes[field];});
  };
  const styleScalars=new Map([[5,1],[6,4],[8,4],[12,4],[13,4],[14,1],[15,1],[16,1],[24,4]]);
  const style:unknown[]=[];
  for(const [slot,offset] of cue.styleTable.fieldOffsets.entries())if(offset&&slot!==1&&slot!==2){
    if(styleScalars.has(slot))style.push([slot,scalar(cue.styleTable,slot,styleScalars.get(slot)!)]);
    else if([4,21,23].includes(slot))style.push([slot,nested(cue.styleTable,slot,slot===4?'rgb':'empty')]);
    else throw Error('UNSUPPORTED_CAPTION_PRESERVATION_STYLE_FIELD:'+slot);
  }
  const documentScalars=new Map([[4,4],[5,4],[6,4],[11,1],[12,4],[13,4],[14,4],[15,4],[16,4],[18,1],[19,4],[20,4],[34,4],[38,1],[43,1],[44,1]]),document:unknown[]=[];
  for(const [slot,offset] of cue.document.fieldOffsets.entries())if(offset&&slot!==0&&slot!==1){
    if(documentScalars.has(slot))document.push([slot,scalar(cue.document,slot,documentScalars.get(slot)!)]);
    else if([10,17,40].includes(slot))document.push([slot,nested(cue.document,slot,slot===40?'empty':'rgb')]);
    else if(slot===32){
      const vector=tablePointer(bytes,cue.document,slot),count=bytes.readUInt32LE(vector),values:string[]=[];
      if(count>32||vector+4+4*count>bytes.length)throw Error('UNSUPPORTED_CAPTION_STYLE_METADATA_VECTOR');
      for(let i=0;i<count;i++){const ref=vector+4+4*i,table=flatBufferTableAt(bytes,ref+bytes.readUInt32LE(ref));if(table.fieldOffsets.length!==1)throw Error('UNSUPPORTED_CAPTION_STYLE_METADATA_TABLE');const field=tableField(table,0);if(field===undefined)throw Error('UNSUPPORTED_CAPTION_STYLE_METADATA_TABLE');values.push(flatBufferStringAt(bytes,field).text);}
      document.push([slot,values]);
    }else throw Error('UNSUPPORTED_CAPTION_PRESERVATION_DOCUMENT_FIELD:'+slot);
  }
  return createHash('sha256').update(JSON.stringify({style,document})).digest('hex');
}

function appendCueStyle(bytes:Buffer,cue:ReturnType<typeof flatBufferCueRecord>,override:CaptionCueStyleOverride):Buffer{
  const style=cue.styleTable,scalarWidths=new Map([[1,4],[5,1],[6,4],[8,4],[12,4],[13,4],[14,1],[15,1],[16,1],[24,4]]),references=new Set([2,4,21,23]);
  for(const [slot,offset] of style.fieldOffsets.entries())if(offset){if(scalarWidths.has(slot))tableField(style,slot,scalarWidths.get(slot));else if(!references.has(slot))throw Error('UNSUPPORTED_CAPTION_STYLE_FIELD:'+slot);}
  const fields=[...style.fieldOffsets];while(fields.length<3)fields.push(0);
  let length=style.objectLength;
  for(const slot of [1,2])if((slot===1?override.fontSize!==undefined:override.fillColor!==undefined)&&!fields[slot]){length=Math.ceil(length/4)*4;fields[slot]=length;length+=4;}
  const body=Buffer.alloc(length);bytes.copy(body,0,style.tableOffset,style.tableOffset+style.objectLength);
  const vtable=Buffer.alloc(4+2*fields.length);vtable.writeUInt16LE(vtable.length,0);vtable.writeUInt16LE(length,2);fields.forEach((offset,i)=>vtable.writeUInt16LE(offset,4+2*i));
  const chunks:Buffer[]=[Buffer.from(bytes)];let position=bytes.length;
  const append=(vt:Buffer,value:Buffer)=>{const pad=Buffer.alloc((4-(position+vt.length)%4)%4),vpos=position+pad.length,tpos=vpos+vt.length;value.writeInt32LE(vt.length,0);chunks.push(pad,vt,value);position=tpos+value.length;return tpos;};
  const newStyle=append(vtable,body);
  for(const slot of references){
    if(!fields[slot])continue;
    let childBody:Buffer,childVtable:Buffer;
    if(slot===2&&override.fillColor){childVtable=Buffer.from('0a000800050006000700','hex');childBody=Buffer.alloc(8);const color=override.fillColor;childBody[5]=color.r;childBody[6]=color.g;childBody[7]=color.b;}
    else{
      const child=flatBufferTableAt(bytes,tablePointer(bytes,style,slot));
      if(slot===2||slot===4){if(child.fieldOffsets.length!==3||[0,1,2].some(i=>tableField(child,i,1)===undefined))throw Error('UNSUPPORTED_CAPTION_COLOR_LAYOUT');}
      else if(child.fieldOffsets.length!==0)throw Error('UNSUPPORTED_CAPTION_STYLE_NESTED_TABLE');
      childBody=Buffer.from(bytes.subarray(child.tableOffset,child.tableOffset+child.objectLength));childVtable=Buffer.from(bytes.subarray(child.vtableOffset,child.vtableOffset+child.vtableLength));
    }
    const childOffset=append(childVtable,childBody);body.writeUInt32LE(childOffset-newStyle-fields[slot]!,fields[slot]!);
  }
  if(override.fontSize!==undefined)body.writeFloatLE(override.fontSize,fields[1]!);
  const result=Buffer.concat(chunks);result.writeUInt32LE(newStyle-cue.styleReferenceOffset,cue.styleReferenceOffset);result.writeUInt32LE(result.length-12,0);return result;
}

const fontSizeTail = Buffer.from("f4fffffff8fffffffcffffff0400040004000000", "hex");

function flatBufferFontSizeOffset(bytes: Buffer): number {
  const first = bytes.indexOf(fontSizeTail);
  if (first < 4 || bytes.indexOf(fontSizeTail, first + 1) >= 0) throw new Error("UNSUPPORTED_CAPTION_STYLE_SIZE_LAYOUT");
  const offset = first - 4;
  const value = bytes.readFloatLE(offset);
  if (!Number.isFinite(value) || value < 1 || value > 1_000) throw new Error(`INVALID_CAPTION_STYLE_SIZE: ${value}`);
  return offset;
}

function binaryHash(bytes: Buffer): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
  const byteCountWithEnvelope = (bytes.length + 12).toString(16).padStart(8, "0");
  const value = `${digest}${byteCountWithEnvelope}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function patchFlatBufferFont(
  before: Buffer,
  font: ReturnType<typeof flatBufferFontRecord>,
  fontPostScriptName: string,
): Buffer {
  if (font.name === fontPostScriptName) return Buffer.from(before);
  const prefixPadding = (4 - (before.length % 4)) % 4;
  const fontBytes = Buffer.from(fontPostScriptName, "utf8");
  const vectorLength = 4 + fontBytes.length + 1;
  const suffixPadding = (4 - (vectorLength % 4)) % 4;
  const vector = Buffer.alloc(vectorLength + suffixPadding);
  vector.writeUInt32LE(fontBytes.length, 0);
  fontBytes.copy(vector, 4);
  const patched = Buffer.concat([Buffer.from(before), Buffer.alloc(prefixPadding), vector]);
  const vectorOffset = before.length + prefixPadding;
  patched.writeUInt32LE(vectorOffset - font.referenceOffset, font.referenceOffset);
  return patched;
}

export function inspectCaptionStyleBinary(encoded: string, hash = ""): CaptionStyleSnapshot {
  const bytes = Buffer.from(encoded, "base64");
  const font = flatBufferFontRecord(bytes);
  return {
    binaryHash: hash,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    fontPostScriptName: font.name,
    fontSize: bytes.readFloatLE(flatBufferFontSizeOffset(bytes)),
    byteLength: bytes.length,
  };
}

export function patchCaptionStyleBinary(encoded: string, fontPostScriptName: string, fontSize: number): { encoded: string; snapshot: CaptionStyleSnapshot } {
  if (!/^[\x20-\x7e]{3,100}$/.test(fontPostScriptName)) throw new Error("INVALID_POSTSCRIPT_FONT_NAME");
  if (!Number.isFinite(fontSize) || fontSize < 1 || fontSize > 1_000) throw new Error("INVALID_CAPTION_FONT_SIZE");
  const before = Buffer.from(encoded, "base64");
  const font = flatBufferFontRecord(before);
  const sizeOffset = flatBufferFontSizeOffset(before);
  const patched = patchFlatBufferFont(before, font, fontPostScriptName);
  patched.writeFloatLE(fontSize, sizeOffset);
  patched.writeUInt32LE(patched.length - 12, 0);
  const hash = binaryHash(patched);
  const snapshot = inspectCaptionStyleBinary(patched.toString("base64"), hash);
  if (snapshot.fontPostScriptName !== fontPostScriptName || Math.abs(snapshot.fontSize - fontSize) > 0.001) {
    throw new Error("CAPTION_STYLE_BINARY_READBACK_MISMATCH");
  }
  return { encoded: patched.toString("base64"), snapshot };
}

export function inspectCaptionCueBinary(encoded: string, hash = ""): CaptionCueBinarySnapshot {
  const bytes = Buffer.from(encoded, "base64");
  const font = flatBufferFontRecord(bytes);
  const cue = flatBufferCueRecord(bytes);
  return {
    binaryHash: hash,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    fontPostScriptName: font.name,
    fontSize: cue.fontSize,
    fillColor:cueFillColor(bytes,cue.styleTable),
    preservedStyleSha256:cuePreservedStyle(bytes,cue),
    byteLength: bytes.length,
    text: cue.text,
  };
}

export function patchCaptionCueBinary(encoded:string,styleOrFont:CaptionCueStyleOverride|string,legacySize?:number):{encoded:string;snapshot:CaptionCueBinarySnapshot}{
  const override:CaptionCueStyleOverride=typeof styleOrFont==='string'?{fontPostScriptName:styleOrFont,...(legacySize!==undefined?{fontSize:legacySize}:{})}:styleOrFont;
  assertCaptionStyleTarget({trackUid:'binary',expectedTrackId:0,expectedTrackName:'',expectedItemCount:1,items:[{itemIndex:0,expectedStartTicks:'0',expectedEndTicks:'1',...override}]});
  const before = Buffer.from(encoded, "base64");
  const beforeSnapshot = inspectCaptionCueBinary(encoded);
  const font = flatBufferFontRecord(before);
  const cue = flatBufferCueRecord(before);
  let patched=override.fontPostScriptName===undefined?Buffer.from(before):patchFlatBufferFont(before,font,override.fontPostScriptName);
  if(override.fillColor!==undefined||override.fontSize!==undefined&&cue.fontSizeOffset===undefined)patched=appendCueStyle(patched,cue,override);
  else if(override.fontSize!==undefined)patched.writeFloatLE(override.fontSize,cue.fontSizeOffset!);
  patched.writeUInt32LE(patched.length - 12, 0);
  const hash = binaryHash(patched);
  const patchedEncoded = patched.toString("base64");
  const snapshot = inspectCaptionCueBinary(patchedEncoded, hash);
  if (snapshot.fontPostScriptName !== (override.fontPostScriptName??beforeSnapshot.fontPostScriptName)
    || Math.abs(snapshot.fontSize - (override.fontSize??beforeSnapshot.fontSize)) > 0.001
    ||JSON.stringify(snapshot.fillColor)!==JSON.stringify(override.fillColor??beforeSnapshot.fillColor)
    ||snapshot.preservedStyleSha256!==beforeSnapshot.preservedStyleSha256
    || snapshot.text !== beforeSnapshot.text) {
    throw new Error("CAPTION_CUE_BINARY_READBACK_MISMATCH");
  }
  return { encoded: patchedEncoded, snapshot };
}

type FormattedTextDataRecord = {
  blockObjectId: string;
  block: string;
  raw: string;
  attributes: string;
  binaryHash: string;
  encoded: string | null;
};

function formattedTextDataRecord(block: string, blockObjectId: string): FormattedTextDataRecord {
  const formatted = [...block.matchAll(/<FormattedTextData\b([^>]*?)(?:\s*\/>|>([\s\S]*?)<\/FormattedTextData>)/g)];
  if (formatted.length !== 1 || attr(formatted[0]?.[1] ?? "", "Encoding") !== "base64") {
    throw new Error(`CAPTION_CUE_FORMATTED_TEXT_UNSUPPORTED: ${blockObjectId}`);
  }
  const binaryHashValue = attr(formatted[0]?.[1] ?? "", "BinaryHash");
  if (!binaryHashValue) throw new Error(`CAPTION_CUE_BINARY_HASH_MISSING: ${blockObjectId}`);
  const payload = (formatted[0]?.[2] ?? "").trim();
  return {
    blockObjectId,
    block,
    raw: formatted[0]![0],
    attributes: formatted[0]?.[1] ?? "",
    binaryHash: binaryHashValue,
    encoded: payload || null,
  };
}

function formattedTextDataRecords(xml: string): FormattedTextDataRecord[] {
  const records = [...xml.matchAll(/<Block\b([^>]*)>[\s\S]*?<\/Block>/g)].map((match) => {
    const blockObjectId = attr(match[1] ?? "", "ObjectID");
    if (!blockObjectId) throw new Error("CAPTION_CUE_BLOCK_OBJECT_ID_MISSING");
    return formattedTextDataRecord(match[0], blockObjectId);
  });
  if (new Set(records.map((record) => record.blockObjectId)).size !== records.length) {
    throw new Error("CAPTION_CUE_BLOCK_OBJECT_ID_DUPLICATED");
  }
  return records;
}

function captionCueSnapshots(xml: string, definition: string, trackUid: string, expectedItemCount: number): CaptionCueSnapshot[] {
  const itemsContainer = /<ClipItems\b[^>]*>[\s\S]*?<TrackItems\b[^>]*>([\s\S]*?)<\/TrackItems>[\s\S]*?<\/ClipItems>/.exec(definition)?.[1];
  if (itemsContainer == null) {
    if (expectedItemCount === 0) return [];
    throw new Error(`CAPTION_TRACK_ITEMS_NOT_FOUND: ${trackUid}`);
  }
  const references = [...itemsContainer.matchAll(/<TrackItem\b([^>]*)\/>/g)].map((match) => ({
    index: Number(attr(match[1] ?? "", "Index")),
    itemObjectId: attr(match[1] ?? "", "ObjectRef"),
  }));
  if (references.length > 2_000) throw new Error(`CAPTION_CUE_LIMIT_EXCEEDED: ${trackUid}`);
  if (new Set(references.map((reference) => reference.itemObjectId)).size !== references.length) {
    throw new Error(`CAPTION_CUE_ITEM_REFERENCE_DUPLICATED: ${trackUid}`);
  }
  const formattedRecords = formattedTextDataRecords(xml);
  const recordsByBlock = new Map(formattedRecords.map((record) => [record.blockObjectId, record]));
  return references.map((reference, expectedIndex) => {
    if (!Number.isInteger(reference.index) || reference.index !== expectedIndex || !reference.itemObjectId) {
      throw new Error(`CAPTION_CUE_ITEM_INDEX_MISMATCH: ${trackUid} expected ${expectedIndex}`);
    }
    const item = objectBlock(xml, "CaptionDataClipTrackItem", "ObjectID", reference.itemObjectId);
    const blockVectors = [...item.matchAll(/<BlockVector\b[^>]*>([\s\S]*?)<\/BlockVector>/g)];
    if (blockVectors.length !== 1) throw new Error(`CAPTION_CUE_BLOCK_VECTOR_NOT_UNIQUE: ${reference.itemObjectId}`);
    const blockReferences = [...(blockVectors[0]?.[1] ?? "").matchAll(/<BlockVectorItem\b([^>]*)\/>/g)];
    if (blockReferences.length !== 1
      || attr(blockReferences[0]?.[1] ?? "", "Index") !== "0"
      || !attr(blockReferences[0]?.[1] ?? "", "ObjectRef")) {
      throw new Error(`CAPTION_CUE_BLOCK_REFERENCE_UNSUPPORTED: ${reference.itemObjectId}`);
    }
    const blockObjectId = attr(blockReferences[0]?.[1] ?? "", "ObjectRef");
    const formatted = recordsByBlock.get(blockObjectId);
    if (!formatted) throw new Error(`PROJECT_ARCHIVE_OBJECT_NOT_FOUND: Block ObjectID=${blockObjectId}`);
    const payloads = formattedRecords.filter((record) => record.binaryHash === formatted.binaryHash && record.encoded != null);
    if (payloads.length !== 1) throw new Error(`CAPTION_CUE_PAYLOAD_NOT_UNIQUE: ${formatted.binaryHash}`);
    const encoded = payloads[0]!.encoded!;
    const startTicks = tag(item, "Start") || "0";
    const endTicks = tag(item, "End");
    if (!/^\d+$/.test(startTicks) || !/^\d+$/.test(endTicks) || BigInt(endTicks) < BigInt(startTicks)) {
      throw new Error(`CAPTION_CUE_TIME_RANGE_INVALID: ${reference.itemObjectId}`);
    }
    return {
      index: reference.index,
      itemObjectId: reference.itemObjectId,
      blockObjectId,
      startTicks,
      endTicks,
      ...inspectCaptionCueBinary(encoded, formatted.binaryHash),
    };
  });
}

function trackSnapshot(xml: string, mediaType: ArchiveMediaType, reference: { index: number; uid: string }): ArchiveTrackSnapshot {
  const definition = objectBlock(xml, media[mediaType].trackTag, "ObjectUID", reference.uid);
  const trackContainer = indexedContainer(definition, "Track", reference.uid);
  const clipItemsContainer = indexedContainer(definition, "ClipItems", reference.uid);
  const transitionItemsContainer = indexedContainer(definition, "TransitionItems", reference.uid);
  for (const [name, container] of [["Track", trackContainer], ["ClipItems", clipItemsContainer], ["TransitionItems", transitionItemsContainer]] as const) {
    if (container.index !== reference.index) {
      throw new Error(`TRACK_CONTAINER_INDEX_MISMATCH: ${reference.uid} ${name} expected ${reference.index}, found ${container.index}`);
    }
  }
  const track = trackContainer.block;
  const items = /<TrackItems\b[^>]*>([\s\S]*?)<\/TrackItems>/.exec(definition)?.[1] ?? "";
  const transitions = /<TransitionItems\b[^>]*>([\s\S]*?)<\/TransitionItems>/.exec(definition)?.[1] ?? "";
  const itemCount = [...items.matchAll(/<TrackItem\b/g)].length;
  const transitionCount = [...transitions.matchAll(/<TrackItem\b|<TransitionItem\b/g)].length;
  const style = /<CaptionDataTemplateStyle\b([^>]*)>([\s\S]*?)<\/CaptionDataTemplateStyle>/.exec(definition);
  return {
    mediaType,
    index: reference.index,
    id: Number(tag(track, "ID")),
    uid: reference.uid,
    name: tag(track, "MZ.TrackName"),
    itemCount,
    transitionCount,
    empty: itemCount === 0 && transitionCount === 0,
    ...(style?.[2] ? { style: inspectCaptionStyleBinary(style[2].trim(), attr(style[1] ?? "", "BinaryHash")) } : {}),
    ...(mediaType === "caption" ? { captionCues: captionCueSnapshots(xml, definition, reference.uid, itemCount) } : {}),
  };
}

export function inspectPremiereSequenceArchive(xml: string, sequenceName: string, projectPath = ""): SequenceArchiveSnapshot {
  const sequence = sequenceBlock(xml, sequenceName);
  const sequenceUid = attr(/^<Sequence\b([^>]*)>/.exec(sequence)?.[1] ?? "", "ObjectUID");
  const tracks = (Object.keys(media) as ArchiveMediaType[]).flatMap((mediaType) => {
    const group = objectBlock(xml, media[mediaType].groupTag, "ObjectID", groupReference(sequence, mediaType));
    return trackReferences(group).map((reference) => trackSnapshot(xml, mediaType, reference));
  });
  return {
    projectPath,
    sequenceName,
    sequenceUid,
    tracks,
    trackCounts: {
      video: tracks.filter((track) => track.mediaType === "video").length,
      audio: tracks.filter((track) => track.mediaType === "audio").length,
      caption: tracks.filter((track) => track.mediaType === "caption").length,
    },
    totalItems: tracks.reduce((sum, track) => sum + track.itemCount + track.transitionCount, 0),
  };
}

function replaceOnce(value: string, before: string, after: string, errorCode: string): string {
  const offset = value.indexOf(before);
  if (offset < 0 || value.indexOf(before, offset + before.length) >= 0) throw new Error(errorCode);
  return value.slice(0, offset) + after + value.slice(offset + before.length);
}

function removeAndRenumberEntries(block: string, entryTag: "Track" | "Source", removedUids: Set<string>): string {
  const containerTag = entryTag === "Track" ? "Tracks" : "Sources";
  const pattern = new RegExp(String.raw`<${containerTag}\b[^>]*>([\s\S]*?)<\/${containerTag}>`);
  const match = pattern.exec(block);
  if (!match) throw new Error(`PROJECT_ARCHIVE_${containerTag.toUpperCase()}_NOT_FOUND`);
  let nextIndex = 0;
  const contents = (match[1] ?? "").replace(new RegExp(String.raw`<${entryTag}\b([^>]*)\/>`, "g"), (raw, attributes: string) => {
    if (removedUids.has(attr(attributes, "ObjectURef"))) return "";
    return raw.replace(/\bIndex="\d+"/, `Index="${nextIndex++}"`);
  });
  return replaceOnce(block, match[0], match[0].replace(match[1] ?? "", contents), `PROJECT_ARCHIVE_${containerTag.toUpperCase()}_AMBIGUOUS`);
}

function removeCaptionPatches(sequence: string, removedIndexes: Set<number>, beforeCount: number): string {
  const pattern = /<(HSL\.[^>]*DataPatches[^>]*)>([\s\S]*?)<\/\1>/;
  const match = pattern.exec(sequence);
  if (!match) return sequence;
  try {
    const patches = JSON.parse(match[2] ?? "") as Array<{ mNumber?: number; mState?: number }>;
    if (!Array.isArray(patches) || patches.length !== beforeCount) return sequence;
    const retained = patches.filter((_patch, index) => !removedIndexes.has(index)).map((patch) => {
      const removedBefore = [...removedIndexes].filter((index) => index < Number(patch.mNumber)).length;
      return typeof patch.mNumber === "number" && patch.mNumber >= 0 ? { ...patch, mNumber: patch.mNumber - removedBefore } : patch;
    });
    return sequence.replace(match[0], `<${match[1]}>${JSON.stringify(retained)}</${match[1]}>`);
  } catch {
    return sequence;
  }
}

function replaceBinaryHashAttribute(attributes: string, hash: string, errorCode: string): string {
  const matches = [...attributes.matchAll(/\bBinaryHash="[^"]*"/g)];
  if (matches.length !== 1) throw new Error(errorCode);
  return attributes.replace(matches[0]![0], `BinaryHash="${hash}"`);
}

function patchTrackStyle(definition: string, target: CaptionStyleTarget): string {
  const pattern = /<CaptionDataTemplateStyle\b([^>]*)>([\s\S]*?)<\/CaptionDataTemplateStyle>/;
  const match = pattern.exec(definition);
  if (!match?.[2]) throw new Error("CAPTION_STYLE_NOT_FOUND");
  const patched = patchCaptionStyleBinary(match[2].trim(), target.fontPostScriptName!, target.fontSize!);
  const attributes = replaceBinaryHashAttribute(match[1] ?? "", patched.snapshot.binaryHash, "CAPTION_TEMPLATE_BINARY_HASH_NOT_UNIQUE");
  return definition.replace(match[0], `<CaptionDataTemplateStyle${attributes}>${patched.encoded}</CaptionDataTemplateStyle>`);
}

function replaceFormattedTextData(
  xml: string,
  blockObjectId: string,
  expectedHash: string,
  nextHash: string,
  encoded: string | null,
): string {
  const block = objectBlock(xml, "Block", "ObjectID", blockObjectId);
  const record = formattedTextDataRecord(block, blockObjectId);
  if (record.binaryHash !== expectedHash) throw new Error(`CAPTION_CUE_BINARY_HASH_STALE: ${blockObjectId}`);
  const attributes = replaceBinaryHashAttribute(
    record.attributes,
    nextHash,
    `CAPTION_CUE_BINARY_HASH_NOT_UNIQUE: ${blockObjectId}`,
  );
  const replacement = encoded == null
    ? `<FormattedTextData${attributes}/>`
    : `<FormattedTextData${attributes}>${encoded}</FormattedTextData>`;
  const patchedBlock = replaceOnce(block, record.raw, replacement, `CAPTION_CUE_FORMATTED_TEXT_AMBIGUOUS: ${blockObjectId}`);
  return replaceOnce(xml, block, patchedBlock, `CAPTION_CUE_BLOCK_AMBIGUOUS: ${blockObjectId}`);
}

function patchCaptionCuePayloadGroups(
  xml: string,
  cues: CaptionCueSnapshot[],
  overrides:Map<number,CaptionCueStyleOverride>,
): string {
  let patchedXml = xml;
  const cuesByHash = new Map<string, CaptionCueSnapshot[]>();
  for (const cue of cues)if(overrides.has(cue.index))cuesByHash.set(cue.binaryHash, [...(cuesByHash.get(cue.binaryHash) ?? []), cue]);
  for (const [originalHash, groupedCues] of cuesByHash) {
    const initialRecords = formattedTextDataRecords(patchedXml);
    const records = initialRecords.filter((record) => record.binaryHash === originalHash);
    const payloads = records.filter((record) => record.encoded != null);
    if (payloads.length !== 1) throw new Error(`CAPTION_CUE_PAYLOAD_NOT_UNIQUE: ${originalHash}`);
    const changed=groupedCues.map(cue=>({cue,patched:patchCaptionCueBinary(payloads[0]!.encoded!,overrides.get(cue.index)!)})).filter(row=>row.patched.encoded!==payloads[0]!.encoded);
    if(!changed.length)continue;
    const targetBlockIds = new Set(changed.map(({cue}) => cue.blockObjectId));
    if (targetBlockIds.size !== changed.length
      || [...targetBlockIds].some((blockObjectId) => !records.some((record) => record.blockObjectId === blockObjectId))) {
      throw new Error(`CAPTION_CUE_PAYLOAD_REFERENCE_MISMATCH: ${originalHash}`);
    }
    for (const blockObjectId of targetBlockIds) {
      const references = [...patchedXml.matchAll(new RegExp(String.raw`\bObjectRef="${escapeRegExp(blockObjectId)}"`, "g"))];
      if (references.length !== 1) throw new Error(`CAPTION_CUE_BLOCK_REFERENCE_NOT_UNIQUE: ${blockObjectId}`);
    }
    const variants=new Map<string,typeof changed>();
    for(const row of changed){const hash=row.patched.snapshot.binaryHash;if(initialRecords.some(record=>record.binaryHash===hash))throw Error('CAPTION_CUE_PATCH_HASH_COLLISION:'+hash);variants.set(hash,[...(variants.get(hash)??[]),row]);}
    const externalRecords = records.filter((record) => !targetBlockIds.has(record.blockObjectId));
    if (externalRecords.length && targetBlockIds.has(payloads[0]!.blockObjectId)) {
      patchedXml = replaceFormattedTextData(
        patchedXml,
        externalRecords[0]!.blockObjectId,
        originalHash,
        originalHash,
        payloads[0]!.encoded,
      );
    }
    for(const [hash,variant] of variants)for(const [index,{cue,patched}] of variant.entries())patchedXml=replaceFormattedTextData(patchedXml,cue.blockObjectId,originalHash,hash,index===0?patched.encoded:null);
    const afterRecords = formattedTextDataRecords(patchedXml);
    const originalAfter = afterRecords.filter((record) => record.binaryHash === originalHash);
    if (originalAfter.length !== externalRecords.length
      || originalAfter.filter((record) => record.encoded != null).length !== (externalRecords.length ? 1 : 0)) {
      throw new Error(`CAPTION_CUE_DEDUP_GRAPH_READBACK_MISMATCH: ${originalHash}`);
    }
    for(const [hash,variant] of variants){const records=afterRecords.filter(record=>record.binaryHash===hash);if(records.length!==variant.length||records.filter(record=>record.encoded!==null).length!==1)throw Error('CAPTION_CUE_DEDUP_GRAPH_READBACK_MISMATCH:'+hash);}
  }
  return patchedXml;
}

function cueOverrides(track:ArchiveTrackSnapshot,target:CaptionStyleTarget):Map<number,CaptionCueStyleOverride>{
  if(!target.items)return new Map((track.captionCues??[]).map(cue=>[cue.index,{fontPostScriptName:target.fontPostScriptName!,fontSize:target.fontSize!}]));
  return new Map(target.items.map(item=>{
    const cue=track.captionCues?.find(c=>c.index===item.itemIndex);
    if(!cue||cue.startTicks!==item.expectedStartTicks||cue.endTicks!==item.expectedEndTicks)throw Error('STALE_CAPTION_CUE_TARGET:'+item.itemIndex);
    const {itemIndex,expectedStartTicks:_start,expectedEndTicks:_end,...style}=item;void _start;void _end;return [itemIndex,style];
  }));
}

/** Stable cue identity survives Premiere's ObjectID renumbering after reopen.
 * Unselected payload hashes protect style fields that this adapter cannot name. */
export function captionStyleReadbackErrors(before:SequenceArchiveSnapshot,after:SequenceArchiveSnapshot,target:CaptionStyleTarget):string[]{
  const errors:string[]=[],selectedBefore=before.tracks.find(t=>t.uid===target.trackUid),selectedAfter=after.tracks.find(t=>t.uid===target.trackUid);
  if(!selectedBefore||!selectedAfter)return ['CAPTION_STYLE_TRACK_MISSING'];
  const overrides=cueOverrides(selectedBefore,target);
  for(const original of before.tracks.filter(t=>t.mediaType==='caption')){
    const actual=after.tracks.find(t=>t.uid===original.uid);
    if(!actual||actual.id!==original.id||actual.name!==original.name||actual.itemCount!==original.itemCount||actual.captionCues?.length!==original.captionCues?.length){errors.push('CAPTION_TRACK_CHANGED:'+original.uid);continue;}
    if(original.uid!==target.trackUid||target.items){if(JSON.stringify(actual.style)!==JSON.stringify(original.style))errors.push('CAPTION_TEMPLATE_CHANGED:'+original.uid);}
    else if(actual.style?.fontPostScriptName!==target.fontPostScriptName||Math.abs((actual.style?.fontSize??0)-target.fontSize!)>0.001)errors.push('CAPTION_STYLE_ARCHIVE_READBACK_MISMATCH');
    for(const cue of original.captionCues??[]){
      const found=actual.captionCues!.find(c=>c.index===cue.index),override=original.uid===target.trackUid?overrides.get(cue.index):undefined;
      if(!found||found.startTicks!==cue.startTicks||found.endTicks!==cue.endTicks||found.text!==cue.text){errors.push('CAPTION_CUE_IDENTITY_CHANGED:'+original.uid+':'+cue.index);continue;}
      if(found.fontPostScriptName!==(override?.fontPostScriptName??cue.fontPostScriptName)||Math.abs(found.fontSize-(override?.fontSize??cue.fontSize))>0.001||JSON.stringify(found.fillColor)!==JSON.stringify(override?.fillColor??cue.fillColor))errors.push('CAPTION_CUE_STYLE_ARCHIVE_READBACK_MISMATCH:'+original.uid+':'+cue.index);
      if(found.preservedStyleSha256!==cue.preservedStyleSha256)errors.push('CAPTION_UNREQUESTED_STYLE_CHANGED:'+original.uid+':'+cue.index);
      if(!override&&found.contentSha256!==cue.contentSha256)errors.push('UNSELECTED_CAPTION_PAYLOAD_CHANGED:'+original.uid+':'+cue.index);
    }
  }
  return errors;
}

export function patchPremiereSequenceArchive(xml: string, input: Omit<PatchSequenceArchiveInput, "projectPath">): { xml: string; before: SequenceArchiveSnapshot; after: SequenceArchiveSnapshot } {
  if(input.captionStyle)assertCaptionStyleTarget(input.captionStyle);
  const before = inspectPremiereSequenceArchive(xml, input.sequenceName);
  if (before.sequenceUid !== input.expectedSequenceUid) throw new Error(`ACTIVE_SEQUENCE_UID_MISMATCH: expected ${input.expectedSequenceUid}, found ${before.sequenceUid}`);
  const removals = input.removeTracks ?? [];
  const removalUids = new Set(removals.map((target) => target.uid));
  if (removalUids.size !== removals.length) throw new Error("DUPLICATE_TRACK_TARGET");
  for (const target of removals) {
    const actual = before.tracks.find((track) => track.uid === target.uid);
    if (!actual || actual.mediaType !== target.mediaType || actual.index !== target.index || actual.id !== target.id || actual.name !== target.name) {
      throw new Error(`STALE_TRACK_TARGET: ${target.mediaType} ${target.uid}`);
    }
    if (!actual.empty || actual.itemCount !== target.expectedItemCount || actual.transitionCount !== target.expectedTransitionCount) {
      throw new Error(`TRACK_NOT_EMPTY: ${target.mediaType} ${target.uid}`);
    }
    const occurrences = [...xml.matchAll(new RegExp(String.raw`\b(?:ObjectUID|ObjectURef)="${escapeRegExp(target.uid)}"`, "g"))].length;
    if (occurrences !== media[target.mediaType].expectedUidReferences) {
      throw new Error(`UNSUPPORTED_TRACK_REFERENCE_GRAPH: ${target.uid} has ${occurrences} references`);
    }
  }
  const removalOwnership = assertTrackRemovalOwnership(xml, before, removals);

  if (input.captionStyle) {
    const target = input.captionStyle;
    const actual = before.tracks.find((track) => track.uid === target.trackUid && track.mediaType === "caption");
    if (!actual
      || actual.id !== target.expectedTrackId
      || actual.name !== target.expectedTrackName
      || actual.itemCount !== target.expectedItemCount
      || (!target.items&&!actual.style)
      || actual.captionCues?.length !== target.expectedItemCount) {
      throw new Error(`STALE_CAPTION_STYLE_TARGET: ${target.trackUid}`);
    }
    if (removalUids.has(target.trackUid)) throw new Error("CAPTION_STYLE_TARGET_IS_REMOVED");
    cueOverrides(actual,target);
  }

  let patchedXml = xml;
  const originalSequence = sequenceBlock(patchedXml, input.sequenceName);
  let patchedSequence = originalSequence;
  const removedByMedia = new Map<ArchiveMediaType, Set<string>>();
  for (const mediaType of Object.keys(media) as ArchiveMediaType[]) {
    const targets = removals.filter((target) => target.mediaType === mediaType);
    if (!targets.length) continue;
    const removed = new Set(targets.map((target) => target.uid));
    removedByMedia.set(mediaType, removed);
    const reference = groupReference(originalSequence, mediaType);
    const originalGroup = objectBlock(patchedXml, media[mediaType].groupTag, "ObjectID", reference);
    const patchedGroup = removeAndRenumberEntries(originalGroup, "Track", removed);
    patchedXml = replaceOnce(patchedXml, originalGroup, patchedGroup, `AMBIGUOUS_${mediaType.toUpperCase()}_TRACK_GROUP`);
  }
  const captionRemovedIndexes = new Set(removals.filter((target) => target.mediaType === "caption").map((target) => target.index));
  if (captionRemovedIndexes.size) patchedSequence = removeCaptionPatches(patchedSequence, captionRemovedIndexes, before.trackCounts.caption);
  patchedXml = replaceOnce(patchedXml, originalSequence, patchedSequence, "AMBIGUOUS_SEQUENCE_BLOCK");

  const audioRemoved = removedByMedia.get("audio");
  if (audioRemoved?.size) {
    const inlet = removalOwnership.audioInlet;
    if (!inlet) throw new Error("AUDIO_TRACK_INLET_NOT_FOUND");
    patchedXml = replaceOnce(patchedXml, inlet, removeAndRenumberEntries(inlet, "Source", audioRemoved), "AMBIGUOUS_AUDIO_TRACK_INLET");
  }

  for (const target of removals) {
    const definition = objectBlock(patchedXml, media[target.mediaType].trackTag, "ObjectUID", target.uid);
    patchedXml = replaceOnce(patchedXml, definition, "", `AMBIGUOUS_TRACK_DEFINITION: ${target.uid}`);
  }

  for (const mediaType of Object.keys(media) as ArchiveMediaType[]) {
    const retained = before.tracks
      .filter((track) => track.mediaType === mediaType && !removalUids.has(track.uid))
      .sort((left, right) => left.index - right.index);
    for (const [nextIndex, track] of retained.entries()) {
      const definition = objectBlock(patchedXml, media[mediaType].trackTag, "ObjectUID", track.uid);
      let indexed = definition;
      for (const containerTag of ["Track", "ClipItems", "TransitionItems"] as const) {
        indexed = patchIndexedContainer(indexed, containerTag, track.uid, track.index, nextIndex);
      }
      if (indexed !== definition) patchedXml = replaceOnce(patchedXml, definition, indexed, `AMBIGUOUS_TRACK_STATE: ${track.uid}`);
    }
  }

  if (input.captionStyle) {
    const target = input.captionStyle;
    const beforeTrack = before.tracks.find((track) => track.uid === target.trackUid && track.mediaType === "caption")!;
    const definition = objectBlock(patchedXml, media.caption.trackTag, "ObjectUID", target.trackUid);
    if(!target.items)patchedXml = replaceOnce(patchedXml, definition, patchTrackStyle(definition, target), "AMBIGUOUS_CAPTION_TRACK_DEFINITION");
    patchedXml = patchCaptionCuePayloadGroups(patchedXml, beforeTrack.captionCues ?? [], cueOverrides(beforeTrack,target));
  }

  const after = inspectPremiereSequenceArchive(patchedXml, input.sequenceName);
  if (after.totalItems !== before.totalItems) throw new Error(`TIMELINE_ITEM_COUNT_CHANGED: ${before.totalItems} -> ${after.totalItems}`);
  if (before.tracks.length - after.tracks.length !== removals.length) throw new Error("TRACK_REMOVAL_COUNT_MISMATCH");
  if (input.captionStyle) {
    const target = input.captionStyle;
    const beforeTrack = before.tracks.find((track) => track.uid === target.trackUid)!;
    const afterTrack = after.tracks.find((track) => track.uid === target.trackUid);
    const failures=captionStyleReadbackErrors({...before,tracks:before.tracks.filter(t=>!removalUids.has(t.uid))},after,target);if(failures.length)throw Error(failures.join('; '));
    const beforeCues = beforeTrack.captionCues ?? [];
    const afterCues = afterTrack?.captionCues ?? [];
    if (beforeCues.length !== target.expectedItemCount || afterCues.length !== beforeCues.length) {
      throw new Error("CAPTION_CUE_COUNT_CHANGED");
    }
    for (const [index, beforeCue] of beforeCues.entries()) {
      const afterCue = afterCues[index];
      if (!afterCue
        || afterCue.index !== beforeCue.index
        || afterCue.itemObjectId !== beforeCue.itemObjectId
        || afterCue.blockObjectId !== beforeCue.blockObjectId
        || afterCue.startTicks !== beforeCue.startTicks
        || afterCue.endTicks !== beforeCue.endTicks
        || afterCue.text !== beforeCue.text) {
        throw new Error(`CAPTION_CUE_IDENTITY_CHANGED: ${beforeCue.itemObjectId}`);
      }
    }
  }
  return { xml: patchedXml, before, after };
}

export async function readPremiereArchiveXml(projectPath: string): Promise<{ xml: string; compressed: boolean; sha256: string }> {
  const bytes = await readFile(projectPath);
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return { xml: (compressed ? await unzip(bytes) : bytes).toString("utf8"), compressed, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function snapshotPremiereSequenceArchive(projectPath: string, sequenceName: string): Promise<SequenceArchiveSnapshot> {
  const archive = await readPremiereArchiveXml(projectPath);
  return inspectPremiereSequenceArchive(archive.xml, sequenceName, projectPath);
}

export async function commitPremiereSequenceArchive(input: PatchSequenceArchiveInput, operationId: string): Promise<{ backupPath: string; before: SequenceArchiveSnapshot; after: SequenceArchiveSnapshot }> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error("INVALID_ARCHIVE_OPERATION_ID");
  const archive = await readPremiereArchiveXml(input.projectPath);
  if (input.expectedSourceSha256 !== undefined && input.expectedSourceSha256 !== archive.sha256) {
    throw new Error("PROJECT_ARCHIVE_CHANGED_SINCE_PREFLIGHT");
  }
  const patched = patchPremiereSequenceArchive(archive.xml, input);
  const output = archive.compressed ? await zip(Buffer.from(patched.xml, "utf8"), { level: 9 }) : Buffer.from(patched.xml, "utf8");
  const backupDirectory = path.join(path.dirname(input.projectPath), "project-backups");
  const backupPath = path.join(backupDirectory, `${path.basename(input.projectPath, path.extname(input.projectPath))}.${operationId}.before.prproj`);
  const temporaryPath = `${input.projectPath}.${operationId}.tmp`;
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(temporaryPath, output, { flag: "wx" });
  try {
    const temporarySnapshot = await snapshotPremiereSequenceArchive(temporaryPath, input.sequenceName);
    if (temporarySnapshot.sequenceUid !== patched.after.sequenceUid || temporarySnapshot.totalItems !== patched.after.totalItems) {
      throw new Error("TEMPORARY_PROJECT_ARCHIVE_VERIFICATION_FAILED");
    }
    // Do not replace a file that changed while the candidate was prepared.
    // This is a bounded freshness guard, not an OS-level compare-and-swap lock.
    const currentSha256 = createHash("sha256").update(await readFile(input.projectPath)).digest("hex");
    if (currentSha256 !== archive.sha256) throw new Error("PROJECT_ARCHIVE_CHANGED_BEFORE_COMMIT");
    await rename(input.projectPath, backupPath);
    try {
      await rename(temporaryPath, input.projectPath);
    } catch (error) {
      await rename(backupPath, input.projectPath);
      throw error;
    }
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { backupPath, before: { ...patched.before, projectPath: input.projectPath }, after: { ...patched.after, projectPath: input.projectPath } };
}

export async function restorePremiereSequenceArchive(
  projectPath: string,
  backupPath: string,
  operationId: string,
): Promise<{ projectPath: string; backupPath: string; failedProjectPath: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error("INVALID_ARCHIVE_OPERATION_ID");
  const expectedBackupDirectory = path.resolve(path.dirname(projectPath), "project-backups");
  if (path.resolve(path.dirname(backupPath)).toLocaleLowerCase("en-US") !== expectedBackupDirectory.toLocaleLowerCase("en-US")) {
    throw new Error("BACKUP_PATH_OUTSIDE_PROJECT_BACKUP_DIRECTORY");
  }
  const restoreTemporaryPath = `${projectPath}.${operationId}.restore.tmp`;
  const failedProjectPath = `${projectPath}.${operationId}.failed.prproj`;
  const backupBytes = await readFile(backupPath);
  await writeFile(restoreTemporaryPath, backupBytes, { flag: "wx" });
  await rename(projectPath, failedProjectPath);
  try {
    await rename(restoreTemporaryPath, projectPath);
  } catch (error) {
    await rename(failedProjectPath, projectPath);
    await rm(restoreTemporaryPath, { force: true });
    throw error;
  }
  return { projectPath, backupPath, failedProjectPath };
}
