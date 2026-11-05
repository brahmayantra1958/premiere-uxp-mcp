import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { decodeZipEntries, encodeStoredZip } from "./editable-text-mogrt.js";

export type EditableRectangleMogrtSpec = {
  widthPixels: number;
  heightPixels: number;
  fillColorHex: string;
  strokeColorHex: string;
  strokeWidthPixels: number;
  opacityPercent: number;
  rotationDegrees: number;
  position: { x: number; y: number };
};

type JsonRecord = Record<string, any>;
type LocatedBlock = { block: string; index: number };

const SHAPE_MATCH_NAME = "AE.ADBE Shape";
const TEXT_MATCH_NAME = "AE.ADBE Text";
const PATH_VERSION = 2;
const RECTANGLE_POINT_COUNT = 4;
const PATH_HEADER_BYTES = 8;
const PATH_POINT_BYTES = 28;
const PATH_CLOSED_BYTES = 1;
const HIDDEN_TEXT = "\u200b";

function assertRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
}

function validateSpec(spec: EditableRectangleMogrtSpec): void {
  assertRange(spec.widthPixels, 1, 20_000, "widthPixels");
  assertRange(spec.heightPixels, 1, 20_000, "heightPixels");
  if (!/^#[0-9a-f]{6}$/i.test(spec.fillColorHex)) throw new Error("fillColorHex must be #RRGGBB");
  if (!/^#[0-9a-f]{6}$/i.test(spec.strokeColorHex)) throw new Error("strokeColorHex must be #RRGGBB");
  assertRange(spec.strokeWidthPixels, 0, 1_000, "strokeWidthPixels");
  assertRange(spec.opacityPercent, 0, 100, "opacityPercent");
  assertRange(spec.rotationDegrees, -36_000, 36_000, "rotationDegrees");
  assertRange(spec.position.x, 0, 1, "position.x");
  assertRange(spec.position.y, 0, 1, "position.y");
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function componentBlock(xml: string, matchName: string): LocatedBlock {
  const matches = [...xml.matchAll(/<VideoFilterComponent\b[^>]*>[\s\S]*?<\/VideoFilterComponent>/g)]
    .filter((match) => match[0].includes(`<MatchName>${matchName}</MatchName>`));
  if (matches.length !== 1 || matches[0]?.index == null) {
    throw new Error(`PREMIERE_COMPONENT_COUNT_UNEXPECTED: ${matchName}=${matches.length}`);
  }
  return { block: matches[0][0], index: matches[0].index };
}

function objectBlock(xml: string, objectId: string): LocatedBlock {
  if (!/^\d+$/.test(objectId)) throw new Error(`PREMIERE_OBJECT_ID_INVALID: ${objectId}`);
  const pattern = new RegExp(`<([A-Za-z0-9_]+)\\b[^>]*ObjectID="${regexEscape(objectId)}"[^>]*>[\\s\\S]*?<\\/\\1>`);
  const match = pattern.exec(xml);
  if (!match || match.index == null) throw new Error(`PREMIERE_OBJECT_NOT_FOUND: ${objectId}`);
  return { block: match[0], index: match.index };
}

function replaceLocated(xml: string, located: LocatedBlock, replacement: string): string {
  return xml.slice(0, located.index) + replacement + xml.slice(located.index + located.block.length);
}

function parameterBlockAtIndex(xml: string, component: LocatedBlock, parameterIndex: number): LocatedBlock {
  const pattern = new RegExp(`<Param Index="${parameterIndex}" ObjectRef="(\\d+)"\\/>`, "g");
  const refs = [...component.block.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
  if (refs.length !== 1 || !refs[0]) {
    throw new Error(`PREMIERE_COMPONENT_PARAMETER_INDEX_UNEXPECTED: ${parameterIndex}=${refs.length}`);
  }
  return objectBlock(xml, refs[0]);
}

function decodeJsonPayload(block: string, parameterName: string): JsonRecord {
  const match = /<StartKeyframeValue[^>]*>([\s\S]*?)<\/StartKeyframeValue>/.exec(block);
  if (!match?.[1]) throw new Error(`PREMIERE_${parameterName.toUpperCase()}_VALUE_NOT_FOUND`);
  const encoded = Buffer.from(match[1].trim(), "base64");
  if (encoded.length < 10 || encoded.readBigUInt64LE(0) !== BigInt(encoded.length - 8)) {
    throw new Error(`PREMIERE_${parameterName.toUpperCase()}_LENGTH_PREFIX_MISMATCH`);
  }
  return JSON.parse(encoded.subarray(8).toString("utf16le")) as JsonRecord;
}

function encodeJsonPayload(payload: JsonRecord): string {
  const json = Buffer.from(JSON.stringify(payload), "utf16le");
  const encoded = Buffer.alloc(8 + json.length);
  encoded.writeBigUInt64LE(BigInt(json.length), 0);
  json.copy(encoded, 8);
  return encoded.toString("base64");
}

function replaceEncodedPayload(block: string, encoded: string): string {
  return block.replace(
    /(<StartKeyframeValue[^>]*>)[\s\S]*?(<\/StartKeyframeValue>)/,
    `$1${encoded}\n\t\t$2`,
  );
}

function staticParameterBlock(block: string, values: number[]): string {
  const match = /<StartKeyframe>([^<]+)<\/StartKeyframe>/.exec(block);
  if (!match?.[1]) throw new Error("PREMIERE_STATIC_PARAMETER_VALUE_NOT_FOUND");
  const fields = match[1].split(",");
  if (fields.length < values.length + 1) throw new Error("PREMIERE_STATIC_PARAMETER_VALUE_INVALID");
  if(values.length===2 && fields[1]?.includes(":")) fields[1]=values.join(":");
  else values.forEach((value, index) => { fields[index + 1] = String(value); });
  let updated = block.replace(match[1], fields.join(","));
  updated = updated.replace(/\s*<Keyframes>[\s\S]*?<\/Keyframes>/g, "");
  updated = updated.replace(/<CurrentValue>[^<]*<\/CurrentValue>/g, `<CurrentValue>${values[0]}</CurrentValue>`);
  if (/<IsTimeVarying>[^<]*<\/IsTimeVarying>/.test(updated)) {
    updated = updated.replace(/<IsTimeVarying>[^<]*<\/IsTimeVarying>/, "<IsTimeVarying>false</IsTimeVarying>");
  } else {
    updated = updated.replace(/(<Name>[\s\S]*?<\/Name>)/, "$1\n\t\t<IsTimeVarying>false</IsTimeVarying>");
  }
  return updated;
}

function readStaticValues(block: string, count: number): number[] {
  const match = /<StartKeyframe>([^<]+)<\/StartKeyframe>/.exec(block);
  const fields = match?.[1]?.split(",");
  if (!fields || fields.length < count + 1) throw new Error("PREMIERE_STATIC_PARAMETER_VALUE_NOT_FOUND");
  const values = (count===2 && fields[1]?.includes(":") ? fields[1].split(":") : fields.slice(1, count + 1)).map(Number);
  if(values.length!==count) throw Error("PREMIERE_STATIC_PARAMETER_VALUE_INVALID");
  if (values.some((value) => !Number.isFinite(value))) throw new Error("PREMIERE_STATIC_PARAMETER_VALUE_INVALID");
  return values;
}

function decodePath(block: string): Buffer {
  const match = /<StartKeyframeValue[^>]*>([\s\S]*?)<\/StartKeyframeValue>/.exec(block);
  if (!match?.[1]) throw new Error("PREMIERE_SHAPE_PATH_VALUE_NOT_FOUND");
  const payload = Buffer.from(match[1].trim(), "base64");
  const expectedLength = PATH_HEADER_BYTES + RECTANGLE_POINT_COUNT * PATH_POINT_BYTES + PATH_CLOSED_BYTES;
  if (payload.length !== expectedLength
    || payload.readInt32LE(0) !== PATH_VERSION
    || payload.readInt32LE(4) !== RECTANGLE_POINT_COUNT
    || payload[payload.length - 1] !== 1) {
    throw new Error("PREMIERE_SHAPE_PATH_SCHEMA_UNSUPPORTED");
  }
  return payload;
}

function pathAnchors(payload: Buffer): Array<{ x: number; y: number }> {
  return Array.from({ length: RECTANGLE_POINT_COUNT }, (_, index) => {
    const offset = PATH_HEADER_BYTES + index * PATH_POINT_BYTES;
    const x = payload.readFloatLE(offset + 4);
    const y = payload.readFloatLE(offset + 8);
    for (const controlOffset of [12, 16, 20, 24]) {
      const expected = controlOffset % 8 === 4 ? x : y;
      if (Math.abs(payload.readFloatLE(offset + controlOffset) - expected) > 1e-4) {
        throw new Error("PREMIERE_SHAPE_PATH_IS_NOT_A_STRAIGHT_RECTANGLE");
      }
    }
    return { x, y };
  });
}

function rectangleDimensions(payload: Buffer): { widthPixels: number; heightPixels: number } {
  const points = pathAnchors(payload);
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const widthPixels = Math.max(...xs) - Math.min(...xs);
  const heightPixels = Math.max(...ys) - Math.min(...ys);
  if (!(widthPixels > 0) || !(heightPixels > 0)) throw new Error("PREMIERE_SHAPE_RECTANGLE_HAS_NO_AREA");
  return { widthPixels, heightPixels };
}

function centeredRectanglePath(block: string, widthPixels: number, heightPixels: number): string {
  const payload = decodePath(block);
  rectangleDimensions(payload);
  const points = [
    { x: -widthPixels / 2, y: -heightPixels / 2 },
    { x: widthPixels / 2, y: -heightPixels / 2 },
    { x: widthPixels / 2, y: heightPixels / 2 },
    { x: -widthPixels / 2, y: heightPixels / 2 },
  ];
  points.forEach(({ x, y }, index) => {
    const offset = PATH_HEADER_BYTES + index * PATH_POINT_BYTES;
    for (const coordinateOffset of [4, 12, 20]) payload.writeFloatLE(x, offset + coordinateOffset);
    for (const coordinateOffset of [8, 16, 24]) payload.writeFloatLE(y, offset + coordinateOffset);
  });
  return replaceEncodedPayload(block, payload.toString("base64"));
}

function colorNumber(colorHex: string): number {
  return Number.parseInt(colorHex.slice(1), 16);
}

function colorHex(value: unknown): string {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xffffff) throw new Error("PREMIERE_SHAPE_COLOR_INVALID");
  return `#${number.toString(16).padStart(6, "0").toUpperCase()}`;
}

function patchAppearance(block: string, spec: EditableRectangleMogrtSpec): string {
  const payload = decodeJsonPayload(block, "shape_appearance");
  const style = payload.mStyle as JsonRecord | undefined;
  if (!style) throw new Error("PREMIERE_SHAPE_APPEARANCE_SCHEMA_UNSUPPORTED");
  style.mFillColor = colorNumber(spec.fillColorHex);
  style.mFillVisible = true;
  delete style.mFillColorType;
  delete style.mGradientInfo;
  style.mStrokeColor = colorNumber(spec.strokeColorHex);
  style.mStrokeVisible = spec.strokeWidthPixels > 0;
  style.mStrokeWidth = spec.strokeWidthPixels;
  style.mShadowVisible = false;
  return replaceEncodedPayload(block, encodeJsonPayload(payload));
}

function hideTextPayload(block: string): string {
  const payload = decodeJsonPayload(block, "source_text");
  const text = payload.mTextParam as JsonRecord | undefined;
  const style = text?.mStyleSheet as JsonRecord | undefined;
  if (!text || !style) throw new Error("PREMIERE_SOURCE_TEXT_SCHEMA_UNSUPPORTED");
  style.mText = HIDDEN_TEXT;
  style.mFillVisible = { mParamValues: [[0, false]] };
  style.mStrokeVisible = { mParamValues: [[0, false]] };
  if (style.mShadowVisible) style.mShadowVisible = { mParamValues: [[0, false]] };
  return replaceEncodedPayload(block, encodeJsonPayload(payload));
}

function updateParameter(
  xml: string,
  componentMatchName: string,
  parameterIndex: number,
  update: (block: string) => string,
): string {
  const component = componentBlock(xml, componentMatchName);
  const parameter = parameterBlockAtIndex(xml, component, parameterIndex);
  return replaceLocated(xml, parameter, update(parameter.block));
}

export function patchPremiereRectangleProjectXml(xml: string, spec: EditableRectangleMogrtSpec): string {
  validateSpec(spec);
  let updated = xml;
  if(xml.includes("<MatchName>AE.ADBE Opacity</MatchName>"))
    updated=updateParameter(updated,"AE.ADBE Opacity",0,block=>staticParameterBlock(block,[100]));
  // These indices are the stable component contract of Adobe's installed
  // Classic Lower Third One Line template. Parameter display names are
  // localized in its ja/ko/ru/zh project variants, so names are not identities.
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 0, (block) => centeredRectanglePath(block, spec.widthPixels, spec.heightPixels));
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 1, (block) => patchAppearance(block, spec));
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 3, (block) => staticParameterBlock(block, [spec.position.x, spec.position.y]));
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 4, (block) => staticParameterBlock(block, [100]));
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 5, (block) => staticParameterBlock(block, [100]));
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 7, (block) => staticParameterBlock(block, [spec.rotationDegrees]));
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 8, (block) => staticParameterBlock(block, [spec.opacityPercent]));
  updated = updateParameter(updated, SHAPE_MATCH_NAME, 9, (block) => staticParameterBlock(block, [0, 0]));
  updated = updateParameter(updated, TEXT_MATCH_NAME, 0, hideTextPayload);
  // The invisible template helper must not retain its lower-third animation.
  // It has no visible role and otherwise leaves an unreadable animated PointF.
  updated = updateParameter(updated, TEXT_MATCH_NAME, 2, (block) => staticParameterBlock(block, [0, 0]));
  updated = updateParameter(updated, TEXT_MATCH_NAME, 7, (block) => staticParameterBlock(block, [0]));
  const textComponent = componentBlock(updated, TEXT_MATCH_NAME);
  const hiddenComponent = textComponent.block.replace(
    /(<InstanceName>)[\s\S]*?(<\/InstanceName>)/,
    `$1Premiere UXP MCP Hidden Helper$2`,
  );
  return replaceLocated(updated, textComponent, hiddenComponent);
}

