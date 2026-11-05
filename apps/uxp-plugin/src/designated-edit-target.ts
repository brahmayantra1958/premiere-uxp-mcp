import { HostCommandError } from "./bridge-client.js";
import { normalizeHostPath, text } from "./host-foundation.js";

export interface DesignatedEditTarget {
  projectPath: string;
  projectId: string;
  sequenceId: string;
  sequenceName: string;
}

/** User-designated mode pins one existing local project and sequence.
 * It replaces scratch-copy mode for this deployment, not a directory exemption.
 */
export function assertDesignatedProject(target: DesignatedEditTarget, project: { path?: unknown; guid?: unknown }): void {
  const expected = normalizeHostPath(target.projectPath);
  if (!/^[a-z]:\\.*\.prproj$/.test(expected) || expected.split("\\").some((part) => part === ".." || part === ".")) {
    throw new HostCommandError("INVALID_DESIGNATED_TARGET", "Designated project must be an exact absolute local .prproj path");
  }
  if (!target.projectId || normalizeHostPath(text(project.path)) !== expected || text(project.guid) !== target.projectId) {
    throw new HostCommandError("DESIGNATED_PROJECT_MISMATCH", "Active project differs from the user-designated file and project ID");
  }
}

export function assertDesignatedSequence(target: DesignatedEditTarget, sequence: { name?: unknown; guid?: unknown }): void {
  if (!target.sequenceId || !target.sequenceName || text(sequence.guid) !== target.sequenceId || text(sequence.name) !== target.sequenceName) {
    throw new HostCommandError("DESIGNATED_SEQUENCE_MISMATCH", "Active sequence differs from the user-designated existing sequence");
  }
}
