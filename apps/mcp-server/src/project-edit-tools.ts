import {targetInputs} from "./target-inputs.js";
import { localProjectPath } from "./active-edit-target.js";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import { editExistingSequenceStructure, inspectExistingSequenceStructure } from "./existing-sequence-structure.js";
import { createProxy, planProxy } from "./media.js";
import { parsePremiereTranscript, premiereTranscriptSchema } from "./premiere-transcript.js";
import { operationId, removableTrack, nativeCaptionStyle } from "./tool-inputs.js";
import { result, failure, writePathForRole, readPathForRole } from "./tool-values.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";

export function registerProjectLifecycleTools(server: McpServer, host: HostExecutor, paths: PathPolicy): void {
  server.registerTool("create_working_copy", {
    description: "Save the active project as a new local scratch .prproj when a copy is requested or needed, and verify Premiere switched to that path. Ordinary edits of saved local projects do not require a working copy.",
    inputSchema: { ...targetInputs, outputPath: z.string().min(1), operationId },
    annotations: { destructiveHint: false },
  }, async ({ outputPath, operationId: id , ...targetPins }) => {
    try { return result(await host.mutate("create_working_copy", { ...targetPins, outputPath: writePathForRole(paths, outputPath, "scratch") }, id)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("activate_sequence", {
    description: "Activate the exact destination sequenceId/name from a pinned current project/sequence, then verify its identity. This explicit navigation changes the active timeline.",
    inputSchema: { ...targetInputs, sequenceId:z.string().min(1), name: z.string().min(1), operationId },
    annotations: { destructiveHint: false },
  }, async ({ name, operationId: id , ...targetPins }) => result(await host.mutate("activate_sequence", { ...targetPins, name }, id)));
}

export function registerSpeechTools(server: McpServer, host: HostExecutor, _paths: PathPolicy): void {
  void _paths;
  server.registerTool("open_native_speech_to_text_workflow", {
    description: "Open Adobe Premiere's built-in Text panel and request its transcription-options workflow for one exact active sequence through declared Adobe UXP IPC. This does not claim that transcription or captions were created.",
    inputSchema: {
      expectedProjectId: z.string().min(1),
      expectedProjectPath: z.string().min(1),
      expectedSequenceId: z.string().min(1),
      expectedSequenceName: z.string().min(1),
      operationId,
    },
    annotations: { destructiveHint: false },
  }, async ({ expectedProjectPath, operationId: id, ...expected }) => {
    try {
      return result(await host.mutate("open_native_speech_to_text_workflow", {
        ...expected,
        expectedProjectPath: localProjectPath(expectedProjectPath),
      }, id));
    } catch (error) { return failure(error); }
  });

  server.registerTool("import_clip_speech_text", {
    description: "Import Adobe's official Transcript JSON into one exact existing non-sequence project clip through public Premiere UXP, without creating a sequence or track. Existing speech text is never overwritten, and success requires hasTranscript plus exportToJSON readback equivalence.",
    inputSchema: {
      expectedProjectId: z.string().min(1),
      expectedProjectPath: z.string().min(1),
      expectedSequenceId: z.string().min(1),
      expectedSequenceName: z.string().min(1),
      projectItemId: z.string().min(1),
      expectedProjectItemName: z.string().min(1),
      expectedHasSpeechText: z.literal(false),
      speechText: premiereTranscriptSchema,
      operationId,
    },
    annotations: { destructiveHint: false },
  }, async ({ expectedProjectPath, speechText, operationId: id, ...expected }) => {
    try {
      const document = parsePremiereTranscript(speechText);
      const receipt = await host.mutate("import_clip_speech_text", {
        ...expected,
        expectedProjectPath: localProjectPath(expectedProjectPath),
        transcriptJson: document.canonicalJson,
      }, id);
      return result({
        ...receipt,
        requestedSpeechText: { ...document.summary, sha256: document.sha256, sizeBytes: document.sizeBytes },
      });
    } catch (error) { return failure(error); }
  });
}

export function registerProjectStructureTools(server: McpServer, host: HostExecutor, _paths: PathPolicy): void {
  void _paths;
  server.registerTool("inspect_sequence_structure", {
    description: "Inspect the pinned sequence and saved Premiere archive before a supported structural edit. This native evidence route may save the local project; use bounded query_timeline for ordinary clip discovery. Returns exact track UIDs/IDs/indices, counts and caption style.",
    inputSchema: targetInputs,
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async target => {
    try {
      return result(await inspectExistingSequenceStructure(host, localProjectPath,target));
    } catch (error) { return failure(error); }
  });

  server.registerTool("edit_existing_sequence_structure", {
    description: "Remove exact selected empty tracks through a recoverable archive edit by default (trackRemovalRoute: archive), or change an existing populated native-caption track's font/size or guarded per-cue styles through a recoverable archive edit. captionStyle.items binds each cue by itemIndex and exact expectedStartTicks/expectedEndTicks; it preserves text, timing, other cues and the track template. Use either track-wide fontPostScriptName+fontSize or items, never both. Removal and style edits are separate operations. Explicit trackRemovalRoute: native retains the Premiere 26.3-only Delete Tracks bridge and requires the complete empty-track set; unsupported versions fail before save, with no automatic fallback. Saves, closes and reopens the current local project, then saves through Premiere again and verifies UXP structure and the host-serialized archive values. It never creates a sequence or track. Archive style readback is not proof of installed-font rendering; inspect Program frames. Do not replay an unknown lifecycle operation.",
    inputSchema: {
      ...targetInputs,
      expectedProjectPath: z.string().min(1),
      expectedSequenceName: z.string().min(1),
      expectedSequenceUid: z.string().uuid(),
      removeTracks: z.array(removableTrack).max(64).default([]),
      trackRemovalRoute: z.enum(["archive", "native"]).default("archive"),
      captionStyle: nativeCaptionStyle.optional(),
      operationId,
    },
    annotations: { destructiveHint: true },
  }, async ({ expectedProjectPath, expectedSequenceName, expectedSequenceUid, removeTracks, trackRemovalRoute, captionStyle, operationId: requestedId, ...target }) => {
    try {
      if (!removeTracks.length && !captionStyle) throw new Error("EMPTY_SEQUENCE_STRUCTURE_EDIT");
      if (removeTracks.length && captionStyle) throw new Error("SEPARATE_TRACK_REMOVAL_AND_CAPTION_STYLE_EDITS_REQUIRED");
      if(target.expectedSequenceId!==expectedSequenceUid)throw Error('SEQUENCE_PRECONDITION_FAILED: expectedSequenceId and expectedSequenceUid must identify the same sequence');
      const projectPath = localProjectPath(expectedProjectPath);
      const commandId = requestedId ?? randomUUID();
      const edit = { ...target, expectedProjectPath: projectPath, expectedSequenceName, expectedSequenceUid, removeTracks, trackRemovalRoute, ...(captionStyle ? { captionStyle } : {}) };
      return result(await host.mutateLocal("edit_existing_sequence_structure", edit, () => editExistingSequenceStructure(host, edit, commandId), commandId));
    } catch (error) { return failure(error); }
  });
}

export function registerProjectMediaTools(server: McpServer, host: HostExecutor, paths: PathPolicy): void {
  server.registerTool("duplicate_working_sequence", {
    description: "Duplicate the exact pinned sequence and verify the requested name, settings, clips and timing. Creation followed by a rename/proof failure may leave a clone: inspect after.id/createdSequenceId and correct that existing sequence; never blindly clone again. Ordinary edits do not require duplication.",
    inputSchema: { ...targetInputs, name: z.string().min(1), operationId },
    annotations: { destructiveHint: false },
  }, async ({ name, operationId: id , ...targetPins }) => result(await host.mutate("duplicate_working_sequence", { ...targetPins, name }, id)));

  server.registerTool("create_bin", {
    description: "Create a project bin at the project root or inside an explicit parent bin, then read back the exact parent relationship.",
    inputSchema: { ...targetInputs, name: z.string().min(1), parentBinId: z.string().min(1).optional(), operationId },
  }, async ({ operationId: id,...args }) => result(await host.mutate("create_bin", args, id)));

  server.registerTool("rename_project_items", {
    description: "Rename project-panel bins, clips, or sequences by stable project-item ID and verify every new name.",
    inputSchema: { ...targetInputs, renames: z.array(z.object({ projectItemId: z.string().min(1), name: z.string().min(1) })).min(1).max(100), operationId },
  }, async ({ operationId: id,...args }) => result(await host.mutate("rename_project_items", args, id)));

  server.registerTool("move_project_items", {
    description: "Move explicit project-panel items into a target bin and verify their parent IDs after the transaction.",
    inputSchema: { ...targetInputs, projectItemIds: z.array(z.string().min(1)).min(1).max(100), targetBinId: z.string().min(1), operationId },
  }, async ({ operationId: id,...args }) => result(await host.mutate("move_project_items", args, id)));

  server.registerTool("set_project_item_labels", {
    description: "Set Premiere project-item label colors by index 0 through 14 and verify each label value.",
    inputSchema: { ...targetInputs, labels: z.array(z.object({ projectItemId: z.string().min(1), colorLabelIndex: z.number().int().min(0).max(14) })).min(1).max(100), operationId },
  }, async ({ labels, operationId: id , ...targetPins }) => result(await host.mutate("set_project_item_labels", { ...targetPins, labels }, id)));

  server.registerTool("import_media", {
    description: "Import explicitly listed absolute media paths from any local folder or NAS share, without per-project sourceRoots registration. Sources remain read-only. Extension and link/junction checks apply, including SRT. Never scans an entire NAS root or broadens write permission.",
    inputSchema: { ...targetInputs, expectedProjectId:z.string().min(1), filePaths: z.array(z.string().min(1)).min(1).max(100), binId: z.string().optional(), operationId },
  }, async ({ filePaths, binId, expectedProjectId, operationId: id , ...targetPins }) => {
    try { return result(await host.mutate("import_media", { ...targetPins, expectedProjectId,filePaths: filePaths.map((value) => paths.authorizeRead(value).path), binId }, id)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("create_proxy", {
    description: "Stream one allowed source through local FFmpeg into a local lightweight proxy; never overwrites the source.",
    inputSchema: { inputPath: z.string().min(1), outputPath: z.string().min(1), operationId },
  }, async ({ inputPath, outputPath, operationId: id }) => {
    try {
      const input = paths.authorizeRead(inputPath).path;
      const output = writePathForRole(paths, outputPath, "proxy");
      const proxyPlan = await planProxy(input, output);
      return result(await host.mutateLocal("create_proxy", { inputPath: input, outputPath: output, proxyPlan }, async () => {
        await mkdir(path.dirname(output), { recursive: true });
        const proxy = await createProxy(input, output, proxyPlan);
        return {
          status: proxy.report.status === "pass" ? "pass" : "fail",
          result: proxy,
          changedFiles: proxy.report.exists ? [output] : [],
          errors: proxy.report.errors,
        };
      }, id));
    } catch (error) { return failure(error); }
  });

  server.registerTool("attach_proxy", {
    description: "Attach an existing local proxy to a project item and verify hasProxy and proxyPath through Premiere readback.",
    inputSchema: { ...targetInputs, projectItemId: z.string().min(1), proxyPath: z.string().min(1), operationId },
  }, async ({ projectItemId, proxyPath, operationId: id , ...targetPins }) => {
    try { return result(await host.mutate("attach_proxy", { ...targetPins, projectItemId, proxyPath: readPathForRole(paths, proxyPath, "proxy") }, id)); }
    catch (error) { return failure(error); }
  });
}
