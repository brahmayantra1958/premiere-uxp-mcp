import { z } from "zod/v4";
import { operationId, seconds, index } from "./tool-inputs.js";

/** L0: the exact target facts required by every supported clip edit. */
const clipGuard = {
  trackItemId: z.string().min(1),
  expectedProjectItemId: z.string().min(1),
  expectedMediaType: z.enum(["video", "audio"]),
  expectedTrackIndex: index,
  expectedStartSeconds: seconds,
  expectedEndSeconds: seconds,
};
const context = { expectedProjectId: z.string().min(1), expectedSequenceId: z.string().min(1) };
const namedContext = { ...context, expectedSequenceName: z.string().min(1) };

/** One schema authority for existing tools and read-only command preparation. */
export const clipEditInputs = {
  split_clips: {
    ...context,
    split: z.object({ ...clipGuard, atSeconds: seconds }),
    operationId,
  },
  trim_clip_exact: {
    ...namedContext,
    trim: z.object({ ...clipGuard, expectedInPointSeconds: seconds, expectedOutPointSeconds: seconds,
      startSeconds: seconds.optional(), endSeconds: seconds.optional(),
    }).refine(trim => [trim.startSeconds, trim.endSeconds].some(value => value !== undefined), "At least one timeline trim boundary is required"),
    operationId,
  },
  move_clips: {
    ...namedContext,
    move: z.object({ ...clipGuard, offsetSeconds: z.number().finite() }),
    operationId,
  },
  move_clip_to_track: {
    ...namedContext,
    move: z.object({ ...clipGuard, expectedInPointSeconds: seconds, expectedOutPointSeconds: seconds, destinationTrackIndex: index }),
    operationId,
  },
  remove_clips: {
    ...namedContext,
    targets: z.array(z.object({...clipGuard,expectedProjectItemId:z.string(),expectedClipName:z.string().optional()})
      .refine(t=>Boolean(t.expectedProjectItemId)||t.expectedClipName!==undefined,"Timeline-native graphics require expectedClipName")).min(1).max(20,"REMOVE_CLIPS_LIMIT: send at most 20 exact targets per operation, wait for PASS, refresh IDs, then submit the next batch")
      .refine(targets => new Set(targets.map(target => target.trackItemId)).size === targets.length, "Track item IDs must be unique"),
    ripple: z.literal(false).default(false),
    operationId,
  },
};
