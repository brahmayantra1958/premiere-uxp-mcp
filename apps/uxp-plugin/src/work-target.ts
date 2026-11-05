export type WorkTrack = { mediaType: "video" | "audio" | "caption"; trackIndex: number };
export type WorkIntent = { itemIds: string[]; tracks: WorkTrack[]; timeSeconds?: number; offsetSeconds?: number; edge?: "end" };
export type WorkTarget = {
  status: "pass" | "partial"; phase: "before_command" | "after_read" | "after_command";
  projectId: string; sequenceId: string; sequenceName: string;
  tracks: WorkTrack[]; itemIds: string[];
  playhead: { ticks: string; seconds: number }; requestedSeconds?: number;
  sequenceActivation: "pass"; playheadReadback: "pass"; clipSelection: "pass" | "preserved";
  trackTargeting: "pass" | "preserved" | "unsupported"; trackTargetingReason: string;
  trackTargetingReadback?: Record<string, unknown>;
};

export const TRACK_TARGETING_REASON = "The approved targeting-only CEP helper uses isTargeted/setTargeted with UI broadcast and verifies the full V/A vector per work target. Helper failure prevents dependent edits; Properties targeting remains disabled.";

// Edits focus before dispatch. Result-based timeline reads are covered by read-work-target.ts.
const timelineCommands = new Set([
  "get_effect_values", "set_effect_disclosure",
  "focus_timeline", "place_clips", "import_caption_track", "place_on_new_layer", "set_track_state",
  "activate_native_tool", "track_object_mask_frames", "inspect_native_masks",
  "set_timeline_item_state", "set_timeline_selection", "clone_clips", "split_clips", "trim_clips",
  "trim_clip_exact", "move_clips", "move_clip_to_track", "remove_clips", "detect_scene_cuts", "add_markers",
  "insert_mogrt_caption", "insert_editable_graphic", "apply_transition", "remove_transition",
  "apply_video_effect", "apply_audio_effect", "remove_effect", "set_effect_values", "set_effect_keyframes",
  "edit_effect_keyframes", "apply_color_adjustments", "set_transform", "scale_clip_to_fill",
  "set_basic_grade", "set_audio_level", "place_voiceover", "place_music", "export_sequence", "export_frame",
  "export_review_frames", "collect_object_mask_prompt", "open_native_speech_to_text_workflow",
]);

/** Batch focus uses the first location in input order and selects all explicitly named clips. */
export function workIntent(command: string, args: Record<string, any>): WorkIntent | undefined {
  if (!timelineCommands.has(command)) return undefined;
  const entries = [args, args.split, args.trim, args.move, args.seed?.target, ...(args.edits ?? []), ...(args.targets ?? []), ...(args.clones ?? [])].filter(Boolean);
  const itemIds = [...new Set<string>([...(args.trackItemIds ?? []), ...entries.flatMap(entry => entry.trackItemId ? [entry.trackItemId] : [])])];
  const tracks: WorkTrack[] = [];
  const add = (mediaType: WorkTrack["mediaType"], trackIndex: unknown) => {
    if (typeof trackIndex === "number" && Number.isInteger(trackIndex) && trackIndex >= 0 &&
      !tracks.some(track => track.mediaType === mediaType && track.trackIndex === trackIndex)) tracks.push({ mediaType, trackIndex });
  };
  for (const entry of [...entries, ...(args.placements ?? []), ...(args.tracks ?? [])]) {
    add("video", entry.videoTrackIndex); add("audio", entry.audioTrackIndex);
    if (["video", "audio", "caption"].includes(entry.mediaType)) add(entry.mediaType, entry.trackIndex);
  }
  const timeSeconds = args.timeSeconds ?? args.seed?.frame?.timelineTimeSeconds ?? args.timesSeconds?.[0] ?? args.split?.atSeconds ?? args.trim?.startSeconds ??
    args.placements?.[0]?.timeSeconds ?? args.markers?.[0]?.timeSeconds ??
    args.keyframes?.[0]?.timeSeconds ?? args.operations?.[0]?.timeSeconds ??
    ((args.keyframes?.[0]?.timeTicks ?? args.operations?.[0]?.timeTicks) === undefined ? undefined : Number(args.keyframes?.[0]?.timeTicks ?? args.operations?.[0]?.timeTicks) / 254016000000);
  return { itemIds, tracks, ...(timeSeconds === undefined ? {} : { timeSeconds }),
    ...(command === "move_clips" ? { offsetSeconds: args.move?.offsetSeconds } : {}),
    ...(["apply_transition", "remove_transition"].includes(command) && args.position === "end" ? { edge: "end" as const } : {}) };
}
