import { z } from "zod/v4";
export const effectSequenceTime = { timeSeconds: z.number().finite().nonnegative().optional(), timeTicks: z.string().regex(/^\d+$/).optional() };
export const hasEffectTime = (v: { timeSeconds?: number | undefined; timeTicks?: string | undefined }) => (v.timeSeconds === undefined) !== (v.timeTicks === undefined);

/** Shared wire constraints; no filesystem, host or tool-registration dependency. */
export const operationId = z.string().uuid().optional().describe("Stable idempotency key. Reuse it only to retrieve the prior receipt without repeating a mutation.");

export const seconds = z.number().finite().nonnegative();

export const index = z.number().int().nonnegative();

export const captionPlacementIndex = z.number().int().min(-1).max(99);

export const effectValue = z.union([
  z.string(), z.number(), z.boolean(),
  z.object({ kind: z.literal("point"), x: z.number().finite(), y: z.number().finite() }),
  z.object({ kind: z.literal("color"), red: z.number().min(0).max(1), green: z.number().min(0).max(1), blue: z.number().min(0).max(1), alpha: z.number().min(0).max(1).optional().describe("Omit to preserve the inspected effect color alpha. Some hosts cannot losslessly encode arbitrary RGB with nonzero alpha; those writes fail before dispatch.") }),
]);

export const values = z.record(z.string(), effectValue);

export const exactEffectTarget = {
  expectedProjectId: z.string().min(1), expectedSequenceId: z.string().min(1), expectedSequenceName: z.string().min(1),
  trackItemId: z.string().min(1), expectedProjectItemId: z.string(), expectedClipName:z.string().optional(), expectedMediaType: z.enum(["video", "audio"]),
  expectedTrackIndex: index, expectedStartSeconds: seconds, expectedEndSeconds: seconds,
};
export const effectParameterSelector = {
  paramIndex: index.optional(), parameterName: z.string().min(1).optional(), expectedDisplayName: z.string().optional(),
};
/** Guard values may be copied directly from native inspection. Mutation values
 * retain their explicit Point/Color tags, so an observed array is never a write. */
export const effectObservedValue=z.union([effectValue,z.tuple([z.number().finite(),z.number().finite()]),z.object({x:z.number().finite(),y:z.number().finite()}),z.object({red:z.number().finite(),green:z.number().finite(),blue:z.number().finite(),alpha:z.number().finite()})]);
const dependencyOperand=z.union([z.number().finite(),z.object({paramIndex:index.max(4095),field:z.enum(['x','y','red','green','blue','alpha']).optional()}).strict(),z.object({nodeIndex:index.max(63)}).strict()]);
export const effectDependencies=z.object({
  mode:z.enum(['observe','apply']).optional(),
  componentMatchName:z.string().min(1).max(512),parameterNames:z.array(z.string().max(512)).min(1).max(4096),
  rules:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,96}$/),outputParamIndex:index.max(4095),
    nodes:z.array(z.object({op:z.enum(['add','subtract','multiply','divide','min','max','point','color']),args:z.array(dependencyOperand).min(2).max(4)}).strict().refine(n=>n.args.length===(n.op==='color'?4:2),'Color has four operands; other nodes have two')).min(1).max(64)
  }).strict()).min(1).max(64)
}).strict();
export const effectParameters = z.array(z.object({ ...effectParameterSelector, value: effectValue, expectedValue: effectObservedValue.optional() })
  .refine(p => p.paramIndex !== undefined ? p.expectedDisplayName !== undefined : p.parameterName !== undefined,
    "Use paramIndex with expectedDisplayName, or a unique parameterName")).min(1).max(500);

export const effectKeyframes=z.array(z.object({...effectParameterSelector,...effectSequenceTime,value:effectValue,interpolation:z.enum(['linear','hold','bezier']).default('linear')})
  .refine(hasEffectTime,'Supply exactly one sequence timeSeconds or timeTicks')
  .refine(p=>p.paramIndex!==undefined?p.expectedDisplayName!==undefined:p.parameterName!==undefined,'An indexed guarded or unique named parameter is required')).min(1).max(500);
