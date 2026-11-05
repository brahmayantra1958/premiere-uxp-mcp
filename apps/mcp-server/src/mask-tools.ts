import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { collectedObjectMaskPromptSchema, maskSeedFrameSchema, objectMaskPromptSchema, objectSegmentationRequestSchema, objectSegmentationResultSchema, projectSnapshotSchema } from "@premiere-uxp/contracts";
import { z } from "zod/v4";
import {targetInputs} from './target-inputs.js';
import { planMaskSeedFrame, probePngEvidence, verifyMaskSeedState } from "./mask-seed-frame.js";
import { assertMaskSeedArtifact, assertOutputPathAvailable, validateObjectMaskPrompt, verifyObjectSegmentationResult } from "./object-segmentation.js";
import { operationId, seconds, maximumMaskPromptPngBytes } from "./tool-inputs.js";
import { result, failure, writePathForRole, readPathForRole, comparablePath } from "./tool-values.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";
import type { SegmentationEnginePort } from "./segmentation-engine.js";
import type { HostBridge } from "./bridge-port.js";

export function registerMaskCaptureTool(server: McpServer, host: HostExecutor, paths: PathPolicy): void {
  server.registerTool("capture_mask_seed_frame", {
    description: "Capture one exact video-item frame for object segmentation, snap it to the active sequence frame grid, bind timeline and source time to project/sequence/item identity, verify no visible-state drift, and return PNG dimensions plus SHA-256.",
    inputSchema: {
      ...targetInputs,
      trackItemId: z.string().min(1),
      timelineTimeSeconds: seconds,
      outputPath: z.string().regex(/\.png$/i),
      operationId,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ trackItemId, timelineTimeSeconds, outputPath, operationId: id, ...target }) => {
    try {
      const authorizedOutput = writePathForRole(paths, outputPath, "output");
      const before = projectSnapshotSchema.parse(await host.read("inspect_project",target));
      const plan = planMaskSeedFrame(before, trackItemId, timelineTimeSeconds);
      const receipt = await host.mutate("export_frame", {
        ...target,
        outputPath: authorizedOutput,
        timeSeconds: plan.timelineTimeSeconds,
        width: plan.width,
        height: plan.height,
      }, id);
      if (receipt.status !== "pass") throw new Error(`MASK_SEED_EXPORT_FAILED: ${receipt.errors.join("; ")}`);
      const [after, png] = await Promise.all([
        host.read("inspect_project",target).then((value) => projectSnapshotSchema.parse(value)),
        probePngEvidence(authorizedOutput),
      ]);
      if (png.status !== "pass" || !png.sha256 || !png.sizeBytes || !png.width || !png.height) {
        throw new Error(`MASK_SEED_PNG_VERIFICATION_FAILED: ${png.errors.join("; ")}`);
      }
      const drift = verifyMaskSeedState(plan, after);
      if (drift.length) throw new Error(drift.join("; "));
      if (png.width !== plan.width || png.height !== plan.height) {
        throw new Error(`MASK_SEED_DIMENSION_MISMATCH: expected ${plan.width}x${plan.height}, got ${png.width}x${png.height}`);
      }
      return result(maskSeedFrameSchema.parse({
        status: "pass",
        capturedAt: new Date().toISOString(),
        project: { id: plan.projectId, name: plan.projectName, path: plan.projectPath, stateSha256: plan.stateSha256 },
        sequence: { id: plan.sequenceId, name: plan.sequenceName, width: plan.width, height: plan.height, frameRate: plan.frameRate },
        target: {
          trackItemId: plan.trackItemId,
          projectItemId: plan.projectItemId,
          trackIndex: plan.trackIndex,
          clipStartSeconds: plan.clipStartSeconds,
          clipEndSeconds: plan.clipEndSeconds,
          sourceTimeSeconds: plan.sourceTimeSeconds,
          speed: plan.speed,
          reversed: plan.reversed,
        },
        frame: {
          requestedTimelineTimeSeconds: plan.requestedTimelineTimeSeconds,
          timelineFrameIndex: plan.timelineFrameIndex,
          timelineTimeSeconds: plan.timelineTimeSeconds,
          outputPath: authorizedOutput,
          sha256: png.sha256,
          sizeBytes: png.sizeBytes,
          width: png.width,
          height: png.height,
        },
        hostReceipt: { commandId: receipt.commandId, status: receipt.status },
        errors: [],
      }));
    } catch (error) { return failure(error); }
  });
}

