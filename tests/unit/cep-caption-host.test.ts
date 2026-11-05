import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("CEP caption ExtendScript host", () => {
  it('creates without implicitly saving the project',async()=>{
    const source=(await readFile(path.resolve('apps/cep-caption-helper/host/caption.jsx'),'utf8')).replace('__PREMIERE_MCP_SCRATCH_ROOT__','C:/scratch');
    let saves=0,creates=0;
    const payload={version:1,operation:'create_caption_track_from_srt',saveProject:false,projectPath:'C:/p.prproj',sequenceId:'s',sequenceName:'sequence',srtPath:'C:/scratch/c.srt',expectedCaptionTracksBefore:0};
    const project={path:'C:/p.prproj',rootItem:{name:'c.srt',getMediaPath:()=> 'C:/scratch/c.srt'},activeSequence:{name:'sequence',sequenceID:'s',createCaptionTrack:()=>{creates++;return true;}},save:()=>{saves++;return true;}};
    const run=(p:any)=>JSON.parse(String(runInNewContext(`${source}\nBrahmaYantraCaptionHelper.execute(${JSON.stringify(JSON.stringify(p))});`,{JSON,app:{project},File:function(){return {exists:true};},Sequence:{CAPTION_FORMAT_SUBTITLE:1}})));
    expect(run(payload)).toMatchObject({ok:true,saved:false});expect(creates).toBe(1);expect(saves).toBe(0);
    expect(run({...payload,saveProject:true})).toMatchObject({ok:false});expect(creates).toBe(1);
  });
  it("parses commands and returns valid JSON when the host has no JSON global", async () => {
    const source = await readFile(path.resolve("apps/cep-caption-helper/host/caption.jsx"), "utf8");
    const result = runInNewContext(
      `${source}\nBrahmaYantraCaptionHelper.execute(${JSON.stringify(JSON.stringify({ version: 2 }))});`,
      { JSON: undefined },
    );

    expect(JSON.parse(String(result))).toMatchObject({
      ok: false,
      code: "EXTENDSCRIPT_ERROR",
    });
    expect(String(JSON.parse(String(result)).message)).toContain("INVALID_COMMAND");
  });
});
