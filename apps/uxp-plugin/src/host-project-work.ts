import type { NativeProjectItemTarget } from "@premiere-uxp/contracts/panel-work";
import { activeProject, inspectHostContext, itemId, sequenceId, ppro } from "./host-context.js";
import { findProjectItemEntry } from "./host-items.js";
import { HostCommandError } from "./bridge-client.js";
import type { BridgeRequest } from "./wire.js";

/** Breadcrumbs locate the same source across UXP/CEP ID spaces. CEP validates
 * every segment, media/sequence identity and its installed scope; independent
 * UXP selection readback must then contain exactly the requested canonical ID. */
export async function revealProjectItem(request: BridgeRequest, id: string,
  select: (parentId: string, target: NativeProjectItemTarget) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const before = await inspectHostContext();
  if ((request.args.expectedProjectId && request.args.expectedProjectId !== before.projectId)
    || (request.args.expectedSequenceId && request.args.expectedSequenceId !== before.sequenceId)) {
    throw new HostCommandError("CONTEXT_CHANGED", "Project selection target changed");
  }
  const entry = await findProjectItemEntry(await activeProject(), id);
  const kind = entry.snapshot.kind;
  if (!["clip", "sequence", "folder"].includes(kind) || !entry.pathSegments?.length || entry.pathSegments.length > 32) {
    return { status: "unsupported", reason: "Project item has no bounded native identity", projectItemId: id };
  }
  const target: NativeProjectItemTarget = { pathSegments: entry.pathSegments, kind };
  if (kind === "clip") {
    if (!entry.snapshot.path) return { status: "unsupported", reason: "Source has no file identity", projectItemId: id };
    target.mediaPath = entry.snapshot.path;
  }
  if (kind === "sequence") {
    const clip = await ppro.ClipProjectItem.cast(entry.raw);
    const sequence = await clip.getSequence();
    target.sequenceId = await sequenceId(sequence);
  }
  const result = await select(request.id, target);
  const after = await inspectHostContext();
  if (before.projectId !== after.projectId || before.sequenceId !== after.sequenceId) {
    throw new HostCommandError("CONTEXT_CHANGED", "Active identity changed during project selection");
  }
  if (result.status !== "pass") return { ...result, projectItemId: id };
  const selection = await ppro.ProjectUtils.getSelection(await activeProject());
  const ids: string[] = [];
  for (const raw of await selection.getItems()) ids.push(await itemId(raw));
  const pass = ids.length === 1 && ids[0] === id;
  return { ...result, status: pass ? "pass" : "unverified", projectItemId: id, selectedProjectItemIds: ids,
    independentReadback: "ProjectUtils.getSelection", ...(pass ? {} : { reason: "UXP project selection differs from requested canonical ID" }) };
}
