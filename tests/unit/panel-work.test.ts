import { describe,it,expect } from "vitest";
import {nativePanelForCommand,projectWorkItemId} from "../../packages/contracts/src/panel-work.js";
describe("fixed native work panel policy",()=>{
  it("routes effect edits and graphics without requiring agent navigation arguments",()=>{
    for(const command of ["set_effect_values","set_effect_keyframes","apply_audio_effect","set_transform","remove_effect"])expect(nativePanelForCommand(command)).toBe("effect_controls");
    expect(nativePanelForCommand("insert_editable_graphic")).toBe("properties");
    expect(nativePanelForCommand("capture_program_frame")).toBe("program_monitor");
    expect(nativePanelForCommand("query_media")).toBe("project");
  });
  it("does not create an arbitrary command or override timeline-only work",()=>{
    for(const command of ["cmd.track.bidirectional","executeCommand","move_clip_to_track","get_track_command_sequence_status","query_timeline"])expect(nativePanelForCommand(command)).toBeUndefined();
  });
  it("follows the first actual project result or source edit, without guessing for empty results",()=>{
    expect(projectWorkItemId("query_media",{ids:["requested"]},{items:[{id:"actual"},{id:"next"}]})).toBe("actual");
    expect(projectWorkItemId("query_media",{ids:["requested"]},{items:[]})).toBeUndefined();
    expect(projectWorkItemId("rename_project_items",{renames:[{projectItemId:"first"},{projectItemId:"next"}]})).toBe("first");
    expect(projectWorkItemId("attach_proxy",{projectItemId:"source"})).toBe("source");
    expect(projectWorkItemId("unknown",{projectItemId:"source"})).toBeUndefined();
  });
});
