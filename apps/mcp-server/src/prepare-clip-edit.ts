import { z } from "zod/v4";
import { clipEditInputs } from "./clip-edit-inputs.js";

const time = z.number().finite().nonnegative();
export const clipEditIntent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("split"), atSeconds: time }),
  z.object({ kind: z.literal("move"), offsetSeconds: z.number().finite().refine(value => value !== 0, "Move offset must not be zero") }),
  z.object({ kind: z.literal("move_to_track"), destinationTrackIndex: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("trim"), startSeconds: time.optional(), endSeconds: time.optional() })
    .refine(value => value.startSeconds !== undefined || value.endSeconds !== undefined, "Provide a trim boundary"),
  z.object({ kind: z.literal("lift") }),
]);

const preparationReadback = z.object({
  project: z.object({ id: z.string().min(1) }),
  sequence: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  editBoundary: z.object({ allowed: z.literal(true) }),
  page: z.object({ hasMore: z.literal(false), scanTruncated: z.literal(false) }),
  items: z.array(z.object({
    id: z.string().min(1), projectItemId: z.string(), name:z.string().optional(), mediaType: z.enum(["video", "audio"]), trackIndex: z.number().int().nonnegative(),
    start: z.object({ seconds: time }), end: z.object({ seconds: time }),
    inPoint: z.object({ seconds: time }).optional(), outPoint: z.object({ seconds: time }).optional(),
  })).length(1),
});

/** Compose guarded arguments from one fresh pinned readback. No I/O or mutation. */
export function prepareClipEdit(readback: unknown, intent: z.infer<typeof clipEditIntent>, operationId: string) {
  const target = preparationReadback.parse(readback);
  const item = target.items[0]!;
  const context = { expectedProjectId: target.project.id, expectedSequenceId: target.sequence.id, expectedSequenceName: target.sequence.name, operationId };
  const guard = { trackItemId: item.id, expectedProjectItemId: item.projectItemId, expectedMediaType: item.mediaType,
    expectedTrackIndex: item.trackIndex, expectedStartSeconds: item.start.seconds, expectedEndSeconds: item.end.seconds };
  let tool: keyof typeof clipEditInputs;
  let args: Record<string, unknown>;
  switch (intent.kind) {
    case "split": tool = "split_clips"; args = { ...context, split: { ...guard, atSeconds: intent.atSeconds } }; break;
    case "move": tool = "move_clips"; args = { ...context, move: { ...guard, offsetSeconds: intent.offsetSeconds } }; break;
    case "move_to_track": tool = "move_clip_to_track"; args = { ...context, move: { ...guard, expectedInPointSeconds: item.inPoint?.seconds,
      expectedOutPointSeconds: item.outPoint?.seconds, destinationTrackIndex: intent.destinationTrackIndex } }; break;
    case "trim": tool = "trim_clip_exact"; args = { ...context, trim: { ...guard, expectedInPointSeconds: item.inPoint?.seconds,
      expectedOutPointSeconds: item.outPoint?.seconds, startSeconds: intent.startSeconds, endSeconds: intent.endSeconds } }; break;
    case "lift": tool = "remove_clips"; args = { ...context, targets: [{...guard,...(!item.projectItemId?{expectedClipName:item.name}:{})}], ripple: false }; break;
  }
  return { tool, arguments: z.object(clipEditInputs[tool]).parse(args), validation: "arguments_only",
    next: "Call this tool separately. It rechecks the target and operation constraints, mutates and verifies readback. Refresh after any timeline change." };
}
