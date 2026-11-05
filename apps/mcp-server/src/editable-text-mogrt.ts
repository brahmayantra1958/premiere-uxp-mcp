import { createHash } from "node:crypto";
import { locateComponent,locateParameter } from "./premiere-mogrt-xml.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync, inflateRawSync } from "node:zlib";

export type TextAlignment = "left" | "center" | "right";

export type EditableTextMogrtSpec = {
  text: string;
  fontPostScriptName: string;
  fontSizePixels: number;
  colorHex: string;
  alignment: TextAlignment;
  position: { x: number; y: number };
};

type ZipEntry = {
  name: string;
  data: Buffer;
  modifiedTime?: number;
  modifiedDate?: number;
  externalAttributes?: number;
};

type TextState = EditableTextMogrtSpec;
type JsonRecord = Record<string, any>;

const LOCAL_FILE = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const alignmentToHost: Record<TextAlignment, number> = { left: 0, right: 1, center: 2 };
const hostToAlignment: Record<number, TextAlignment> = { 0: "left", 1: "right", 2: "center" };

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
}

function validateSpec(spec: EditableTextMogrtSpec): void {
  if (!spec.text || spec.text.length > 1_000 || spec.text.includes("\0")) {
    throw new Error("Editable text must contain 1 through 1000 non-NUL characters");
  }
  if (!/^[A-Za-z0-9._ -]{1,100}$/.test(spec.fontPostScriptName)) {
    throw new Error("fontPostScriptName contains unsupported characters");
  }
  assertRange(spec.fontSizePixels, 8, 300, "fontSizePixels");
  if (!/^#[0-9a-f]{6}$/i.test(spec.colorHex)) throw new Error("colorHex must be #RRGGBB");
  if (!(spec.alignment in alignmentToHost)) throw new Error("Unsupported text alignment");
  assertRange(spec.position.x, 0, 1, "position.x");
  assertRange(spec.position.y, 0, 1, "position.y");
}

function safeZipName(name: string): void {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`UNSAFE_ZIP_ENTRY_NAME: ${name}`);
  }
}

function endOfCentralDirectory(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("ZIP_END_OF_CENTRAL_DIRECTORY_NOT_FOUND");
}

