import { z } from "zod";
import { JOB_PRESERVATION_READ, isJobPreservationRead } from './read-purpose.js';
export { nativePanelForCommand, followsProjectItem, nativeVisualFeatureForCommand, nativeToolStateProves, type NativeVisualFeature, type NativeWorkPanel } from "./panel-work.js";

export const operationStatusSchema = z.enum([
  "pass",
  "partial",
  "fail",
  "unsupported",
  "unverified",
]);
export type OperationStatus = z.infer<typeof operationStatusSchema>;

export const mediaRootSchema = z.object({
  path: z.string().min(1),
  role: z.enum(["source", "proxy", "output", "scratch"]),
  access: z.enum(["readOnly", "readWrite"]),
  isNas: z.boolean(),
  allowedExtensions: z.array(z.string().regex(/^\.[a-z0-9]+$/i)),
  pathBoundary: z.enum(["enforced", "unverified"]),
});
export type MediaRoot = z.infer<typeof mediaRootSchema>;

export const pathAuthorizationSchema = z.object({
  requestedPath: z.string(),
  canonicalPath: z.string(),
  rootPath: z.string(),
  operation: z.enum(["read", "write"]),
  pathEscapeBlocked: z.boolean(),
});
export type PathAuthorization = z.infer<typeof pathAuthorizationSchema>;

export const capabilitySchema = z.object({
  name: z.string().min(1),
  supported: z.boolean(),
  minimumPremiereVersion: z.string().optional(),
  reason: z.string().optional(),
});

export const capabilitySetSchema = z.object({
  premiereVersion: z.string(),
  uxpVersion: z.string(),
  runtimeCompatibility: z.object({
    requiredPremiereVersion: z.string(),
    status: z.enum(["compatible", "incompatible", "unknown"]),
    reason: z.string().optional(),
  }),
  installedMogrtPath: z.string().optional(),
  hostContext: z.object({ activeProject: z.boolean(), activeSequence: z.boolean() }),
  read: z.array(capabilitySchema),
  write: z.array(capabilitySchema),
  unsupported: z.array(capabilitySchema),
});
export type CapabilitySet = z.infer<typeof capabilitySetSchema>;

export const tickTimeSchema = z.object({
  ticks: z.string().regex(/^\d+$/),
  seconds: z.number().finite().nonnegative(),
});
export type WireTickTime = z.infer<typeof tickTimeSchema>;

export const trackItemSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.enum(["video", "audio", "caption", "unknown"]),
  trackIndex: z.number().int().nonnegative(),
  start: tickTimeSchema,
  end: tickTimeSchema,
  inPoint: tickTimeSchema.optional(),
  outPoint: tickTimeSchema.optional(),
  disabled: z.boolean().optional(),
  projectItemId: z.string().optional(),
  speed: z.number().finite().optional(),
  reversed: z.boolean().optional(),
  adjustmentLayer: z.boolean().optional(),
});
export type TrackItemSnapshot = z.infer<typeof trackItemSnapshotSchema>;

export const timelineTrackSnapshotSchema = z.object({
  mediaType: z.enum(["video", "audio"]),
  index: z.number().int().nonnegative(),
  id: z.number().int().nonnegative(),
  name: z.string(),
  muted: z.boolean(),
  itemCount: z.number().int().nonnegative(),
  transitionCount: z.number().int().nonnegative(),
});

export const captionTrackSnapshotSchema = z.object({
  index: z.number().int().nonnegative(),
  id: z.number().int().nonnegative(),
  name: z.string(),
  muted: z.boolean(),
  itemCount: z.number().int().nonnegative().optional(),
  transitionCount: z.literal(0).default(0),
});
export type CaptionTrackSnapshot = z.infer<typeof captionTrackSnapshotSchema>;

export const transitionSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  matchName: z.string(),
  trackIndex: z.number().int().nonnegative(),
  start: tickTimeSchema,
  end: tickTimeSchema,
  duration: tickTimeSchema,
});

