import { z } from "zod/v4";
import {targetInputs} from './target-inputs.js';
import { operationId, seconds, index, values, exactEffectTarget, effectParameters, effectKeyframes, effectKeyframeEdits, effectDependencies } from "./tool-inputs.js";
import { result, failure } from "./tool-values.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";
import {effectCommandSequenceSchema,planEffectSequence} from './effect-command-sequence.js';
import {randomUUID} from 'node:crypto';
import {runLumetriCurve} from './lumetri-curve-operation.js';
import {runSpeedGraph} from './speed-graph-operation.js';

export function registerEffectReadTools(server:McpServer,host:HostExecutor):void {
  server.registerTool('get_effect_command_sequence_status',{description:'Read cached runtime-owned effect job status and up to 25 step receipts. Unknown/interrupted work is unverified and must never be replayed.',inputSchema:{jobId:z.string().uuid(),cursor:index.default(0)},annotations:{readOnlyHint:true}},async args=>{try{return result(await host.read('get_effect_command_sequence_status',args));}catch(e){return failure(e);}});
  server.registerTool("get_effect_values",{
    description:"Read one exact clip effect; use parameter detail for a single value. Targeted work follows the clip/effect best effort and retains an in-clip playhead when no time is requested. No extra focus/expand call is needed. Animated Color and video time use the separately installed read-only Adobe SDK adapter with exact clip/source/time and duplicate-instance correlation. Per-parameter readStatus/nativeSample report unavailable or ambiguous proofs. Generic visibility is separate from content; specialized native proof remains required. Saved native evidence paths may save the local project.",
    inputSchema:z.object({...exactEffectTarget,componentIndex:index,componentMatchName:z.string().min(1),componentDisplayName:z.string().optional(),paramIndex:index.optional().describe("Optionally reveal this exact parameter and its ancestor groups"),expectedDisplayName:z.string().optional(),detail:z.enum(['effect','parameter','chain']).default('effect').describe('Selected effect/parameter, or full chain with saved Point proof at native zero. Content preservation and specialized native proof are retained; generic follow visibility is separate.'),timeSeconds:seconds.optional().describe("Optional sequence time; defaults to the timeline clip start. Every video clip obtains fresh exact SDK samples, including speed ramps whose public speed remains 1. Inverse keys report only observed exact occurrences; ambiguous/unreachable times remain unavailable.")}).refine(v=>v.paramIndex===undefined||v.expectedDisplayName!==undefined,"An exact parameter index requires its inspected expectedDisplayName").refine(v=>v.detail!=='parameter'||v.paramIndex!==undefined,'Parameter detail requires an exact parameter selector').refine(v=>v.detail!=='chain'||v.timeSeconds===undefined,'Chain state is sampled at native zero'),
    annotations:{readOnlyHint:false,destructiveHint:false},
  },async args=>{try{return result(await host.read("get_effect_values",args));}catch(error){return failure(error);}});
}

