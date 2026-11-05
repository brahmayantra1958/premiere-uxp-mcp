import { gzipSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createEditableTextMogrtBuffer,
  decodeZipEntries,
  encodeStoredZip,
  inspectEditableTextMogrtBuffer,
  inspectPremiereTextProjectXml,
} from "../../apps/mcp-server/src/editable-text-mogrt.js";

const originalTextState = {
  mTextParam: {
    mAlignment: 2,
    mIsVerticalText: false,
    mRTL: false,
    mWidth: 0,
    mStyleSheet: {
      mText: "Your Title Here",
      mFontName: { mParamValues: [[0, "MyriadPro-Regular"]] },
      mFontSize: { mParamValues: [[0, 100]] },
      mFillColor: { mParamValues: [[0, 16777215]] },
      mFillVisible: { mParamValues: [[0, true]] },
      mStrokeVisible: { mParamValues: [[0, false]] },
    },
  },
  mVersion: 1,
};

function textValue(): string {
  const json = Buffer.from(JSON.stringify(originalTextState), "utf16le");
  const value = Buffer.alloc(8 + json.length);
  value.writeBigUInt64LE(BigInt(json.length), 0);
  json.copy(value, 8);
  return value.toString("base64");
}

function projectXml(): string {
  return `<PremiereData>
<VideoFilterComponent ObjectID="1"><Component><Params><Param Index="0" ObjectRef="2"/><Param Index="2" ObjectRef="3"/></Params><DisplayName>텍스트</DisplayName><InstanceName>Your Title Here</InstanceName></Component><MatchName>AE.ADBE Text</MatchName></VideoFilterComponent>
<ArbVideoComponentParam ObjectID="2"><Name>소스 텍스트</Name><StartKeyframeValue Encoding="base64">${textValue()}</StartKeyframeValue></ArbVideoComponentParam>
<PointComponentParam ObjectID="3"><Name>위치</Name><StartKeyframe>-91445760000000000,0.5:0.5,0,0,0</StartKeyframe></PointComponentParam>
</PremiereData>`;
}

function template(): Buffer {
  const nested = encodeStoredZip([{ name: "template.prproj", data: gzipSync(Buffer.from(projectXml(), "utf8")) }]);
  const definition = {
    capsuleID: "00000000-0000-0000-0000-000000000000",
    capsuleName: "Basic Title",
    capsuleNameLocalized: { strDB: [{ localeString: "en_US", str: "Basic Title" }] },
    clientControls: [{
      type: 6,
      fonteditinfo: { capPropFontEdit: false, capPropFontSizeEdit: false },
      value: { strDB: [{ localeString: "en_US", str: "Your Title Here" }] },
    }],
    usedFontsLocalized: { en_US: ["MyriadPro-Regular"] },
  };
  return encodeStoredZip([
    { name: "definition.json", data: Buffer.from(JSON.stringify(definition), "utf8") },
    { name: "project.prgraphic", data: nested },
  ]);
}

describe("editable Premiere text MOGRT", () => {
  it("round-trips stored ZIP entries without changing their bytes", () => {
    const archive = encodeStoredZip([{ name: "a.txt", data: Buffer.from("hello") }, { name: "folder/", data: Buffer.alloc(0) }]);
    expect(decodeZipEntries(archive).map(({ name, data }) => [name, data.toString("utf8")])).toEqual([
      ["a.txt", "hello"],
      ["folder/", ""],
    ]);
  });

  it("creates a one-control MOGRT whose nested Premiere text is editable and styled", () => {
    const spec = {
      text: "연출: 장이머우 감독\n장소: MGM 시어터, MGM 코타이",
      fontPostScriptName: "SourceHanSansKR-Regular",
      fontSizePixels: 19.6875,
      colorHex: "#DDE3E8",
      alignment: "right" as const,
      position: { x: 0.9453125, y: 0.1 },
    };
    const generated = createEditableTextMogrtBuffer(template(), spec);
    const inspection = inspectEditableTextMogrtBuffer(generated);
    expect(inspection).toMatchObject({ textControlCount: 1, projectStates: [{ state: spec }] });
    expect(inspection.capsuleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);

    const projectGraphic = decodeZipEntries(generated).find(({ name }) => name === "project.prgraphic");
    expect(projectGraphic).toBeDefined();
    const project = decodeZipEntries(projectGraphic!.data).find(({ name }) => name.endsWith(".prproj"));
    expect(project).toBeDefined();
    expect(inspectPremiereTextProjectXml(gunzipSync(project!.data).toString("utf8"))).toEqual(spec);
  });

  it("rejects traversal names before materializing an archive", () => {
    expect(() => encodeStoredZip([{ name: "../escape", data: Buffer.alloc(0) }])).toThrow("UNSAFE_ZIP_ENTRY_NAME");
  });
});