export const sequenceSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  frameRate: z.number().positive().optional(),
  duration: tickTimeSchema.optional(),
  videoTracks: z.number().int().nonnegative(),
  audioTracks: z.number().int().nonnegative(),
  captionTracks: z.number().int().nonnegative(),
  itemLimit: z.number().int().positive(),
  itemsTruncated: z.boolean(),
  items: z.array(trackItemSnapshotSchema),
  tracks: z.array(timelineTrackSnapshotSchema).default([]),
  captionTrackStates: z.array(captionTrackSnapshotSchema).default([]),
  transitions: z.array(transitionSnapshotSchema).default([]),
});
export type SequenceSnapshot = z.infer<typeof sequenceSnapshotSchema>;

export const projectItemSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["folder", "clip", "sequence", "unknown"]),
  path: z.string().optional(),
  parentId: z.string().optional(),
  colorLabelIndex: z.number().int().nonnegative().optional(),
  offline: z.boolean().optional(),
  hasProxy: z.boolean().optional(),
  proxyPath: z.string().optional(),
});

export const projectSnapshotSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  projectPath: z.string(),
  capturedAt: z.string().datetime(),
  activeSequence: sequenceSnapshotSchema.nullable(),
  sequences: z.array(z.object({ id: z.string(), name: z.string() })),
  projectItems: z.array(projectItemSnapshotSchema),
  projectItemLimit: z.number().int().positive(),
  projectItemsTruncated: z.boolean(),
  offlineMediaIds: z.array(z.string()),
  proxyAttachments: z.array(z.object({ projectItemId: z.string(), proxyPath: z.string() })),
  markers: z.array(z.unknown()),
  mogrtItems: z.array(z.unknown()),
  effects: z.array(z.unknown()),
  audioState: z.array(z.unknown()),
  unsupportedFields: z.array(z.object({ field: z.string(), reason: z.string() })),
});
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

export const maskSeedFrameSchema = z.object({
  status: z.literal("pass"),
  capturedAt: z.string().datetime(),
  project: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1),
    stateSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  sequence: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
  }),
  target: z.object({
    trackItemId: z.string().min(1),
    projectItemId: z.string().min(1),
    trackIndex: z.number().int().nonnegative(),
    clipStartSeconds: z.number().nonnegative(),
    clipEndSeconds: z.number().positive(),
    sourceTimeSeconds: z.number().nonnegative(),
    speed: z.number().positive(),
    reversed: z.boolean(),
  }),
  frame: z.object({
    requestedTimelineTimeSeconds: z.number().nonnegative(),
    timelineFrameIndex: z.number().int().nonnegative(),
    timelineTimeSeconds: z.number().nonnegative(),
    outputPath: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  hostReceipt: z.object({
    commandId: z.string().min(1),
    status: z.literal("pass"),
  }),
  errors: z.array(z.string()).max(0),
});
export type MaskSeedFrame = z.infer<typeof maskSeedFrameSchema>;

export const objectMaskPointSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  label: z.enum(["positive", "negative"]),
});

export const objectMaskBoxSchema = z.object({
  left: z.number().finite().nonnegative(),
  top: z.number().finite().nonnegative(),
  right: z.number().finite().positive(),
  bottom: z.number().finite().positive(),
});

export const objectMaskPromptSchema = z.object({
  coordinateSpace: z.literal("image_pixels"),
  points: z.array(objectMaskPointSchema).max(64).default([]),
  box: objectMaskBoxSchema.optional(),
}).refine((value) => value.points.some((point) => point.label === "positive") || value.box !== undefined, {
  message: "At least one positive point or a box is required",
});
export type ObjectMaskPrompt = z.infer<typeof objectMaskPromptSchema>;

export const collectedObjectMaskPromptSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pass"),
    seedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    prompt: objectMaskPromptSchema,
    collectedAt: z.string().datetime(),
  }),
  z.object({
    status: z.literal("cancelled"),
    seedSha256: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.enum(["user_cancelled", "timeout", "panel_hidden", "plugin_destroyed"]),
  }),
]);
export type CollectedObjectMaskPrompt = z.infer<typeof collectedObjectMaskPromptSchema>;

export const segmentationEngineOnlineSchema = z.object({
  status: z.literal("online"),
  service: z.literal("premiere-object-segmentation"),
  protocolVersion: z.literal("1"),
  processId: z.number().int().positive(),
  engineVersion: z.string().min(1),
  model: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    checkpointSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  device: z.object({
    kind: z.enum(["cuda", "cpu"]),
    name: z.string().min(1),
  }),
  capabilities: z.object({
    imageSegmentation: z.literal(true),
    videoTracking: z.boolean(),
    pointPrompts: z.literal(true),
    boxPrompts: z.literal(true),
  }),
});

