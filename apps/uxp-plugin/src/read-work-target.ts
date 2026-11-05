import type { WorkIntent } from "./work-target.js";
import { isJobPreservationRead, type BridgeReadPurpose } from '@premiere-uxp/contracts/read-purpose';

// The host owns this policy. Overview/verification reads must not replace the
// last work location with the first item in a returned page.
export const timelineReadCommands = new Set([
  "query_timeline", "get_agent_context", "inspect_project", "inspect_sequence", "inspect_delivery_state",
  "inspect_effects", "inspect_markers", "inspect_timeline_selection", "inspect_object_mask_state",
]);

/** Only a requested clip/search/time is a navigation target. Context, inventory,
 * selection and pagination are observations, even if their first result is at 0. */
export function readWorkIntent(command: string, args: Record<string, any>, result: any, readPurpose?: BridgeReadPurpose): WorkIntent | undefined {
  if (command !== "query_timeline") return undefined;
  if (isJobPreservationRead(command, readPurpose)) return undefined;
  const rangeStart = args.effectTimeSeconds ?? args.startSeconds;
  if (!args.ids?.length && !args.nameContains?.trim() && rangeStart === undefined) return undefined;
  const first = result?.items?.[0];
  const id = first?.trackItemId ?? first?.id;
  const itemIds = typeof id === "string" && /^(video|audio):/.test(id) ? [id] : [];
  const start = typeof first?.start?.seconds === "number" ? first.start.seconds : undefined;
  const timeSeconds = rangeStart === undefined ? undefined : Math.max(rangeStart, start ?? rangeStart);
  const tracks = itemIds.length === 0 && command === "query_timeline" && ["video", "audio"].includes(args.mediaType) &&
    Number.isInteger(args.trackIndex) && args.trackIndex >= 0 ? [{ mediaType: args.mediaType as "video" | "audio", trackIndex: args.trackIndex }] : [];
  if (!itemIds.length && !tracks.length && timeSeconds === undefined) return undefined;
  return { itemIds, tracks, ...(timeSeconds === undefined ? {} : { timeSeconds }) };
}
