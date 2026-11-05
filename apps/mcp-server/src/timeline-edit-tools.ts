import { clipEditInputs } from "./clip-edit-inputs.js";
import { targetInputs } from './target-inputs.js';
import { z } from "zod/v4";
import { operationId, seconds, index } from "./tool-inputs.js";
import { result, failure } from "./tool-values.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";
import { sourceRangeInput, sourceMappingInput, renderChecksInput } from './source-range-inputs.js';
import { sourceRangePlacementOperation } from './source-range-operation.js';

export function registerPlacementTools(server: McpServer, host: HostExecutor, paths: PathPolicy): void {
  server.registerTool("create_subclip", {
    description: "Create a hard-bounded Premiere subclip from an explicit source range and verify the new project item and bounds.",
    inputSchema: { ...targetInputs,
      projectItemId: z.string().min(1),
      name: z.string().min(1),
      startSeconds: seconds,
      endSeconds: seconds,
      hardBoundaries: z.boolean().default(true),
      takeVideo: z.boolean().default(true),
      takeAudio: z.boolean().default(true),
      operationId,
    },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("create_subclip", args, id)));

  server.registerTool("create_sequence", {
    description: "Create and activate a sequence only when the requested work needs a new sequence, optionally from an Adobe .sqpreset path. Existing local sequence edits require no replacement or WORKING__ prefix. Verify actual format and identity before placement.",
    inputSchema: { ...targetInputs, name: z.string().min(1), presetPath: z.string().optional(), operationId },
  }, async ({ name, presetPath, operationId: id , ...targetPins }) => {
    try { return result(await host.mutate("create_sequence", { ...targetPins, name, presetPath: presetPath ? paths.authorizeRead(presetPath).path : undefined }, id)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("place_clips", {
    description: "Keep the full original file, never a cut-length derivative. First inspect get_agent_context.placementCapabilities (or get_capabilities.write.sourceRangePlacement:true on older servers); tools/list and panelVersion do not prove live support. Choose sourceRange {inPointSeconds,outPointSeconds} only when supported. If unavailable, full-original placement + trim_clip_exact requires both capabilities and empty space for the entire temporary insertion on all streams; never auto-fallback or reload during active editing. Source-range mode accepts ONE item, named exact target, existing tracks, overwrite + requireEmpty + expectedMediaTypes; timeline start and range length must be exact sequence frames. It restores project source marks and checks host start/in/out. Video also requires renderChecks (timeline timeSeconds + independently reviewed capture_program_frame expectedSha256); wrong/black output cannot PASS on model values alone. No reference means preflight refusal. Returns editability handles/warnings and sampled render proof; audio still requires audition. Optional sourceMapping records derivative provenance, not a verified relink. Legacy expectedDurationSeconds is floored to sequence frames; do not mix legacy expectations with sourceRange. Never replay unknown placement.",
    inputSchema: { expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),expectedSequenceName:z.string().min(1).optional(), placements: z.array(z.object({ projectItemId: z.string(), timeSeconds: seconds, videoTrackIndex: index.default(0), audioTrackIndex: index.default(0), mode: z.enum(["insert", "overwrite"]).default("insert"), sourceRange: sourceRangeInput.optional(), sourceMapping: sourceMappingInput.optional(), expectedDurationSeconds:z.number().positive().optional(),expectedSourceInSeconds:seconds.optional(),expectedMediaTypes:z.array(z.enum(['video','audio'])).min(1).max(2).refine(types => new Set(types).size === types.length, 'Unique streams required').optional(),requireEmpty:z.boolean().default(false) })).min(1).max(100), renderChecks: renderChecksInput, operationId },
  }, async ({ operationId: id,...args }) => {
    if (args.placements.some(p => p.sourceRange)) return result(await sourceRangePlacementOperation(host, paths, args, id));
    if (args.renderChecks) return failure(Error('RENDER_CHECKS_REQUIRE_SOURCE_RANGE: legacy placement has no rendered-success contract'));
    return result(await host.mutate("place_clips", args, id));
  });
}

export function registerTimelineEditTools(server: McpServer, host: HostExecutor): void {
  server.registerTool("focus_timeline", {
    description: "Reveal an exact working sequence, move the playhead and select exact clips without mouse or keyboard input. The approved targeting-only CEP helper exclusively targets the working V/A tracks with native API readback. Overview/verification reads retain the last location, while targeted reads/edits follow automatically. Use this for explicit navigation; do not append a restore-to-original call unless requested. Does not edit media or save the project.",
    inputSchema: { expectedProjectId: z.string().min(1), sequenceId: z.string().min(1),
      timeSeconds: seconds.optional(), trackItemIds: z.array(z.string().min(1)).max(100).default([]),
      tracks: z.array(z.object({ mediaType: z.enum(["video", "audio", "caption"]), trackIndex: index })).max(100).default([]), operationId },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("focus_timeline", args, id)));

  server.registerTool("place_on_new_layer", {
    description: "Place a project item on the next available video/audio track indices, creating real layers as media streams are inserted, and optionally name the new tracks.",
    inputSchema: { ...targetInputs, projectItemId: z.string().min(1), timeSeconds: seconds, mode: z.enum(["insert", "overwrite"]).default("overwrite"), videoTrackName: z.string().min(1).optional(), audioTrackName: z.string().min(1).optional(), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("place_on_new_layer", args, id)));

  server.registerTool("set_track_state", {
    description: "Rename/mute exact tracks. For video/audio track locking use read_track_locks and set_track_locks. Track mixer pan/volume are unsupported; use inspected clip effect controls. Pan storage 0..1 maps to UI -100..100 for the verified Balance effect only.",
    inputSchema: { ...targetInputs, edits: z.array(z.object({ mediaType: z.enum(["video", "audio", "caption"]), trackIndex: index, name: z.string().min(1).optional(), muted: z.boolean().optional(), pan:z.never({error:"TRACK_MIXER_UNSUPPORTED: use an inspected clip Balance effect on supported stereo audio; mono intrinsic panner is not exposed"}).optional(), volume:z.never({error:"TRACK_MIXER_UNSUPPORTED: use the inspected clip Volume parameter; track volume is not exposed"}).optional() }).strict()).min(1).max(100), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("set_track_state", args, id)));

  server.registerTool("set_timeline_item_state", {
    description: "Rename and/or enable or disable explicit timeline clips and verify the resulting clip state.",
    inputSchema: { ...targetInputs, edits: z.array(z.object({ trackItemId: z.string().min(1), name: z.string().min(1).optional(), disabled: z.boolean().optional() })).min(1).max(100), operationId },
  }, async ({ edits, operationId: id , ...targetPins }) => result(await host.mutate("set_timeline_item_state", { ...targetPins, edits }, id)));

  server.registerTool("set_timeline_selection", {
    description: "Replace Premiere's current timeline selection with exact inspected clip IDs, then verify that no requested item is missing and no unrelated item remains selected. This changes selection only, not project content.",
    inputSchema: {
      expectedProjectId: z.string().min(1),
      expectedSequenceId: z.string().min(1),
      expectedSequenceName: z.string().min(1),
      trackItemIds: z.array(z.string().min(1)).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "Track item IDs must be unique"),
      operationId,
    },
    annotations: { destructiveHint: false },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("set_timeline_selection", args, id)));

  server.registerTool("clone_clips", {
    description: "Clone exact timeline clips with Premiere's public action. Destinations must be on the sequence frame grid and existing tracks. Non-overlapping overwrite clones run sequentially with fresh native objects and all-result readback; insert allows one clone per command because it ripples identities. A partial/unknown result must be inspected before new work; never replay completed clones. Verifies structural timing/source ranges, not rendered pixels or audio.",
    inputSchema: { ...targetInputs, clones: z.array(z.object({ trackItemId: z.string().min(1), timeOffsetSeconds: z.number().finite().default(0), videoTrackOffset: z.number().int().default(0), audioTrackOffset: z.number().int().default(0), mode: z.enum(["insert", "overwrite"]).default("overwrite") })).min(1).max(100), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("clone_clips", args, id)));

  server.registerTool("split_clips", {
    description: "Split one exact timeline item using public UXP staging clone/trim, registration of the right segment in the cut gap, then verified staging removal. Verifies both editable segments, source continuity, effects/keyframes and native chronological track order. Does not create a sequence or track. Structural readback does not prove program pixels or audible output; validate those when visual/audio correctness is required. Never replay an uncertain split.",
    inputSchema: clipEditInputs.split_clips,
    annotations: { destructiveHint: true },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("split_clips", args, id)));

  server.registerTool("trim_clips", {
    description: "Compatibility batch trim for existing workflows. New automation should use trim_clip_exact so active-target, unrelated-item, component, and rollback state are verified.",
    inputSchema: { ...targetInputs, edits: z.array(z.object({ trackItemId: z.string(), startSeconds: seconds.optional(), endSeconds: seconds.optional(), inPointSeconds: seconds.optional(), outPointSeconds: seconds.optional() })).min(1).max(100), operationId },
  }, async ({ edits, operationId: id , ...targetPins }) => result(await host.mutate("trim_clips", { ...targetPins, edits }, id)));

  server.registerTool("trim_clip_exact", {
    description: "Trim one exact inspected normal-speed forward clip's timeline boundaries, verifying Premiere's coupled source range without creating tracks or changing unrelated items, transitions, effects, or keyframes; failed verification attempts bounded restoration. after.editability reports file-relative head/tail handles (null if unknown), derivative warnings and limits. Inspect each zero handle and explain it. Structural PASS is not rendered/audio proof: compare capture_program_frame with reviewed reference frames and audition audio before declaring the edit complete.",
    inputSchema: clipEditInputs.trim_clip_exact,
    annotations: { destructiveHint: true },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("trim_clip_exact", args, id)));

  server.registerTool("move_clips", {
    description: "Move one exact inspected clip by a frame-aligned signed offset into an empty range without creating tracks or changing unrelated items, transitions, effects, or keyframes.",
    inputSchema: clipEditInputs.move_clips,
    annotations: { destructiveHint: true },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("move_clips", args, id)));

  server.registerTool("move_clip_to_track", {
    description: "Move one exact inspected individual clip to an empty range on another existing track of the same media type. Preserve exact timeline/source ticks, readable effects/keyframes and all unrelated items. Verify the clone before lifting the original; bounded rollback on failure. Refuses possible linked A/V counterparts, retimed clips, or source/destination tracks with transitions. Repeat with fresh IDs for multiple clips. Selects the moved clip after completion.",
    inputSchema: clipEditInputs.move_clip_to_track,
    annotations: { destructiveHint: true },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("move_clip_to_track", args, id, { timeoutMs: 120_000 })));

  server.registerTool("remove_clips", {
    description: "Lift exact inspected video or audio clips from the active sequence without ripple, then prove every unrelated item, track count, and transition remained unchanged. Mixed-media and transition-attached targets fail closed.",
    inputSchema: clipEditInputs.remove_clips,
    annotations: { destructiveHint: true },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("remove_clips", args, id)));

  server.registerTool("detect_scene_cuts", {
    description: "Run Premiere's native Scene Edit Detection on explicit video clip IDs, apply real timeline cuts in place, and verify contiguous segment coverage plus preservation of every unselected item.",
    inputSchema: { ...targetInputs,
      trackItemIds: z.array(z.string().min(1)).min(1).max(20),
      minimumCutCount: z.number().int().nonnegative().max(10_000).default(0),
      operationId,
    },
    annotations: { destructiveHint: true },
  }, async ({ trackItemIds, minimumCutCount, operationId: id , ...targetPins }) => result(await host.mutate(
    "detect_scene_cuts",
    { ...targetPins, trackItemIds, minimumCutCount },
    id,
    { timeoutMs: 300_000 },
  )));

  server.registerTool("add_markers", {
    description: "Add named timeline markers with explicit time, duration, type, and comments, then read them back.",
    inputSchema: { ...targetInputs, markers: z.array(z.object({ name: z.string(), timeSeconds: seconds, durationSeconds: seconds.default(0), type: z.enum(["Comment", "Chapter", "Segmentation", "WebLink"]).default("Comment"), comments: z.string().default("") })).min(1).max(100), operationId },
  }, async ({ markers, operationId: id , ...targetPins }) => result(await host.mutate("add_markers", { ...targetPins, markers }, id)));
}
