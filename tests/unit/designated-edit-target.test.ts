import { describe, expect, it } from "vitest";
import { assertDesignatedProject, assertDesignatedSequence, type DesignatedEditTarget } from "../../apps/uxp-plugin/src/designated-edit-target.js";

const target: DesignatedEditTarget = { projectPath: "C:/creative/main.prproj", projectId: "project-1", sequenceId: "sequence-1", sequenceName: "Existing cut" };
describe("explicitly designated edit target", () => {
  it("accepts the exact local project with device-prefix and case normalization", () => {
    expect(() => assertDesignatedProject(target, { path: "\\\\?\\C:\\CREATIVE\\main.prproj", guid: "project-1" })).not.toThrow();
    expect(() => assertDesignatedSequence(target, { guid: "sequence-1", name: "Existing cut" })).not.toThrow();
  });
  it("rejects another path even when Save As preserves the project ID", () => {
    expect(() => assertDesignatedProject(target, { path: "C:/creative/copy.prproj", guid: "project-1" })).toThrow();
    expect(() => assertDesignatedProject(target, { path: target.projectPath, guid: "other" })).toThrow();
  });
  it("rejects another sequence ID or a renamed sequence", () => {
    expect(() => assertDesignatedSequence(target, { guid: "other", name: target.sequenceName })).toThrow();
    expect(() => assertDesignatedSequence(target, { guid: target.sequenceId, name: "Copy" })).toThrow();
  });
  it("cannot designate network paths, traversal, non-project files or empty identity", () => {
    for (const projectPath of ["//server/share/main.prproj", "C:/creative/../main.prproj", "C:/creative/main.mp4", "main.prproj"]) {
      expect(() => assertDesignatedProject({ ...target, projectPath }, { path: projectPath, guid: target.projectId })).toThrow();
    }
    expect(() => assertDesignatedProject({ ...target, projectId: "" }, { path: target.projectPath, guid: "" })).toThrow();
  });
});