export function decodeZipEntries(archive: Buffer): ZipEntry[] {
  const eocd = endOfCentralDirectory(archive);
  const diskNumber = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const count = archive.readUInt16LE(eocd + 10);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || count === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64_OR_MULTIDISK_ARCHIVE_UNSUPPORTED");
  }

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_DIRECTORY) throw new Error("INVALID_ZIP_CENTRAL_DIRECTORY");
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const modifiedTime = archive.readUInt16LE(cursor + 12);
    const modifiedDate = archive.readUInt16LE(cursor + 14);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString((flags & UTF8_FLAG) !== 0 ? "utf8" : "latin1");
    safeZipName(name);
    if ((flags & 1) !== 0) throw new Error("ENCRYPTED_ZIP_ENTRY_UNSUPPORTED");
    if (archive.readUInt32LE(localOffset) !== LOCAL_FILE) throw new Error("INVALID_ZIP_LOCAL_HEADER");
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : undefined;
    if (!data) throw new Error(`ZIP_COMPRESSION_METHOD_UNSUPPORTED: ${method}`);
    if (data.length !== uncompressedSize) throw new Error(`ZIP_ENTRY_SIZE_MISMATCH: ${name}`);
    entries.push({ name, data, modifiedTime, modifiedDate, externalAttributes });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) value = (crcTable[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function encodeStoredZip(entries: ZipEntry[]): Buffer {
  if (!entries.length || entries.length > 0xffff) throw new Error("ZIP_ENTRY_COUNT_OUT_OF_RANGE");
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    safeZipName(entry.name);
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const modifiedTime = entry.modifiedTime ?? 0;
    const modifiedDate = entry.modifiedDate ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(modifiedTime, 10);
    local.writeUInt16LE(modifiedDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIRECTORY, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(modifiedTime, 12);
    central.writeUInt16LE(modifiedDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sourceTextBlock(xml: string): { block: string; index: number } {
  return locateParameter(xml,locateComponent(xml,"AE.ADBE Text"),0);
}

function decodeTextPayload(block: string): JsonRecord {
  const match = /<StartKeyframeValue[^>]*>([\s\S]*?)<\/StartKeyframeValue>/.exec(block);
  if (!match?.[1]) throw new Error("PREMIERE_SOURCE_TEXT_VALUE_NOT_FOUND");
  const encoded = Buffer.from(match[1].trim(), "base64");
  if (encoded.length < 10 || encoded.readBigUInt64LE(0) !== BigInt(encoded.length - 8)) {
    throw new Error("PREMIERE_SOURCE_TEXT_LENGTH_PREFIX_MISMATCH");
  }
  return JSON.parse(encoded.subarray(8).toString("utf16le")) as JsonRecord;
}

function encodeTextPayload(payload: JsonRecord): string {
  const json = Buffer.from(JSON.stringify(payload), "utf16le");
  const encoded = Buffer.alloc(8 + json.length);
  encoded.writeBigUInt64LE(BigInt(json.length), 0);
  json.copy(encoded, 8);
  return encoded.toString("base64");
}

function replaceTextPosition(xml: string, position: EditableTextMogrtSpec["position"]): string {
  const located=locateParameter(xml,locateComponent(xml,"AE.ADBE Text"),2);
  const pointMatch=/<StartKeyframe>([^<]+)<\/StartKeyframe>/.exec(located.block);
  if (!pointMatch || pointMatch.index == null || !pointMatch[1]) throw new Error("PREMIERE_TEXT_POSITION_PARAMETER_NOT_FOUND");
  const values = pointMatch[1].split(",");
  if (values.length < 3) throw new Error("PREMIERE_TEXT_POSITION_VALUE_INVALID");
  if(values[1]?.includes(":"))values[1]=`${position.x}:${position.y}`;
  else { values[1] = String(position.x);values[2] = String(position.y); }
  const updatedBlock = located.block.replace(pointMatch[1], values.join(","));
  return xml.slice(0, located.index) + updatedBlock + xml.slice(located.index + located.block.length);
}

export function patchPremiereTextProjectXml(xml: string, spec: EditableTextMogrtSpec): string {
  validateSpec(spec);
  const located = sourceTextBlock(xml);
  const payload = decodeTextPayload(located.block);
  const textParam = payload.mTextParam as JsonRecord | undefined;
  const style = textParam?.mStyleSheet as JsonRecord | undefined;
  if (!textParam || !style) throw new Error("PREMIERE_SOURCE_TEXT_SCHEMA_UNSUPPORTED");
  style.mText = spec.text;
  style.mFontName = { mParamValues: [[0, spec.fontPostScriptName]] };
  style.mFontSize = { mParamValues: [[0, spec.fontSizePixels]] };
  style.mFillColor = { mParamValues: [[0, Number.parseInt(spec.colorHex.slice(1), 16)]] };
  style.mFillVisible = { mParamValues: [[0, true]] };
  style.mStrokeVisible = { mParamValues: [[0, false]] };
  textParam.mAlignment = alignmentToHost[spec.alignment];
  textParam.mRTL = false;
  textParam.mIsVerticalText = false;
  textParam.mWidth = 0;

  const encoded = encodeTextPayload(payload);
  const updatedBlock = located.block.replace(
    /(<StartKeyframeValue[^>]*>)[\s\S]*?(<\/StartKeyframeValue>)/,
    `$1${encoded}\n\t\t$2`,
  );
  let updated = xml.slice(0, located.index) + updatedBlock + xml.slice(located.index + located.block.length);
  const component=locateComponent(updated,"AE.ADBE Text");
  const named=component.block.replace(/(<InstanceName>)[\s\S]*?(<\/InstanceName>)/,`$1${xmlEscape(spec.text.replace(/[\r\n]+/g," "))}$2`);
  updated=updated.slice(0,component.index)+named+updated.slice(component.index+component.block.length);
  return replaceTextPosition(updated, spec.position);
}

function textPosition(xml: string): { x: number; y: number } {
  const block=locateParameter(xml,locateComponent(xml,"AE.ADBE Text"),2).block;
  const match = /<StartKeyframe>([^<]+)<\/StartKeyframe>/.exec(block);
  const values = match?.[1]?.split(",");
  if (!values?.[1] || !values[2]) throw new Error("PREMIERE_TEXT_POSITION_PARAMETER_NOT_FOUND");
  const xy=values[1].includes(":")?values[1].split(":"):values.slice(1,3);
  if(xy.length!==2||xy.some(v=>!Number.isFinite(Number(v))))throw Error("PREMIERE_TEXT_POSITION_VALUE_INVALID");
  return { x: Number(xy[0]), y: Number(xy[1]) };
}

export function inspectPremiereTextProjectXml(xml: string): TextState {
  const located = sourceTextBlock(xml);
  const payload = decodeTextPayload(located.block);
  const textParam = payload.mTextParam as JsonRecord | undefined;
  const style = textParam?.mStyleSheet as JsonRecord | undefined;
  if (!textParam || !style) throw new Error("PREMIERE_SOURCE_TEXT_SCHEMA_UNSUPPORTED");
  const alignment = hostToAlignment[Number(textParam.mAlignment)];
  if (!alignment) throw new Error("PREMIERE_TEXT_ALIGNMENT_UNSUPPORTED");
  const color = Number(style.mFillColor?.mParamValues?.[0]?.[1]);
  return {
    text: String(style.mText ?? ""),
    fontPostScriptName: String(style.mFontName?.mParamValues?.[0]?.[1] ?? ""),
    fontSizePixels: Number(style.mFontSize?.mParamValues?.[0]?.[1]),
    colorHex: `#${color.toString(16).padStart(6, "0").toUpperCase()}`,
    alignment,
    position: textPosition(xml),
  };
}

function patchPrgraphic(archive: Buffer, spec: EditableTextMogrtSpec): Buffer {
  const entries = decodeZipEntries(archive);
  let patched = 0;
  const updated = entries.map((entry) => {
    if (!entry.name.toLocaleLowerCase("en-US").endsWith(".prproj")) return entry;
    const xml = gunzipSync(entry.data).toString("utf8");
    patched += 1;
    return { ...entry, data: gzipSync(Buffer.from(patchPremiereTextProjectXml(xml, spec), "utf8")) };
  });
  if (patched !== 1) throw new Error(`PRGRAPHIC_PROJECT_COUNT_UNEXPECTED: ${patched}`);
  return encodeStoredZip(updated);
}

function inspectPrgraphic(archive: Buffer): TextState {
  const project = decodeZipEntries(archive).filter((entry) => entry.name.toLocaleLowerCase("en-US").endsWith(".prproj"));
  if (project.length !== 1 || !project[0]) throw new Error(`PRGRAPHIC_PROJECT_COUNT_UNEXPECTED: ${project.length}`);
  return inspectPremiereTextProjectXml(gunzipSync(project[0].data).toString("utf8"));
}

function deterministicCapsuleId(source: Buffer, spec: EditableTextMogrtSpec): string {
  const digest = createHash("sha256").update(source).update(JSON.stringify(spec)).digest("hex").slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = "8";
  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function setLocalizedStrings(holder: JsonRecord | undefined, value: string): void {
  const entries = holder?.strDB;
  if (!Array.isArray(entries)) return;
  for (const entry of entries) if (entry && typeof entry === "object") entry.str = value;
}

function patchDefinition(data: Buffer, source: Buffer, spec: EditableTextMogrtSpec): Buffer {
  const definition = JSON.parse(data.toString("utf8")) as JsonRecord;
  const capsuleId = deterministicCapsuleId(source, spec);
  definition.capsuleID = capsuleId;
  definition.authorID = "Premiere UXP MCP";
  definition.capsuleName = `Premiere UXP MCP Editable Text ${capsuleId.slice(0, 8)}`;
  setLocalizedStrings(definition.capsuleNameLocalized, definition.capsuleName);
  const controls = Array.isArray(definition.clientControls) ? definition.clientControls : [];
  const textControls = controls.filter((control: JsonRecord) => Number(control?.type) === 6);
  if (textControls.length !== 1) throw new Error(`MOGRT_TEXT_CONTROL_COUNT_UNEXPECTED: ${textControls.length}`);
  for (const control of textControls) {
    setLocalizedStrings(control.value, spec.text);
    control.fonteditinfo = {
      ...(control.fonteditinfo ?? {}),
      capPropFontEdit: true,
      capPropFontFauxStyleEdit: true,
      capPropFontSizeEdit: true,
      fontEditValue: spec.fontPostScriptName,
      fontSizeEditValue: spec.fontSizePixels,
    };
  }
  const localizedFonts = definition.usedFontsLocalized;
  if (localizedFonts && typeof localizedFonts === "object") {
    for (const locale of Object.keys(localizedFonts)) localizedFonts[locale] = [spec.fontPostScriptName];
  }
  return Buffer.from(JSON.stringify(definition), "utf8");
}

function stateMatches(actual: TextState, expected: EditableTextMogrtSpec): boolean {
  return actual.text === expected.text
    && actual.fontPostScriptName === expected.fontPostScriptName
    && Math.abs(actual.fontSizePixels - expected.fontSizePixels) < 1e-6
    && actual.colorHex.toUpperCase() === expected.colorHex.toUpperCase()
    && actual.alignment === expected.alignment
    && Math.abs(actual.position.x - expected.position.x) < 1e-9
    && Math.abs(actual.position.y - expected.position.y) < 1e-9;
}

export function createEditableTextMogrtBuffer(template: Buffer, spec: EditableTextMogrtSpec): Buffer {
  validateSpec(spec);
  const sourceEntries = decodeZipEntries(template);
  let definitionCount = 0;
  let projectCount = 0;
  const updated = sourceEntries.map((entry) => {
    const lower = entry.name.toLocaleLowerCase("en-US");
    if (lower === "definition.json") {
      definitionCount += 1;
      return { ...entry, data: patchDefinition(entry.data, template, spec) };
    }
    if (lower.endsWith(".prgraphic")) {
      projectCount += 1;
      return { ...entry, data: patchPrgraphic(entry.data, spec) };
    }
    return entry;
  });
  if (definitionCount !== 1) throw new Error(`MOGRT_DEFINITION_COUNT_UNEXPECTED: ${definitionCount}`);
  if (projectCount < 1) throw new Error("MOGRT_HAS_NO_PREMIERE_GRAPHIC_PROJECT");
  return encodeStoredZip(updated);
}

export function inspectEditableTextMogrtBuffer(archive: Buffer): {
  capsuleId: string;
  textControlCount: number;
  projectStates: Array<{ name: string; state: TextState }>;
} {
  const entries = decodeZipEntries(archive);
  const definitionEntry = entries.find((entry) => entry.name.toLocaleLowerCase("en-US") === "definition.json");
  if (!definitionEntry) throw new Error("MOGRT_DEFINITION_NOT_FOUND");
  const definition = JSON.parse(definitionEntry.data.toString("utf8")) as JsonRecord;
  const textControlCount = (Array.isArray(definition.clientControls) ? definition.clientControls : [])
    .filter((control: JsonRecord) => Number(control?.type) === 6).length;
  return {
    capsuleId: String(definition.capsuleID ?? ""),
    textControlCount,
    projectStates: entries
      .filter((entry) => entry.name.toLocaleLowerCase("en-US").endsWith(".prgraphic"))
      .map((entry) => ({ name: entry.name, state: inspectPrgraphic(entry.data) })),
  };
}

export async function createEditableTextMogrt(input: {
  templatePath: string;
  outputPath: string;
  spec: EditableTextMogrtSpec;
}): Promise<{
  outputPath: string;
  sizeBytes: number;
  sha256: string;
  capsuleId: string;
  textControlCount: number;
  patchedProjectFiles: number;
  verifiedSpec: EditableTextMogrtSpec;
}> {
  validateSpec(input.spec);
  const template = await readFile(input.templatePath);
  const generated = createEditableTextMogrtBuffer(template, input.spec);
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, generated, { flag: "wx" });
  const stored = await readFile(input.outputPath);
  const inspection = inspectEditableTextMogrtBuffer(stored);
  if (inspection.textControlCount !== 1 || !inspection.projectStates.length || inspection.projectStates.some(({ state }) => !stateMatches(state, input.spec))) {
    throw new Error("GENERATED_MOGRT_TEXT_READBACK_MISMATCH");
  }
  return {
    outputPath: input.outputPath,
    sizeBytes: stored.length,
    sha256: createHash("sha256").update(stored).digest("hex"),
    capsuleId: inspection.capsuleId,
    textControlCount: inspection.textControlCount,
    patchedProjectFiles: inspection.projectStates.length,
    verifiedSpec: input.spec,
  };
}