export function inspectPremiereRectangleProjectXml(xml: string, nativeSavedProject = false): EditableRectangleMogrtSpec & {
  hiddenText: boolean;
  shapeMatchName: string;
} {
  const shape = componentBlock(xml, SHAPE_MATCH_NAME);
  const text = componentBlock(xml, TEXT_MATCH_NAME);
  const pathBlock = parameterBlockAtIndex(xml, shape, 0).block;
  const appearanceBlock = parameterBlockAtIndex(xml, shape, 1).block;
  const appearance = decodeJsonPayload(appearanceBlock, "shape_appearance");
  const style = appearance.mStyle as JsonRecord | undefined;
  if (!style) throw new Error("PREMIERE_SHAPE_APPEARANCE_SCHEMA_UNSUPPORTED");
  // Premiere 26.5 converts SourceText JSON to its binary native representation
  // on save. Hidden helper opacity is independently stored as a scalar. Never
  // attempt to parse or claim to verify that opaque binary text payload.
  const sourceText = nativeSavedProject ? null : decodeJsonPayload(parameterBlockAtIndex(xml, text, 0).block, "source_text");
  const textStyle = sourceText?.mTextParam?.mStyleSheet as JsonRecord | undefined;
  const [x, y] = readStaticValues(parameterBlockAtIndex(xml, shape, 3).block, 2);
  const [rotationDegrees] = readStaticValues(parameterBlockAtIndex(xml, shape, 7).block, 1);
  const [opacityPercent] = readStaticValues(parameterBlockAtIndex(xml, shape, 8).block, 1);
  const [textOpacity] = readStaticValues(parameterBlockAtIndex(xml, text, 7).block, 1);
  return {
    ...rectangleDimensions(decodePath(pathBlock)),
    fillColorHex: colorHex(style.mFillColor),
    strokeColorHex: colorHex(style.mStrokeColor),
    strokeWidthPixels: style.mStrokeVisible ? Number(style.mStrokeWidth) : 0,
    opacityPercent: opacityPercent!,
    rotationDegrees: rotationDegrees!,
    position: { x: x!, y: y! },
    hiddenText: textOpacity === 0 && (nativeSavedProject || (textStyle?.mText === HIDDEN_TEXT
      && textStyle?.mFillVisible?.mParamValues?.[0]?.[1] === false
      && textStyle?.mStrokeVisible?.mParamValues?.[0]?.[1] === false)),
    shapeMatchName: SHAPE_MATCH_NAME,
  };
}