export const segmentationEngineStatusSchema = z.discriminatedUnion("status", [
  segmentationEngineOnlineSchema,
  z.object({
    status: z.literal("offline"),
    service: z.literal("premiere-object-segmentation"),
    protocolVersion: z.literal("1"),
    endpoint: z.string().url(),
    reason: z.string().min(1),
  }),
]);
export type SegmentationEngineStatus = z.infer<typeof segmentationEngineStatusSchema>;

export const objectSegmentationRequestSchema = z.object({
  requestId: z.string().uuid(),
  objectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  expectedModel: z.string().min(1),
  seed: maskSeedFrameSchema,
  prompt: objectMaskPromptSchema,
  outputMaskPath: z.string().regex(/\.png$/i),
});
export type ObjectSegmentationRequest = z.infer<typeof objectSegmentationRequestSchema>;

export const objectSegmentationResultSchema = z.object({
  status: z.literal("pass"),
  requestId: z.string().uuid(),
  objectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  seedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  engine: segmentationEngineOnlineSchema,
  mask: z.object({
    path: z.string().regex(/\.png$/i),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    foregroundPixelCount: z.number().int().positive(),
    bounds: objectMaskBoxSchema,
    confidence: z.number().finite().min(0).max(1),
  }),
  timing: z.object({
    queuedMs: z.number().finite().nonnegative(),
    inferenceMs: z.number().finite().nonnegative(),
    totalMs: z.number().finite().nonnegative(),
  }),
  createdAt: z.string().datetime(),
});
export type ObjectSegmentationResult = z.infer<typeof objectSegmentationResultSchema>;

export const editOperationSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  expectedChange: z.string().min(1),
});

export const editPlanSchema = z.object({
  planId: z.string().min(1),
  baseProjectId: z.string().min(1),
  baseSnapshot: projectSnapshotSchema,
  baseSequenceId: z.string().optional(),
  workingProjectPath: z.string(),
  workingSequenceName: z.string().optional(),
  operations: z.array(editOperationSchema),
  expectedArtifacts: z.array(z.string()),
  preconditions: z.array(z.string()),
  requiresUserAction: z.boolean(),
  stopOnFailure: z.boolean().default(true),
});
export type EditPlan = z.infer<typeof editPlanSchema>;

const workFollowPhaseSchema = z.enum(["before_command", "after_read", "after_command"]);
export const workTargetRevealSchema = z.object({
  status: z.enum(["pass", "partial"]), phase: workFollowPhaseSchema,
  projectId: z.string(), sequenceId: z.string(), sequenceName: z.string(),
  tracks: z.array(z.object({ mediaType: z.enum(["video", "audio", "caption"]), trackIndex: z.number().int().nonnegative() })),
  itemIds: z.array(z.string()), playhead: tickTimeSchema, requestedSeconds: z.number().finite().nonnegative().optional(),
  sequenceActivation: z.literal("pass"), playheadReadback: z.literal("pass"), clipSelection: z.enum(["pass", "preserved"]),
  trackTargeting: z.enum(["pass", "preserved", "unsupported"]), trackTargetingReason: z.string(),
  trackTargetingReadback: z.record(z.string(), z.unknown()).optional(),
});
/** Automatic follow is observation only: its failure is reported beside the
 * unchanged content result (UXP work-follow FollowFailure). Before 2026-11-05 it
 * failed this schema and turned a verified clone into an unreceipted error. */
export const workFollowFailureSchema = z.object({
  status: z.literal("unverified"), phase: workFollowPhaseSchema, reason: z.string(),
});
export const workTargetSchema = z.union([workTargetRevealSchema, workFollowFailureSchema]);

