import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createEditableRectangleMogrt,
  createEditableRectangleMogrtBuffer,
  inspectEditableRectangleMogrtBuffer,
  inspectPremiereRectangleProjectXml,
  patchPremiereRectangleProjectXml,
} from "../../apps/mcp-server/src/editable-rectangle-mogrt.js";
import { decodeZipEntries, encodeStoredZip } from "../../apps/mcp-server/src/editable-text-mogrt.js";
import { inspectSavedRectangle } from "../../apps/mcp-server/src/premiere-graphic-archive.js";

function jsonValue(value: unknown): string {
  const json = Buffer.from(JSON.stringify(value), "utf16le");
  const payload = Buffer.alloc(8 + json.length);
  payload.writeBigUInt64LE(BigInt(json.length), 0);
  json.copy(payload, 8);
  return payload.toString("base64");
}

function rectanglePath(width: number, height: number): string {
  const payload = Buffer.alloc(8 + 4 * 28 + 1);
  payload.writeInt32LE(2, 0);
  payload.writeInt32LE(4, 4);
  const points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  points.forEach(({ x, y }, index) => {
    const offset = 8 + index * 28;
    payload.writeFloatLE(0, offset);
    for (const coordinateOffset of [4, 12, 20]) payload.writeFloatLE(x, offset + coordinateOffset);
    for (const coordinateOffset of [8, 16, 24]) payload.writeFloatLE(y, offset + coordinateOffset);
  });
  payload[payload.length - 1] = 1;
  return payload.toString("base64");
}

function param(id: number, name: string, values: number[]): string {
  return `<VideoComponentParam ObjectID="${id}"><Name>${name}</Name><IsTimeVarying>true</IsTimeVarying><StartKeyframe>-91445760000000000,${values.join(",")},0,0,0,0,0,0</StartKeyframe><Keyframes>0,1,0,0;</Keyframes><CurrentValue>1</CurrentValue></VideoComponentParam>`;
}

function pointParam(id: number, name: string, x: number, y: number): string {
  return `<PointComponentParam ObjectID="${id}"><Name>${name}</Name><StartKeyframe>-91445760000000000,${x},${y},0,0,0,0,0,0</StartKeyframe><Keyframes>0,1,1,0,0;</Keyframes></PointComponentParam>`;
}

function arbParam(id: number, name: string, value: string): string {
  return `<ArbVideoComponentParam ObjectID="${id}"><Name>${name}</Name><StartKeyframeValue Encoding="base64">${value}</StartKeyframeValue></ArbVideoComponentParam>`;
}

function component(id: number, displayName: string, matchName: string, refs: number[]): string {
  return `<VideoFilterComponent ObjectID="${id}"><Component><Params>${refs.map((ref, index) => `<Param Index="${index}" ObjectRef="${ref}"/>`).join("")}</Params><DisplayName>${displayName}</DisplayName><InstanceName>${displayName}</InstanceName></Component><MatchName>${matchName}</MatchName></VideoFilterComponent>`;
}

function projectXml(): string {
  const textState = {
    mTextParam: {
      mStyleSheet: {
        mText: "Insert Name Here",
        mFillVisible: { mParamValues: [[0, true]] },
        mStrokeVisible: { mParamValues: [[0, true]] },
      },
    },
    mVersion: 1,
  };
  const appearance = {
    mStyle: {
      mFillColor: 0,
      mFillColorType: 1,
      mFillVisible: true,
      mGradientInfo: { mColorStops: [] },
      mStrokeColor: 0xffffff,
      mStrokeVisible: false,
      mStrokeWidth: 1,
      mShadowVisible: true,
    },
    mVersion: 1,
  };
  return `<PremiereData>
${component(100, "Text", "AE.ADBE Text", [1, 11, 12, 13, 14, 15, 16, 2])}
${component(101, "Shape", "AE.ADBE Shape", [3, 4, 17, 5, 6, 7, 18, 8, 9, 10])}
${arbParam(1, "Source Text", jsonValue(textState))}
${param(2, "Opacity", [100])}
${param(11, "Transform", [0])}
${param(12, "Position", [0])}
${param(13, "Scale", [100])}
${param(14, "Horizontal Scale", [100])}
${param(15, "Constrain", [1])}
${param(16, "Rotation", [0])}
${arbParam(3, "Path", rectanglePath(838, 75))}
${arbParam(4, "Appearance", jsonValue(appearance))}
${param(17, "Transform", [0])}
${pointParam(5, "Position", -0.0125, 0.824)}
${param(6, "Scale", [100])}
${param(7, "Horizontal Scale", [100])}
${param(18, "Constrain", [1])}
${param(8, "Rotation", [0])}
${param(9, "Opacity", [100])}
${pointParam(10, "Anchor Point", 0, 0)}
</PremiereData>`;
}

