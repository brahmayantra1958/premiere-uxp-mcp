import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import { requireAdobeTemplate } from "./config.js";
import { createEditableRectangleMogrt, inspectEditableRectangleMogrtBuffer } from "./editable-rectangle-mogrt.js";
import { createEditableTextMogrt } from "./editable-text-mogrt.js";
import { operationId, seconds, index, values } from "./tool-inputs.js";
import { result, failure, writePathForRole, readPathForRole } from "./tool-values.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";

const graphicTarget = {
  expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),expectedSequenceName:z.string().min(1),
  expectedVideoTrackCount:z.number().int().positive(),expectedAudioTrackCount:z.number().int().positive(),expectedCaptionTrackCount:index,
  expectedTimelineItemCount:index,videoTrackIndex:index,expectedVideoTrackId:index,expectedVideoTrackName:z.string(),expectedVideoTrackItemCount:z.literal(0),
  audioTrackIndex:index,timeSeconds:seconds,durationSeconds:z.number().finite().positive().optional(),
  mogrtPath:z.string().min(1),expectedMogrtSha256:z.string().regex(/^[0-9a-f]{64}$/i),operationId,
};

export function registerGraphicsTools(server: McpServer, host: HostExecutor, paths: PathPolicy): void {
  server.registerTool("insert_mogrt_caption", {
    description: "Insert one local video-only MOGRT with exact project/sequence/track/hash guards, optional duration and fully preflighted named parameters. Default empty_track requires an empty video track. Opt-in trailing_append requires the exact existing video item count, complete timeline metadata, both destination tracks empty from the insertion tick onward, and genuinely empty raw transition collections. Middle gaps are rejected because a template's initial length is unknown. Verify placement, existing timeline metadata and track state; automatically lift the inserted item on failure. Use apply_video_effect for later clip-level effects; review exported frames for appearance.",
    inputSchema: { ...graphicTarget,expectedVideoTrackItemCount:index,insertionMode:z.enum(['empty_track','trailing_append']).default('empty_track'),parameterValues: values.default({}) },
  }, async ({ mogrtPath, operationId: id,...args }) => {
    try {
      if((args.insertionMode??'empty_track')==='empty_track'&&args.expectedVideoTrackItemCount!==0)throw Error('EMPTY_GRAPHIC_TRACK_REQUIRED');
      const authorized=paths.authorizeRead(mogrtPath).path;
      const actualHash=createHash("sha256").update(await readFile(authorized)).digest("hex");
      if(actualHash!==args.expectedMogrtSha256.toLowerCase())throw Error("MOGRT_HASH_PRECONDITION_FAILED");
      return result(await host.mutate("insert_mogrt_caption",{...args,mogrtPath:authorized,expectedMogrtSha256:actualHash},id));
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("create_editable_text_mogrt", {
    description: "Create a local Premiere-native editable text MOGRT from Adobe's built-in Basic Title without changing the Adobe template or rasterizing text.",
    inputSchema: {
      outputPath: z.string().min(1),
      text: z.string().min(1).max(1_000),
      fontPostScriptName: z.string().min(1).max(100),
      fontSizePixels: z.number().finite().min(8).max(300),
      colorHex: z.string().regex(/^#[0-9a-f]{6}$/i),
      alignment: z.enum(["left", "center", "right"]),
      position: z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }),
      operationId,
    },
    annotations: { destructiveHint: false },
  }, async ({ outputPath, operationId: id, ...spec }) => {
    try {
      const templatePath = paths.authorizeRead(requireAdobeTemplate('basicTitleMogrt')).path;
      const authorizedOutput = writePathForRole(paths, outputPath, "scratch");
      const args = { templatePath, outputPath: authorizedOutput, spec };
      return result(await host.mutateLocal("create_editable_text_mogrt", args, async () => {
        const artifact = await createEditableTextMogrt(args);
        return { status: "pass", result: artifact, changedFiles: [authorizedOutput] };
      }, id));
    } catch (error) { return failure(error); }
  });

  server.registerTool("create_editable_rectangle_mogrt", {
    description: "Create a Premiere-native editable rectangle MOGRT from Adobe's installed Classic Lower Third template. The generated graphic contains an actual AE.ADBE Shape component, not a rasterized image.",
    inputSchema: {
      outputPath: z.string().min(1),
      widthPixels: z.number().finite().min(1).max(20_000),
      heightPixels: z.number().finite().min(1).max(20_000),
      fillColorHex: z.string().regex(/^#[0-9a-f]{6}$/i),
      strokeColorHex: z.string().regex(/^#[0-9a-f]{6}$/i).default("#000000"),
      strokeWidthPixels: z.number().finite().min(0).max(1_000).default(0),
      opacityPercent: z.number().finite().min(0).max(100).default(100),
      rotationDegrees: z.number().finite().min(-36_000).max(36_000).default(0),
      position: z.object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      }),
      operationId,
    },
    annotations: { destructiveHint: false },
  }, async ({ outputPath, operationId: id, ...spec }) => {
    try {
      const templatePath = paths.authorizeRead(requireAdobeTemplate('classicLowerThirdOneLineMogrt')).path;
      const authorizedOutput = writePathForRole(paths, outputPath, "scratch");
      const args = { templatePath, outputPath: authorizedOutput, spec };
      return result(await host.mutateLocal("create_editable_rectangle_mogrt", args, async () => {
        const artifact = await createEditableRectangleMogrt(args);
        return { status: "pass", result: artifact, changedFiles: [authorizedOutput] };
      }, id));
    } catch (error) { return failure(error); }
  });

  server.registerTool("insert_editable_graphic", {
    description: "Insert one verified native rectangle on an existing empty track. Normalize Premiere's import scaling, verify transforms/timing/preservation, then SAVE the authorized project to verify native Path/Appearance. Failed proof lifts the insertion and saves restoration. Subsequent apply_video_effect calls default to the clip-level position before a unique Graphic Group; inspect fresh component indices and review exported frames for appearance.",
    inputSchema: graphicTarget,
    annotations: { destructiveHint: true },
  }, async ({ mogrtPath, operationId: id, ...args }) => {
    try {
      const authorizedMogrt = readPathForRole(paths, mogrtPath, "scratch");
      const bytes = await readFile(authorizedMogrt);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash.toLocaleLowerCase("en-US") !== args.expectedMogrtSha256.toLocaleLowerCase("en-US")) {
        throw new Error(`MOGRT_HASH_PRECONDITION_FAILED: expected ${args.expectedMogrtSha256}, actual ${actualHash}`);
      }
      const inspection = inspectEditableRectangleMogrtBuffer(bytes);
      const states = inspection.projectStates.map(({ state }) => state);
      if (inspection.shapeControlCount !== 1
        || inspection.textControlCount !== 1
        || !states.length
        || states.some((state) => !state.hiddenText || state.shapeMatchName !== "AE.ADBE Shape")
        || states.some((state) => JSON.stringify(state) !== JSON.stringify(states[0]))) {
        throw new Error("MOGRT_EDITABLE_RECTANGLE_PRECONDITION_FAILED");
      }
      return result(await host.mutate("insert_editable_graphic", {
        ...args,
        mogrtPath: authorizedMogrt,
        expectedMogrtSha256: actualHash,
        expectedGraphicKind:"rectangle",
        expectedShapeState:states[0],
      }, id));
    } catch (error) { return failure(error); }
  });
}