export const operationReceiptSchema = z.object({
  commandId: z.string().min(1),
  command: z.string().min(1),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: operationStatusSchema,
  retryable: z.boolean().optional(),
  errorClassification: z.enum(['preflight', 'host_transient', 'postcondition']).optional(),
  actualTarget: z.unknown().optional(),
  before: z.unknown().optional(),
  hostResult: z.unknown().optional(),
  workTarget: workTargetSchema.optional(),
  after: z.unknown().optional(),
  changedFiles: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  recovery: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;

export const deliveryReportSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  container: z.string().optional(),
  codecs: z.array(z.string()).default([]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  aspectRatio: z.number().positive().optional(),
  frameRate: z.number().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  audioStreams: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative().optional(),
  blackFrameIntervals: z.array(z.object({ startSeconds: z.number().nonnegative(), endSeconds: z.number().nonnegative() })).default([]),
  silenceIntervals: z.array(z.object({ startSeconds: z.number().nonnegative(), endSeconds: z.number().nonnegative() })).default([]),
  offlineMediaCount: z.number().int().nonnegative().optional(),
  requirementResults: z.array(z.object({ requirement: z.string(), status: operationStatusSchema, actual: z.unknown().optional() })).default([]),
  status: operationStatusSchema,
  errors: z.array(z.string()).default([]),
});
export type DeliveryReport = z.infer<typeof deliveryReportSchema>;

export const bridgeRequestSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().int().positive().max(300_000).default(15_000),
  readPurpose: z.literal(JOB_PRESERVATION_READ).optional(),
}).refine(request => request.readPurpose === undefined || isJobPreservationRead(request.command, request.readPurpose),
  { message: 'Read purpose applies only to internal query_timeline verification', path: ['readPurpose'] });
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;

export const bridgeResponseSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }).optional(),
  durationMs: z.number().nonnegative(),
});
export type BridgeResponse = z.infer<typeof bridgeResponseSchema>;

const bridgeAuthBaseSchema = z.object({
  version: z.literal(1),
  type: z.literal("authenticate"),
  projectId: z.string().min(1).max(512),
  client: z.literal("premiere-uxp-panel"),
});

export const bridgeAuthRequestSchema = z.discriminatedUnion("method", [
  bridgeAuthBaseSchema.extend({
    method: z.literal("pairing_token"),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  bridgeAuthBaseSchema.extend({
    method: z.literal("project_credential"),
    credential: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  bridgeAuthBaseSchema.extend({
    method: z.literal("local_approval"),
  }),
]);
export type BridgeAuthRequest = z.infer<typeof bridgeAuthRequestSchema>;

export const bridgeAuthResponseSchema = z.object({
  version: z.literal(1),
  type: z.literal("authenticated"),
  ok: z.literal(true),
  projectId: z.string().min(1),
  credential: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  credentialIssued: z.boolean(),
});
export type BridgeAuthResponse = z.infer<typeof bridgeAuthResponseSchema>;

export const toolProfiles = ["inspect", "edit", "delivery"] as const;
export type ToolProfile = (typeof toolProfiles)[number];

export const PREMIERE_TICKS_PER_SECOND = 254_016_000_000n;

export type RationalFrameRate = Readonly<{ numerator: bigint; denominator: bigint }>;

export function assertFrameRate(rate: RationalFrameRate): void {
  if (rate.numerator <= 0n || rate.denominator <= 0n) throw new RangeError("Frame rate terms must be positive integers");
}

export function frameIndexToTickTime(frameIndex: bigint, rate: RationalFrameRate): WireTickTime {
  assertFrameRate(rate);
  if (frameIndex < 0n) throw new RangeError("Frame index must be non-negative");
  const numerator = frameIndex * PREMIERE_TICKS_PER_SECOND * rate.denominator;
  if (numerator % rate.numerator !== 0n) throw new RangeError("Frame boundary is not exactly representable in Premiere ticks");
  const ticks = numerator / rate.numerator;
  return { ticks: ticks.toString(), seconds: Number(frameIndex * rate.denominator) / Number(rate.numerator) };
}

export function tickTimeToFrameIndex(time: WireTickTime, rate: RationalFrameRate): bigint {
  assertFrameRate(rate);
  const ticks = BigInt(time.ticks);
  const numerator = ticks * rate.numerator;
  const denominator = PREMIERE_TICKS_PER_SECOND * rate.denominator;
  if (numerator % denominator !== 0n) throw new RangeError("Tick time is not on an exact frame boundary");
  return numerator / denominator;
}