export function registerEffectTools(server: McpServer, host: HostExecutor, paths: PathPolicy): void {
  for(const mode of ['get','set'] as const){
    const name=`${mode}_speed_graph_disclosure`;
    server.registerTool(name,{
      description:mode==='get'?'Reveal the exact clip and Time Remapping section, then independently read the actual Speed arrow. Saves the designated project to discover its native UI owner. A missing saved owner is normal for a default clip. A header alone is not Speed-graph proof.':'Set the exact Speed arrow without mouse input through a guarded save/close/reopen lifecycle. Saved ramps preserve every time key. Default clips use a keyless temporary UI owner that must disappear on native save; actual SDK clocks and saved content must remain unchanged. Independently verifies the native arrow. Never replay an unknown operation.',
      inputSchema:{...exactEffectTarget,expectedMediaType:z.literal('video'),...(mode==='set'?{expanded:z.boolean()}:{}),operationId},annotations:{readOnlyHint:false,destructiveHint:false},
    },async({operationId:requestedId,...args})=>{try{const id=requestedId??randomUUID();return result(await host.mutateLocal(name,args,()=>runSpeedGraph(host,paths,args,id),id));}catch(e){return failure(e);}});
  }
  const curveTarget={...exactEffectTarget,expectedMediaType:z.literal('video'),componentIndex:index.max(63),paramIndex:index.max(4095),expectedDisplayName:z.string().min(1).max(512),operationId};
  const rgbTarget={...curveTarget,channel:z.enum(['master','red','green','blue'])};
  server.registerTool('get_lumetri_rgb_curve',{
    description:'Read one exact Lumetri RGB master/red/green/blue channel, with all four channel values and a whole-control digest. Reveals the RGB graph and saves the designated project for native readback. Coordinates are normalized input/output levels in [0,1].',
    inputSchema:rgbTarget,annotations:{readOnlyHint:false,destructiveHint:false},
  },async({operationId:requestedId,...args})=>{try{const id=requestedId??randomUUID(),input={...args,curveKind:'rgb' as const};return result(await host.mutateLocal('get_lumetri_rgb_curve',input,()=>runLumetriCurve(host,paths,input,id),id));}catch(e){return failure(e);}});
  server.registerTool('set_lumetri_rgb_curve',{
    description:'Replace points of one exact RGB channel with increasing normalized input x and output y in [0,1]. Supply 2–32 points; reset with [{x:0,y:0},{x:1,y:1}]. Uses a whole-control optimistic digest. Other three channel bytes and every other parameter must survive fresh Premiere save. Saves/closes/reopens the designated project; no mouse input. Never replay an unknown operation.',
    inputSchema:{...rgbTarget,expectedCurveSha256:z.string().regex(/^[a-f0-9]{64}$/),points:z.array(z.object({x:z.number().finite().min(0).max(1),y:z.number().finite().min(0).max(1)}).strict()).min(2).max(32)},
  },async({operationId:requestedId,...args})=>{try{const id=requestedId??randomUUID(),input={...args,curveKind:'rgb' as const};return result(await host.mutateLocal('set_lumetri_rgb_curve',input,()=>runLumetriCurve(host,paths,input,id),id));}catch(e){return failure(e);}});
  server.registerTool('get_lumetri_hue_saturation_curve',{
    description:'Read the typed native Hue vs Saturation control points on an exact Lumetri instance. Reveals the target and saves the designated project for fresh native binary readback. Returns normalized native hue x, signed saturation displacement y and a digest required for edits. Other proprietary controls remain unsupported.',
    inputSchema:curveTarget,annotations:{readOnlyHint:false,destructiveHint:false},
  },async({operationId:requestedId,...args})=>{try{const id=requestedId??randomUUID();return result(await host.mutateLocal('get_lumetri_hue_saturation_curve',args,()=>runLumetriCurve(host,paths,args,id),id));}catch(e){return failure(e);}});
  server.registerTool('set_lumetri_hue_saturation_curve',{
    description:'Replace all points of the exact inspected Hue vs Saturation curve. Native x is [0,1), y is [-1,1]; points must have strictly increasing x. Empty points reset the curve. Saves/closes/reopens the designated project through public API; no mouse input. Backup and journal precede the typed archive edit. Fresh host save proves native points and untouched parameters. This is a slower project lifecycle operation; never replay an unknown receipt.',
    inputSchema:{...curveTarget,expectedCurveSha256:z.string().regex(/^[a-f0-9]{64}$/),points:z.array(z.object({x:z.number().finite().min(0).lt(1),y:z.number().finite().min(-1).max(1)}).strict()).max(32)},
  },async({operationId:requestedId,...args})=>{try{const id=requestedId??randomUUID();return result(await host.mutateLocal('set_lumetri_hue_saturation_curve',args,()=>runLumetriCurve(host,paths,args,id),id));}catch(e){return failure(e);}});
  server.registerTool('submit_effect_command_sequence',{description:'Submit one bounded effect plan to the shared runtime. Each sequential step retains ordinary content readback and best-effort work follow; explicit disclosure and specialized native proof keep their own checks. Maximum 20 clips, 64 initial effect bindings and 256 steps; split larger plans only after terminal verification. Stops on uncertain state; no atomic rollback or automatic replay. Acceptance is partial; terminal native proof is required. Wait via wait_runtime_events and retrieve cached status.',inputSchema:{operationId:z.string().uuid(),sequence:effectCommandSequenceSchema},annotations:{readOnlyHint:false}},async args=>{try{planEffectSequence(args.sequence);return result(await host.read('submit_effect_command_sequence',args));}catch(e){return failure(e);}});
  server.registerTool('cancel_effect_command_sequence',{description:'Request effect job cancellation between verified steps. An in-flight host operation finishes and is verified first.',inputSchema:{jobId:z.string().uuid()},annotations:{readOnlyHint:false}},async args=>{try{return result(await host.read('cancel_effect_command_sequence',args));}catch(e){return failure(e);}});
  server.registerTool("set_effect_disclosure",{
    description:"Explicitly collapse or expand one guarded effect header without changing effect values. Use when header display itself is requested; ordinary targeted content work already follows best effort. Requires independent native readback. It does not change child graphs. Use set_speed_graph_disclosure for the separate Speed arrow. Value reads/edits do not require native disclosure.",
    inputSchema:z.object({...exactEffectTarget,componentIndex:index.optional(),componentMatchName:z.string().min(1),expanded:z.boolean(),operationId})
      .refine(v=>v.componentMatchName==="BE.TimeRemapping"?v.componentIndex===undefined:v.componentIndex!==undefined,"Supply the inspected componentIndex; omit it only for the native-only BE.TimeRemapping header"),
  },async({operationId:id,...args})=>result(await host.mutate("set_effect_disclosure",args,id)));
  const staticInput = { values: values.optional(), parameters: effectParameters.optional() };
  const hasStaticWrites = (v: { values?: Record<string, unknown> | undefined; parameters?: unknown[] | undefined }) =>
    Boolean(Object.keys(v.values ?? {}).length) !== Boolean(v.parameters?.length);
  server.registerTool("apply_transition", {
    description: "Apply or replace an installed video transition by match name, edge, duration, side mode, and Premiere alignment value; verify the transition track-item readback.",
    inputSchema: { trackItemId: z.string().min(1), matchName: z.string().min(1), position: z.enum(["start", "end"]), durationSeconds: seconds.optional(), forceSingleSided: z.boolean().default(false), alignment: z.number().int().min(0).max(2).optional(), replaceExisting: z.boolean().default(true), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("apply_transition", args, id)));

  server.registerTool("remove_transition", {
    description: "Remove the video transition at a clip's start or end edge and verify that no transition remains there.",
    inputSchema: { trackItemId: z.string().min(1), position: z.enum(["start", "end"]), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("remove_transition", args, id)));

  server.registerTool("apply_video_effect", {
    description: "Add an installed video effect by stable match name, initialize optional indexed parameters, then verify the full chain. Default placement is before the unique Graphic Group on generated graphics, or at the end on ordinary media. Explicit indices are honored exactly; positions after a Graphic Group are refused before insertion. Multiple Graphic Groups require an explicit inspected position before the first group. Read fresh indices after insertion; duplicate effects remain independently addressed. Failed initialization removes only the new instance and verifies restoration. Review exported frames to verify the rendered appearance.",
    inputSchema: { ...exactEffectTarget, matchName: z.string().min(1), insertionIndex: index.describe("Optional exact position in the fresh full chain. On generated graphics choose at or before the first Graphic Group; omitted selects before a unique group, otherwise appends on ordinary media.").optional(), initialValues: values.describe("Display-name keys only; numeric indices require initialParameters with paramIndex and expectedDisplayName").optional(), initialParameters: effectParameters.optional(), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("apply_video_effect", args, id)));

  server.registerTool("apply_audio_effect", {
    description: "Add an installed audio effect by exact display name at the end or an inspected component index. Initialize optional indexed parameters (default empty animation on the new instance may become a constant), verify the chain. Failed initialization rolls back only the new effect.",
    inputSchema: { ...exactEffectTarget, displayName: z.string().min(1), insertionIndex: index.optional(), initialValues:values.describe("Keys must be parameter display names, never numeric indices; use initialParameters with paramIndex and expectedDisplayName for indexed writes").optional(),initialParameters:effectParameters.optional(), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("apply_audio_effect", args, id)));

  server.registerTool("remove_effect", {
    description: "Remove the guarded effect at an exact component index; verify its identity and the surviving effect order, observable parameter values and animation. Intrinsic Motion/Opacity/Volume are protected by default.",
    inputSchema: { ...exactEffectTarget, componentIndex: index, componentMatchName: z.string().min(1), componentDisplayName: z.string().optional(), allowIntrinsic: z.boolean().default(false), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("remove_effect", args, id)));

  server.registerTool("set_effect_values", {
    description: "Set static values using indexed parameters with expectedDisplayName or unique names. preserveEmptyAnimation explicitly permits updating a base value only when the inspected key list is empty; preserves the animation flag and all keys. Auto Reframe's static Reframe Scale change automatically verifies its native merged scale against the unchanged generated scale. Other expectedDerivedParameters declare exact before/after values Premiere computes; those are verified, never directly written. Preflight every guard before one transaction and verify requested/derived values plus untouched state. Opaque controls and existing keys remain protected.",
    inputSchema: z.object({ ...exactEffectTarget, componentIndex: index, componentMatchName: z.string().min(1).optional(), componentDisplayName: z.string().min(1).optional(), ...staticInput, preserveEmptyAnimation:z.boolean().default(false),dependencies:effectDependencies.optional().describe('Typed static Number/Point/Color links bound to the complete inspected parameter-name vector. Default mode observe asserts an existing native relationship, including its baseline equation, and never writes outputs. Explicit mode apply establishes the declared relationship by writing computed outputs in the same guarded transaction as inputs. Outputs pass native type/range/animation preflight and all actual after-values are verified. Cycles and direct-write overlap fail. This does not infer proprietary semantics.'),expectedDerivedParameters:effectParameters.refine(rows=>rows.every(p=>p.expectedValue!==undefined),"Every derived parameter requires its inspected expectedValue").optional(), operationId })
      .refine(hasStaticWrites, "Supply nonempty values or indexed parameters, exclusively"),
  }, async ({ operationId: id, ...args }) => result(await host.mutate("set_effect_values", args, id)));

  server.registerTool("set_effect_keyframes", {
    description: "Add keyframes using sequence timeSeconds or exact timeTicks. Every video clip samples each requested time through the installed read-only Adobe SDK adapter before editing (up to 64 distinct times), including reverse, constant-rate and nonlinear ramps. Missing exact samples or duplicate native times fail before dispatch. Preflight all types/times and verify exact values/interpolation. Interpolation modes refer to native source-time keys, including on reversed clips. Point insertion and temporal modes use two bounded transactions and fresh same-project save readback. Use get_effect_values with Native Read for Color samples between keys.",
    inputSchema: {
      ...exactEffectTarget,
      componentIndex: index, componentMatchName: z.string().min(1).optional(), componentDisplayName: z.string().min(1).optional(),
      keyframes: effectKeyframes, operationId,
    },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("set_effect_keyframes", args, id)));

  server.registerTool("edit_effect_keyframes", {
    description: "Replace or remove existing effect keyframes at exact sequence-time ticks only when their inspected value and interpolation still match; preflight every operation before one transaction and verify each requested result.",
    inputSchema: {
      ...exactEffectTarget,
      componentIndex: index, componentMatchName: z.string().min(1).optional(), componentDisplayName: z.string().min(1).optional(),
      operations: effectKeyframeEdits,
      disableAnimationWhenEmpty: z.boolean().default(false),
      operationId,
    },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("edit_effect_keyframes", args, id)));

  const colorAdjustments = z.object({
    temperature: z.number().finite().optional(), tint: z.number().finite().optional(), exposure: z.number().finite().optional(), contrast: z.number().finite().optional(),
    highlights: z.number().finite().optional(), shadows: z.number().finite().optional(), whites: z.number().finite().optional(), blacks: z.number().finite().optional(),
    saturation: z.number().finite().optional(), vibrance: z.number().finite().optional(), sharpen: z.number().finite().optional(), fadedFilm: z.number().finite().optional(),
    vignetteAmount: z.number().finite().optional(), vignetteMidpoint: z.number().finite().optional(), vignetteRoundness: z.number().finite().optional(), vignetteFeather: z.number().finite().optional(),
  }).refine((adjustments) => Object.values(adjustments).some((value) => value !== undefined), "At least one color adjustment is required");

  server.registerTool("apply_color_adjustments", {
    description: "Apply common Lumetri controls including temperature, exposure, contrast, highlights, shadows, whites, blacks, saturation, vibrance, sharpen, and vignette controls, with parameter readback.",
    inputSchema: { ...exactEffectTarget, componentIndex: index.optional(), componentMatchName: z.string().optional(), adjustments: colorAdjustments, parameterIndices: z.record(z.string(), index).optional(), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("apply_color_adjustments", args, id)));

  for (const [name, description] of [
    ["set_transform", "Reframe using editable Premiere Motion/Transform values while retaining source framing, timing and audio. Inspect exact component/parameter selectors, native units and animation first; use keyframe tools for existing keys. Prefer this route for later user framing adjustments instead of baking crop/rotation into media. Respect an explicit scale even if it cannot fill the frame. Verify before/after values and inspect a composited frame for composition."],
    ["set_basic_grade", "Set named Lumetri component parameters and compare before/after values."],
    ["set_audio_level", "Set named audio component parameters and compare before/after values."],
  ] as const) {
    server.registerTool(name, { description, inputSchema: z.object({ ...exactEffectTarget, componentIndex: index.optional(), componentMatchName: z.string().optional(), ...staticInput, operationId }).refine(hasStaticWrites, "Supply nonempty values or indexed parameters, exclusively") }, async ({ operationId: id, ...args }) => result(await host.mutate(name, args, id)));
  }

  server.registerTool("scale_clip_to_fill", {
    description: "Compute and verify uniform fill from Premiere's source dimensions and square source/sequence pixels. Require centered, unrotated, uncropped static Motion and no extra geometry effects. Coverage refers to source bounds; embedded black bars/transparency are not removed. Retains editable Motion and original media. Use set_transform for subject position or an explicit scale; do not substitute automatic fill for a user-specified value. Inspect the composited frame separately.",
    inputSchema: { ...exactEffectTarget, sourceWidth: z.number().finite().positive(), sourceHeight: z.number().finite().positive(), operationId },
  }, async ({ operationId: id, ...args }) => result(await host.mutate("scale_clip_to_fill", args, id)));

  for (const [name, description] of [
    ["place_voiceover", "Import and place a supplied voiceover file on the requested audio track."],
    ["place_music", "Import and place a supplied music file on the requested audio track."],
  ] as const) {
    server.registerTool(name, { description, inputSchema: { ...targetInputs, filePath: z.string(), timeSeconds: seconds, audioTrackIndex: index, binId: z.string().optional(), operationId } }, async ({ filePath, operationId: id, ...args }) => {
      try { return result(await host.mutate(name, { ...args, filePath: paths.authorizeRead(filePath).path }, id)); }
      catch (error) { return failure(error); }
    });
  }
}
