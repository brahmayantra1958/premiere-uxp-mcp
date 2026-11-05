import { describe, expect, it } from "vitest";
import { planEffectInsertion } from "../../packages/contracts/src/effect-insertion.js";

const chain = (...names: string[]) => names.map((matchName, componentIndex) => ({ componentIndex, matchName }));
const group = "AE.ADBE Graphic Group";
const graphic = chain("AE.ADBE Opacity", "AE.ADBE Motion", group, "AE.ADBE Text");

describe("effect insertion placement contract", () => {
  it("places a new video effect immediately before the generated group and retains sequential add order", () => {
    expect(planEffectInsertion(graphic, "video")).toEqual({ index: 2, mode: "insert", policy: "before_graphic_group", graphicGroupIndex: 2 });
    const withEffect = chain("AE.ADBE Opacity", "AE.ADBE Motion", "AE.ADBE Tint", group, "AE.ADBE Text");
    expect(planEffectInsertion(withEffect, "video").index).toBe(3);
    expect(graphic.map(c => c.matchName)).toEqual(["AE.ADBE Opacity", "AE.ADBE Motion", group, "AE.ADBE Text"]);
  });
  it("retains ordinary media and audio append defaults, including an empty chain", () => {
    expect(planEffectInsertion(chain("AE.ADBE Opacity", "AE.ADBE Motion"), "video")).toEqual({ index: 2, mode: "append", policy: "append" });
    expect(planEffectInsertion([], "video")).toEqual({ index: 0, mode: "append", policy: "append" });
    expect(planEffectInsertion(graphic, "audio")).toEqual({ index: 4, mode: "append", policy: "append" });
  });
  it("uses exact match identity rather than a display name or substring", () => {
    const other = [{ componentIndex: 0, matchName: "ThirdParty.Graphic Group", displayName: group }];
    expect(planEffectInsertion(other, "video").policy).toBe("append");
  });
  it.each([0, 1, 2])("honors explicit graphic index %s without moving it", index => {
    expect(planEffectInsertion(graphic, "video", index)).toEqual({ index, mode: "insert", policy: "explicit", graphicGroupIndex: 2 });
  });
  it.each([3, 4])("refuses explicit graphic child-region index %s rather than silently moving it", index => {
    expect(() => planEffectInsertion(graphic, "video", index)).toThrow(expect.objectContaining({ code: "GRAPHIC_EFFECT_INSERTION_AFTER_GROUP" }));
  });
  it("refuses automatic placement among duplicate groups but accepts an inspected position before the first", () => {
    const duplicates = chain("AE.ADBE Opacity", group, "AE.ADBE Text", group, "AE.ADBE Shape");
    expect(() => planEffectInsertion(duplicates, "video")).toThrow(expect.objectContaining({ code: "GRAPHIC_EFFECT_INSERTION_AMBIGUOUS" }));
    expect(planEffectInsertion(duplicates, "video", 1)).toEqual({ index: 1, mode: "insert", policy: "explicit", graphicGroupIndex: 1 });
    expect(() => planEffectInsertion(duplicates, "video", 3)).toThrow(expect.objectContaining({ code: "GRAPHIC_EFFECT_INSERTION_AFTER_GROUP" }));
  });
  it("retains explicit native insert semantics at the end of ordinary media", () => {
    expect(planEffectInsertion(chain("Existing"), "video", 1)).toEqual({ index: 1, mode: "insert", policy: "explicit" });
  });
  it.each([-1, 0.5, 5, Number.NaN, Number.POSITIVE_INFINITY])("refuses invalid explicit index %s", index => {
    expect(() => planEffectInsertion(graphic, "video", index)).toThrow(expect.objectContaining({ code: "INVALID_COMPONENT_INDEX" }));
  });
  it("refuses a partial or out-of-order inspected chain", () => {
    expect(() => planEffectInsertion([{ componentIndex: 1, matchName: group }], "video")).toThrow(expect.objectContaining({ code: "EFFECT_CHAIN_INDEX_AMBIGUOUS" }));
  });
});