export const effectKeyframeEdits=z.array(z.discriminatedUnion('action',[
  z.object({action:z.literal('replace'),...effectParameterSelector,...effectSequenceTime,expectedValue:effectObservedValue,expectedInterpolation:z.enum(['linear','hold','bezier']),value:effectValue,interpolation:z.enum(['linear','hold','bezier'])}),
  z.object({action:z.literal('remove'),...effectParameterSelector,...effectSequenceTime,expectedValue:effectObservedValue,expectedInterpolation:z.enum(['linear','hold','bezier'])}),
]).refine(hasEffectTime,'Supply exactly one sequence timeSeconds or timeTicks').refine(p=>p.paramIndex!==undefined?p.expectedDisplayName!==undefined:p.parameterName!==undefined,'An indexed guarded or unique named parameter is required')).min(1).max(500);

export const removableTrack = z.object({
  mediaType: z.enum(["video", "audio", "caption"]),
  index: z.number().int().nonnegative(),
  id: z.number().int().nonnegative(),
  uid: z.string().uuid(),
  name: z.string(),
  expectedHostName: z.string(),
  expectedItemCount: z.literal(0),
  expectedTransitionCount: z.literal(0),
});

const captionFontPostScriptName = z.string().regex(/^[\x20-\x7e]{3,100}$/);
const captionFontSize = z.number().finite().min(1).max(1_000);
const captionCueTicks = z.string().regex(/^(0|[1-9]\d*)$/).max(30);
const captionFillColor = z.object({
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
}).strict();

/** Cue indices are not durable IDs: bind every write to its exact current ticks. */
export const nativeCaptionCueStyle = z.object({
  itemIndex: z.number().int().nonnegative(),
  expectedStartTicks: captionCueTicks,
  expectedEndTicks: captionCueTicks,
  fontPostScriptName: captionFontPostScriptName.optional(),
  fontSize: captionFontSize.optional(),
  fillColor: captionFillColor.optional().describe('RGB integer channels 0..255; preserve the existing opacity.'),
}).strict().superRefine((value, context) => {
  if (/^(0|[1-9]\d*)$/.test(value.expectedStartTicks) && /^(0|[1-9]\d*)$/.test(value.expectedEndTicks)
    && BigInt(value.expectedEndTicks) <= BigInt(value.expectedStartTicks)) {
    context.addIssue({code:'custom',path:['expectedEndTicks'],message:'Caption end must be greater than start'});
  }
  if (value.fontPostScriptName === undefined && value.fontSize === undefined && value.fillColor === undefined) {
    context.addIssue({code:'custom',message:'Request at least one cue style field'});
  }
});

export const nativeCaptionStyle = z.object({
  trackUid: z.string().uuid(),
  expectedTrackId: z.number().int().nonnegative(),
  expectedTrackName: z.string().min(1),
  expectedItemCount: z.number().int().positive(),
  fontPostScriptName: captionFontPostScriptName.optional(),
  fontSize: captionFontSize.optional(),
  items: z.array(nativeCaptionCueStyle).min(1).max(1_000).optional()
    .describe('Edit only these guarded cues. Cannot be combined with track-wide fontPostScriptName/fontSize.'),
}).strict().superRefine((value, context) => {
  if (value.items !== undefined) {
    if (value.fontPostScriptName !== undefined || value.fontSize !== undefined) {
      context.addIssue({code:'custom',message:'Separate track-wide and per-cue caption style requests'});
    }
    const seen = new Set<number>();
    for (const [position, item] of value.items.entries()) {
      if (seen.has(item.itemIndex) || item.itemIndex >= value.expectedItemCount) {
        context.addIssue({code:'custom',path:['items',position,'itemIndex'],message:'Cue index must be unique and below expectedItemCount'});
      }
      seen.add(item.itemIndex);
    }
  } else if (value.fontPostScriptName === undefined || value.fontSize === undefined) {
    context.addIssue({code:'custom',message:'Track-wide caption style requires both fontPostScriptName and fontSize; otherwise use items'});
  }
});

export const maximumMaskPromptPngBytes = 5 * 1024 * 1024;
