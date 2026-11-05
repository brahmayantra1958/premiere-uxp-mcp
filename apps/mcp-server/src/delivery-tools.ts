import { randomUUID } from "node:crypto";
import { targetInputs } from './target-inputs.js';
import { z } from "zod/v4";
import { projectLifecyclePath } from "./project-lifecycle-path.js";
import { culturalHeritageRequirements, probeDelivery } from "./media.js";
import { operationId, seconds } from "./tool-inputs.js";
import { result, failure, writePathForRole } from "./tool-values.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostBridge } from "./bridge-port.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";

export function registerDeliveryTools(server: McpServer, bridge: HostBridge, host: HostExecutor, paths: PathPolicy): void {
  server.registerTool("export_sequence", {
    description: "Export the exact pinned sequence to a new allowed local artifact and verify media with ffprobe. Requires delivery profile and an export request; preserve the editable project and original sources. Metadata verification does not assess composition or audio quality.",
    inputSchema: { ...targetInputs, outputPath: z.string(), presetPath: z.string(), exportFull: z.boolean().default(true), operationId },
  }, async ({ outputPath, presetPath, exportFull, operationId: id , ...targetPins }) => {
    try { return result(await host.mutate("export_sequence", { ...targetPins, outputPath: writePathForRole(paths, outputPath, "output"), presetPath: paths.authorizeRead(presetPath).path, exportFull }, id)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("export_frame", {
    description: "Export a full-resolution still from the active sequence and verify the image exists.",
    inputSchema: { ...targetInputs, outputPath: z.string(), timeSeconds: seconds, width: z.number().int().positive().optional(), height: z.number().int().positive().optional(), operationId },
  }, async ({ outputPath, operationId: id, ...args }) => {
    try { return result(await host.mutate("export_frame", { ...args, outputPath: writePathForRole(paths, outputPath, "output") }, id)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("verify_delivery", {
    description: "Read an allowed local media artifact with ffprobe and report container, codecs, dimensions, frame rate, duration, audio, and size. Choose only the requested delivery profile; metadata does not prove visual or audio quality.",
    inputSchema: {
      filePath: z.string(),
      profile: z.enum(["metadata_only", "cultural_heritage"]).default("metadata_only"),
      analyzeContent: z.boolean().default(false),
      offlineMediaCount: z.number().int().nonnegative().optional(),
      expectedProjectId:targetInputs.expectedProjectId.optional(),
      expectedSequenceId:targetInputs.expectedSequenceId.optional(),
      expectedSequenceName:targetInputs.expectedSequenceName,
    },
    annotations: { readOnlyHint: true },
  }, async ({ filePath, profile, analyzeContent, offlineMediaCount, ...target }) => {
    try {
      let resolvedOfflineMediaCount = offlineMediaCount;
      const hostErrors: string[] = [];
      const bridgeStatus = await bridge.getStatus();
      if (profile === "cultural_heritage" && resolvedOfflineMediaCount === undefined && bridgeStatus.connected) {
        try {
          if(!target.expectedProjectId||!target.expectedSequenceId)throw Error('EXACT_TARGET_REQUIRED: provide current project/sequence IDs for live offline-media inspection, or supply offlineMediaCount for file-only verification');
          const snapshot = await host.read("inspect_project",target) as { offlineMediaIds?: unknown[] };
          if (Array.isArray(snapshot.offlineMediaIds)) resolvedOfflineMediaCount = snapshot.offlineMediaIds.length;
        } catch (error) {
          hostErrors.push(`Offline-media inspection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const requirements = profile === "cultural_heritage"
        ? { ...culturalHeritageRequirements, ...(resolvedOfflineMediaCount === undefined ? {} : { offlineMediaCount: resolvedOfflineMediaCount }) }
        : {};
      const report = await probeDelivery(paths.authorizeRead(filePath).path, requirements, analyzeContent);
      return result(hostErrors.length ? { ...report, status: report.status === "pass" ? "partial" : report.status, errors: [...report.errors, ...hostErrors] } : report);
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("save_working_project", {
    description: "Save the exact pinned saved local project within the requested task scope. Supply fresh project/sequence IDs (name optional); verify identity after saving. No project allowlist or sequence-name prefix is required. Do not save repeatedly as a generic verification step.",
    inputSchema: { ...targetInputs, operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("save_working_project", args, id ?? randomUUID())));

  server.registerTool("close_working_project", {
    description: "Save and close only the exact authorized active local project and sequence identified by path, name, and sequence ID. Never retries a close after an uncertain response.",
    inputSchema: {
      projectPath: z.string().min(1),
      sequenceName: z.string().min(1),
      sequenceId: z.string().min(1),
      operationId,
    },
    annotations: { destructiveHint: true },
  }, async ({ projectPath, sequenceName, sequenceId, operationId: id }) => {
    try {
      const authorizedPath = projectLifecyclePath(paths, projectPath, sequenceName, sequenceId);
      return result(await host.mutate("close_working_project", { projectPath: authorizedPath, sequenceName, sequenceId }, id ?? randomUUID()));
    } catch (error) { return failure(error); }
  });

  server.registerTool("open_working_project", {
    description: "Open one exact local .prproj with dialogs suppressed, activate the exact sequence ID/name, and verify target identity.",
    inputSchema: {
      projectPath: z.string().min(1),
      sequenceName: z.string().min(1),
      sequenceId: z.string().min(1),
      operationId,
    },
  }, async ({ projectPath, sequenceName, sequenceId, operationId: id }) => {
    try {
      const authorizedPath = projectLifecyclePath(paths, projectPath, sequenceName, sequenceId);
      return result(await host.mutateLifecycle("open_working_project", { projectPath: authorizedPath, sequenceName, sequenceId }, id ?? randomUUID()));
    } catch (error) { return failure(error); }
  });
}