function template(): Buffer {
  const nested = encodeStoredZip([{ name: "template.prproj", data: gzipSync(Buffer.from(projectXml(), "utf8")) }]);
  const definition = {
    capsuleID: "00000000-0000-0000-0000-000000000000",
    capsuleName: "Classic Lower Third One Line",
    capsuleNameLocalized: { strDB: [{ localeString: "en_US", str: "Classic Lower Third One Line" }] },
    clientControls: [
      { type: 6, value: { strDB: [{ localeString: "en_US", str: "Insert Name Here" }] } },
      { type: 8, hidden: true, value: { strDB: [{ localeString: "en_US", str: "Shape" }] } },
    ],
  };
  return encodeStoredZip([
    { name: "definition.json", data: Buffer.from(JSON.stringify(definition), "utf8") },
    { name: "project.prgraphic", data: nested },
  ]);
}

const spec = {
  widthPixels: 640,
  heightPixels: 180,
  fillColorHex: "#2457A6",
  strokeColorHex: "#F5E7C6",
  strokeWidthPixels: 8,
  opacityPercent: 82,
  rotationDegrees: -12.5,
  position: { x: 0.45, y: 0.72 },
};

describe("editable Premiere rectangle MOGRT", () => {
  it("checks the exact sequence/track/clip graph and native saved point syntax",()=>{
    let xml=patchPremiereRectangleProjectXml(projectXml(),spec);
    xml=xml.replace(/(<PointComponentParam[^>]*>[\s\S]*?<StartKeyframe>[^,]+),([^,]+),([^,]+),/g,"$1,$2:$3,");
    const graph=`<Sequence ObjectUID="sequence"><TrackGroups><TrackGroup><Second ObjectRef="900"/></TrackGroup></TrackGroups></Sequence>
      <VideoTrackGroup ObjectID="900"><Track Index="1" ObjectURef="track"/></VideoTrackGroup>
      <VideoClipTrack ObjectUID="track"><TrackItem Index="0" ObjectRef="901"/></VideoClipTrack>
      <VideoClipTrackItem ObjectID="901"><Components ObjectRef="902"/><Start>10</Start><End>20</End></VideoClipTrackItem>
      <VideoComponentChain ObjectID="902"><Component Index="0" ObjectRef="100"/><Component Index="1" ObjectRef="101"/></VideoComponentChain>`;
    const target={sequenceId:"sequence",trackIndex:1,startTicks:"10",endTicks:"20"};
    expect(inspectSavedRectangle(xml+graph,target)).toMatchObject({...spec,hiddenText:true});
    expect(()=>inspectSavedRectangle(xml+graph,{...target,trackIndex:0})).toThrow("TRACK_MISSING");
    expect(()=>inspectSavedRectangle(xml+graph,{...target,startTicks:"11"})).toThrow("CLIP_NOT_UNIQUE");
  });
  it("patches one native Shape component and removes template animation", () => {
    const patched = patchPremiereRectangleProjectXml(projectXml(), spec);
    expect(inspectPremiereRectangleProjectXml(patched)).toEqual({
      ...spec,
      hiddenText: true,
      shapeMatchName: "AE.ADBE Shape",
    });
    for (const objectId of [2, 5, 6, 7, 8, 9, 10]) {
      const target = new RegExp(`<([A-Za-z0-9_]+) ObjectID="${objectId}">[\\s\\S]*?<\\/\\1>`).exec(patched)?.[0];
      expect(target).toBeDefined();
      expect(target).not.toContain("<Keyframes>");
      expect(target).toContain("<IsTimeVarying>false</IsTimeVarying>");
    }
    expect(patched).not.toContain("mGradientInfo");
    expect(patched).toContain("<InstanceName>Premiere UXP MCP Hidden Helper</InstanceName>");
  });

  it("creates and independently inspects a native editable rectangle MOGRT", () => {
    const generated = createEditableRectangleMogrtBuffer(template(), spec);
    const inspection = inspectEditableRectangleMogrtBuffer(generated);
    expect(inspection).toMatchObject({
      textControlCount: 1,
      shapeControlCount: 1,
      projectStates: [{ state: { ...spec, hiddenText: true, shapeMatchName: "AE.ADBE Shape" } }],
    });
    expect(inspection.capsuleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);

    const projectGraphic = decodeZipEntries(generated).find(({ name }) => name === "project.prgraphic");
    const project = decodeZipEntries(projectGraphic!.data).find(({ name }) => name.endsWith(".prproj"));
    expect(inspectPremiereRectangleProjectXml(gunzipSync(project!.data).toString("utf8"))).toMatchObject(spec);
  });

  it("fails closed when the source path is not the verified four-point rectangle schema", () => {
    const malformed = projectXml().replace(rectanglePath(838, 75), Buffer.from("not-a-path").toString("base64"));
    expect(() => patchPremiereRectangleProjectXml(malformed, spec)).toThrow("PREMIERE_SHAPE_PATH_SCHEMA_UNSUPPORTED");
  });

  it("never deletes or overwrites a pre-existing output file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "editable-rectangle-mogrt-"));
    const templatePath = path.join(root, "template.mogrt");
    const outputPath = path.join(root, "existing.mogrt");
    const sentinel = Buffer.from("pre-existing-user-file", "utf8");
    try {
      await writeFile(templatePath, template());
      await writeFile(outputPath, sentinel);
      await expect(createEditableRectangleMogrt({ templatePath, outputPath, spec })).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(outputPath)).toEqual(sentinel);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
