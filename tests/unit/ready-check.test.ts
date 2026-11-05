import path from "node:path";
import type { ProjectSnapshot } from "@premiere-uxp/contracts";
import { describe, expect, it } from "vitest";
import { verifyReadySnapshot } from "../../apps/mcp-server/src/ready-check.js";

const scratch = "C:\\repo\\artifacts\\scratch";
const base = {
  projectId: "project-1",
  projectName: "working.prproj",
  projectPath: path.win32.join(scratch, "working.prproj"),
  projectItems: [],
  offlineMediaIds: [],
  activeSequence: { id: "sequence-1", name: "WORKING__FINAL", width: 2048, height: 1152, frameRate: 29.97, duration: { ticks: "1", seconds: 1 }, videoTracks: 1, audioTracks: 1, captionTracks: 0, captionTrackStates: [], itemLimit: 1000, itemsTruncated: false, items: [], tracks: [], transitions: [] },
} as unknown as ProjectSnapshot;

describe("Premiere ready snapshot", () => {
  it('accepts only the exact designated local identity without a scratch-copy false alarm',()=>{
    const target={projectPath:'C:\\user\\project.prproj',projectId:base.projectId,sequenceId:base.activeSequence!.id,sequenceName:'Existing sequence'};
    const snapshot={...base,projectPath:'\\\\?\\'+target.projectPath,activeSequence:{...base.activeSequence!,name:target.sequenceName}};
    expect(verifyReadySnapshot(snapshot,{scratchRoot:scratch,designatedTarget:target})).toEqual([]);
    for(const changed of [{...target,projectId:'other'},{...target,sequenceId:'other'},{...target,projectPath:'\\\\Example_nas\\data3\\source.prproj'}])expect(verifyReadySnapshot(snapshot,{scratchRoot:scratch,designatedTarget:changed})).not.toEqual([]);
  });
  it("accepts an exact scratch project and WORKING__ sequence", () => {
    expect(verifyReadySnapshot(base, { scratchRoot: scratch, expectedProjectPath: base.projectPath, expectedSequenceName: "WORKING__FINAL" })).toEqual([]);
  });

  it("accepts Premiere's extended-length representation of the same scratch project", () => {
    const extended = { ...base, projectPath: "\\\\?\\" + base.projectPath };
    expect(verifyReadySnapshot(extended, { scratchRoot: scratch, expectedProjectPath: base.projectPath })).toEqual([]);
  });

  it("rejects a source project or non-working sequence", () => {
    const invalid = { ...base, projectPath: "\\\\Example_nas\\data3\\source.prproj", activeSequence: { ...base.activeSequence!, name: "MASTER" } };
    expect(verifyReadySnapshot(invalid, { scratchRoot: scratch })).toHaveLength(2);
  });
});
