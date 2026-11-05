/** Deadlines are budgets, never sleeps or permission to retry. Kept below the
 * executor and archive adapters to avoid importing their stateful machinery. */
export const PROJECT_OPEN_TIMEOUT_MS = 240_000;

/** Cold disclosure can include two bounded 8.5 s observations and saved-chain
 * proof. Warm work still returns immediately; mutation timeouts stay unknown. */
export const EFFECT_PROOF_TIMEOUT_MS = 45_000;

// These handlers perform exact clip preflight and capture their before state in
// the same serialized host command as the edit. A second planning snapshot adds
// latency and can go stale; it provides no additional mutation authorization.
export const HOST_PLANNED_EFFECTS:ReadonlySet<string> = new Set(["apply_video_effect", "apply_audio_effect", "remove_effect", "set_effect_values", "set_effect_keyframes", "edit_effect_keyframes", "set_transform", "set_basic_grade", "set_audio_level", "apply_color_adjustments", "scale_clip_to_fill"]);
