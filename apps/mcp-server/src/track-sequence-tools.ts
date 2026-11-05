import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { clipEditInputs } from "./clip-edit-inputs.js";
import type { HostExecutor } from "./host-executor.js";
import { result, failure } from "./tool-values.js";

const context = { expectedProjectId: z.string().min(1), expectedSequenceId: z.string().min(1), expectedSequenceName: z.string().min(1) };
export const trackCommandSequenceSchema = z.object({
  ...context, protocolVersion: z.literal(1),
  clips: z.array(clipEditInputs.move_clip_to_track.move.omit({ destinationTrackIndex: true }).extend({ ref: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) })).min(1).max(64),
  steps: z.array(z.object({ clipRef: z.string().min(1), destinationTrackIndex: z.number().int().min(0).max(99) }).strict()).min(1).max(256),
  minIntervalMs: z.number().int().min(0).max(5000).default(0),
  maxRunMs: z.number().int().min(1000).max(900000).default(240000),
});

/** The diagonal ordering makes a travelling crest: later clips follow earlier
 * clips through the route. Actual edit duration bounds the visible cadence. */
export function buildTrackWave(query: any, route: number[], phaseOffsetClips: number, minIntervalMs: number, maxRunMs: number) {
  if (query.page?.hasMore || query.page?.scanTruncated) throw Error("Wave planning requires a complete bounded clip list; select at most 64 IDs");
  const items = [...(query.items ?? [])].sort((a, b) => a.start.seconds - b.start.seconds);
  if (!items.length || items.some(item => item.mediaType !== "video" || item.trackIndex !== route[0])) throw Error("Wave clips must all start on the first video track in the route");
  const clips = items.map((item, index) => ({ ref: `clip_${index}`, trackItemId: item.id, expectedProjectItemId: item.projectItemId,
    expectedMediaType: item.mediaType, expectedTrackIndex: item.trackIndex, expectedStartSeconds: item.start.seconds,
    expectedEndSeconds: item.end.seconds, expectedInPointSeconds: item.inPoint?.seconds, expectedOutPointSeconds: item.outPoint?.seconds }));
  const schedule = clips.flatMap((clip, index) => route.slice(1).map((destinationTrackIndex, leg) => ({
    clipRef: clip.ref, destinationTrackIndex, tick: index + leg * phaseOffsetClips, leg,
  }))).sort((a, b) => a.tick - b.tick || b.leg - a.leg);
  const args = trackCommandSequenceSchema.parse({ protocolVersion: 1, expectedProjectId: query.project.id,
    expectedSequenceId: query.sequence.id, expectedSequenceName: query.sequence.name, clips,
    steps: schedule.map(({ clipRef, destinationTrackIndex }) => ({ clipRef, destinationTrackIndex })), minIntervalMs, maxRunMs });
  return { tool: "submit_track_command_sequence", arguments: { ...args, operationId: randomUUID() },
    wave: { route, phaseOffsetClips, clipCount: clips.length, moveCount: schedule.length, returnsToInitialTrack: route[0] === route.at(-1),
      cadence: "minimum interval between actual step starts; never overlapping native transactions; zero means no intentional delay" },
    status: "prepared", executionRequired: true };
}

export function registerTrackSequenceTools(server: McpServer, host: HostExecutor, editable: boolean): void {
  server.registerTool("prepare_track_wave", {
    description: "Prepare a bounded travelling V1→V2→V3→V2→V1 wave from current video clips without editing content. Returns one declarative command list to submit. IDs/times are freshly queried; the host checks all occupancy/effect guards before execution. Track indices are zero-based. No native clicks.",
    inputSchema: { ...context, trackItemIds: z.array(z.string().min(1)).min(1).max(64).optional(),
      route: z.array(z.number().int().min(0).max(99)).min(2).max(9).default([0, 1, 2, 1, 0]),
      phaseOffsetClips: z.number().int().min(1).max(64).default(3), minIntervalMs: z.number().int().min(0).max(5000).default(0),
      maxRunMs: z.number().int().min(1000).max(900000).default(240000) },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ trackItemIds, route, phaseOffsetClips, minIntervalMs, maxRunMs, ...identity }) => {
    try {
      const query = await host.read("query_timeline", { ...identity, ...(trackItemIds ? { ids: trackItemIds } : {}), mediaType: "video", trackIndex: route[0], limit: 64 });
      if (trackItemIds && ((query as any).items.length !== trackItemIds.length || new Set(trackItemIds).size !== trackItemIds.length)) throw Error("Requested clips were not uniquely found on the initial track");
      return result(buildTrackWave(query, route, phaseOffsetClips, minIntervalMs, maxRunMs));
    } catch (error) { return failure(error); }
  });
  server.registerTool("get_track_command_sequence_status", {
    description: "Read cached progress/final proof of a submitted command sequence. No host timeline scan or navigation. Poll roughly once a second; results are paginated in groups of 50 with nextCursor. Only terminal pass plus preservation.expectedState=pass proves completion. Unknown after reload is UNVERIFIED, never retry authorization.",
    inputSchema: { jobId: z.string().uuid(), cursor: z.number().int().min(0).max(256).default(0) }, annotations: { readOnlyHint: true },
  }, async args => { try { return result(await host.trackSequenceStatus(args)); } catch (error) { return failure(error); } });
  if (!editable) return;
  server.registerTool("submit_track_command_sequence", {
    description: "Submit up to 256 guarded track relocations ONCE. The UXP host owns the queue and runs them without agent/MCP roundtrips per edit, rebinding clip IDs after each verified move. Acceptance returns PARTIAL immediately; poll status with returned jobId. Every edit reveals/selects/targets, proves time/effects and collateral preservation. Stops on failure/deadline/cancel; earlier moves remain. Never automatically retry or reload a running job.",
    inputSchema: trackCommandSequenceSchema.extend({ operationId: z.string().uuid() }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ operationId: id, ...args }) => {
    try { return result(await host.mutate("submit_track_command_sequence", args, id)); } catch (error) { return failure(error); }
  });
  server.registerTool("cancel_track_command_sequence", {
    description: "Request a submitted job to stop BETWEEN verified native steps. Never interrupts or rolls back a dispatched step. Inspect final status and fresh timeline before planning restoration; earlier completed moves remain.",
    inputSchema: { jobId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async args => { try { return result(await host.read("cancel_track_command_sequence", args)); } catch (error) { return failure(error); } });
}
