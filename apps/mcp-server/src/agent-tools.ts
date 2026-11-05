import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {targetInputs} from './target-inputs.js';
import {failure} from './tool-values.js';
import type { HostExecutor } from "./host-executor.js";
import { clipEditIntent, prepareClipEdit } from "./prepare-clip-edit.js";
import { agentContextWithPlacement } from './agent-context-discovery.js';

const pin = { expectedProjectId: z.string().min(1).optional(), expectedSequenceId: z.string().min(1).optional() };
const page = { offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.number().int().min(1).max(100, 'Use limit:100 or less, then page.nextOffset/nextCursor').default(20),
  ids: z.array(z.string().min(1)).min(1).max(100).optional(), nameContains: z.string().max(500).optional() };
const timelineQuery = z.object({ ...targetInputs, ...page,
  limit: page.limit.describe("Clips per page: default 20, maximum 100; maximum 20 when includeEffects or includeSourceMetadata is true. Continue with page.nextOffset while page.hasMore is true."),
  mediaType: z.enum(["video", "audio"]).optional(), trackIndex: z.number().int().nonnegative().optional(),
  selectedOnly: z.boolean().default(false), includeEffects: z.boolean().default(false).describe("Include effect components and parameters; requires limit <= 20."),
  includeSourceMetadata: z.boolean().default(false).describe("Read the returned clips' native source metadata and footage pixel aspect ratio; no project-media traversal. Requires limit <= 20."),
  effectSampleTimeSeconds: z.number().finite().nonnegative().optional().describe("Advanced: explicitly sample native SOURCE component time; default evaluates each clip at its native in-point. Video sequence-time samples and inverse key times require get_effect_values with SDK proof."),
  effectTimeSeconds: z.number().finite().nonnegative().optional().describe("Sequence time for forward 1x audio effect values. For video, use get_effect_values: public speed=1 does not exclude a native speed ramp, so discovery never guesses a video sequence-time mapping."),
  startSeconds: z.number().finite().nonnegative().optional(), endSeconds: z.number().finite().nonnegative().optional(),
}).refine(value => !(value.includeEffects || value.includeSourceMetadata) || value.limit <= 20,
  { message: "When includeEffects or includeSourceMetadata is true, limit accepts at most 20 clips; use limit:20 and page.nextOffset for further pages", path: ["limit"] })
  .refine(value => value.startSeconds === undefined || value.endSeconds === undefined || value.startSeconds < value.endSeconds, "Time range must be increasing");

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

/** Discoverable, bounded reads remain available even in the inspect-only profile. */
export function registerAgentTools(server: McpServer, host: HostExecutor): void {
  server.registerTool('inspect_ripple_capabilities',{
    description:'Read-only native caption timing/move capability samples and sequence insert/remove availability. Preserves user navigation. This is discovery, not proof of all-track ripple support.',
    inputSchema:{expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1)},annotations:{readOnlyHint:true}},
    async args=>{try{return result(await host.read('inspect_ripple_capabilities',args));}catch(error){return failure(error);}});
  server.registerTool("get_agent_context", {
    description: "START HERE: fresh small project/sequence identity, format, edit boundary and up to 10 selected clips, plus placementCapabilities from the live capability catalog. Check sourceRange support before constructing a placement; panelVersion/tools/list alone do not prove it. Reports the conditional full-original + exact-trim alternative without executing it. No media/effect scan. Preserves the current sequence view, playhead and selection. Use returned IDs to pin queries. Empty host returns actionable state.",
    inputSchema: pin, annotations: { readOnlyHint: false, destructiveHint: false },
  }, async args => { try { return result(await agentContextWithPlacement(host, args)); } catch (error) { return failure(error); } });
  server.registerTool("query_timeline", {
    description: "Find clips by IDs, name, media type, zero-based track, selection or half-open time overlap. Overview/selection queries preserve the last work position and native panel. Explicit IDs/name/startSeconds follow the target while retaining an in-clip playhead unless a time is specified, without reopening the timeline tab. Targeted includeEffects also reveals the first effect; broad inventories do not. Content is preserved. Pages default to 20 clips, maximum 100; when includeEffects or includeSourceMetadata is true, limit must be <= 20. Continue with page.nextOffset while page.hasMore is true; page.scanTruncated reports incomplete scanning. Refresh offset after edits.",
    inputSchema: timelineQuery, annotations: { readOnlyHint: false, destructiveHint: false },
  }, async args => { try { return result(await host.read("query_timeline", args)); } catch (error) { return failure(error); } });
  server.registerTool("query_media", {
    description: "Find project media/bins by ids, direct-parent binId or name. Enumerates beyond 500 items, hydrates only the page. limit <=100. Continue with page.nextCursor (same project/filter; omit offset), or page.nextOffset. Restart after edits. Inventory reads preserve the last native panel/selection; ids/name/bin queries reveal the first matched Project item. inspect_project remains a capped summary, not a complete inventory.",
    inputSchema: { ...targetInputs, ...page, binId:z.string().min(1).optional(), cursor:z.string().max(50000).optional() }, annotations: { readOnlyHint: true, destructiveHint:false },
  }, async args => { try { return result(await host.read("query_media", args)); } catch (error) { return failure(error); } });
  server.registerTool("prepare_clip_edit", {
    description: "Prepare exact split/move/trim/lift arguments from a fresh pinned clip. Follows the exact clip, keeping an existing in-clip playhead and selection without editing content. Returns tool + arguments; execute separately with edit profile enabled. Validates argument shape; the actual edit rechecks timing, occupancy and effects.",
    inputSchema: { expectedProjectId: z.string().min(1), expectedSequenceId: z.string().min(1), trackItemId: z.string().min(1),
      intent: clipEditIntent, operationId: z.string().uuid().optional() }, annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ trackItemId, intent, operationId, ...identity }) => {
    try {
      const readback = await host.read("query_timeline", { ...identity, ids: [trackItemId], limit: 1 });
      return result({ ...prepareClipEdit(readback, intent, operationId ?? randomUUID()), workTarget: (readback as Record<string, unknown>).workTarget });
    } catch (error) { return failure(error); }
  });
}