function deterministicCapsuleId(source: Buffer, spec: EditableRectangleMogrtSpec): string {
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

function patchDefinition(data: Buffer, source: Buffer, spec: EditableRectangleMogrtSpec): Buffer {
  const definition = JSON.parse(data.toString("utf8")) as JsonRecord;
  const capsuleId = deterministicCapsuleId(source, spec);
  definition.capsuleID = capsuleId;
  definition.authorID = "Premiere UXP MCP";
  definition.capsuleName = `Premiere UXP MCP Editable Rectangle ${capsuleId.slice(0, 8)}`;
  setLocalizedStrings(definition.capsuleNameLocalized, definition.capsuleName);
  const controls = Array.isArray(definition.clientControls) ? definition.clientControls : [];
  const textControls = controls.filter((control: JsonRecord) => Number(control?.type) === 6);
  const shapeControls = controls.filter((control: JsonRecord) => Number(control?.type) === 8);
  if (textControls.length !== 1) throw new Error(`MOGRT_TEXT_CONTROL_COUNT_UNEXPECTED: ${textControls.length}`);
  if (shapeControls.length !== 1) throw new Error(`MOGRT_SHAPE_CONTROL_COUNT_UNEXPECTED: ${shapeControls.length}`);
  for (const control of textControls) setLocalizedStrings(control.value, HIDDEN_TEXT);
  return Buffer.from(JSON.stringify(definition), "utf8");
}

function patchPrgraphic(archive: Buffer, spec: EditableRectangleMogrtSpec): Buffer {
  const entries = decodeZipEntries(archive);
  let patched = 0;
  const updated = entries.map((entry) => {
    if (!entry.name.toLocaleLowerCase("en-US").endsWith(".prproj")) return entry;
    patched += 1;
    const xml = gunzipSync(entry.data).toString("utf8");
    return { ...entry, data: gzipSync(Buffer.from(patchPremiereRectangleProjectXml(xml, spec), "utf8")) };
  });
  if (patched !== 1) throw new Error(`PRGRAPHIC_PROJECT_COUNT_UNEXPECTED: ${patched}`);
  return encodeStoredZip(updated);
}

function inspectPrgraphic(archive: Buffer) {
  const projects = decodeZipEntries(archive).filter((entry) => entry.name.toLocaleLowerCase("en-US").endsWith(".prproj"));
  if (projects.length !== 1 || !projects[0]) throw new Error(`PRGRAPHIC_PROJECT_COUNT_UNEXPECTED: ${projects.length}`);
  return inspectPremiereRectangleProjectXml(gunzipSync(projects[0].data).toString("utf8"));
}

function stateMatches(actual: ReturnType<typeof inspectPremiereRectangleProjectXml>, expected: EditableRectangleMogrtSpec): boolean {
  return Math.abs(actual.widthPixels - expected.widthPixels) < 1e-4
    && Math.abs(actual.heightPixels - expected.heightPixels) < 1e-4
    && actual.fillColorHex.toUpperCase() === expected.fillColorHex.toUpperCase()
    && actual.strokeColorHex.toUpperCase() === expected.strokeColorHex.toUpperCase()
    && Math.abs(actual.strokeWidthPixels - expected.strokeWidthPixels) < 1e-6
    && Math.abs(actual.opacityPercent - expected.opacityPercent) < 1e-6
    && Math.abs(actual.rotationDegrees - expected.rotationDegrees) < 1e-6
    && Math.abs(actual.position.x - expected.position.x) < 1e-6
    && Math.abs(actual.position.y - expected.position.y) < 1e-6
    && actual.hiddenText
    && actual.shapeMatchName === SHAPE_MATCH_NAME;
}

export function createEditableRectangleMogrtBuffer(template: Buffer, spec: EditableRectangleMogrtSpec): Buffer {
  validateSpec(spec);
  const entries = decodeZipEntries(template);
  let definitionCount = 0;
  let projectCount = 0;
  const updated = entries.map((entry) => {
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

export function inspectEditableRectangleMogrtBuffer(archive: Buffer): {
  capsuleId: string;
  textControlCount: number;
  shapeControlCount: number;
  projectStates: Array<{ name: string; state: ReturnType<typeof inspectPremiereRectangleProjectXml> }>;
} {
  const entries = decodeZipEntries(archive);
  const definitionEntry = entries.find((entry) => entry.name.toLocaleLowerCase("en-US") === "definition.json");
  if (!definitionEntry) throw new Error("MOGRT_DEFINITION_NOT_FOUND");
  const definition = JSON.parse(definitionEntry.data.toString("utf8")) as JsonRecord;
  const controls = Array.isArray(definition.clientControls) ? definition.clientControls : [];
  return {
    capsuleId: String(definition.capsuleID ?? ""),
    textControlCount: controls.filter((control: JsonRecord) => Number(control?.type) === 6).length,
    shapeControlCount: controls.filter((control: JsonRecord) => Number(control?.type) === 8).length,
    projectStates: entries
      .filter((entry) => entry.name.toLocaleLowerCase("en-US").endsWith(".prgraphic"))
      .map((entry) => ({ name: entry.name, state: inspectPrgraphic(entry.data) })),
  };
}

export async function createEditableRectangleMogrt(input: {
  templatePath: string;
  outputPath: string;
  spec: EditableRectangleMogrtSpec;
}): Promise<{
  outputPath: string;
  sizeBytes: number;
  sha256: string;
  capsuleId: string;
  textControlCount: number;
  shapeControlCount: number;
  patchedProjectFiles: number;
  verifiedSpec: EditableRectangleMogrtSpec;
}> {
  validateSpec(input.spec);
  const template = await readFile(input.templatePath);
  const generated = createEditableRectangleMogrtBuffer(template, input.spec);
  const inspection = inspectEditableRectangleMogrtBuffer(generated);
  if (inspection.textControlCount !== 1
    || inspection.shapeControlCount !== 1
    || !inspection.projectStates.length
    || inspection.projectStates.some(({ state }) => !stateMatches(state, input.spec))) {
    throw new Error("GENERATED_MOGRT_RECTANGLE_READBACK_MISMATCH");
  }
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  let ownsOutput = false;
  try {
    const output = await open(input.outputPath, "wx");
    ownsOutput = true;
    try {
      await output.writeFile(generated);
    } finally {
      await output.close();
    }
    const stored = await readFile(input.outputPath);
    const storedInspection = inspectEditableRectangleMogrtBuffer(stored);
    if (storedInspection.projectStates.some(({ state }) => !stateMatches(state, input.spec))) {
      throw new Error("STORED_MOGRT_RECTANGLE_READBACK_MISMATCH");
    }
    return {
      outputPath: input.outputPath,
      sizeBytes: stored.length,
      sha256: createHash("sha256").update(stored).digest("hex"),
      capsuleId: storedInspection.capsuleId,
      textControlCount: storedInspection.textControlCount,
      shapeControlCount: storedInspection.shapeControlCount,
      patchedProjectFiles: storedInspection.projectStates.length,
      verifiedSpec: input.spec,
    };
  } catch (error) {
    if (ownsOutput) await unlink(input.outputPath).catch(() => undefined);
    throw error;
  }
}
