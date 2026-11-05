import { describe, expect, it } from "vitest";
import {
  assessClipSplitReadback,
  assessClipSplitRecovery,
  planClipSplit,
  type SplitTimelineItem,
} from "../../apps/uxp-plugin/src/clip-split.js";

function item(
  id: string,
  start: number,
  end: number,
  inPoint = start,
  outPoint = end,
  overrides: Partial<SplitTimelineItem> = {},
): SplitTimelineItem {
  return {
    id,
    projectItemId: "source-a",
    mediaType: "video",
    trackIndex: 0,
    name: "Shot A",
    start: { seconds: start },
    end: { seconds: end },
    inPoint: { seconds: inPoint },
    outPoint: { seconds: outPoint },
    disabled: false,
    speed: 1,
    reversed: false,
    adjustmentLayer: false,
    ...overrides,
  };
}

describe("public UXP clip split planning and readback", () => {
  it('ignores existing same-source fragments adjoining either edge of a second split',()=>{
    const fps=30000/1001,start=1.9686333333,end=151.7516,cut=146.7466;
    const target=item('target',start,end,0,end-start,{mediaType:'audio',trackIndex:2});
    const before=[item('prior',0,start+4e-12,0,start,{mediaType:'audio',trackIndex:2}),target,item('later',end+4e-12,226.35946666667,end-start,224.39083333337,{mediaType:'audio',trackIndex:2})];
    const plan=planClipSplit(before,'target',cut,262.7291333333,fps);
    const after=[before[0]!,{...target,end:{seconds:cut},outPoint:{seconds:cut-start}},{...target,id:'right',start:{seconds:cut},inPoint:{seconds:cut-start}},before[2]!];
    expect(assessClipSplitReadback(before,after,plan,fps)).toMatchObject({leftItemId:'target',rightItemId:'right',unaffectedItemCount:2,errors:[]});
    const broken=structuredClone(after);broken[2]!.start.seconds+=1/fps;
    expect(assessClipSplitReadback(before,broken,plan,fps).errors).toContain('Right split item did not read back at the requested cut and original end');
  });
  it("stages a clone after the timeline and moves the trimmed right half into place", () => {
    const items = [item("target", 10, 18, 30, 38), item("later", 20, 24, 0, 4, { projectItemId: "source-b" })];
    expect(planClipSplit(items, "target", 13, 24, 24)).toEqual({
      targetId: "target",
      projectItemId: "source-a",
      mediaType: "video",
      trackIndex: 0,
      originalStartSeconds: 10,
      originalEndSeconds: 18,
      splitSeconds: 13,
      stagingStartSeconds: 24.083333333333332,
      stagedTrimStartSeconds: 27.083333333333332,
      cloneTimeOffsetSeconds: 14.083333333333332,
      finalMoveOffsetSeconds: -14.083333333333332,
    });
  });

  it("accepts two editable forward segments and proves unrelated clips stayed intact", () => {
    const before = [item("target", 10, 18, 30, 38), item("later", 20, 24, 0, 4, { projectItemId: "source-b" })];
    const plan = planClipSplit(before, "target", 13, 24, 24);
    const after = [
      item("target", 10, 13, 30, 33),
      item("right", 13, 18, 33, 38),
      before[1],
    ];
    expect(assessClipSplitReadback(before, after, plan, 24)).toMatchObject({
      leftItemId: "target",
      rightItemId: "right",
      unaffectedItemCount: 1,
      errors: [],
    });
  });

  it("accepts reversed source ranges when the shared boundary is inverted", () => {
    const reversed = { reversed: true, speed: 2 };
    const before = [item("target", 10, 14, 20, 28, reversed)];
    const plan = planClipSplit(before, "target", 11.5, 14, 24);
    const after = [
      item("target", 10, 11.5, 25, 28, reversed),
      item("right", 11.5, 14, 20, 25, reversed),
    ];
    expect(assessClipSplitReadback(before, after, plan, 24).errors).toEqual([]);
  });

  it("rejects edge cuts and ambiguous overlapping source instances before mutation", () => {
    const target = item("target", 10, 18);
    expect(() => planClipSplit([target], "target", 10, 18, 24)).toThrow(/one frame/);
    expect(() => planClipSplit([target, item("peer", 12, 15)], "target", 13, 18, 24)).toThrow(/overlaps another instance/);
  });

  it("reports collateral edits, incomplete source coverage, and failed recovery", () => {
    const before = [item("target", 10, 18, 30, 38), item("later", 20, 24, 0, 4, { projectItemId: "source-b" })];
    const plan = planClipSplit(before, "target", 13, 24, 24);
    const damaged = [
      item("target", 10, 13, 30, 32),
      item("right", 13, 18, 34, 38),
      item("later", 21, 25, 0, 4, { projectItemId: "source-b" }),
    ];
    expect(assessClipSplitReadback(before, damaged, plan, 24).errors).toEqual(expect.arrayContaining([
      expect.stringContaining("unrelated timeline item"),
      expect.stringContaining("not contiguous"),
    ]));
    expect(assessClipSplitRecovery(before, damaged, 24)).toEqual(expect.arrayContaining([
      expect.stringContaining("target"),
      expect.stringContaining("later"),
    ]));
    expect(assessClipSplitRecovery(before, before, 24)).toEqual([]);
  });
});