export function registerMaskPromptTool(server: McpServer, bridge: HostBridge, paths: PathPolicy): void {
  server.registerTool("collect_object_mask_prompt", {
    description: "Open the exact captured frame inside the connected Premiere UXP panel and collect image-pixel positive/negative points or a two-corner box. This is semantic image interaction, not global screen-coordinate automation.",
    inputSchema: {
      objectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
      seed: maskSeedFrameSchema,
      initialPrompt: objectMaskPromptSchema.optional(),
      timeoutSeconds: z.number().int().min(30).max(600).default(300),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ objectId, seed, initialPrompt, timeoutSeconds }) => {
    try {
      const parsedSeed = maskSeedFrameSchema.parse(seed);
      const authorizedSeedPath = readPathForRole(paths, parsedSeed.frame.outputPath, "output");
      await assertMaskSeedArtifact(parsedSeed, authorizedSeedPath);
      const png = await readFile(authorizedSeedPath);
      if (png.byteLength > maximumMaskPromptPngBytes) {
        throw new Error(`MASK_PROMPT_IMAGE_TOO_LARGE: ${png.byteLength} bytes exceeds ${maximumMaskPromptPngBytes}`);
      }
      const timeoutMs = timeoutSeconds * 1_000;
      const commandId = randomUUID();
      const response = await bridge.call({
        version: 1,
        id: commandId,
        command: "collect_object_mask_prompt",
        args: {
          objectId,
          seedSha256: parsedSeed.frame.sha256,
          dataUrl: `data:image/png;base64,${png.toString("base64")}`,
          width: parsedSeed.frame.width,
          height: parsedSeed.frame.height,
          timelineTimeSeconds: parsedSeed.frame.timelineTimeSeconds,
          timeoutMs,
          ...(initialPrompt ? { initialPrompt } : {}),
        },
        timeoutMs: timeoutMs + 5_000,
      });
      if (!response.ok) throw new Error(`MASK_PROMPT_HOST_FAILED: ${response.error?.code ?? "unknown"}: ${response.error?.message ?? "unknown"}`);
      const collected = collectedObjectMaskPromptSchema.parse(response.result);
      if (collected.seedSha256 !== parsedSeed.frame.sha256) throw new Error("MASK_PROMPT_SEED_MISMATCH");
      if (collected.status === "pass") validateObjectMaskPrompt(parsedSeed, collected.prompt);
      return result(collected);
    } catch (error) { return failure(error); }
  });
}

export function registerSegmentationTool(server: McpServer, paths: PathPolicy, segmentation: SegmentationEnginePort): void {
  server.registerTool("segment_object_frame", {
    description: "Run one authenticated, content-bound object segmentation request against a previously verified mask seed. The sidecar writes a new PNG under artifacts/output; the server independently verifies seed and mask hashes, dimensions, path, model, and request identity.",
    inputSchema: {
      requestId: z.string().uuid().optional(),
      objectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
      expectedModel: z.string().min(1),
      seed: maskSeedFrameSchema,
      prompt: objectMaskPromptSchema,
      outputMaskPath: z.string().regex(/\.png$/i),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ requestId, objectId, expectedModel, seed, prompt, outputMaskPath }) => {
    try {
      const parsedSeed = maskSeedFrameSchema.parse(seed);
      const authorizedSeedPath = readPathForRole(paths, parsedSeed.frame.outputPath, "output");
      const authorizedOutputPath = writePathForRole(paths, outputMaskPath, "output");
      if (comparablePath(authorizedSeedPath) === comparablePath(authorizedOutputPath)) {
        throw new Error("OBJECT_MASK_OUTPUT_MUST_DIFFER_FROM_SEED");
      }
      await Promise.all([
        assertMaskSeedArtifact(parsedSeed, authorizedSeedPath),
        assertOutputPathAvailable(authorizedOutputPath),
      ]);
      const request = objectSegmentationRequestSchema.parse({
        requestId: requestId ?? randomUUID(),
        objectId,
        expectedModel,
        seed: parsedSeed,
        prompt: validateObjectMaskPrompt(parsedSeed, prompt),
        outputMaskPath: authorizedOutputPath,
      });
      const segmentationResult = objectSegmentationResultSchema.parse(await segmentation.segment(request));
      await verifyObjectSegmentationResult(request, segmentationResult, authorizedOutputPath);
      return result(segmentationResult);
    } catch (error) { return failure(error); }
  });
}
