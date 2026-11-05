import { pathIsWithin } from '@premiere-uxp/contracts/local-path';
import { placementIntervalsOverlap, placementDurationTicks } from './placement-interval.js';
import { placeSourceRange } from './host-source-range-placement.js';
import { readSourceEditability } from './host-source-editability.js';
import {markContentDispatched,dispatchContent,withMutationPhase} from './host-mutation-phase.js';
import { timelineExtentSeconds } from './timeline-extent.js';
import { assertMethod, tickFromSeconds, tickOffsetFromSeconds, tickTimeFromTicks, exactTickFromSeconds, activeProject, activeSequence, inspectHostContext, assertWorkingProject, assertWorkingSequence, mutationContext, itemId, sequenceId, ppro, uxp } from "./host-context.js";
import { getAgentContext, queryTimeline, queryMedia, sourceMetadata } from "./host-agent-context.js";
import { followTimelineWork, focusWorkTarget, framePosition } from "./host-work-target.js";
import { readWorkIntent } from "./read-work-target.js";
import { workFollow, attemptFollow, followFailed } from "./work-follow.js";
import { revealProjectItem } from "./host-project-work.js";
import { HostCommandQueue } from "./host-command-queue.js";
import {inspectCaptionTrack,inspectCaptionImportCapabilities} from './host-caption-inspection.js';
import { trackLocks, trackLockConfigured } from './host-track-locks.js';
import {finalizeCaptionImport} from './host-caption-state.js';
import {withCapturePlayhead} from './capture-playhead.js';
import {hostCommandProgress,observeHostAwait,observeHostSync,type HostCommandProgress} from './host-command-progress.js';
import {inspectRippleCapabilities,inspectTimelineRipple,rippleTimeline} from './host-ripple.js';
import { TrackCommandSequences, stateErrors } from "./track-command-sequence.js";
import { readRelocationState } from "./host-track-relocation.js";
import type { TaskEvent } from "./task-activity.js";
import { TRACK_TARGETING_REASON, type WorkTarget } from "./work-target.js";
import { trackTargetingConfigured } from "./track-targeting-client.js";
import {bindCommandEditTarget,releaseCommandEditTarget} from "./command-edit-target.js";
import { queryTimelineEntries, projectItems, findProjectItemEntry, findProjectItem, trackItems, findTrackItemEntry, findTrackItemEntriesFromOneTrack, findTrackItem, timelineSelectionSnapshot, inspectTimelineSelection } from "./host-items.js";
import { sequenceSnapshot, targetSequenceSnapshot, sequenceContentSignature } from "./host-sequence.js";
import {sequenceProjectItem} from './sequence-project-item.js';
import { componentSnapshot, inspectEffectCatalog, inspectEffects } from "./host-components.js";
import { graphicComponentSnapshot, readEffectStructure, effectStructureMatches } from './host-graphic-components.js';
import { noteGraphicMutation, waitGraphicMutationQuiet } from './graphic-lifecycle.js';
import { tryCloneOneTrackBatch, type TransactionObservation } from './host-clone-batch.js';
import { readEffectProperty, writeEffectProperty } from './effect-property-lifecycle.js';
import { effectTargetLookupHint, withEffectTargetLookup } from './effect-target-lookup.js';
import { ProjectLifecycle, readOpenProjects } from './host-project-lifecycle.js';
import {effectStateProjection} from '@premiere-uxp/contracts/effect-state';
import {EffectInsertionError,planEffectInsertion,type EffectInsertionPlan} from '@premiere-uxp/contracts/effect-insertion';
import { inspectProject, inspectMarkers } from "./host-inspection.js";
import { HostCommandError, preflightValue } from "./bridge-client.js";
import {
  assessClipSplitReadback,
  assessClipSplitRecovery,
  planClipSplit,
  type ClipSplitPlan,
  type SplitTimelineItem,
} from "./clip-split.js";
import { hostNumericValuesEqual, isTransientHostObjectInvalidation } from "./component-write.js";
import { collectObjectMaskPrompt } from "./mask-prompt-controller.js";
import {revealEffectDisclosure,explicitDisclosureResult} from "./effect-disclosure.js";
import {revealParameter} from "./parameter-disclosure.js";
import {trackObjectMaskFrames} from "./mask-tracking.js";
import type {MaskTrackingPhase,MaskTrackingWork,NativeMaskWork} from "@premiere-uxp/contracts/mask-tracking";
import {firstEffectParameter,type EffectDisclosurePhase,type EffectDisclosureWork} from "@premiere-uxp/contracts/effect-disclosure";
import {isEffectValueQuery} from "@premiere-uxp/contracts/effect-disclosure";
import { snapshotKeyframeValue } from "./host-value.js";
import { parameterDisclosurePath, enrichPointAnimation, enrichEffectParameterSchema, isIntrinsicEffect, colorKeyframeConversionMatches, preflightParameterValue, effectValuesEqual, parameterWrites, preflightParameterWrites, requireReadableParameter, resolveEffectParameter, verifyEffectChainChange, verifyParameterPreservation, type ParameterWrite } from "./effect-parameter-contract.js";
import {effectVisibilityPreservation} from './effect-visibility-preservation.js';
import {deriveEffectValues} from './effect-derived-values.js';
import { trimEditPhases, type TrimEdit } from "./trim-phases.js";
import { isFrameAligned } from "./timing.js";
import { assessTimelineSelection } from "./timeline-selection.js";
import { assessLiftRemoval } from "./timeline-removal.js";
import { assessExactClipMove, exactMoveTicks, moveTicksMatch, planExactClipMove, type MoveTimelineItem } from "./timeline-move.js";
import { assessExactClipTrim, exactTrimTicks, planExactClipTrim, trimTicksMatch, type TrimTimelineItem } from "./timeline-trim.js";
import { exactTicksFromSeconds, frameTicksFromRate, snapTicksToFrameGrid } from "./tick-conversion.js";
import {
  assertLocalScratchPath, asTickTime, LOCAL_SCRATCH_ROOT, normalizeHostPath,
  PROJECT_ITEM_LIMIT, splitWindowsPath, text, TRACK_ITEM_LIMIT, type AnyRecord, WORKING_SEQUENCE_PREFIX,
} from "./host-foundation.js";
import { PANEL_ENTRYPOINT_ID, PANEL_MODE, PANEL_VERSION } from "./plugin-contract.js";
import {
  inspectPremiereFeatureRoutes,
  openAdobeTextTranscriptionWorkflow,
  PremiereFeatureRouteError,
} from "./premiere-feature-routes.js";
import { computeScaleToFill } from "./scale-to-fill.js";
import { effectTime, nativeToSequenceTime } from "./effect-time.js";

import {effectChainProofCommands,type EffectChainProofWork} from '@premiere-uxp/contracts/effect-chain-proof';
import {requestedEffectTimes,type EffectNativeSampleWork} from '@premiere-uxp/contracts/effect-native-sample';
import { equalSnapshotValue as snapshotsEqual } from "./snapshot-equality.js";
import { graphicDurationDiagnostics } from './graphic-duration-diagnostics.js';
import {assessGraphicInsertion} from "./graphic-insertion.js";
import {graphicAppendErrors,requireEmptyGraphicAppendTransitions,verifyGraphicAppendTrackStates} from './graphic-append.js';
import { assessSceneCutReadback, type SceneDetectionItem } from "./scene-edit-detection.js";
import type { BridgeRequest, HostResult } from "./wire.js";
import { assessRuntimeCompatibility } from "./runtime-compatibility.js";
import { moveClipToTrack } from "./host-track-relocation.js";
import { inspectTrackTargetingSurface } from "./host-track-targeting-probe.js";
import { nativePanelForCommand, projectWorkItemId, nativeToolStateProves, nativeVisualFeatureForCommand, type NativeWorkPanel, type NativeProjectItemTarget } from "@premiere-uxp/contracts/panel-work";
import {inspectVisualSurface} from "./host-visual-surface.js";


async function setTimelineSelection(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const actualProjectId = text(project.guid) || text(project.path) || text(project.name);
  const actualSequenceId = await sequenceId(sequence);
  if (actualProjectId !== text(args.expectedProjectId)) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", `Expected project ${text(args.expectedProjectId)}, active project is ${actualProjectId}`);
  }
  if (actualSequenceId !== text(args.expectedSequenceId) || text(sequence.name) !== text(args.expectedSequenceName)) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the exact selection target");
  }
  const requestedIds = (Array.isArray(args.trackItemIds) ? args.trackItemIds : []).map(text);
  const duplicateIds = requestedIds.filter((id, index, ids) => ids.indexOf(id) !== index);
  if (requestedIds.length === 0 || duplicateIds.length > 0) {
    throw new HostCommandError("INVALID_SELECTION_REQUEST", "Timeline selection requires unique non-empty track item IDs");
  }
  const before = await timelineSelectionSnapshot(sequence);
  const entries = await Promise.all(requestedIds.map((id) => findTrackItemEntry(sequence, id)));
  await liveTrackItemSelection(sequence, entries);
  const after = await timelineSelectionSnapshot(sequence);
  const readback = assessTimelineSelection(requestedIds, after.itemIds as string[]);
  return {
    status: readback.status,
    before,
    hostResult: { selectedItemCount: after.itemIds.length, readback },
    after,
    errors: [
      ...readback.missingIds.map((id) => `Requested timeline item is not selected: ${id}`),
      ...readback.unexpectedIds.map((id) => `Unexpected timeline item remains selected: ${id}`),
      ...readback.duplicateActualIds.map((id) => `Timeline selection returned a duplicate item: ${id}`),
    ],
  };
}

async function inspectObjectMaskState(): Promise<AnyRecord> {
  const project = await activeProject();
  const sequence = await activeSequence(project);
  assertMethod(ppro.ObjectMaskUtils, "hasObjectMask", "ObjectMaskUtils.hasObjectMask");
  return {
    projectId: text(project.guid) || text(project.path),
    sequenceId: await sequenceId(sequence),
    sequenceName: text(sequence.name),
    projectHasObjectMask: Boolean(ppro.ObjectMaskUtils.hasObjectMask(project)),
    sequenceHasObjectMask: Boolean(ppro.ObjectMaskUtils.hasObjectMask(sequence)),
    writablePublicRoutes: [],
    readbackContract: "presence-only",
  };
}

async function clipProjectItemForSpeechText(project: any, projectItemId: string): Promise<{ clip: any; snapshot: AnyRecord }> {
  const entry = await findProjectItemEntry(project, projectItemId);
  if (entry.snapshot.kind !== "clip") {
    throw new HostCommandError("SPEECH_TEXT_CLIP_REQUIRED", `Project item ${projectItemId} is not a non-sequence clip`);
  }
  let clip: any;
  try { clip = await ppro.ClipProjectItem.cast(entry.raw); }
  catch { clip = undefined; }
  if (!clip || typeof clip.isSequence !== "function" || await clip.isSequence()) {
    throw new HostCommandError("SPEECH_TEXT_CLIP_REQUIRED", `Project item ${projectItemId} is not a non-sequence clip`);
  }
  return { clip, snapshot: entry.snapshot };
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: AnyRecord = {};
  for (const key of Object.keys(record).sort()) sorted[key] = canonicalJsonValue(record[key]);
  return sorted;
}

function canonicalSpeechTextJson(json: string): string {
  if (!json || json.length > 2 * 1024 * 1024) {
    throw new HostCommandError("SPEECH_TEXT_SIZE_INVALID", "Premiere speech-text JSON is empty or exceeds the bounded host payload");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch (error) {
    throw new HostCommandError("SPEECH_TEXT_JSON_INVALID", `Premiere speech-text JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return JSON.stringify(canonicalJsonValue(parsed));
}

function speechTextSummary(json: string): AnyRecord {
  const parsed = JSON.parse(json) as AnyRecord;
  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
  const speakers = Array.isArray(parsed.speakers) ? parsed.speakers : [];
  return {
    language: text(parsed.language),
    segmentCount: segments.length,
    speakerCount: speakers.length,
    wordCount: segments.reduce((total: number, segment: AnyRecord) => total + (Array.isArray(segment?.words) ? segment.words.length : 0), 0),
  };
}

async function inspectClipSpeechText(args: AnyRecord): Promise<AnyRecord> {
  const project = await activeProject();
  const active = await project.getActiveSequence();
  const target = await clipProjectItemForSpeechText(project, text(args.projectItemId));
  assertMethod(ppro.Transcript, "hasTranscript", "Transcript.hasTranscript");
  const hasSpeechText = Boolean(await Promise.resolve(ppro.Transcript.hasTranscript(target.clip)));
  let transcriptJson: string | undefined;
  if (hasSpeechText) {
    assertMethod(ppro.Transcript, "exportToJSON", "Transcript.exportToJSON");
    transcriptJson = text(await ppro.Transcript.exportToJSON(target.clip));
    canonicalSpeechTextJson(transcriptJson);
  }
  return {
    status: "pass",
    project: { id: text(project.guid), name: text(project.name), path: text(project.path) },
    activeSequence: active ? { id: await sequenceId(active), name: text(active.name) } : null,
    projectItem: { id: target.snapshot.id, name: target.snapshot.name, kind: target.snapshot.kind, path: target.snapshot.path },
    hasSpeechText,
    api: "premierepro.Transcript",
    ...(transcriptJson === undefined ? {} : { transcriptJson }),
  };
}

function exactSpeechTextTargetMatches(
  project: any,
  sequence: any,
  projectItem: AnyRecord,
  args: AnyRecord,
): Promise<boolean> {
  return sequenceId(sequence).then((activeSequenceId) => text(project.guid) === text(args.expectedProjectId)
    && normalizeHostPath(text(project.path)) === normalizeHostPath(text(args.expectedProjectPath))
    && activeSequenceId === text(args.expectedSequenceId)
    && text(sequence.name) === text(args.expectedSequenceName)
    && text(projectItem.id) === text(args.projectItemId)
    && text(projectItem.name) === text(args.expectedProjectItemName));
}

async function importClipSpeechText(args: AnyRecord): Promise<HostResult> {
  let current = await mutationContext(args);
  let target = await clipProjectItemForSpeechText(current.project, text(args.projectItemId));
  if (!await exactSpeechTextTargetMatches(current.project, current.sequence, target.snapshot, args)) {
    throw new HostCommandError("ACTIVE_TARGET_MISMATCH", "Premiere speech-text import target differs from the exact project, sequence, or clip preconditions");
  }
  if (args.expectedHasSpeechText !== false) {
    throw new HostCommandError("INVALID_SPEECH_TEXT_PRECONDITION", "Speech-text import requires expectedHasSpeechText=false");
  }
  assertMethod(ppro.Transcript, "hasTranscript", "Transcript.hasTranscript");
  assertMethod(ppro.Transcript, "importFromJSON", "Transcript.importFromJSON");
  assertMethod(ppro.Transcript, "createImportTextSegmentsAction", "Transcript.createImportTextSegmentsAction");
  assertMethod(ppro.Transcript, "exportToJSON", "Transcript.exportToJSON");
  const beforeHasSpeechText = Boolean(await Promise.resolve(ppro.Transcript.hasTranscript(target.clip)));
  const before = {
    projectId: text(current.project.guid),
    projectPath: text(current.project.path),
    sequenceId: await sequenceId(current.sequence),
    sequenceName: text(current.sequence.name),
    projectItem: { id: target.snapshot.id, name: target.snapshot.name, kind: target.snapshot.kind },
    hasSpeechText: beforeHasSpeechText,
  };
  if (beforeHasSpeechText) {
    throw new HostCommandError("SPEECH_TEXT_ALREADY_EXISTS", "The target clip already has speech text; overwrite is intentionally unsupported");
  }

  const requestedJson = text(args.transcriptJson);
  const requestedCanonical = canonicalSpeechTextJson(requestedJson);
  const hostResult = executeTransaction(current.project, `Import speech text for ${text(target.snapshot.name)}`, () => [
    ppro.Transcript.createImportTextSegmentsAction(ppro.Transcript.importFromJSON(requestedJson), target.clip),
  ]);
  if (!hostResult) {
    return { status: "fail", before, hostResult: { transaction: false }, errors: ["Premiere rejected the public Transcript import transaction"] };
  }

  let lastAfter: AnyRecord | undefined;
  try {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      current = await mutationContext(args);
      target = await clipProjectItemForSpeechText(current.project, text(args.projectItemId));
      const identityMatches = await exactSpeechTextTargetMatches(current.project, current.sequence, target.snapshot, args);
      if (!identityMatches) {
        return {
          status: "unverified",
          before,
          hostResult: { transaction: true, readbackAttempts: attempt },
          after: { targetPreserved: false },
          errors: ["The active Premiere target changed before speech-text readback completed"],
          recovery: "Inspect the target clip before retrying; the import transaction may already have succeeded.",
        };
      }
      const hasSpeechText = Boolean(await Promise.resolve(ppro.Transcript.hasTranscript(target.clip)));
      let exportedJson: string | undefined;
      let equivalent = false;
      if (hasSpeechText) {
        exportedJson = text(await ppro.Transcript.exportToJSON(target.clip));
        equivalent = canonicalSpeechTextJson(exportedJson) === requestedCanonical;
      }
      lastAfter = {
        projectId: text(current.project.guid),
        projectPath: text(current.project.path),
        sequenceId: await sequenceId(current.sequence),
        sequenceName: text(current.sequence.name),
        projectItem: { id: target.snapshot.id, name: target.snapshot.name, kind: target.snapshot.kind },
        hasSpeechText,
        equivalent,
        ...(exportedJson ? { speechText: speechTextSummary(exportedJson) } : {}),
      };
      if (equivalent) {
        return {
          status: "pass",
          before,
          hostResult: { transaction: true, readbackAttempts: attempt, api: "premierepro.Transcript" },
          after: lastAfter,
          errors: [],
        };
      }
      if (attempt < 20) await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    return {
      status: "unverified",
      before,
      hostResult: { transaction: true },
      after: lastAfter,
      errors: [`Speech-text import was dispatched, but readback failed: ${error instanceof Error ? error.message : String(error)}`],
      recovery: "Inspect the target clip before retrying; the import transaction may already have succeeded.",
    };
  }
  return {
    status: lastAfter?.hasSpeechText ? "partial" : "fail",
    before,
    hostResult: { transaction: true, readbackAttempts: 20, api: "premierepro.Transcript" },
    after: lastAfter,
    errors: [lastAfter?.hasSpeechText
      ? "Premiere created speech text, but exportToJSON did not match the requested official document"
      : "Premiere did not expose imported speech text within the bounded readback window"],
    recovery: "Inspect the exact clip in Premiere before deciding whether a new import is necessary.",
  };
}

async function openNativeTranscriptionWorkflow(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const before = {
    projectId: text(project.guid),
    projectPath: text(project.path),
    sequenceId: await sequenceId(sequence),
    sequenceName: text(sequence.name),
  };
  const expected = {
    projectId: text(args.expectedProjectId),
    projectPath: text(args.expectedProjectPath),
    sequenceId: text(args.expectedSequenceId),
    sequenceName: text(args.expectedSequenceName),
  };
  const targetMatches = before.projectId === expected.projectId
    && normalizeHostPath(before.projectPath) === normalizeHostPath(expected.projectPath)
    && before.sequenceId === expected.sequenceId
    && before.sequenceName === expected.sequenceName;
  if (!targetMatches) {
    throw new HostCommandError("ACTIVE_TARGET_MISMATCH", "Adobe Text transcription target differs from the exact active project or sequence");
  }
  if (!before.projectId || !before.sequenceId) {
    throw new HostCommandError("MISSING_TARGET_GUID", "Adobe Text transcription requires Premiere project and sequence GUIDs");
  }

  let hostResult;
  try {
    hostResult = await openAdobeTextTranscriptionWorkflow(uxp.pluginManager, {
      projectGuid: before.projectId,
      sequenceGuid: before.sequenceId,
    });
  } catch (error) {
    if (error instanceof PremiereFeatureRouteError) throw new HostCommandError(error.code, error.message);
    throw error;
  }

  const afterProject = await activeProject();
  const afterSequence = await activeSequence(afterProject);
  const after = {
    projectId: text(afterProject.guid),
    projectPath: text(afterProject.path),
    sequenceId: await sequenceId(afterSequence),
    sequenceName: text(afterSequence.name),
  };
  const targetPreserved = after.projectId === before.projectId
    && normalizeHostPath(after.projectPath) === normalizeHostPath(before.projectPath)
    && after.sequenceId === before.sequenceId
    && after.sequenceName === before.sequenceName;
  return {
    status: targetPreserved ? "partial" : "unverified",
    before,
    hostResult,
    after,
    errors: targetPreserved
      ? ["Adobe Text accepted the panel and transcription workflow IPC requests; transcript creation and timeline mutation are not implied until separately read back"]
      : ["Adobe Text accepted the IPC request, but the active Premiere target changed before identity readback"],
    recovery: "Inspect the Adobe Text panel for its transcription-options workflow. Do not replay this operation after a timeout or unverified result without first inspecting Premiere state.",
  };
}

type ActionFactory = () => any[];

/** Construct and consume Actions in one nested transaction callback, narrowing
 * their lifetime within the supported lockedAccess/executeTransaction scope. */
function executeTransaction(project: any, label: string, createActions: ActionFactory, observe?: (event: TransactionObservation) => void): boolean {
  assertMethod(project, "lockedAccess", "Project.lockedAccess");
  assertMethod(project, "executeTransaction", "Project.executeTransaction");
  let result = false;
  const notify = (event: TransactionObservation) => { try { observe?.(event); } catch { /* Diagnostic observers cannot affect native edits. */ } };
  try { project.lockedAccess(() => {
    notify({phase:'locked_enter'});
    let actionCount: number | undefined;
    markContentDispatched();
    try {
      notify({phase:'execute_enter'});
      result = project.executeTransaction((compound: any) => {
        notify({phase:'callback_enter'});
        const actions = createActions();
        actionCount = actions.length;
        notify({phase:'actions_created',count:actionCount});
        for (const [index,action] of actions.entries()) {
          notify({phase:'add_action_enter',ordinal:index+1,count:actionCount});
          compound.addAction(action);
          notify({phase:'add_action_exit',ordinal:index+1,count:actionCount});
        }
        notify({phase:'callback_exit',count:actionCount});
      }, label);
      notify({phase:'execute_exit',...(actionCount===undefined?{}:{count:actionCount})});
      if(actionCount===0)result=true;
    } catch(error) { notify({phase:'execute_throw'}); throw error;
    } finally { noteGraphicMutation(); }
  }); notify({phase:'locked_exit'});
  } catch(error) { notify({phase:'locked_throw'}); throw error; }
  return result;
}

/**
 * Native editors must receive the active sequence's live selection object.
 * A detached TrackItemSelection created by the static callback can accept an
 * item and still be rejected or invalidated when consumed by Premiere 26.x.
 * Mutating the live group can change getIsSelected() without publishing the
 * timeline highlight. Commit it through Sequence.setSelection, then reacquire
 * the group because that commit can invalidate the previously held wrapper.
 */
async function liveTrackItemSelection(
  sequence: any,
  entries: Array<{ raw: any; snapshot: AnyRecord }>,
): Promise<any> {
  assertMethod(sequence, "clearSelection", "Sequence.clearSelection");
  assertMethod(sequence, "getSelection", "Sequence.getSelection");
  assertMethod(sequence, "setSelection", "Sequence.setSelection");
  await sequence.clearSelection();
  const selection = await sequence.getSelection();
  if (!selection) throw new HostCommandError("SELECTION_CREATE_FAILED", "Premiere did not return the sequence's live track item selection");
  assertMethod(selection, "addItem", "TrackItemSelection.addItem");
  assertMethod(selection, "getTrackItems", "TrackItemSelection.getTrackItems");
  for (const entry of entries) {
    if (!selection.addItem(entry.raw, true)) {
      await sequence.clearSelection();
      throw new HostCommandError("SELECTION_ADD_FAILED", `Premiere rejected the live sequence selection: ${text(entry.snapshot.id)}`);
    }
  }
  const selectedItems = await selection.getTrackItems();
  if (selectedItems.length !== entries.length) {
    await sequence.clearSelection();
    throw new HostCommandError("SELECTION_READBACK_MISMATCH", `Premiere selected ${selectedItems.length} of ${entries.length} requested timeline items`);
  }
  if (!await sequence.setSelection(selection)) {
    throw new HostCommandError("SELECTION_APPLY_FAILED", "Premiere rejected applying the timeline selection");
  }
  const applied = await sequence.getSelection();
  if (!applied || (await applied.getTrackItems()).length !== entries.length) {
    throw new HostCommandError("SELECTION_READBACK_MISMATCH", "Applied timeline selection differs from the requested selection");
  }
  return applied;
}

function toHostValue(value: unknown): unknown {
  const requested = value as AnyRecord;
  return requested?.kind === "point"
    ? ppro.PointF(Number(requested.x), Number(requested.y))
    : requested?.kind === "color"
      ? ppro.Color(Number(requested.red), Number(requested.green), Number(requested.blue), Number(requested.alpha ?? 1))
      : value;
}

function componentMatches(component: AnyRecord, selector: AnyRecord | undefined): boolean {
  if (!selector) return true;
  if (selector.componentIndex != null && Number(component.componentIndex) !== Number(selector.componentIndex)) return false;
  if (selector.componentMatchName != null && text(component.matchName).toLocaleLowerCase("en-US") !== text(selector.componentMatchName).toLocaleLowerCase("en-US")) return false;
  if (selector.componentDisplayName != null && text(component.displayName).toLocaleLowerCase("en-US") !== text(selector.componentDisplayName).toLocaleLowerCase("en-US")) return false;
  return true;
}

function checkedNativeKeyframe(param:any,value:unknown):any {
  const keyframe=param.createKeyframe(toHostValue(value));
  if((value as AnyRecord)?.kind==="color" && !colorKeyframeConversionMatches(snapshotKeyframeValue(keyframe),value))
    throw new HostCommandError("UNSUPPORTED_API","NATIVE_COLOR_PRECISION_LOSS: Premiere's observable Color-to-Keyframe conversion changes the requested RGBA channels. This value is unsupported by the current conversion route; alpha is preserved, never forced to zero. Other RGBA values may be exactly representable.");
  if((value as AnyRecord)?.kind==="point" && !effectValuesEqual(snapshotKeyframeValue(keyframe),value))
    throw new HostCommandError("UNSUPPORTED_API","NATIVE_POINT_CONVERSION_UNVERIFIED: the effect cannot encode this point without changing coordinates");
  return keyframe;
}

async function setComponentValues(project: any, item: any, values: Record<string, unknown> | ParameterWrite[], selector?: AnyRecord, baseline?: AnyRecord[],preserveEmptyAnimation=false): Promise<{ changed: string[]; missing: string[]; animated: string[]; transaction: boolean; targets: Array<{ componentIndex: number; paramIndex: number }> }> {
  const writes: ParameterWrite[] = Array.isArray(values) ? values : Object.entries(values).map(([parameterName, value]) => ({ parameterName, value }));
  const snapshots = baseline ?? await componentSnapshot(item);
  const selected = snapshots.filter(c => componentMatches(c, selector));
  const groups = new Map<number, ParameterWrite[]>();
  // Resolve ALL names/indices and animation state before constructing an action.
  for (const write of writes) {
    const matches = selected.filter(c => (c.params as AnyRecord[]).some(p => write.paramIndex !== undefined ? p.paramIndex === write.paramIndex : text(p.displayName).toLocaleLowerCase("en-US") === text(write.parameterName).toLocaleLowerCase("en-US")));
    if (matches.length !== 1) throw new HostCommandError("PARAMETER_TARGET_AMBIGUOUS_OR_MISSING", `Parameter ${write.parameterName ?? write.paramIndex} needs one exact component`);
    const componentIndex = Number(matches[0]!.componentIndex);
    groups.set(componentIndex, [...(groups.get(componentIndex) ?? []), write]);
  }
  const planned = [...groups].flatMap(([componentIndex, requests]) => preflightParameterWrites(snapshots.find(c => c.componentIndex === componentIndex)!, requests,false,preserveEmptyAnimation).map(p => ({ ...p, componentIndex })));
  const changedPlans = planned.filter(p => !hostValuesEqual(p.snapshot.value, p.write.value));
  const chain = changedPlans.length ? await item.getComponentChain() : null;
  const changed = changedPlans.map(p => `${p.componentIndex}:${p.snapshot.paramIndex}:${p.snapshot.displayName}`);
  // Validate every conversion before dispatch, but retain no temporary native
  // keyframe/parameter proxy across lockedAccess. Premiere invalidates these
  // wrappers when entering its action construction window on some filters.
  for(const p of changedPlans)checkedNativeKeyframe(chain.getComponentAtIndex(p.componentIndex).getParam(p.snapshot.paramIndex),p.write.value);
  let transaction:boolean;
  try { transaction = !changedPlans.length || executeTransaction(project, `Set component values: ${changed.join(", ")}`, () => changedPlans.map(p => {
    const param=chain.getComponentAtIndex(p.componentIndex).getParam(p.snapshot.paramIndex),keyframe=checkedNativeKeyframe(param,p.write.value);
    // Static preflight proved false, or an explicit empty-key base-value write.
    // This action never disables animation; all flags/keys are read back.
    return param.createSetValueAction(keyframe, true);
  })); } catch(error) { throw new HostCommandError("EFFECT_DISPATCH_UNVERIFIED",`Value transaction may have applied: ${String(error)}`); }
  return { changed, missing: [], animated: [], transaction, targets: planned.map(p => ({ componentIndex: p.componentIndex, paramIndex: p.snapshot.paramIndex })) };
}

function hostValuesEqual(actual: unknown, expected: unknown): boolean {
  return effectValuesEqual(actual, expected);
}

function componentValuesMatch(components: AnyRecord[], values: Record<string, unknown> | ParameterWrite[], selector?: AnyRecord,preserveEmptyAnimation=false): { matched: string[]; mismatched: string[]; missing: string[] } {
  const parameters = components.filter((component) => componentMatches(component, selector)).flatMap((component) => component.params ?? []);
  const matched: string[] = [];
  const mismatched: string[] = [];
  const missing: string[] = [];
  for (const request of Array.isArray(values) ? values : Object.entries(values).map(([parameterName, value]) => ({ parameterName, value } as ParameterWrite))) {
    const name = request.parameterName ?? `parameter ${request.paramIndex}`;
    let parameter;
    try { parameter = resolveEffectParameter({ params: parameters }, request); requireReadableParameter(parameter, true,preserveEmptyAnimation); }
    catch { missing.push(name); continue; }
    const actual = parameter.value;
    const equal = hostValuesEqual(actual, request.value);
    (equal ? matched : mismatched).push(name);
  }
  return { matched, mismatched, missing };
}

async function createWorkingCopy(args: AnyRecord): Promise<HostResult> {
  const {project} = await mutationContext(args);
  assertMethod(project, "saveAs", "Project.saveAs");
  const outputPath = text(args.outputPath);
  assertLocalScratchPath(outputPath, ".prproj");
  const before = { projectId: text(project.guid), path: text(project.path) };
  const hostResult = await dispatchContent(()=>project.saveAs(outputPath));
  const afterProject = await activeProject();
  const after = { projectId: text(afterProject.guid), path: text(afterProject.path) };
  const pass = Boolean(hostResult) && normalizeHostPath(after.path) === normalizeHostPath(outputPath);
  return { status: pass ? "pass" : "fail", before, hostResult, after, changedFiles: pass ? [outputPath] : [], errors: pass ? [] : ["Project Save As did not read back the requested local path"] };
}

async function renameSequenceProjectItem(project: any, sequence: any, newName: string): Promise<boolean> {
  const item=await sequenceProjectItem(sequence);
  return executeTransaction(project, `Rename working sequence to ${newName}`, () => [item.createSetNameAction(newName)]);
}

async function activateSequence(args: AnyRecord): Promise<HostResult> {
  const {project} = await mutationContext(args);
  assertWorkingProject(project);
  const requestedName = text(args.name);
  const sequences = await project.getSequences();
  const matches=[];
  for(const sequence of sequences)if(text(sequence.name)===requestedName&&(!args.sequenceId||await sequenceId(sequence)===args.sequenceId))matches.push(sequence);
  if (!matches.length) throw new HostCommandError("SEQUENCE_NOT_FOUND", "Sequence not found: " + requestedName);
  if (matches.length > 1) throw new HostCommandError("SEQUENCE_NAME_AMBIGUOUS", "Multiple sequences are named " + requestedName);
  const beforeSequence = await activeSequence(project);
  const before = { id: await sequenceId(beforeSequence), name: text(beforeSequence.name) };
  assertMethod(project, "openSequence", "Project.openSequence");
  assertMethod(project, "setActiveSequence", "Project.setActiveSequence");
  // setActiveSequence() changes the project model, but Premiere can keep showing
  // the previously focused timeline tab. openSequence() is the public UXP call
  // that makes the requested sequence visible in the application workspace.
  const opened = await project.openSequence(matches[0]);
  const activated = await project.setActiveSequence(matches[0]);
  const afterSequence = await activeSequence(project);
  const after = { id: await sequenceId(afterSequence), name: text(afterSequence.name) };
  const pass = Boolean(opened) && Boolean(activated) && after.name === requestedName && after.id === await sequenceId(matches[0]);
  return {
    status: pass ? "pass" : "fail",
    before,
    hostResult: { opened, activated },
    after,
    errors: pass ? [] : ["Requested sequence was not opened visibly and read back as active"],
  };
}

async function duplicateWorkingSequence(args: AnyRecord): Promise<HostResult> {
  let stage = "read active project";
  try {
    const {project,sequence:source} = await mutationContext(args);
    stage = "read source sequence";
    const beforeSequences = await project.getSequences();
    const requestedName = text(args.name) || `${WORKING_SEQUENCE_PREFIX}${text(source.name)}`;

    if (beforeSequences.some((sequence: any) => text(sequence.name) === requestedName)) throw new HostCommandError("SEQUENCE_ALREADY_EXISTS", `Sequence already exists: ${requestedName}`);
    const beforeIds = new Set(await Promise.all(beforeSequences.map((sequence: any) => sequenceId(sequence))));
    const before = { source: await sequenceSnapshot(source), sequenceCount: beforeSequences.length };
    assertMethod(source, "createCloneAction", "Sequence.createCloneAction");
    const sourceName = text(source.name);

    stage = "execute clone transaction";
    const cloneTransaction = executeTransaction(project, `Clone sequence ${sourceName}`, () => [source.createCloneAction()]);
    stage = "reacquire project after clone";
    const projectAfterClone = (await mutationContext(args)).project;
    const afterSequences = await projectAfterClone.getSequences();
    const createdCandidates = [];
    for (const sequence of afterSequences) if (!beforeIds.has(await sequenceId(sequence))) createdCandidates.push(sequence);
    if(createdCandidates.length>1)throw new HostCommandError('SEQUENCE_CLONE_AMBIGUOUS','Multiple new sequences observed after clone; inspect current sequences without replay');
    const created = createdCandidates[0];
    if (!cloneTransaction || !created) return { status: "fail", before, hostResult: cloneTransaction, errors: ["Premiere clone transaction did not produce a new sequence"] };
    const createdId = await sequenceId(created);

    stage = "rename cloned sequence";
    let renameResult=false,renameError:string|undefined;
    try { renameResult=await renameSequenceProjectItem(projectAfterClone,created,requestedName); }
    catch(error) { renameError=String(error); }
    stage = "reacquire sequence after rename";
    const projectAfterRename = (await mutationContext(args)).project;
    let createdAfterRename: any;
    for (const sequence of await projectAfterRename.getSequences()) {
      if (await sequenceId(sequence) === createdId) {
        createdAfterRename = sequence;
        break;
      }
    }
    if (!createdAfterRename) throw new HostCommandError("SEQUENCE_CLONE_NOT_FOUND", "Cloned sequence disappeared after rename transaction");
    await projectAfterRename.setActiveSequence(createdAfterRename);
    const after = await sequenceSnapshot(createdAfterRename);
    const preserved=sequenceContentSignature(after)===sequenceContentSignature(before.source);
    const pass=text(after.name)===requestedName&&preserved;
    return { status:pass?'pass':preserved?'partial':'unverified',before,
      hostResult:{cloneTransaction,created:true,createdSequenceId:createdId,renamed:renameResult,contentDispatched:true,...(renameError?{renameError}:{})},after,
      errors:pass?[]:['Sequence was created; its name or content preservation did not meet the requested postcondition'],
      ...(!pass?{recovery:'Do not clone again. Inspect the exact after.id sequence and its associated project item; archive the inactive root operation if needed, then correct only its name or the observed difference.'}:{}) };
  } catch (error) {
    if (error instanceof HostCommandError) throw error;
    throw new HostCommandError("SEQUENCE_CLONE_FAILED", `${stage}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createBin(args: AnyRecord): Promise<HostResult> {
  const { project } = await mutationContext(args);
  const name = text(args.name);
  const root = await project.getRootItem();
  // FolderItem is an action/children interface, not ProjectItem identity.
  // Its cast proxy may expose only a localized name, without getId/guid.
  const parentEntry=args.parentBinId?await findProjectItemEntry(project,text(args.parentBinId)):undefined;
  const target = parentEntry ? await ppro.FolderItem.cast(parentEntry.raw) : root;
  const targetId = parentEntry?.snapshot.id ?? await itemId(root);
  const children = await target.getItems();
  const beforeIds = new Set<string>();
  for(const child of children) {
    beforeIds.add(await itemId(child));
    if(text(child.name)===name)throw new HostCommandError('BIN_ALREADY_EXISTS', 'A child already has that name; query_media with binId before choosing a new name', {contentDispatched:false,retryable:false,errorClassification:'preflight'});
  }
  assertMethod(target, 'createBinAction', 'FolderItem.createBinAction');
  const hostResult = executeTransaction(project, 'Create bin '+name, () => [target.createBinAction(name, true)]);
  const readbackProject = (await mutationContext(args)).project;
  const freshParentEntry=parentEntry?await findProjectItemEntry(readbackProject,targetId):undefined;
  const freshParent = freshParentEntry ? await ppro.FolderItem.cast(freshParentEntry.raw) : await readbackProject.getRootItem();
  if((freshParentEntry?.snapshot.id??await itemId(freshParent))!==targetId)throw Error('BIN_PARENT_CHANGED_AFTER_DISPATCH');
  const matches:AnyRecord[]=[];
  for(const child of await freshParent.getItems()) {
    const id=await itemId(child);
    if(beforeIds.has(id)||text(child.name)!==name)continue;
    const folder=await ppro.FolderItem.cast(child);
    if(folder)matches.push({id,name,parentId:targetId,kind:'folder'});
  }
  const pass=Boolean(hostResult)&&matches.length===1;
  return {status:pass?'pass':'unverified',before:{parentId:targetId,childIds:[...beforeIds]},hostResult,after:matches.length===1?matches[0]:{candidates:matches},errors:pass?[]:['BIN_CREATION_READBACK_UNVERIFIED: inspect query_media with binId; do not recreate until exact new child ID is identified']};
}

async function renameProjectItems(args: AnyRecord): Promise<HostResult> {
  const {project} = await mutationContext(args);
  const renames = Array.isArray(args.renames) ? args.renames : [];
  const prepared:Array<{entry:Awaited<ReturnType<typeof findProjectItemEntry>>;name:string}> = [];
  let readbackArgs=args;
  for(const rename of renames) {
    const entry = await findProjectItemEntry(project,text(rename.projectItemId));
    assertMethod(entry.raw, "createSetNameAction", "ProjectItem.createSetNameAction");
    if(entry.snapshot.kind==='sequence'){
      const clip=await ppro.ClipProjectItem.cast(entry.raw);
      const sequence=await clip.getSequence();
      // Renaming this exact pinned sequence changes our own name precondition.
      // Keep both ID pins and check the intended new name after the transaction.
      if(await sequenceId(sequence)===args.expectedSequenceId)readbackArgs={...args,expectedSequenceName:text(rename.name)};
    }
    prepared.push({ entry, name: text(rename.name) });
  }
  const hostResult = executeTransaction(project, `Rename ${prepared.length} project items`, () => prepared.map(({ entry, name }) => entry.raw.createSetNameAction(name)));
  const freshProject=(await mutationContext(readbackArgs)).project;
  const afterItems:Awaited<ReturnType<typeof findProjectItemEntry>>[] = [];
  for(const {entry} of prepared)afterItems.push(await findProjectItemEntry(freshProject,entry.snapshot.id));
  const mismatches = prepared.filter(({ entry, name }) => !afterItems.some((item) => item.snapshot.id === entry.snapshot.id && item.snapshot.name === name));
  const pass = hostResult && mismatches.length === 0;
  return { status: pass ? "pass" : "fail", before: prepared.map(({ entry }) => entry.snapshot), hostResult, after: prepared.map(({ entry }) => afterItems.find((item) => item.snapshot.id === entry.snapshot.id)?.snapshot), errors: mismatches.map(({ entry }) => `Renamed project item did not read back: ${entry.snapshot.id}`) };
}

async function moveProjectItems(args: AnyRecord): Promise<HostResult> {
  const {project} = await mutationContext(args);
  const ids = Array.isArray(args.projectItemIds) ? args.projectItemIds.map(text) : [];
  const targetEntry = await findProjectItemEntry(project, text(args.targetBinId));
  const target = await ppro.FolderItem.cast(targetEntry.raw);
  const prepared:Awaited<ReturnType<typeof findProjectItemEntry>>[] = [];
  for(const id of ids) {
    const entry = await findProjectItemEntry(project,id);
    if (!entry?.parentRaw) throw new HostCommandError("PROJECT_ITEM_PARENT_NOT_FOUND", `Project item parent was not found: ${id}`);
    assertMethod(entry.parentRaw, "createMoveItemAction", "FolderItem.createMoveItemAction");
    prepared.push(entry);
  }
  const hostResult = executeTransaction(project, `Move ${prepared.length} project items`, () => prepared.map((entry) => entry.parentRaw.createMoveItemAction(entry.raw, target)));
  const freshProject=(await mutationContext(args)).project;
  const afterItems:Awaited<ReturnType<typeof findProjectItemEntry>>[] = [];
  for(const id of ids)afterItems.push(await findProjectItemEntry(freshProject,id));
  const mismatches = ids.filter((id) => !afterItems.some((item) => item.snapshot.id === id && item.snapshot.parentId === targetEntry.snapshot.id));
  const pass = hostResult && mismatches.length === 0;
  return { status: pass ? "pass" : "fail", before: prepared.map((entry) => entry.snapshot), hostResult, after: ids.map((id) => afterItems.find((item) => item.snapshot.id === id)?.snapshot), errors: mismatches.map((id) => `Moved project item did not read back in target bin: ${id}`) };
}

async function setProjectItemLabels(args: AnyRecord): Promise<HostResult> {
  const {project} = await mutationContext(args);
  assertWorkingProject(project);
  const labels = Array.isArray(args.labels) ? args.labels : [];
  const beforeItems = await projectItems(project);
  const prepared = labels.map((label) => {
    const entry = beforeItems.find((item) => item.snapshot.id === text(label.projectItemId));
    if (!entry) throw new HostCommandError("PROJECT_ITEM_NOT_FOUND", `Project item not found: ${text(label.projectItemId)}`);
    assertMethod(entry.raw, "createSetColorLabelAction", "ProjectItem.createSetColorLabelAction");
    return { entry, colorLabelIndex: Number(label.colorLabelIndex) };
  });
  const hostResult = executeTransaction(project, `Label ${prepared.length} project items`, () => prepared.map(({ entry, colorLabelIndex }) => entry.raw.createSetColorLabelAction(colorLabelIndex)));
  const afterItems = await projectItems((await mutationContext(args)).project, Infinity);
  const mismatches = prepared.filter(({ entry, colorLabelIndex }) => !afterItems.some((item) => item.snapshot.id === entry.snapshot.id && item.snapshot.colorLabelIndex === colorLabelIndex));
  const pass = hostResult && mismatches.length === 0;
  return { status: pass ? "pass" : "fail", before: prepared.map(({ entry }) => entry.snapshot), hostResult, after: prepared.map(({ entry }) => afterItems.find((item) => item.snapshot.id === entry.snapshot.id)?.snapshot), errors: mismatches.map(({ entry }) => `Project item label did not read back: ${entry.snapshot.id}`) };
}

async function importMedia(args: AnyRecord): Promise<HostResult> {
  let contentDispatched=false;
  try {
  const { project } = await mutationContext(args);
  assertMethod(project, "importFiles", "Project.importFiles");
  const paths = Array.isArray(args.filePaths) ? args.filePaths.map(text) : [];
  const before = (await projectItems(project, Infinity)).map((item) => item.snapshot);
  const existingPaths = new Set(before.flatMap((item) => item.path ? [normalizeHostPath(item.path)] : []));
  const newPaths = paths.filter((candidate) => !existingPaths.has(normalizeHostPath(candidate)));
  if (!newPaths.length) return { status: "pass", before: { count: before.length }, hostResult: { imported: [], skippedAlreadyImported: paths }, after: { count: before.length, imported: [] }, errors: [] };
  let target = await project.getRootItem();
  if (args.binId) target = await findProjectItem(project, text(args.binId));
  contentDispatched=true;
  const hostResult = await dispatchContent(()=>project.importFiles(newPaths, true, target, false));
  const readbackProject = (await mutationContext(args)).project;
  const after = (await projectItems(readbackProject, Infinity)).map((item) => item.snapshot);
  const importedPaths = new Set(after.flatMap((item) => item.path ? [normalizeHostPath(item.path)] : []));
  const missing = newPaths.filter((candidate) => !importedPaths.has(normalizeHostPath(candidate)));
  const pass = Boolean(hostResult) && missing.length === 0;
  return { status: pass ? "pass" : "fail", before: { count: before.length }, hostResult: { returned: hostResult, skippedAlreadyImported: paths.filter((candidate) => existingPaths.has(normalizeHostPath(candidate))) }, after: { count: after.length, imported: newPaths.filter((p) => !missing.includes(p)), importedItems: after.filter(item => !before.some(old => old.id===item.id) && item.path && newPaths.some(p=>normalizeHostPath(p)===normalizeHostPath(item.path))) }, errors: missing.map((p) => `Imported path missing from project readback: ${p}`) };
  } catch(error) {
    if(contentDispatched)throw error;
    return {status:'fail',hostResult:{contentDispatched:false},errors:[String(error)]};
  }
}

async function attachProxy(args: AnyRecord): Promise<HostResult> {
  const { project } = await mutationContext(args);
  const projectItem = await findProjectItem(project, text(args.projectItemId));
  const clip = await ppro.ClipProjectItem.cast(projectItem);
  assertMethod(clip, "attachProxy", "ClipProjectItem.attachProxy");
  const before = { hasProxy: Boolean(await clip.hasProxy()), proxyPath: text(await clip.getProxyPath()) };
  const hostResult = await dispatchContent(()=>clip.attachProxy(text(args.proxyPath), false, false));
  const after = { hasProxy: Boolean(await clip.hasProxy()), proxyPath: text(await clip.getProxyPath()) };
  const pass = Boolean(hostResult) && after.hasProxy && normalizeHostPath(after.proxyPath) === normalizeHostPath(text(args.proxyPath));
  return { status: pass ? "pass" : "fail", before, hostResult, after, errors: pass ? [] : ["Proxy path did not read back from Premiere"] };
}

async function createSubclip(args: AnyRecord): Promise<HostResult> {
  const {project} = await mutationContext(args);
  assertWorkingProject(project);
  const name = text(args.name);
  const beforeItems = (await projectItems(project,Infinity)).map(item=>item.snapshot);
  if(!beforeItems.some(item=>item.id===text(args.projectItemId)))throw new HostCommandError('PROJECT_ITEM_NOT_FOUND','Subclip source ID is absent from the current project');
  const start = Number(args.startSeconds);
  const end = Number(args.endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new HostCommandError("INVALID_SUBCLIP_RANGE", "Subclip endSeconds must be greater than startSeconds");
  const existing = beforeItems.find((item) => item.name === name);
  if (existing) return {
    status: "partial",
    before: { count: beforeItems.length },
    hostResult: { created: false, reusedExisting: true },
    after: { count: beforeItems.length, created: existing, rangeReadback: "existing-item" },
    errors: ["An existing named subclip was reused; verify its hard-bounded duration after timeline placement"],
  };
  // Tree traversal may invalidate earlier native wrappers. Retain baseline
  // identities only, then reacquire the exact source immediately before dispatch.
  const sourceItem=await findProjectItem(project,text(args.projectItemId));
  const sourceClip=await ppro.ClipProjectItem.cast(sourceItem);
  assertMethod(sourceClip,"createSubClipAction","ClipProjectItem.createSubClipAction");
  // Premiere truncates a sub-frame out point (5.333333 s became 159 frames at
  // 30 fps). Snap float noise to the source frame grid and refuse real
  // between-frame times before dispatch; audio-only subclips stay sample-exact.
  let startTicks = exactTicksFromSeconds(start), endTicks = exactTicksFromSeconds(end);
  let frameGrid: AnyRecord = { status: "unavailable" };
  if (args.takeVideo !== false && typeof sourceClip.getFootageInterpretation === "function") {
    let frameTicks: string | undefined;
    try { frameTicks = frameTicksFromRate((await sourceClip.getFootageInterpretation())?.getFrameRate?.()); } catch { frameTicks = undefined; }
    if (frameTicks) {
      const snapStart = snapTicksToFrameGrid(startTicks, frameTicks), snapEnd = snapTicksToFrameGrid(endTicks, frameTicks);
      const off = !snapStart ? { field: "startSeconds", value: start, ticks: startTicks } : !snapEnd ? { field: "endSeconds", value: end, ticks: endTicks } : undefined;
      if (off) {
        const frame = BigInt(frameTicks), earlier = BigInt(off.ticks) / frame, toSeconds = (frames: bigint) => (Number(frames * frame) / 254016000000).toFixed(6);
        throw new HostCommandError("SUBCLIP_TIME_OFF_FRAME_GRID", `${off.field} ${off.value} falls between source frames; use ${toSeconds(earlier)} (frame ${earlier}) or ${toSeconds(earlier + 1n)} (frame ${earlier + 1n})`,
          { contentDispatched: false, retryable: false, errorClassification: "preflight" });
      }
      startTicks = snapStart!.ticks; endTicks = snapEnd!.ticks;
      frameGrid = { status: "source_frame_grid", frameTicks, startFrame: snapStart!.frame, endFrame: snapEnd!.frame, startSnapped: snapStart!.snapped, endSnapped: snapEnd!.snapped };
    }
  }
  const startTime = tickTimeFromTicks(startTicks), endTime = tickTimeFromTicks(endTicks);
  const requestedRange = { inPoint: asTickTime(startTime), outPoint: asTickTime(endTime) };
  const hostResult = executeTransaction(project, `Create subclip ${name}`, () => [sourceClip.createSubClipAction(
    name,
    startTime,
    endTime,
    args.hardBoundaries !== false,
    { takeVideo: args.takeVideo !== false, takeAudio: args.takeAudio !== false },
  )]);
  const currentProject = (await mutationContext(args)).project;
  const afterItems = (await projectItems(currentProject,Infinity)).map(item=>item.snapshot);
  const beforeIds=new Set(beforeItems.map(item=>item.id));
  const candidates=afterItems.filter(item=>item.name===name&&!beforeIds.has(item.id));
  const created=candidates.length===1?candidates[0]:undefined;
  let range: AnyRecord | undefined;
  let rangeReadback = "unavailable";
  if (created) {
    const createdClip = await ppro.ClipProjectItem.cast(await findProjectItem(currentProject,created.id));
    try {
      const candidate = {
        inPoint: asTickTime(await createdClip.getInPoint(args.takeVideo===false?ppro.Constants.MediaType.AUDIO:ppro.Constants.MediaType.VIDEO)),
        outPoint: asTickTime(await createdClip.getOutPoint(args.takeVideo===false?ppro.Constants.MediaType.AUDIO:ppro.Constants.MediaType.VIDEO)),
      };
      if (candidate.inPoint.seconds >= 0 && candidate.outPoint.seconds >= 0) {
        range = candidate;
        rangeReadback = "available";
      } else rangeReadback = "host-sentinel";
    } catch { /* audio-only or host does not expose subclip bounds */ }
  }
  const rangePass = range && range.inPoint?.ticks === requestedRange.inPoint.ticks && range.outPoint?.ticks === requestedRange.outPoint.ticks;
  const createdPass = hostResult && Boolean(created);
  const status = createdPass && (rangePass || !range) ? (rangePass ? "pass" : "partial") : "fail";
  return {
    status,
    before: { count: beforeItems.length },
    hostResult,
    after: { count: afterItems.length, created, range, rangeReadback,
      requestedRange, frameGrid },
    errors: status === "pass" ? [] : status === "partial"
      ? ["Premiere created the subclip but returned an unavailable in/out sentinel; verify the hard-bounded duration after timeline placement"]
      : ["Created subclip or its source range did not read back from Premiere"],
  };
}

async function createSequence(args: AnyRecord, progress?: HostCommandProgress): Promise<HostResult> {
  const {project} = await observeHostAwait(progress?.at('sequence.preflight'),'mutationContext',()=>mutationContext(args));
  assertWorkingProject(project);
  const name = text(args.name);
  const before = (await observeHostAwait(progress?.at('sequence.preflight'),'getSequences',()=>project.getSequences())).map((sequence: any) => text(sequence.name));
  if (before.includes(name)) throw new HostCommandError("SEQUENCE_ALREADY_EXISTS", `Sequence already exists: ${name}`);
  if (args.presetPath) assertMethod(project, "createSequenceWithPresetPath", "Project.createSequenceWithPresetPath");
  else assertMethod(project, "createSequence", "Project.createSequence");
  const created = args.presetPath
    ? await observeHostAwait(progress?.at('sequence.create'),'createSequenceWithPresetPath',()=>dispatchContent(()=>project.createSequenceWithPresetPath(name, text(args.presetPath))))
    : await observeHostAwait(progress?.at('sequence.create'),'createSequence',()=>dispatchContent(()=>project.createSequence(name)));
  if (created) await observeHostAwait(progress?.at('sequence.activate'),'setActiveSequence',()=>project.setActiveSequence(created));
  const afterNames = (await observeHostAwait(progress?.at('sequence.readback'),'getSequences',()=>project.getSequences())).map((sequence: any) => text(sequence.name));
  const active = created ? await observeHostAwait(progress?.at('sequence.readback'),'activeSequence',()=>activeSequence(project)) : undefined;
  const after = { names: afterNames, active: active ? await observeHostAwait(progress?.at('sequence.readback'),'sequenceSnapshot',()=>sequenceSnapshot(active)) : null };
  const pass = Boolean(created) && afterNames.includes(name) && !before.includes(name) && after.active?.name === name;
  return { status: pass ? "pass" : "fail", before, hostResult: Boolean(created), after, errors: pass ? [] : ["Sequence creation and activation did not read back"] };
}

/** Placement owns only its requested source and destination intervals, not a
 * snapshot of unrelated user edits or the active view after dispatch. */
async function placeClips(args: AnyRecord): Promise<HostResult> {
  if (args.placements?.some((p: AnyRecord) => p.sourceRange !== undefined)) return placeSourceRange(args, executeTransaction);
  let contentDispatched=false;
  try {
  const { project, sequence } = await mutationContext(args);
  const placements:AnyRecord[] = Array.isArray(args.placements) ? args.placements : [];
  const frameTicks=text(await sequence.getTimebase()),frameSeconds=Number(frameTicks)/254016000000;
  if(!Number.isFinite(frameSeconds)||frameSeconds<=0)throw Error('PLACEMENT_TIMEBASE_REQUIRED');
  const durations=new Map(placements.filter(p=>p.expectedDurationSeconds!==undefined).map(p=>[p,placementDurationTicks(Number(p.expectedDurationSeconds),frameTicks)]));
  const duration=(p:AnyRecord)=>durations.has(p)?Number(durations.get(p))/254016000000:frameSeconds;
  const close=(a:number,b:number)=>Math.abs(a-b)<frameSeconds/2;
  const streams=(p:AnyRecord):Array<'video'|'audio'>=>p.expectedMediaTypes??['video','audio'];
  const track=(p:AnyRecord,m:string)=>Number(m==='video'?p.videoTrackIndex??0:p.audioTrackIndex??0);
  const readRange=async(p:AnyRecord)=>{
    const items:AnyRecord[]=[];
    for(const mediaType of streams(p)) {
      const read=await queryTimelineEntries(sequence,{mediaType,trackIndex:track(p,mediaType),startSeconds:Number(p.timeSeconds),endSeconds:Number(p.timeSeconds)+duration(p),limit:100});
      if(read.page.hasMore||read.page.scanTruncated)throw Error('PLACEMENT_RANGE_INCOMPLETE');
      items.push(...read.entries.map(e=>e.snapshot));
    }
    return items;
  };
  assertMethod(ppro.SequenceEditor, 'getEditor', 'SequenceEditor.getEditor');
  const editor=ppro.SequenceEditor.getEditor(sequence),prepared:Array<{item:any;time:any;placement:AnyRecord}>=[];
  for(const placement of placements) {
    if(placement.requireEmpty&&(!(placement.expectedDurationSeconds>0)||!placement.expectedMediaTypes?.length||placement.mode!=='overwrite'))throw Error('EMPTY_PLACEMENT_REQUIRES_DURATION_STREAMS_AND_OVERWRITE');
    const item=await findProjectItem(project,text(placement.projectItemId));
    prepared.push({item,time:tickFromSeconds(Number(placement.timeSeconds)),placement});
  }
  const beforeItems:AnyRecord[]=[];
  for(let i=0;i<placements.length;i++) {
    const p=placements[i]!,items=await readRange(p);beforeItems.push(...items);
    if(!p.requireEmpty)continue;
    if(items.length)throw new HostCommandError('PLACEMENT_RANGE_OCCUPIED','Requested destination range now contains a clip; no placement dispatched');
    for(const other of placements.slice(0,i))if((other.requireEmpty||p.requireEmpty)&&streams(p).some(m=>streams(other).includes(m)&&track(p,m)===track(other,m))&&placementIntervalsOverlap(Number(p.timeSeconds),duration(p),Number(other.timeSeconds),duration(other)))throw Error('PLACEMENT_REQUESTS_OVERLAP');
  }
  contentDispatched=true;
  const hostResult=executeTransaction(project, `Place ${prepared.length} project items`,()=>prepared.map(({item,time,placement:p})=>p.mode==='overwrite'
    ?editor.createOverwriteItemAction(item,time,Number(p.videoTrackIndex??0),Number(p.audioTrackIndex??0))
    :editor.createInsertProjectItemAction(item,time,Number(p.videoTrackIndex??0),Number(p.audioTrackIndex??0),true)));
  const afterItems:AnyRecord[]=[],placedItemIds:string[]=[],errors:string[]=[];
  for(const p of placements) {
    const items=await readRange(p);afterItems.push(...items);
    const matches=items.filter(item=>item.projectItemId===p.projectItemId&&close(Number(item.start.seconds),Number(p.timeSeconds)));
    if(!matches.length)errors.push('Placed source missing: '+p.projectItemId);
    for(const m of p.expectedMediaTypes??[])if(matches.filter(item=>item.mediaType===m&&item.trackIndex===track(p,m)).length!==1)errors.push('Expected one placed '+m+' stream: '+p.projectItemId);
    for(const item of matches) {
      if(durations.has(p)&&String(BigInt(item.end.ticks)-BigInt(item.start.ticks))!==durations.get(p))errors.push('Placed duration differs: '+item.id+'; expected '+durations.get(p)+' ticks after flooring the requested source duration to complete sequence frames; observed '+String(BigInt(item.end.ticks)-BigInt(item.start.ticks))+' ticks. Inspect source bounds and actual placement before recovery; do not replay this operation');
      if(p.expectedSourceInSeconds!==undefined&&!close(Number(item.inPoint?.seconds??NaN),Number(p.expectedSourceInSeconds)))errors.push('Placed source in point differs: '+item.id);
      placedItemIds.push(text(item.id));
    }
  }
  const editability = [];
  for (const item of afterItems.filter(item => placedItemIds.includes(item.id))) {
    const source = await findProjectItem((await mutationContext(args)).project, item.projectItemId);
    editability.push(await readSourceEditability(source, item, placements.find(p => p.projectItemId === item.projectItemId)?.sourceMapping));
  }
  return {status:hostResult&&errors.length===0?'pass':'unverified',before:{sequenceId:await sequenceId(sequence),items:beforeItems},hostResult,after:{sequenceId:await sequenceId(sequence),items:afterItems,editability,
    placementTiming:placements.map(p=>({projectItemId:p.projectItemId,requestedDurationSeconds:p.expectedDurationSeconds,expectedDurationTicks:durations.get(p),frameTicks,durationRounding:'floor_to_sequence_frame'}))},placedItemIds:[...new Set(placedItemIds)],errors};
  } catch(error) {
    if(contentDispatched)throw error;
    return {status:'fail',hostResult:{contentDispatched:false},errors:[String(error)]};
  }
}

async function importCaptionTrack(args: AnyRecord): Promise<HostResult> {
  const initial = await mutationContext(args);
  const before = await sequenceSnapshot(initial.sequence);
  const srtPath = text(args.srtPath);
  const imported = await importMedia({ ...args, filePaths: [srtPath], binId: args.binId });
  if (imported.status === "fail") return imported;

  let current = await mutationContext(args);
  const captionItem = (await projectItems(current.project)).find((entry) => normalizeHostPath(text(entry.snapshot.path)) === normalizeHostPath(srtPath));
  if (!captionItem) return { status: "fail", before, hostResult: { imported }, errors: ["Imported SRT project item was not found during readback"] };

  assertMethod(ppro.SequenceEditor, "getEditor", "SequenceEditor.getEditor");
  const editor = ppro.SequenceEditor.getEditor(current.sequence);
  const placementMode = text(args.placementMode) === "overwrite" ? "overwrite" : "insert";
  const videoTrackIndex = Number(args.videoTrackIndex ?? 0);
  const audioTrackIndex = Number(args.audioTrackIndex ?? 0);
  const placementMethod = placementMode === "overwrite" ? "createOverwriteItemAction" : "createInsertProjectItemAction";
  assertMethod(editor, placementMethod, `SequenceEditor.${placementMethod}`);
  const placementResult = executeTransaction(current.project, `Place caption track ${text(args.trackName) || "Captions"}`, () => [
    placementMode === "overwrite"
      ? editor.createOverwriteItemAction(captionItem.raw, tickFromSeconds(Number(args.timeSeconds ?? 0)), videoTrackIndex, audioTrackIndex)
      : editor.createInsertProjectItemAction(captionItem.raw, tickFromSeconds(Number(args.timeSeconds ?? 0)), videoTrackIndex, audioTrackIndex, true),
  ]);

  current = await mutationContext(args);
  let afterPlacement = await sequenceSnapshot(current.sequence);
  const createdTrackIndex = afterPlacement.captionTracks - 1;
  let renameResult = true;
  if (placementResult && text(args.trackName) && afterPlacement.captionTracks > before.captionTracks && createdTrackIndex >= 0) {
    const track = await current.sequence.getCaptionTrack(createdTrackIndex);
    assertMethod(track, "createSetNameAction", "CaptionTrack.createSetNameAction");
    renameResult = executeTransaction(current.project, `Rename caption track ${text(args.trackName)}`, () => [track.createSetNameAction(text(args.trackName))]);
    current = await mutationContext(args);
    afterPlacement = await sequenceSnapshot(current.sequence);
  }
  const created = afterPlacement.captionTracks === before.captionTracks + 1;
  const named = !text(args.trackName) || afterPlacement.captionTrackStates?.some((track: AnyRecord) => track.index === createdTrackIndex && track.name === text(args.trackName));
  const populated = afterPlacement.captionTrackStates?.some((track: AnyRecord) => track.index === createdTrackIndex && (track.itemCount == null || track.itemCount > 0));
  const pass = Boolean(placementResult) && renameResult && created && named && populated;
  return {
    status: pass ? "pass" : "fail",
    before,
    hostResult: { imported, placementMode, videoTrackIndex, audioTrackIndex, placementResult, renameResult, projectItemId: captionItem.snapshot.id },
    after: afterPlacement,
    errors: pass ? [] : [
      ...(!placementResult ? ["Premiere rejected the SRT placement action"] : []),
      ...(!created ? ["Caption-track count did not increase by one"] : []),
      ...(!named ? ["Caption-track name did not read back"] : []),
      ...(!populated ? ["Created caption track did not contain caption items"] : []),
    ],
  };
}

async function setTrackState(args: AnyRecord): Promise<HostResult> {
  let context;
  try { context = await mutationContext(args); }
  catch(error){
    if(error instanceof HostCommandError&&error.code==='DESIGNATED_SEQUENCE_MISMATCH')return {status:'fail',hostResult:{phase:'scope_preflight',contentDispatched:false},errors:[error.code+': '+error.message]};
    throw error;
  }
  const { project, sequence } = context;
  const edits = Array.isArray(args.edits) ? args.edits : [];
  const before = await sequenceSnapshot(sequence);
  const prepared: Array<{ edit: AnyRecord; track: any }> = [];
  for (const edit of edits) {
    const mediaType = text(edit.mediaType);
    if (mediaType !== "video" && mediaType !== "audio" && mediaType !== "caption") {
      throw new HostCommandError("INVALID_MEDIA_TYPE", `Unsupported track media type: ${mediaType}`);
    }
    const trackIndex = Number(edit.trackIndex);
    const count = mediaType === "video"
      ? Number(await sequence.getVideoTrackCount())
      : mediaType === "audio" ? Number(await sequence.getAudioTrackCount()) : Number(await sequence.getCaptionTrackCount());
    if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= count) throw new HostCommandError("TRACK_NOT_FOUND", `${mediaType} track not found: ${trackIndex}`);
    const track = mediaType === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : mediaType === "audio" ? await sequence.getAudioTrack(trackIndex) : await sequence.getCaptionTrack(trackIndex);
    if (edit.name != null) assertMethod(track, "createSetNameAction", `${mediaType}Track.createSetNameAction`);
    if (edit.muted != null) assertMethod(track, "setMute", `${mediaType}Track.setMute`);
    prepared.push({ edit, track });
  }
  const renames=prepared.filter(({edit})=>edit.name!=null);
  const renameResult = !renames.length || executeTransaction(project, `Rename ${renames.length} timeline tracks`, () => renames.map(({edit,track})=>track.createSetNameAction(text(edit.name))));
  let muteResult = true;
  for (const { edit } of prepared) {
    if (edit.muted == null) continue;
    const current = await mutationContext(args);
    const mediaType = text(edit.mediaType);
    const track = mediaType === "video"
      ? await current.sequence.getVideoTrack(Number(edit.trackIndex))
      : mediaType === "audio" ? await current.sequence.getAudioTrack(Number(edit.trackIndex)) : await current.sequence.getCaptionTrack(Number(edit.trackIndex));
    muteResult = Boolean(await dispatchContent(()=>track.setMute(Boolean(edit.muted)))) && muteResult;
  }
  const after = await targetSequenceSnapshot(args);
  const mismatches = edits.flatMap((edit) => {
    const mediaType = text(edit.mediaType);
    const track = mediaType === "caption"
      ? after.captionTrackStates.find((candidate: AnyRecord) => candidate.index === Number(edit.trackIndex))
      : after.tracks.find((candidate: AnyRecord) => candidate.mediaType === mediaType && candidate.index === Number(edit.trackIndex));
    if (!track) return [`Track disappeared during readback: ${text(edit.mediaType)} ${Number(edit.trackIndex)}`];
    return [
      ...(edit.name != null && track.name !== text(edit.name) ? [`Track name mismatch: ${text(edit.mediaType)} ${Number(edit.trackIndex)}`] : []),
      ...(edit.muted != null && track.muted !== Boolean(edit.muted) ? [`Track mute mismatch: ${text(edit.mediaType)} ${Number(edit.trackIndex)}`] : []),
    ];
  });
  const pass = renameResult && muteResult && mismatches.length === 0;
  return { status: pass ? "pass" : "fail", before, hostResult: { renameResult, muteResult }, after, errors: mismatches };
}

async function setTimelineItemState(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const edits = Array.isArray(args.edits) ? args.edits : [];
  const before = await sequenceSnapshot(sequence);
  const available = await trackItems(sequence);
  const prepared = edits.map((edit) => {
    const entry = available.find((candidate) => candidate.snapshot.id === text(edit.trackItemId));
    if (!entry) throw new HostCommandError("TRACK_ITEM_NOT_FOUND", `Track item not found: ${text(edit.trackItemId)}`);
    if (edit.name != null) assertMethod(entry.raw, "createSetNameAction", "TrackItem.createSetNameAction");
    if (edit.disabled != null) assertMethod(entry.raw, "createSetDisabledAction", "TrackItem.createSetDisabledAction");
    return { edit, entry };
  });
  const changes = prepared.filter(({ edit }) => edit.name != null || edit.disabled != null);
  const hostResult = !changes.length || executeTransaction(project, `Update ${changes.length} timeline items`, () => changes.flatMap(({ edit, entry }) => [
    ...(edit.name != null ? [entry.raw.createSetNameAction(text(edit.name))] : []),
    ...(edit.disabled != null ? [entry.raw.createSetDisabledAction(Boolean(edit.disabled))] : []),
  ]));
  const after = await targetSequenceSnapshot(args);
  const mismatches = prepared.flatMap(({ edit, entry }) => {
    const candidate = after.items.find((item: AnyRecord) => item.id === entry.snapshot.id);
    if (!candidate) return [`Timeline item disappeared during readback: ${entry.snapshot.id}`];
    return [
      ...(edit.name != null && candidate.name !== text(edit.name) ? [`Timeline item name mismatch: ${entry.snapshot.id}`] : []),
      ...(edit.disabled != null && candidate.disabled !== Boolean(edit.disabled) ? [`Timeline item disabled-state mismatch: ${entry.snapshot.id}`] : []),
    ];
  });
  const pass = hostResult && mismatches.length === 0;
  return { status: pass ? "pass" : "fail", before, hostResult, after, errors: mismatches };
}

async function cloneClips(args: AnyRecord): Promise<HostResult> {
  const clones = Array.isArray(args.clones) ? args.clones : [];
  // Audio can still be rebuilding after the preceding command. Settle before
  // acquiring any preflight wrapper; no delay is added without a recent mutation.
  if(clones.some((clone:AnyRecord)=>text(clone.trackItemId).startsWith('audio:')))await waitGraphicMutationQuiet();
  const { sequence } = await mutationContext(args);
  const before = await sequenceSnapshot(sequence);
  if(before.itemsTruncated)throw new HostCommandError('CLONE_PREFLIGHT_UNVERIFIED','Clone planning requires a complete timeline snapshot');
  assertMethod(sequence,'getTimebase','Sequence.getTimebase');
  const frameTicks=Number(await sequence.getTimebase());
  if(!Number.isSafeInteger(frameTicks)||frameTicks<=0)throw new HostCommandError('CLONE_TIMEBASE_UNVERIFIED','Clone planning requires a valid native video-frame timebase');
  // Insert can ripple an earlier result or a later source on other tracks.
  // This batch contract does not predict those shifts. One insert can be read
  // back before the caller discovers fresh IDs for its next command.
  if(clones.length>1&&clones.some((clone:AnyRecord)=>text(clone.mode)==='insert'))throw new HostCommandError('CLONE_INSERT_BATCH_UNSUPPORTED','Insert clones require one clone per command; inspect fresh source IDs after each insert');
  assertMethod(ppro.SequenceEditor, "getEditor", "SequenceEditor.getEditor");
  assertMethod(ppro.SequenceEditor.getEditor(sequence), "createCloneTrackItemAction", "SequenceEditor.createCloneTrackItemAction");
  const prepared: Array<{ clone: AnyRecord; source: AnyRecord; videoOffset: number; audioOffset: number; timeOffset: number; destinationTrack: number }> = [];
  // Plans retain only values. Native wrappers must be reacquired immediately
  // before each transaction, including repeated clones of the same MOGRT.
  const available = before.items as AnyRecord[];
  for (const clone of clones) {
    const entry = available.find((candidate) => candidate.id === text(clone.trackItemId));
    if (!entry) throw new HostCommandError("TRACK_ITEM_NOT_FOUND", `Track item not found: ${text(clone.trackItemId)}`);
    const videoOffset = Number(clone.videoTrackOffset ?? 0);
    const audioOffset = Number(clone.audioTrackOffset ?? 0);
    const timeOffset = Number(clone.timeOffsetSeconds ?? 0);
    const destinationTrack = Number(entry.trackIndex) + (entry.mediaType === "video" ? videoOffset : audioOffset);
    if(!Number.isInteger(videoOffset)||!Number.isInteger(audioOffset)||!Number.isFinite(timeOffset))throw new HostCommandError('INVALID_CLONE_OFFSET','Clone offsets must be finite, with integer track offsets');
    if(!['video','audio'].includes(entry.mediaType)||![entry.start?.seconds,entry.end?.seconds,entry.inPoint?.seconds,entry.outPoint?.seconds].every(value=>Number.isFinite(Number(value)))||Number(entry.end.seconds)<=Number(entry.start.seconds)||Number(entry.outPoint.seconds)<=Number(entry.inPoint.seconds))throw new HostCommandError('CLONE_SOURCE_UNVERIFIED','Clone source requires complete, positive timeline and source ranges');
    const trackCount=Number(entry.mediaType==='video'?before.videoTracks:before.audioTracks);
    if (!Number.isInteger(trackCount)||!Number.isInteger(destinationTrack)||destinationTrack < 0||destinationTrack>=trackCount) throw new HostCommandError("INVALID_TRACK_OFFSET", `Clone destination track does not exist: ${destinationTrack}`);
    if (timeOffset === 0 && destinationTrack===Number(entry.trackIndex)) throw new HostCommandError("NO_OP_CLONE", "A clone must change time or its media type's destination track");
    if(Number(entry.start.seconds)+timeOffset<0)throw new HostCommandError('INVALID_CLONE_OFFSET','Clone destination time would be negative');
    const requestedStart=Number(entry.start.seconds)+timeOffset,frameIndex=Math.round(requestedStart*254016000000/frameTicks),alignedStart=frameIndex*frameTicks/254016000000;
    // alignToVideo is true below. Do not guess native tie/rounding semantics
    // for an off-grid request and discover a predictable mismatch after writing.
    if(!Number.isSafeInteger(frameIndex)||Math.abs(requestedStart-alignedStart)>0.000001)throw new HostCommandError('CLONE_DESTINATION_NOT_FRAME_ALIGNED',`Clone destination must be on a video frame; use timeOffsetSeconds ${alignedStart-Number(entry.start.seconds)} for the nearest frame`);
    if(clone.mode!==undefined&&!['insert','overwrite'].includes(text(clone.mode)))throw new HostCommandError('INVALID_CLONE_MODE','Clone mode must be insert or overwrite');
    // Prove the exact signed native offset before any transaction; the action
    // factories below rebuild the same value from the same seconds.
    tickOffsetFromSeconds(timeOffset);
    prepared.push({ clone, source:entry, videoOffset, audioOffset, timeOffset, destinationTrack });
  }
  const interval=(plan:typeof prepared[number])=>({start:Number(plan.source.start.seconds)+plan.timeOffset,end:Number(plan.source.end.seconds)+plan.timeOffset});
  const overlaps=(left:{start:number;end:number},right:{start:number;end:number})=>left.start<right.end-0.000001&&right.start<left.end-0.000001;
  for(const [index,plan] of prepared.entries())for(const later of prepared.slice(index+1)) {
    if(plan.source.mediaType===later.source.mediaType&&plan.destinationTrack===later.destinationTrack&&overlaps(interval(plan),interval(later)))throw new HostCommandError('CLONE_DESTINATION_CONFLICT','Clone batch destinations overlap; submit intentional overwrites separately with fresh IDs');
    if(plan.source.mediaType===later.source.mediaType&&plan.destinationTrack===Number(later.source.trackIndex)&&overlaps(interval(plan),{start:Number(later.source.start.seconds),end:Number(later.source.end.seconds)}))throw new HostCommandError('CLONE_SOURCE_CONFLICT','An earlier clone would overwrite a later source; inspect and submit separate commands');
  }
  const batched=await tryCloneOneTrackBatch(before,prepared,{
    acquireSources:async ids=>{
      const current=await mutationContext(args),entries=await findTrackItemEntriesFromOneTrack(current.sequence,ids);
      const byId=new Map(entries.map(entry=>[entry.snapshot.id,entry]));
      return {snapshots:entries.map(entry=>entry.snapshot),
        createAction:(plan,observe)=>{
          const notify=(phase:Parameters<NonNullable<typeof observe>>[0])=>{try{observe?.(phase);}catch{/* Observations never change edit behavior. */}};
          notify('get_editor_enter'); const editor=ppro.SequenceEditor.getEditor(current.sequence); notify('get_editor_exit');
          notify('create_tick_time_enter'); const time=tickOffsetFromSeconds(plan.timeOffset); notify('create_tick_time_exit');
          notify('create_clone_action_enter');
          const action=editor.createCloneTrackItemAction(byId.get(plan.source.id)!.raw,time,plan.videoOffset,plan.audioOffset,true,false);
          notify('create_clone_action_exit'); return action;
        },
        executeTransaction:(label,factory,observe)=>executeTransaction(current.project,label,factory,observe),
      };
    },
    waitForQuiet:()=>prepared[0]!.source.mediaType==='audio'||prepared[0]!.source.projectItemId===''?waitGraphicMutationQuiet():Promise.resolve(),
    targetSequenceSnapshot:()=>targetSequenceSnapshot(args),
  });
  if(batched)return batched;
  // A one-frame tolerance can mistake the preceding one-frame graphic for the
  // requested new clone. Keep only sub-frame floating-point conversion slack.
  const exactCloneTime=(actual:unknown,expected:number)=>Number.isFinite(Number(actual))&&Math.abs(Number(actual)-expected)<=0.000001;
  const matchesPlan=(snapshot:AnyRecord,plan:typeof prepared[number])=>{
    const {source,destinationTrack}=plan,expected=interval(plan);
    return snapshot.items.filter((item:AnyRecord)=>item.projectItemId===source.projectItemId&&item.mediaType===source.mediaType&&item.trackIndex===destinationTrack&&exactCloneTime(item.start?.seconds,expected.start)&&exactCloneTime(item.end?.seconds,expected.end)&&item.name===source.name&&snapshotsEqual(item.inPoint,source.inPoint)&&snapshotsEqual(item.outPoint,source.outPoint)&&['disabled','speed','reversed','adjustmentLayer'].every(key=>snapshotsEqual(item[key],source[key])));
  };
  let after=before,hostResult=true;
  const steps:AnyRecord[]=[],errors:string[]=[];
  for(const [index,plan] of prepared.entries()) {
    const {clone,source,videoOffset,audioOffset,timeOffset,destinationTrack}=plan;
    const current=await mutationContext(args);
    const entry=await findTrackItemEntry(current.sequence,text(source.id));
    // Earlier insert/overwrite steps can invalidate a later source. Stop the
    // batch without replay or guessing which moved item the caller intended.
    if(!snapshotsEqual(entry.snapshot,source))throw new HostCommandError('CLONE_SOURCE_CHANGED','Clone source changed during the batch; inspect the partial result before continuing');
    const accepted=executeTransaction(current.project,`Clone clip ${index+1}/${prepared.length}`,()=>[ppro.SequenceEditor.getEditor(current.sequence).createCloneTrackItemAction(
      entry.raw,tickOffsetFromSeconds(timeOffset),videoOffset,audioOffset,true,text(clone.mode)==='insert',
    )]);
    // The transaction records its mutation time. Audio, like generated graphics,
    // must settle before post-readback and the next step's source acquisition.
    if(source.mediaType==='audio'||source.mediaType==='video'&&source.projectItemId==='')await waitGraphicMutationQuiet();
    after=await targetSequenceSnapshot(args);
    const expectedStart=Number(source.start.seconds)+timeOffset;
    const matches=matchesPlan(after,plan);
    const verified=accepted&&!after.itemsTruncated&&matches.length===1;
    steps.push({index,sourceId:source.id,hostResult:accepted,verified,destinationId:matches.length===1?matches[0].id:null});
    if(!verified){hostResult=false;errors.push(`Clone ${index+1} did not read back uniquely with its original duration/source range at ${source.mediaType} track ${destinationTrack}, ${expectedStart}s`);}
    // Every accepted clone must still exist in the final state, including when
    // a later native action unexpectedly overwrites or ripples an earlier one.
    for(const step of steps.slice(0,-1))if(step.verified&&(after.itemsTruncated||matchesPlan(after,prepared[step.index]!).length!==1)) {
      step.verified=false;hostResult=false;errors.push(`Earlier clone ${Number(step.index)+1} no longer matches its verified destination`);
    }
    if(!hostResult)break;
  }
  return {status:hostResult?'pass':'fail',before,hostResult:{accepted:hostResult,steps,completedClones:steps.filter(step=>step.verified).length},after,errors};
}

type SplitRollbackResult = Readonly<{
  removedCloneCount: number;
  removalResult: boolean;
  restoreResult: boolean;
  after: AnyRecord;
  errors: string[];
}>;

function splitSnapshots(items: AnyRecord[]): SplitTimelineItem[] {
  return items as unknown as SplitTimelineItem[];
}

function splitComponentSignature(components: AnyRecord[]): string {
  return JSON.stringify(canonicalJsonValue(components));
}

const splitClockEqual=(actual:number,expected:number)=>Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=0.000001;

async function rollbackClipSplit(
  before: AnyRecord,
  plan: ClipSplitPlan,
  beforeComponents: AnyRecord[],
  scope: {project:any;sequence:any;read:()=>Promise<AnyRecord>},
): Promise<SplitRollbackResult> {
  let removalResult = true;
  let restoreResult = true;
  const recoveryErrors: string[] = [];
  const current = scope;
  const baselineIds = new Set((before.items as AnyRecord[]).map((item) => text(item.id)));
  const currentEntries=[];
  for(const item of (await scope.read()).items)currentEntries.push(await findTrackItemEntry(current.sequence,item.id));
  const generatedEntries = currentEntries.filter((entry) => {
    if (baselineIds.has(text(entry.snapshot.id)) || entry.snapshot.projectItemId !== plan.projectItemId || entry.snapshot.mediaType!==plan.mediaType || entry.snapshot.trackIndex!==plan.trackIndex) return false;
    const start = Number(entry.snapshot.start?.seconds);
    return splitClockEqual(start, plan.stagingStartSeconds)
      || splitClockEqual(start, plan.stagedTrimStartSeconds)
      || splitClockEqual(start, plan.splitSeconds);
  });
  if (generatedEntries.length) {
    try {
      const selection = await liveTrackItemSelection(current.sequence, generatedEntries);
      assertMethod(ppro.SequenceEditor, "getEditor", "SequenceEditor.getEditor");
      const editor = ppro.SequenceEditor.getEditor(current.sequence);
      assertMethod(editor, "createRemoveItemsAction", "SequenceEditor.createRemoveItemsAction");
      removalResult = executeTransaction(current.project, "Recover failed clip split: remove generated clips", () => [
        editor.createRemoveItemsAction(selection, false, plan.mediaType==='audio'?ppro.Constants.MediaType.AUDIO:ppro.Constants.MediaType.VIDEO, true),
      ]);
    } catch (error) {
      removalResult = false;
      recoveryErrors.push(`Could not remove generated split clips: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await current.sequence.clearSelection().catch(() => false);
    }
  }

  try {
    const original = await findTrackItemEntry(current.sequence, plan.targetId);
    if (!splitClockEqual(Number(original.snapshot.end?.seconds), plan.originalEndSeconds)) {
      if(Math.abs(Number(original.snapshot.end?.seconds)-plan.splitSeconds)>0.000001)throw Error('Split target changed after dispatch; preserve the current user edit');
      assertMethod(original.raw, "createSetEndAction", "TrackItem.createSetEndAction");
      restoreResult = executeTransaction(current.project, "Recover failed clip split: restore original end", () => [
        original.raw.createSetEndAction(exactTickFromSeconds(plan.originalEndSeconds)),
      ]);
    }
  } catch (error) {
    restoreResult = false;
    recoveryErrors.push(`Could not restore original split target: ${error instanceof Error ? error.message : String(error)}`);
  }

  const after = await scope.read();
  recoveryErrors.push(...assessClipSplitRecovery(
    splitSnapshots(before.items as AnyRecord[]),
    splitSnapshots(after.items as AnyRecord[]),
    Number(before.frameRate),
  ));
  try {
    const recovered = await findTrackItemEntry(current.sequence, plan.targetId);
    const recoveredComponents = await componentSnapshot(recovered.raw);
    if (splitComponentSignature(recoveredComponents) !== splitComponentSignature(beforeComponents)) {
      recoveryErrors.push("Recovery did not restore the original component chain and keyframes");
    }
  } catch (error) {
    recoveryErrors.push(`Recovery component readback failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { removedCloneCount: generatedEntries.length, removalResult, restoreResult, after, errors: recoveryErrors };
}

async function assertSplitTrackOrder(sequence:any,mediaType:string,trackIndex:number):Promise<void>{
  const track=await (mediaType==='audio'?sequence.getAudioTrack(trackIndex):sequence.getVideoTrack(trackIndex));
  const items=await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
  if(!Array.isArray(items)||items.length>TRACK_ITEM_LIMIT)throw Error('SPLIT_NATIVE_TRACK_ORDER_UNVERIFIED: incomplete native collection');
  let previous:bigint|undefined;
  for(const item of items){
    const start=BigInt(asTickTime(await item.getStartTime()).ticks);
    if(previous!==undefined&&start<previous)throw Error('SPLIT_NATIVE_TRACK_ORDER_UNVERIFIED: native clip collection is not chronological');
    previous=start;
  }
}

/**
 * Split one exact timeline item with public UXP clone/trim/clone/lift actions.
 * One item per command keeps rollback bounded and makes every state transition
 * observable before the next mutation. No sequence or track is created.
 */
async function splitClips(args: AnyRecord, held?:{project:any;sequence:any}): Promise<HostResult> {
  const { project, sequence } = held??await mutationContext(args);
  const split = args.split as AnyRecord | undefined;
  if (!split) throw new HostCommandError("INVALID_SPLIT_REQUEST", "split_clips requires one split specification");
  const actualProjectId = text(project.guid) || text(project.path) || text(project.name);
  const actualSequenceId = await sequenceId(sequence);
  if (actualProjectId !== text(args.expectedProjectId)) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", `Expected project ${text(args.expectedProjectId)}, active project is ${actualProjectId}`);
  }
  if (actualSequenceId !== text(args.expectedSequenceId)) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", `Expected sequence ${text(args.expectedSequenceId)}, active sequence is ${actualSequenceId}`);
  }

  const initialEntry=await findTrackItemEntry(sequence,text(split.trackItemId));
  const target=initialEntry.snapshot;
  await assertSplitTrackOrder(sequence,target.mediaType,target.trackIndex);
  const frameRate=254016000000/Number(await sequence.getTimebase());
  let plan: ClipSplitPlan | undefined;
  const read=async()=>{
    const ranges=[{startSeconds:target.start.seconds,endSeconds:target.end.seconds,mediaType:target.mediaType,trackIndex:target.trackIndex},...(plan?[{startSeconds:plan.stagingStartSeconds,endSeconds:plan.stagingStartSeconds+plan.originalEndSeconds-plan.originalStartSeconds}]:[])];
    const entries=new Map<string,AnyRecord>();
    for(const range of ranges){
      const page=await queryTimelineEntries(sequence,{...range,limit:100});
      if(page.page.hasMore||page.page.scanTruncated)throw Error('SPLIT_RANGE_READBACK_INCOMPLETE');
      for(const {snapshot:item} of page.entries)if(Math.min(item.end.seconds,range.endSeconds)-Math.max(item.start.seconds,range.startSeconds)>0.000001)entries.set(item.id,item);
    }
    return {id:actualSequenceId,frameRate,duration:asTickTime(await sequence.getEndTime()),items:[...entries.values()]};
  };
  const before=await read();
  if(before.items.length!==1)throw Error('SPLIT_TARGET_RANGE_NOT_EXCLUSIVE');
  if (!target) throw new HostCommandError("TRACK_ITEM_NOT_FOUND", `Track item not found: ${text(split.trackItemId)}`);
  const preconditionErrors = [
    ...(target.projectItemId === text(split.expectedProjectItemId) ? [] : ["project item ID"]),
    ...(target.mediaType === text(split.expectedMediaType) ? [] : ["media type"]),
    ...(target.trackIndex === Number(split.expectedTrackIndex) ? [] : ["track index"]),
    ...(splitClockEqual(Number(target.start?.seconds), Number(split.expectedStartSeconds)) ? [] : ["start time"]),
    ...(splitClockEqual(Number(target.end?.seconds), Number(split.expectedEndSeconds)) ? [] : ["end time"]),
  ];
  if (preconditionErrors.length) {
    throw new HostCommandError("TRACK_ITEM_PRECONDITION_FAILED", `Split target changed since inspection: ${preconditionErrors.join(", ")}`);
  }

  try {
    plan = planClipSplit(
      splitSnapshots(before.items as AnyRecord[]),
      text(split.trackItemId),
      Number(split.atSeconds),
      await timelineExtentSeconds(sequence,ppro.Constants.TrackItemType.CLIP),
      Number(before.frameRate),
    );
  } catch (error) {
    throw new HostCommandError("INVALID_SPLIT_REQUEST", error instanceof Error ? error.message : String(error));
  }

  assertMethod(ppro.SequenceEditor, "getEditor", "SequenceEditor.getEditor");
  const editor = ppro.SequenceEditor.getEditor(sequence);
  assertMethod(editor, "createCloneTrackItemAction", "SequenceEditor.createCloneTrackItemAction");
  assertMethod(editor, "createRemoveItemsAction", "SequenceEditor.createRemoveItemsAction");
  const targetEntry = await findTrackItemEntry(sequence, plan.targetId);
  assertMethod(targetEntry.raw, "createSetEndAction", "TrackItem.createSetEndAction");
  const beforeComponents = await componentSnapshot(targetEntry.raw);
  const operations: AnyRecord = {};
  if((await read()).items.length!==before.items.length)throw Error('SPLIT_STAGING_RANGE_OCCUPIED: content entered the staging range after full AV extent discovery. Reinspect all tracks including muted/disabled clips and prepare a fresh plan; do not remove hidden content or retry a dispatched split blindly');

  try {
    const freshTarget=await findTrackItemEntry(sequence,plan.targetId);
    operations.clone = executeTransaction(project, "Split clip: stage clone", () => [ppro.SequenceEditor.getEditor(sequence).createCloneTrackItemAction(
      freshTarget.raw,
      exactTickFromSeconds(plan.cloneTimeOffsetSeconds),
      0,
      0,
      true,
      false,
    )]);
    if (!operations.clone) throw new Error("Premiere rejected the staging clone transaction");

    const current = {project,sequence};
    let snapshot = await read();
    if ((snapshot.items as AnyRecord[]).length !== (before.items as AnyRecord[]).length + 1) {
      throw new Error("The clone action changed more than the explicit timeline item; linked or collateral items require a separate grouped split route");
    }
    let staged = (snapshot.items as AnyRecord[]).filter((item) => item.projectItemId === plan.projectItemId
      && item.mediaType === plan.mediaType
      && item.trackIndex === plan.trackIndex
      && splitClockEqual(Number(item.start?.seconds), plan.stagingStartSeconds));
    if (staged.length !== 1) throw new Error(`Expected one staged clone, read back ${staged.length}`);

    let stagedId = text(staged[0]!.id);
    let stagedEntry = await findTrackItemEntry(current.sequence, stagedId);
    assertMethod(stagedEntry.raw, "createSetStartAction", "TrackItem.createSetStartAction");
    operations.trimCloneStart = executeTransaction(current.project, "Split clip: trim staged clone", () => [
      stagedEntry.raw.createSetStartAction(exactTickFromSeconds(plan.stagedTrimStartSeconds)),
    ]);
    if (!operations.trimCloneStart) throw new Error("Premiere rejected the staged-clone trim transaction");

    snapshot = await read();
    staged = (snapshot.items as AnyRecord[]).filter((item) => item.projectItemId === plan.projectItemId
      && item.mediaType === plan.mediaType
      && item.trackIndex === plan.trackIndex
      && splitClockEqual(Number(item.start?.seconds), plan.stagedTrimStartSeconds));
    if (staged.length !== 1) throw new Error(`Trimmed staging clone did not read back uniquely; found ${staged.length}`);
    stagedId = text(staged[0]!.id);

    const original = await findTrackItemEntry(current.sequence, plan.targetId);
    operations.trimOriginalEnd = executeTransaction(current.project, "Split clip: trim original end", () => [
      original.raw.createSetEndAction(exactTickFromSeconds(plan.splitSeconds)),
    ]);
    if (!operations.trimOriginalEnd) throw new Error("Premiere rejected the original-end trim transaction");

    stagedEntry = await findTrackItemEntry(current.sequence, stagedId);
    // A1's saved tracks retained the moved staging item at the end of their
    // native collections despite correct timestamps. Register a fresh clone in
    // the empty cut range through SequenceEditor, prove it, then lift staging.
    operations.placeRightSegment = executeTransaction(current.project, "Split clip: register right segment in cut gap", () => [
      ppro.SequenceEditor.getEditor(current.sequence).createCloneTrackItemAction(stagedEntry.raw,
        ppro.TickTime.createWithTicks(String(BigInt(exactTickFromSeconds(plan.splitSeconds).ticks)-BigInt(stagedEntry.snapshot.start.ticks))),0,0,true,false),
    ]);
    if (!operations.placeRightSegment) throw new Error("Premiere rejected the right-segment clone transaction");
    const withStaging=await read();
    const interim=assessClipSplitReadback(splitSnapshots(before.items as AnyRecord[]),
      splitSnapshots(withStaging.items.filter((item:AnyRecord)=>item.id!==stagedId)),plan,Number(before.frameRate));
    if(withStaging.items.filter((item:AnyRecord)=>item.id===stagedId).length!==1||interim.errors.length||!interim.rightItemId)throw Error('SPLIT_DESTINATION_UNVERIFIED: '+interim.errors.join('; '));
    const rightBeforeLift=await findTrackItemEntry(current.sequence,interim.rightItemId);
    if(splitComponentSignature(await componentSnapshot(rightBeforeLift.raw))!==splitComponentSignature(beforeComponents))throw Error('SPLIT_DESTINATION_COMPONENTS_CHANGED');
    await assertSplitTrackOrder(current.sequence,plan.mediaType,plan.trackIndex);
    stagedEntry=await findTrackItemEntry(current.sequence,stagedId);
    const selection=await liveTrackItemSelection(current.sequence,[stagedEntry]);
    operations.liftStaging=executeTransaction(current.project,'Split clip: lift verified staging item',()=>[
      ppro.SequenceEditor.getEditor(current.sequence).createRemoveItemsAction(selection,false,plan.mediaType==='audio'?ppro.Constants.MediaType.AUDIO:ppro.Constants.MediaType.VIDEO,true),
    ]);
    if(!operations.liftStaging)throw Error('Premiere rejected removing the verified staging item');
    await current.sequence.clearSelection();

    const after = await read();
    const readback = assessClipSplitReadback(
      splitSnapshots(before.items as AnyRecord[]),
      splitSnapshots(after.items as AnyRecord[]),
      plan,
      Number(before.frameRate),
    );
    const verificationErrors = [...readback.errors];
    if (!readback.leftItemId || !readback.rightItemId) verificationErrors.push("Split segment IDs were not proven");
    if (!verificationErrors.length) {
      const finalSequence = sequence;
      const leftEntry = await findTrackItemEntry(finalSequence, readback.leftItemId!);
      const rightEntry = await findTrackItemEntry(finalSequence, readback.rightItemId!);
      const leftComponents=await componentSnapshot(leftEntry.raw);
      const rightComponents=await componentSnapshot(rightEntry.raw);
      const baselineComponents = splitComponentSignature(beforeComponents);
      if (splitComponentSignature(leftComponents) !== baselineComponents) verificationErrors.push("Left segment component chain or keyframes changed");
      if (splitComponentSignature(rightComponents) !== baselineComponents) verificationErrors.push("Right segment did not preserve the component chain and keyframes");
    }
    if (verificationErrors.length) throw new Error(verificationErrors.join("; "));
    await assertSplitTrackOrder(sequence,plan.mediaType,plan.trackIndex);
    return {
      status: "pass",
      before,
      hostResult: { route: "public_uxp_clone_trim_register_lift", plan, operations, readback, componentsPreserved: true,nativeTrackOrderVerified:true,renderVerification:'requires_program_and_audio_readback' },
      after,
      errors: [],
    };
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    const rollback = await rollbackClipSplit(before, plan, beforeComponents,{project,sequence,read});
    return {
      status: "fail",
      before,
      hostResult: { route: "public_uxp_clone_trim_register_lift", plan, operations, rollback,rollbackVerified:rollback.errors.length===0&&rollback.removalResult&&rollback.restoreResult },
      after: rollback.after,
      errors: [failureMessage, ...rollback.errors],
      recovery: rollback.errors.length
        ? "Automatic rollback was incomplete. Stop editing, inspect the returned after snapshot, and use Premiere undo or restore the working-copy backup before retrying."
        : "Automatic rollback removed generated split clips and restored the original item; inspect before retrying with a new operationId.",
    };
  }
}

async function placeOnNewLayer(args: AnyRecord): Promise<HostResult> {
  const initial = await mutationContext(args);
  const before = await sequenceSnapshot(initial.sequence);
  const receipt = await placeClips({ ...args, placements: [{ projectItemId: text(args.projectItemId), timeSeconds: Number(args.timeSeconds ?? 0), videoTrackIndex: before.videoTracks, audioTrackIndex: before.audioTracks, mode: text(args.mode) || "overwrite" }] });
  if (receipt.status !== "pass") return receipt;
  const afterPlacement = await targetSequenceSnapshot(args);
  const trackEdits: AnyRecord[] = [];
  if (args.videoTrackName != null && afterPlacement.videoTracks > before.videoTracks) trackEdits.push({ mediaType: "video", trackIndex: before.videoTracks, name: text(args.videoTrackName) });
  if (args.audioTrackName != null && afterPlacement.audioTracks > before.audioTracks) trackEdits.push({ mediaType: "audio", trackIndex: before.audioTracks, name: text(args.audioTrackName) });
  const trackReceipt = trackEdits.length ? await setTrackState({ ...args, edits: trackEdits }) : undefined;
  const after = (trackReceipt?.after ?? afterPlacement) as AnyRecord;
  const createdItems = after.items.filter((item: AnyRecord) => item.projectItemId === text(args.projectItemId) && isFrameAligned(Number(item.start.seconds), Number(args.timeSeconds ?? 0)) && ((item.mediaType === "video" && item.trackIndex === before.videoTracks) || (item.mediaType === "audio" && item.trackIndex === before.audioTracks)));
  const pass = createdItems.length > 0 && (!trackReceipt || trackReceipt.status === "pass");
  return { status: pass ? "pass" : "fail", before, hostResult: { placement: receipt.hostResult, trackState: trackReceipt?.hostResult, createdItemCount: createdItems.length }, after, placedItemIds: createdItems.map((item: AnyRecord) => text(item.id)), errors: [...(receipt.errors ?? []), ...(trackReceipt?.errors ?? []), ...(createdItems.length ? [] : ["No media stream appeared on a newly created track"])] };
}

async function trimClips(args: AnyRecord): Promise<HostResult> {
  const initial = await mutationContext(args);
  const edits = (Array.isArray(args.edits) ? args.edits : []) as TrimEdit[];
  const before = await sequenceSnapshot(initial.sequence);
  let hostResult = true;
  for (const edit of edits) {
    const phases = trimEditPhases(edit);
    if (!phases.length) hostResult = false;
    for (const phase of phases) {
      // Premiere invalidates host wrappers across mutations, so reacquire every
      // item before creating the next action group.
      const current = await mutationContext(args);
      const item = await findTrackItem(current.sequence, text(edit.trackItemId));
      const phaseResult = executeTransaction(current.project, `Trim ${phase.kind} for ${text(edit.trackItemId)}`, () => phase.kind === "source"
        ? [
            ...(edit.inPointSeconds != null ? [item.createSetInPointAction(tickFromSeconds(Number(edit.inPointSeconds)))] : []),
            ...(edit.outPointSeconds != null ? [item.createSetOutPointAction(tickFromSeconds(Number(edit.outPointSeconds)))] : []),
          ]
        : [
            ...(edit.startSeconds != null ? [item.createSetStartAction(tickFromSeconds(Number(edit.startSeconds)))] : []),
            ...(edit.endSeconds != null ? [item.createSetEndAction(tickFromSeconds(Number(edit.endSeconds)))] : []),
          ]);
      hostResult = hostResult && phaseResult;
    }
  }
  const after = await targetSequenceSnapshot(args);
  const mismatches = edits.flatMap((edit) => {
    const prior = before.items.find((item: AnyRecord) => item.id === text(edit.trackItemId));
    if (!prior) return [`Trim target disappeared from the baseline snapshot: ${text(edit.trackItemId)}`];
    const expectedStart = edit.startSeconds != null ? Number(edit.startSeconds) : Number(prior.start.seconds);
    const candidate = after.items.find((item: AnyRecord) => item.projectItemId === prior.projectItemId && item.mediaType === prior.mediaType && item.trackIndex === prior.trackIndex && isFrameAligned(Number(item.start.seconds), expectedStart));
    if (!candidate) return [`Trimmed item did not read back on its expected track/start: ${text(edit.trackItemId)}`];
    const fields: Array<[string, unknown, number | undefined]> = [
      ["start", candidate.start, edit.startSeconds], ["end", candidate.end, edit.endSeconds],
      ["inPoint", candidate.inPoint, edit.inPointSeconds], ["outPoint", candidate.outPoint, edit.outPointSeconds],
    ];
    return fields.flatMap(([name, actual, expected]) => expected === undefined || isFrameAligned(Number((actual as AnyRecord | undefined)?.seconds ?? -1), expected) ? [] : [`${name} readback mismatch for ${text(edit.trackItemId)}`]);
  });
  const pass = hostResult && mismatches.length === 0;
  return { status: pass ? "pass" : "fail", before, hostResult, after, errors: mismatches };
}

async function trimClipExact(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const actualProjectId = text(project.guid) || text(project.path) || text(project.name);
  const actualSequenceId = await sequenceId(sequence);
  if (actualProjectId !== text(args.expectedProjectId)) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", `Expected project ${text(args.expectedProjectId)}, active project is ${actualProjectId}`);
  }
  if (actualSequenceId !== text(args.expectedSequenceId) || text(sequence.name) !== text(args.expectedSequenceName)) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the exact trim target");
  }
  const before = await sequenceSnapshot(sequence);
  if (before.itemsTruncated) throw new HostCommandError("TIMELINE_READBACK_TRUNCATED", "Exact clip trim requires a complete timeline snapshot");
  const request = args.trim as AnyRecord;
  const entry = await findTrackItemEntry(sequence, text(request.trackItemId));
  if (!entry.snapshot.inPoint || !entry.snapshot.outPoint) {
    throw new HostCommandError("SOURCE_RANGE_UNAVAILABLE", "Exact clip trim requires readable source in/out points");
  }
  let plan;
  try {
    plan = planExactClipTrim(request as any, entry.snapshot as unknown as TrimTimelineItem, before.items as unknown as TrimTimelineItem[], Number(before.frameRate));
  } catch (error) {
    throw new HostCommandError("TRIM_PREFLIGHT_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (transitionsAtClipEdge(before, entry.snapshot, "start").length || transitionsAtClipEdge(before, entry.snapshot, "end").length) {
    throw new HostCommandError("ATTACHED_TRANSITION_UNVERIFIED", "Exact clip trim refuses targets with an edge transition until transition trimming is explicit");
  }
  const beforeComponents = await componentSnapshot(entry.raw);
  const edit: TrimEdit = { trackItemId: plan.targetId, ...plan.writes };
  assertMethod(sequence, "getTimebase", "Sequence.getTimebase");
  let ticks;
  try {
    ticks = exactTrimTicks(plan, entry.snapshot as unknown as TrimTimelineItem, text(await sequence.getTimebase()));
  } catch (error) {
    throw new HostCommandError("TRIM_PREFLIGHT_FAILED", error instanceof Error ? error.message : String(error));
  }
  const writes = ticks.writes;
  // Prove the native times before the first transaction. A factory failure
  // inside executeTransaction would make an unapplied trim look uncertain.
  for (const value of Object.values(writes)) tickTimeFromTicks(value);
  let hostResult = true;
  for (const phase of trimEditPhases(edit)) {
    const current = await mutationContext(args);
    const item = await findTrackItem(current.sequence, plan.targetId);
    const phaseResult = executeTransaction(current.project, `Exact ${phase.kind} trim`, () => [
      ...(writes.startTicks !== undefined ? [item.createSetStartAction(tickTimeFromTicks(writes.startTicks))] : []),
      ...(writes.endTicks !== undefined ? [item.createSetEndAction(tickTimeFromTicks(writes.endTicks))] : []),
    ]);
    hostResult = hostResult && phaseResult;
  }
  const after = await targetSequenceSnapshot(args);
  const readback = assessExactClipTrim(before.items as unknown as TrimTimelineItem[], after.items as unknown as TrimTimelineItem[], plan);
  // Frame-tolerant matching only finds the item; PASS requires the exact ticks.
  const exactTicks = { expected: ticks, observed: readback.observedTarget ? { startTicks: text(readback.observedTarget.start.ticks), endTicks: text(readback.observedTarget.end.ticks) } : null,
    pass: trimTicksMatch(readback.observedTarget, ticks) };
  const trackCountsUnchanged = before.videoTracks === after.videoTracks
    && before.audioTracks === after.audioTracks
    && before.captionTracks === after.captionTracks;
  const transitionsUnchanged = JSON.stringify(canonicalJsonValue(before.transitions)) === JSON.stringify(canonicalJsonValue(after.transitions));
  let componentsPreserved = false;
  if (readback.trimmedItemId) {
    const current = await mutationContext(args);
    const trimmed = await findTrackItemEntry(current.sequence, readback.trimmedItemId);
    componentsPreserved = splitComponentSignature(await componentSnapshot(trimmed.raw)) === splitComponentSignature(beforeComponents);
  }
  const pass = hostResult && readback.status === "pass" && exactTicks.pass && trackCountsUnchanged && transitionsUnchanged && componentsPreserved;
  if (pass) {
    const current = await mutationContext(args);
    const source = await findProjectItem(current.project, plan.projectItemId);
    const editability = await readSourceEditability(source, readback.observedTarget);
    return { status: "pass", before, hostResult: { transaction: hostResult, plan, readback, exactTicks, trackCountsUnchanged, transitionsUnchanged, componentsPreserved }, after: { ...after, editability: [editability], renderVerification: { status: 'unverified', reason: 'Timeline/source readback is not rendered-frame or audible-output proof' } }, errors: [] };
  }

  const recoveryErrors: string[] = [];
  let recoveryResult = true;
  if (readback.observedTargetId) {
    try {
      const current = await mutationContext(args);
      const item = await findTrackItem(current.sequence, readback.observedTargetId);
      // Restore the pre-operation ticks themselves, not a seconds round trip.
      recoveryResult = executeTransaction(current.project, "Recover exact timeline trim", () => [
        ...(writes.startTicks !== undefined ? [item.createSetStartAction(tickTimeFromTicks(text(entry.snapshot.start.ticks)))] : []),
        ...(writes.endTicks !== undefined ? [item.createSetEndAction(tickTimeFromTicks(text(entry.snapshot.end.ticks)))] : []),
      ]);
    } catch (error) {
      recoveryResult = false;
      recoveryErrors.push(`Trim rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    recoveryResult = false;
  }
  const recovered = await targetSequenceSnapshot(args);
  let recoveryComponentsPreserved = false;
  if (recoveryResult) {
    try {
      const current = await mutationContext(args);
      const original = await findTrackItemEntry(current.sequence, plan.targetId);
      recoveryComponentsPreserved = splitComponentSignature(await componentSnapshot(original.raw)) === splitComponentSignature(beforeComponents);
    } catch (error) {
      recoveryErrors.push(`Trim rollback component readback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const recoveryVerified = recoveryResult
    && sequenceContentSignature(recovered) === sequenceContentSignature(before)
    && JSON.stringify(canonicalJsonValue(recovered.transitions)) === JSON.stringify(canonicalJsonValue(before.transitions))
    && recoveryComponentsPreserved;
  if (!recoveryVerified) recoveryErrors.push("Trim rollback did not restore the complete timeline snapshot");
  return {
    status: "fail",
    before,
    hostResult: {
      transaction: hostResult,
      plan,
      readback,
      exactTicks,
      trackCountsUnchanged,
      transitionsUnchanged,
      componentsPreserved,
      rollback: { attempted: Boolean(readback.observedTargetId), transaction: recoveryResult, componentsPreserved: recoveryComponentsPreserved, verified: recoveryVerified },
    },
    after,
    errors: [
      ...(!hostResult ? ["Premiere rejected one or more exact trim actions"] : []),
      ...(!readback.trimmedItemId ? ["Trimmed item did not read back at the exact source/timeline range"] : []),
      ...(readback.observedTargetId && !exactTicks.pass ? ["Trimmed clip boundary ticks differ from the exact frame boundary"] : []),
      ...(readback.observedTargetId && !readback.sourceRangeMatches ? ["Premiere timeline trim produced an unexpected coupled source range"] : []),
      ...readback.missingUnrelatedIds.map((id) => `Unrelated timeline item disappeared: ${id}`),
      ...readback.unexpectedIds.map((id) => `Unexpected timeline item appeared: ${id}`),
      ...(!trackCountsUnchanged ? ["Track counts changed during exact trim"] : []),
      ...(!transitionsUnchanged ? ["Transitions changed during exact trim"] : []),
      ...(!componentsPreserved ? ["Trimmed clip components or keyframes changed"] : []),
      ...recoveryErrors,
    ],
    recovery: recoveryVerified
      ? "Premiere trim verification failed, and the automatic inverse timeline trim returned the complete pre-operation state. Refresh inspect_project before retrying."
      : "Automatic trim recovery was not proven. Do not retry or save; inspect the exact project and sequence first.",
  };
}

async function moveClips(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const actualProjectId = text(project.guid) || text(project.path) || text(project.name);
  const actualSequenceId = await sequenceId(sequence);
  if (actualProjectId !== text(args.expectedProjectId)) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", `Expected project ${text(args.expectedProjectId)}, active project is ${actualProjectId}`);
  }
  if (actualSequenceId !== text(args.expectedSequenceId) || text(sequence.name) !== text(args.expectedSequenceName)) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the exact move target");
  }
  const before = await sequenceSnapshot(sequence);
  if (before.itemsTruncated) throw new HostCommandError("TIMELINE_READBACK_TRUNCATED", "Clip move requires a complete timeline snapshot");
  const request = args.move as AnyRecord;
  const entry = await findTrackItemEntry(sequence, text(request.trackItemId));
  let plan;
  try {
    plan = planExactClipMove(request as any, entry.snapshot as unknown as MoveTimelineItem, before.items as unknown as MoveTimelineItem[], Number(before.frameRate));
  } catch (error) {
    throw new HostCommandError("MOVE_PREFLIGHT_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (transitionsAtClipEdge(before, entry.snapshot, "start").length || transitionsAtClipEdge(before, entry.snapshot, "end").length) {
    throw new HostCommandError("ATTACHED_TRANSITION_UNVERIFIED", "Clip move refuses targets with an edge transition until transition movement is explicit");
  }
  assertMethod(entry.raw, "createMoveAction", "TrackItem.createMoveAction");
  assertMethod(sequence, "getTimebase", "Sequence.getTimebase");
  let ticks;
  try {
    ticks = exactMoveTicks(entry.snapshot as unknown as MoveTimelineItem, plan.offsetSeconds, text(await sequence.getTimebase()));
  } catch (error) {
    throw new HostCommandError("MOVE_PREFLIGHT_FAILED", error instanceof Error ? error.message : String(error));
  }
  // Both signed native offsets (move and its inverse) are proven before dispatch.
  tickTimeFromTicks(ticks.offsetTicks);
  const inverseOffsetTicks = (-BigInt(ticks.offsetTicks)).toString();
  tickTimeFromTicks(inverseOffsetTicks);
  const beforeComponents = await componentSnapshot(entry.raw);
  const hostResult = executeTransaction(project, `Move exact ${plan.mediaType} clip`, () => [entry.raw.createMoveAction(tickTimeFromTicks(ticks.offsetTicks))]);
  const after = await targetSequenceSnapshot(args);
  const readback = assessExactClipMove(
    before.items as unknown as MoveTimelineItem[],
    after.items as unknown as MoveTimelineItem[],
    plan,
  );
  // The frame-tolerant match only locates the moved item; PASS needs exact ticks.
  const movedItem = readback.movedItemId ? (after.items as unknown as MoveTimelineItem[]).find((item) => item.id === readback.movedItemId) : undefined;
  const exactTicks = { expected: ticks, observed: movedItem ? { startTicks: text(movedItem.start.ticks), endTicks: text(movedItem.end.ticks) } : null,
    pass: moveTicksMatch(movedItem, ticks) };
  const trackCountsUnchanged = before.videoTracks === after.videoTracks
    && before.audioTracks === after.audioTracks
    && before.captionTracks === after.captionTracks;
  const transitionsUnchanged = JSON.stringify(canonicalJsonValue(before.transitions)) === JSON.stringify(canonicalJsonValue(after.transitions));
  let componentsPreserved = false;
  if (readback.movedItemId) {
    const current = await mutationContext(args);
    const moved = await findTrackItemEntry(current.sequence, readback.movedItemId);
    componentsPreserved = splitComponentSignature(await componentSnapshot(moved.raw)) === splitComponentSignature(beforeComponents);
  }
  const pass = hostResult && readback.status === "pass" && exactTicks.pass && trackCountsUnchanged && transitionsUnchanged && componentsPreserved;
  if (pass) {
    return {
      status: "pass",
      before,
      hostResult: { transaction: hostResult, plan, readback, exactTicks, trackCountsUnchanged, transitionsUnchanged, componentsPreserved },
      after,
      errors: [],
    };
  }

  const recoveryErrors: string[] = [];
  let recoveryResult = false;
  let recoveryComponentsPreserved = false;
  if (readback.movedItemId) {
    try {
      const current = await mutationContext(args);
      const moved = await findTrackItemEntry(current.sequence, readback.movedItemId);
      recoveryResult = executeTransaction(current.project, "Recover failed exact clip move", () => [moved.raw.createMoveAction(tickTimeFromTicks(inverseOffsetTicks))]);
    } catch (error) {
      recoveryErrors.push(`Move rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const recovered = await targetSequenceSnapshot(args);
  if (recoveryResult) {
    try {
      const current = await mutationContext(args);
      const original = await findTrackItemEntry(current.sequence, plan.targetId);
      recoveryComponentsPreserved = splitComponentSignature(await componentSnapshot(original.raw)) === splitComponentSignature(beforeComponents);
    } catch (error) {
      recoveryErrors.push(`Move rollback component readback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const recoveryVerified = recoveryResult
    && sequenceContentSignature(recovered) === sequenceContentSignature(before)
    && JSON.stringify(canonicalJsonValue(recovered.transitions)) === JSON.stringify(canonicalJsonValue(before.transitions))
    && recoveryComponentsPreserved;
  if (!recoveryVerified) recoveryErrors.push("Move rollback did not restore the complete timeline snapshot");
  return {
    status: "fail",
    before,
    hostResult: {
      transaction: hostResult,
      plan,
      readback,
      trackCountsUnchanged,
      transitionsUnchanged,
      componentsPreserved,
      exactTicks,
      rollback: { attempted: Boolean(readback.movedItemId), transaction: recoveryResult, componentsPreserved: recoveryComponentsPreserved, verified: recoveryVerified },
    },
    after,
    errors: [
      ...(!hostResult ? ["Premiere rejected the exact clip move transaction"] : []),
      ...(!readback.movedItemId ? ["Moved item did not appear at the exact destination"] : []),
      ...(readback.movedItemId && !exactTicks.pass ? ["Moved clip ticks differ from the exact frame destination"] : []),
      ...(readback.originalStillPresent ? ["Original timeline item remained at its old position"] : []),
      ...readback.missingUnrelatedIds.map((id) => `Unrelated timeline item disappeared: ${id}`),
      ...readback.unexpectedIds.map((id) => `Unexpected timeline item appeared: ${id}`),
      ...(!trackCountsUnchanged ? ["Track counts changed during clip move"] : []),
      ...(!transitionsUnchanged ? ["Transitions changed during clip move"] : []),
      ...(!componentsPreserved ? ["Moved clip components or keyframes changed"] : []),
      ...recoveryErrors,
    ],
    recovery: recoveryVerified
      ? "Premiere move verification failed, and the automatic inverse move restored the complete pre-operation timeline snapshot. Refresh inspect_project before retrying."
      : "Automatic inverse-move recovery was not proven. Do not retry or save; inspect the exact project and sequence first.",
  };
}

async function removeClips(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const actualProjectId = text(project.guid) || text(project.path) || text(project.name);
  const actualSequenceId = await sequenceId(sequence);
  if (actualProjectId !== text(args.expectedProjectId)) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", `Expected project ${text(args.expectedProjectId)}, active project is ${actualProjectId}`);
  }
  if (actualSequenceId !== text(args.expectedSequenceId) || text(sequence.name) !== text(args.expectedSequenceName)) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the exact removal target");
  }
  if (args.ripple !== false) {
    throw new HostCommandError("RIPPLE_REMOVAL_UNVERIFIED", "remove_clips currently accepts only ripple=false so every unrelated timeline item can be proven unchanged");
  }
  const targets = Array.isArray(args.targets) ? args.targets : [];
  const ids = targets.map((target: AnyRecord) => text(target.trackItemId));
  if (!ids.length) throw new HostCommandError("EMPTY_REMOVAL_SELECTION", "Clip removal requires at least one exact target");
  if (new Set(ids).size !== ids.length) throw new HostCommandError("DUPLICATE_REMOVAL_TARGET", "Clip removal target IDs must be unique");
  const before = await sequenceSnapshot(sequence);
  if (before.itemsTruncated) throw new HostCommandError("TIMELINE_READBACK_TRUNCATED", "Clip removal requires a complete timeline snapshot");
  // Resolve every selected wrapper from one traversal. Re-running trackItems
  // for each ID can invalidate wrappers already collected by Premiere.
  const availableItems = await trackItems(sequence);
  const selected: Array<{ raw: any; snapshot: AnyRecord }> = [];
  for (const target of targets) {
    const id = text(target.trackItemId);
    const found = availableItems.find((item) => item.snapshot.id === id);
    if (!found) throw new HostCommandError("TRACK_ITEM_NOT_FOUND", `Track item not found: ${id}`);
    const matches = found.snapshot.projectItemId === text(target.expectedProjectItemId)
      && (found.snapshot.projectItemId || found.snapshot.name===target.expectedClipName)
      && found.snapshot.mediaType === text(target.expectedMediaType)
      && Number(found.snapshot.trackIndex) === Number(target.expectedTrackIndex)
      && hostNumericValuesEqual(Number(found.snapshot.start?.seconds), Number(target.expectedStartSeconds))
      && hostNumericValuesEqual(Number(found.snapshot.end?.seconds), Number(target.expectedEndSeconds));
    if (!matches) throw new HostCommandError("TRACK_ITEM_PRECONDITION_FAILED", `Timeline item differs from the exact removal target: ${id}`);
    selected.push(found);
  }
  const mediaTypes = new Set(selected.map((entry) => text(entry.snapshot.mediaType)));
  if (mediaTypes.size !== 1) {
    throw new HostCommandError("MIXED_MEDIA_REMOVAL_UNVERIFIED", "One remove_clips call must target only video items or only audio items");
  }
  const mediaType = [...mediaTypes][0];
  if (mediaType !== "video" && mediaType !== "audio") {
    throw new HostCommandError("INVALID_MEDIA_TYPE", `Clip removal does not support media type: ${mediaType}`);
  }
  const touchedTransitions = before.transitions.filter((transition: AnyRecord) => selected.some((entry) => (
    Number(transition.trackIndex) === Number(entry.snapshot.trackIndex)
      && (isFrameAligned(Number(transition.start?.seconds), Number(entry.snapshot.start?.seconds))
        || isFrameAligned(Number(transition.end?.seconds), Number(entry.snapshot.end?.seconds)))
  )));
  if (touchedTransitions.length) {
    throw new HostCommandError("ATTACHED_TRANSITION_UNVERIFIED", "Clip removal refuses targets with an edge transition until transition-removal intent is explicit");
  }
  const selection = await liveTrackItemSelection(sequence, selected);
  assertMethod(ppro.SequenceEditor, "getEditor", "SequenceEditor.getEditor");
  const editor = ppro.SequenceEditor.getEditor(sequence);
  assertMethod(editor, "createRemoveItemsAction", "SequenceEditor.createRemoveItemsAction");
  let hostResult = false;
  try {
    const hostMediaType = mediaType === "video" ? ppro.Constants.MediaType.VIDEO : ppro.Constants.MediaType.AUDIO;
    hostResult = executeTransaction(project, `Lift ${ids.length} ${mediaType} clips`, () => [editor.createRemoveItemsAction(selection, false, hostMediaType, true)]);
  } finally {
    await sequence.clearSelection().catch(() => false);
  }
  const after = await targetSequenceSnapshot(args);
  const readback = assessLiftRemoval(
    before.items.map((item: AnyRecord) => text(item.id)),
    after.items.map((item: AnyRecord) => text(item.id)),
    ids,
  );
  const trackCountsUnchanged = before.videoTracks === after.videoTracks
    && before.audioTracks === after.audioTracks
    && before.captionTracks === after.captionTracks;
  const transitionsUnchanged = JSON.stringify(before.transitions) === JSON.stringify(after.transitions);
  const pass = hostResult && readback.status === "pass" && trackCountsUnchanged && transitionsUnchanged;
  return {
    status: pass ? "pass" : "fail",
    before,
    hostResult: { transaction: hostResult, mediaType, readback, trackCountsUnchanged, transitionsUnchanged },
    after,
    errors: pass ? [] : [
      ...(!hostResult ? ["Premiere rejected the lift-removal transaction"] : []),
      ...readback.remainingTargetIds.map((id) => `Requested timeline item still exists: ${id}`),
      ...readback.missingUnrelatedIds.map((id) => `Unrelated timeline item disappeared: ${id}`),
      ...readback.unexpectedIds.map((id) => `Unexpected timeline item appeared: ${id}`),
      ...(!trackCountsUnchanged ? ["Track counts changed during clip lift"] : []),
      ...(!transitionsUnchanged ? ["Timeline transitions changed during clip lift"] : []),
    ],
  };
}

async function detectSceneCuts(args: AnyRecord): Promise<HostResult> {
  const { sequence } = await mutationContext(args);
  const ids = Array.isArray(args.trackItemIds) ? args.trackItemIds.map(text) : [];
  if (!ids.length) throw new HostCommandError("EMPTY_SCENE_DETECTION_SELECTION", "Scene detection requires at least one video clip");
  if (new Set(ids).size !== ids.length) throw new HostCommandError("DUPLICATE_SCENE_DETECTION_TARGET", "Scene detection target IDs must be unique");

  const before = await sequenceSnapshot(sequence);
  if (before.itemsTruncated) throw new HostCommandError("TIMELINE_READBACK_TRUNCATED", "Scene detection requires a complete timeline snapshot");
  const availableItems = await trackItems(sequence);
  const selectedEntries: Array<{ raw: any; snapshot: AnyRecord }> = [];
  for (const id of ids) {
    const found = availableItems.find((item) => item.snapshot.id === id);
    if (!found) throw new HostCommandError("TRACK_ITEM_NOT_FOUND", `Scene detection track item not found: ${id}`);
    if (found.snapshot.mediaType !== "video") throw new HostCommandError("VIDEO_TRACK_ITEM_REQUIRED", `Scene detection accepts video clips only: ${id}`);
    selectedEntries.push(found);
  }
  const selection = await liveTrackItemSelection(sequence, selectedEntries);

  assertMethod(ppro.SequenceUtils, "performSceneEditDetectionOnSelection", "SequenceUtils.performSceneEditDetectionOnSelection");
  const operation = text(ppro.SequenceUtils.SEQUENCE_OPERATION_APPLYCUT);
  if (!operation) throw new HostCommandError("UNSUPPORTED_API", "Premiere does not expose SequenceUtils.SEQUENCE_OPERATION_APPLYCUT");
  let accepted = false;
  try {
    accepted = Boolean(await ppro.SequenceUtils.performSceneEditDetectionOnSelection(operation, selection));
  } finally {
    await sequence.clearSelection().catch(() => false);
  }
  const after = await targetSequenceSnapshot(args);
  if (after.itemsTruncated) throw new HostCommandError("TIMELINE_READBACK_TRUNCATED", "Scene detection readback exceeded the timeline item limit");
  const readback = assessSceneCutReadback(
    before.items as SceneDetectionItem[],
    after.items as SceneDetectionItem[],
    ids,
    Number(before.frameRate),
  );
  const minimumCutCount = Number(args.minimumCutCount ?? 0);
  const errors = [
    ...readback.errors,
    ...(!accepted ? ["Premiere rejected native scene edit detection"] : []),
    ...(readback.detectedCutCount < minimumCutCount
      ? [`Detected ${readback.detectedCutCount} cuts, fewer than the required ${minimumCutCount}`]
      : []),
  ];
  return {
    status: errors.length ? "fail" : "pass",
    before: {
      sequenceId: before.id,
      sequenceName: before.name,
      timelineItemCount: before.items.length,
      selected: selectedEntries.map((entry) => entry.snapshot),
    },
    hostResult: { accepted, operation, readback },
    after: {
      sequenceId: after.id,
      sequenceName: after.name,
      timelineItemCount: after.items.length,
      detectedCutCount: readback.detectedCutCount,
      targets: readback.targets,
    },
    errors,
  };
}

async function addMarkers(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const markers = Array.isArray(args.markers) ? args.markers : [];
  const before = await inspectMarkers();
  const newMarkers = markers.filter((marker) => !before.some((existing) => existing.name === text(marker.name) && Math.abs(Number(existing.start?.seconds ?? -1) - Number(marker.timeSeconds ?? 0)) < 0.000_001));
  if (!newMarkers.length) return { status: "pass", before, hostResult: { added: 0, skippedAlreadyPresent: markers.length }, after: before, errors: [] };
  const owner = await ppro.Markers.getMarkers(sequence);
  assertMethod(owner, "createAddMarkerAction", "Markers.createAddMarkerAction");
  const transaction = executeTransaction(project, `Add ${newMarkers.length} markers`, () => newMarkers.map((marker) => owner.createAddMarkerAction(
    text(marker.name), text(marker.type) || "Comment", tickFromSeconds(Number(marker.timeSeconds ?? 0)), tickFromSeconds(Number(marker.durationSeconds ?? 0)), text(marker.comments),
  )));
  const after = await inspectMarkers();
  const expected = newMarkers.map((marker) => text(marker.name));
  const pass = transaction && expected.every((name) => after.some((marker) => marker.name === name));
  return { status: pass ? "pass" : "fail", before, hostResult: { transaction, added: newMarkers.length, skippedAlreadyPresent: markers.length - newMarkers.length }, after, errors: pass ? [] : ["Added markers did not read back"] };
}

async function insertMogrtCaption(args: AnyRecord,progress?:HostCommandProgress): Promise<HostResult> {
  return insertEditableGraphic(args,progress,true);
}

async function verifyTrailingGraphicReadback(args:AnyRecord,snapshot:AnyRecord,afterInsertion=false):Promise<void>{
  if(ppro.Constants?.TrackItemType?.TRANSITION===undefined)throw Error('Trailing append requires the native transition collection API');
  const errors=graphicAppendErrors(snapshot,args,afterInsertion);
  if(errors.length)throw new HostCommandError('GRAPHIC_APPEND_PRECONDITION_FAILED',errors.join('; '));
  await verifyGraphicAppendTrackStates(snapshot,async(mediaType,index)=>{
    const current=await mutationContext(args);
    const track=await (mediaType==='video'?current.sequence.getVideoTrack(index):mediaType==='audio'?current.sequence.getAudioTrack(index):current.sequence.getCaptionTrack(index));
    const id=Number(track.id),name=text(track.name);
    const muted=await track.isMuted();
    if(typeof muted!=='boolean')throw Error('Trailing append track mute state is unreadable');
    return {id,name,muted};
  });
  await requireEmptyGraphicAppendTransitions(async mediaType=>{
    const current=await mutationContext(args);
    const track=await (mediaType==='video'?current.sequence.getVideoTrack(Number(args.videoTrackIndex)):current.sequence.getAudioTrack(Number(args.audioTrackIndex)));
    return await track.getTrackItems(ppro.Constants.TrackItemType.TRANSITION,false);
  });
}

async function prepareEditableGraphic(args: AnyRecord,allowTrailingAppend=false) {
  const insertionMode=args.insertionMode??'empty_track';
  if(!['empty_track','trailing_append'].includes(insertionMode)||insertionMode==='trailing_append'&&!allowTrailingAppend)throw new HostCommandError('GRAPHIC_INSERTION_MODE_UNSUPPORTED','Trailing append is supported only by insert_mogrt_caption');
  const trailingAppend=insertionMode==='trailing_append';
  const { project, sequence } = await mutationContext(args);
  const actualProjectId = text(project.guid) || text(project.path) || text(project.name);
  const actualSequenceId = await sequenceId(sequence);
  if (actualProjectId !== text(args.expectedProjectId)) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", `Expected project ${text(args.expectedProjectId)}, active project is ${actualProjectId}`);
  }
  if (actualSequenceId !== text(args.expectedSequenceId) || text(sequence.name) !== text(args.expectedSequenceName)) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the exact editable-graphic target");
  }
  const before = await sequenceSnapshot(sequence);
  if (before.itemsTruncated) throw new HostCommandError("TIMELINE_READBACK_TRUNCATED", "Editable-graphic insertion requires a complete timeline snapshot");
  const countMismatches = [
    ["video tracks", before.videoTracks, args.expectedVideoTrackCount],
    ["audio tracks", before.audioTracks, args.expectedAudioTrackCount],
    ["caption tracks", before.captionTracks, args.expectedCaptionTrackCount],
    ["timeline items", before.items.length, args.expectedTimelineItemCount],
  ].filter(([, actual, expected]) => Number(actual) !== Number(expected));
  if (countMismatches.length) {
    throw new HostCommandError("TIMELINE_PRECONDITION_FAILED", countMismatches.map(([label, actual, expected]) => `${label}: expected ${expected}, actual ${actual}`).join("; "));
  }
  const targetTrack = before.tracks.find((track: AnyRecord) => track.mediaType === "video" && Number(track.index) === Number(args.videoTrackIndex));
  if (!targetTrack
    || Number(targetTrack.id) !== Number(args.expectedVideoTrackId)
    || text(targetTrack.name) !== text(args.expectedVideoTrackName)
    || Number(targetTrack.itemCount) !== (trailingAppend?args.expectedVideoTrackItemCount:0)
    || Number(targetTrack.transitionCount) !== 0) {
    throw new HostCommandError("VIDEO_TRACK_PRECONDITION_FAILED", "The requested existing video track is missing, changed, or not empty");
  }
  if (Number(args.audioTrackIndex) < 0 || Number(args.audioTrackIndex) >= Number(before.audioTracks)) {
    throw new HostCommandError("AUDIO_TRACK_PRECONDITION_FAILED", "The MOGRT audio-track argument is outside the existing sequence tracks");
  }
  const startTicks=BigInt(Math.round(Number(args.timeSeconds)*254016000000));
  const durationTicks=args.durationSeconds===undefined?undefined:BigInt(Math.round(Number(args.durationSeconds)*254016000000));
  const frameTicks=BigInt(text(await sequence.getTimebase()));
  if(startTicks%frameTicks!==0n || (durationTicks!==undefined&&(durationTicks<=0n||durationTicks%frameTicks!==0n)))throw new HostCommandError("GRAPHIC_TIME_NOT_FRAME_ALIGNED","Graphic start and duration must lie on the sequence frame grid. Read sequence frameRate/timebase, choose integer start/duration frames, and convert frames*frameTicks/254016000000 to seconds. Automatic alignment is not implemented");

  if(trailingAppend)await verifyTrailingGraphicReadback(args,before);

  assertMethod(ppro.SequenceEditor, "getEditor", "SequenceEditor.getEditor");
  const insertionContext=trailingAppend?await mutationContext(args):{project,sequence};
  const editor = ppro.SequenceEditor.getEditor(insertionContext.sequence);
  assertMethod(editor, "insertMogrtFromPath", "SequenceEditor.insertMogrtFromPath");
  return {...insertionContext,before,startTicks,durationTicks,editor};
}

async function insertEditableGraphic(args: AnyRecord,progress?:HostCommandProgress,allowTrailingAppend=false): Promise<HostResult> {
  let prepared;
  try {prepared=await observeHostAwait(progress,'prepareEditableGraphic',()=>prepareEditableGraphic(args,allowTrailingAppend));}
  catch(error){return {status:"fail",hostResult:{contentDispatched:false,phase:"preflight"},errors:[String(error)]};}
  const {project,before,startTicks,durationTicks,editor}=prepared;
  let inserted: any[] = [];
  let insertionError = "";
  try {
    observeHostSync(progress?.at('graphic.insert'),'insertMogrtFromPath',()=>project.lockedAccess(() => {
      inserted = editor.insertMogrtFromPath(
        text(args.mogrtPath),
        ppro.TickTime.createWithTicks(String(startTicks)),
        Number(args.videoTrackIndex),
        Number(args.audioTrackIndex),
      );
    }));
  } catch (error) {
    insertionError = error instanceof Error ? error.message : String(error);
  } finally { noteGraphicMutation(); }

  let after:AnyRecord;
  try {
    await observeHostAwait(progress?.at('graphic.timeline.after_insert'),'readinessWait',()=>waitGraphicMutationQuiet());
    after=await observeHostAwait(progress?.at('graphic.timeline.after_insert'),'targetSequenceSnapshot',()=>targetSequenceSnapshot(args));
    if(args.insertionMode==='trailing_append')await verifyTrailingGraphicReadback(args,after,true);
  }
  catch(error){return {status:"unverified",before,hostResult:{insertedCount:inserted.length,insertionError},errors:[String(error)],recovery:"MOGRT insertion was dispatched but the timeline could not be read. Inspect before retrying or saving."};}
  let assessment=assessGraphicInsertion(before,after,{...args,durationSeconds:undefined});
  const errors=[...(insertionError?[`Premiere insertion threw: ${insertionError}`]:[]),...(inserted.length!==1?[`Premiere returned ${inserted.length} items`]:[]),...assessment.errors];
  let insertedComponents: AnyRecord[] = [];
  let sourceBoundsProof: AnyRecord | undefined;
  let durationPreservation: ReturnType<typeof graphicDurationDiagnostics> | undefined;
  if (!errors.length && assessment.insertedItem) {
    try {
      const insertedBaseline=assessment.insertedItem;
      const lookupHint={};
      let current = await observeHostAwait(progress?.at('graphic.lookup'),'mutationContext',()=>mutationContext(args));
      let entry=await observeHostAwait(progress?.at('graphic.lookup'),'findTrackItemEntry',()=>findTrackItemEntry(current.sequence,text(insertedBaseline.id),lookupHint));
      const reacquire=async(trace?:HostCommandProgress)=>{
        current=await observeHostAwait(trace,'mutationContext',()=>mutationContext(args));
        entry=await observeHostAwait(trace,'findTrackItemEntry',()=>findTrackItemEntry(current.sequence,text(insertedBaseline.id),lookupHint));
      };
      const readComponents=(trace?:HostCommandProgress)=>observeHostAwait(trace,'componentSnapshot',()=>graphicComponentSnapshot(async()=>{await reacquire(trace);return entry;},true,undefined,undefined,trace,args.expectedGraphicKind==='rectangle'?'AE.ADBE Shape':undefined));
      // Observe stable topology before any parameter promises, including after
      // the duration transaction. Every leaf rebinds the exact inserted item.
      insertedComponents=await readComponents(progress?.at('graphic.components.readiness'));
      if(!insertedComponents.length)throw Error("Native graphic component chain is empty");
      if(args.expectedGraphicKind==="rectangle") {
        const shape=insertedComponents.find(c=>c.matchName==="AE.ADBE Shape");
        if(!shape)throw Error("Native rectangle Shape did not become available within 20 completed read attempts");
        const spec=args.expectedShapeState;
        if(!spec)throw Error("Rectangle artifact state was not provided");
        const opacity=insertedComponents.find(c=>c.matchName==="AE.ADBE Opacity")?.params[0];
        if(!opacity || opacity.value!==100 || opacity.timeVarying || opacity.keyframes.length)throw Error("Rectangle inherited unexpected clip opacity/animation");
        const writes=[{paramIndex:3,value:{kind:"point",...spec.position}},{paramIndex:4,value:100},{paramIndex:5,value:100},{paramIndex:7,value:spec.rotationDegrees},{paramIndex:8,value:spec.opacityPercent},{paramIndex:9,value:{kind:"point",x:0,y:0}}]
          .map(w=>({...w,expectedDisplayName:shape.params[w.paramIndex].displayName}));
        const selector={componentIndex:shape.componentIndex,componentMatchName:shape.matchName};
        const trace=progress?.at('graphic.parameters');
        await reacquire(trace);
        await observeHostAwait(trace,'setComponentValues',()=>setComponentValues(current.project,entry.raw,writes,selector,insertedComponents));
        await reacquire(trace);
        insertedComponents=await readComponents(trace);
        const verified=componentValuesMatch(insertedComponents,writes,selector);
        if(verified.missing.length||verified.mismatched.length)throw Error("Imported rectangle transform normalization failed");
      }
      if(Object.keys(args.parameterValues??{}).length){
        const trace=progress?.at('graphic.parameters');
        await reacquire(trace);
        await observeHostAwait(trace,'setComponentValues',()=>setComponentValues(current.project,entry.raw,args.parameterValues,undefined,insertedComponents));
        await reacquire(trace);
        insertedComponents=await readComponents(trace);
        const values=componentValuesMatch(insertedComponents,args.parameterValues);
        if(values.missing.length||values.mismatched.length)throw Error("Graphic parameter readback failed");
      }
      const beforeDurationComponents=insertedComponents;
      if(durationTicks!==undefined){
        // Same proven timeline-only trim contract as trim_clip_exact: Premiere
        // moves the source out-point itself. Setting it separately can deref a
        // null media item for timeline-native graphics.
        const trace=progress?.at('graphic.duration');
        await reacquire(trace);
        if(!observeHostSync(trace,'executeTransaction',()=>executeTransaction(current.project,"Set inserted graphic duration",()=>[
          observeHostSync(trace,'createSetEndAction',()=>entry.raw.createSetEndAction(ppro.TickTime.createWithTicks(String(startTicks+durationTicks)))),
        ])))throw Error("Premiere rejected graphic duration");
      }
      await observeHostAwait(progress?.at('graphic.timeline.final'),'readinessWait',()=>waitGraphicMutationQuiet());
      after=await observeHostAwait(progress?.at('graphic.timeline.final'),'targetSequenceSnapshot',()=>targetSequenceSnapshot(args));
      if(args.insertionMode==='trailing_append')await verifyTrailingGraphicReadback(args,after,true);
      assessment=assessGraphicInsertion(before,after,args); errors.push(...assessment.errors);
      const finalTrace=progress?.at('graphic.components.final');
      const finalContext=await observeHostAwait(finalTrace,'mutationContext',()=>mutationContext(args));
      entry=await observeHostAwait(finalTrace,'findTrackItemEntry',()=>findTrackItemEntry(finalContext.sequence,text(assessment.insertedItem?.id)));
      insertedComponents=await readComponents(finalTrace);
      durationPreservation=graphicDurationDiagnostics(beforeDurationComponents,insertedComponents);
      if(!snapshotsEqual(beforeDurationComponents,insertedComponents))throw Error('Graphic duration changed component values or animation');
      const finalValues=componentValuesMatch(insertedComponents,args.parameterValues??{});
      if(finalValues.missing.length||finalValues.mismatched.length)throw Error('Final graphic parameter readback failed after duration change');
      await reacquire(finalTrace);
      if(!snapshotsEqual(assessment.insertedItem,entry.snapshot))throw Error('Graphic source bounds changed across final timeline and component readback');
      sourceBoundsProof={status:'pass',basis:'fresh_timeline_and_settled_component_readback',item:entry.snapshot};
    } catch(error) { errors.push(`Graphic component/duration verification: ${String(error)}`); }
  }
  const {newItems,insertedItem,missingUnrelatedIds,changedUnrelatedIds,trackCountsUnchanged,transitionsUnchanged,tracksPreserved,sequenceSettingsUnchanged}=assessment;
  const pass=errors.length===0;

  let rollbackAttempted = false;
  const rollbackTransactions: boolean[] = [];
  let recoveryVerified = false;
  let recoveredSnapshot: AnyRecord | null = null;
  if (!pass && newItems.length) {
    rollbackAttempted = true;
    try {
      for (const mediaType of ["video", "audio"] as const) {
        const ids = newItems.filter((item) => item.mediaType === mediaType).map((item) => text(item.id));
        if (!ids.length) continue;
        const trace=progress?.at('graphic.rollback');
        const current = await observeHostAwait(trace,'mutationContext',()=>mutationContext(args));
        const currentEntries = (await observeHostAwait(trace,'trackItems',()=>trackItems(current.sequence))).filter((entry) => ids.includes(text(entry.snapshot.id)));
        if (currentEntries.length !== ids.length) throw new Error(`Could not reacquire every inserted ${mediaType} item for rollback`);
        const selection = await observeHostAwait(trace,'liveTrackItemSelection',()=>liveTrackItemSelection(current.sequence, currentEntries));
        const currentEditor = ppro.SequenceEditor.getEditor(current.sequence);
        assertMethod(currentEditor, "createRemoveItemsAction", "SequenceEditor.createRemoveItemsAction");
        try {
          const hostMediaType = mediaType === "video" ? ppro.Constants.MediaType.VIDEO : ppro.Constants.MediaType.AUDIO;
          rollbackTransactions.push(observeHostSync(trace,'executeTransaction',()=>executeTransaction(current.project, `Rollback failed editable graphic ${mediaType}`, () => [observeHostSync(trace,'createRemoveItemsAction',()=>currentEditor.createRemoveItemsAction(selection, false, hostMediaType, true))])));
        } finally {
          await observeHostAwait(trace,'clearSelection',()=>current.sequence.clearSelection().catch(() => false));
        }
      }
      const recovered = await observeHostAwait(progress?.at('graphic.rollback'),'targetSequenceSnapshot',()=>targetSequenceSnapshot(args));
      recoveredSnapshot = recovered;
      recoveryVerified = sequenceContentSignature(recovered) === sequenceContentSignature(before)
        && JSON.stringify(recovered.tracks) === JSON.stringify(before.tracks)
        && JSON.stringify(recovered.transitions) === JSON.stringify(before.transitions)
        && JSON.stringify(recovered.captionTrackStates) === JSON.stringify(before.captionTrackStates)
        && (args.insertionMode!=='trailing_append'||snapshotsEqual(recovered.items,before.items));
    } catch (error) {
      errors.push(`Automatic rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    status: pass ? (args.expectedGraphicKind==="rectangle" ? "unverified":"pass") : recoveryVerified ? "fail" : "unverified",
    before,
    hostResult: {
      insertedCount: inserted.length,
      insertedItem: insertedItem ?? null,
      insertedComponents,
      ...(durationPreservation?{durationPreservation}:{}),
      ...(sourceBoundsProof?{sourceBoundsProof}:{}),
      shapeVerification: args.expectedGraphicKind==="rectangle" ? "requires_saved_archive_readback" : "not_requested",
      artifact: { path: text(args.mogrtPath), sha256: text(args.expectedMogrtSha256) },
      readback: { newItems, missingUnrelatedIds, changedUnrelatedIds, trackCountsUnchanged, transitionsUnchanged, tracksPreserved, sequenceSettingsUnchanged },
      rollback: { attempted: rollbackAttempted, transactions: rollbackTransactions, verified: recoveryVerified, recovered: recoveredSnapshot },
    },
    after,
    errors: pass && args.expectedGraphicKind==="rectangle" ? ["Native graphic group inserted; Node server must verify the saved rectangle shape and appearance"] : errors,
    ...(pass ? {} : {
      recovery: recoveryVerified
        ? "Editable-graphic insertion verification failed, and the exact pre-operation timeline structure was restored. Refresh inspect_project before retrying."
        : "Editable-graphic insertion verification failed and rollback was not proven. Do not save or retry; inspect the exact project and sequence first.",
    }),
  };
}

/** Effect content reads acquire ordinary public values first, then complete
 * missing Point animation proof through the current command's bounded adapter.
 * No native wrapper or proof survives the command. Strict callers still reject
 * every unverified value/animation after native enrichment. */
async function effectSnapshot(args:AnyRecord,item:any,strict=false,_parallel=false,sampleTime?:any,graphicTargetSnapshot?:AnyRecord):Promise<AnyRecord[]> {
  let snapshot=await effectComponents(args,item,sampleTime,undefined,graphicTargetSnapshot);void _parallel;
  if(typeof args.__readEffectChain==='function')snapshot=await args.__readEffectChain(snapshot);
  if(strict)for(const c of snapshot)for(const p of c.params){
    if(p.readStatus.value==='unverified'||p.readStatus.animation!=='pass')throw Error(`Incomplete effect readback: ${c.componentIndex}:${p.paramIndex}`);
  }
  return snapshot;
}

async function effectComponents(args:AnyRecord,item:any,sampleTime?:any,projection?:{componentIndex:number;paramIndex?:number},graphicTargetSnapshot?:AnyRecord):Promise<AnyRecord[]> {
  if(!needsSettledEffectObjects(args))return componentSnapshot(item,false,false,sampleTime,projection);
  const expected=graphicTargetSnapshot??(await exactEffectTarget(args)).entry.snapshot;
  return graphicComponentSnapshot(async()=>{
    const fresh=(await exactEffectTarget(args)).entry;
    // Native source in/out can settle independently of timeline start/end.
    // Never report values sampled/mapped using a different source snapshot.
    if(!snapshotsEqual(expected,fresh.snapshot))throw new HostCommandError('TRACK_ITEM_PRECONDITION_FAILED','Effect source bounds or metadata changed during effect inspection; refresh the exact timeline target');
    return fresh;
  },false,sampleTime,projection);
}

async function selectedComponent(item: any, selector: AnyRecord, baseline?: AnyRecord[]): Promise<{ chain: any; component: any; snapshot: AnyRecord; snapshots: AnyRecord[] }> {
  const snapshots = baseline ?? await componentSnapshot(item);
  const matches = snapshots.filter((candidate) => componentMatches(candidate, selector));
  if (matches.length !== 1) throw new HostCommandError("COMPONENT_NOT_FOUND_OR_AMBIGUOUS", "The requested selector must match exactly one clip component");
  const snapshot = matches[0]!;
  const chain = await item.getComponentChain();
  return { chain, component: chain.getComponentAtIndex(Number(snapshot.componentIndex)), snapshot, snapshots };
}

async function applyVideoEffect(args: AnyRecord): Promise<HostResult> {return applyComponentEffect(args,"video");}
function assertEffectSequenceState(args:AnyRecord,before:AnyRecord[]):void {
  if(args.expectedEffectState!==undefined&&!snapshotsEqual(args.expectedEffectState,effectStateProjection(before)))throw new HostCommandError('EFFECT_SEQUENCE_STATE_CHANGED','Effect chain changed since the preceding verified step; no next edit dispatched');
}
async function applyAudioEffect(args: AnyRecord): Promise<HostResult> {return applyComponentEffect(args,"audio");}
/** Factory differences end here. Insertion, initialization and exact rollback
 * derive from the same chain-preservation and parameter-preflight contracts. */
async function applyComponentEffect(args: AnyRecord,mediaType:"video"|"audio"): Promise<HostResult> {
  // Sibling phases are exclusive; initialValueWrite contains initialization's
  // timingsMs. Only the plain numeric record is completed in finally.
  const effectPhaseTimingsMs:Record<string,number>={},totalStarted=performance.now();
  let phaseStarted=totalStarted;
  try {
  // Syntax does not require an attached native component. Reject malformed
  // selectors before insertion; only native identity/value checks need it.
  if (args.initialValues && args.initialParameters) throw Error("Supply only one initial parameter form");
  const initialWrites=args.initialValues||args.initialParameters?parameterWrites(args.initialValues,args.initialParameters):undefined;
  let { project, entry } = await exactEffectTarget(args);
  effectPhaseTimingsMs.initialTarget=performance.now()-phaseStarted;phaseStarted=performance.now();
  if (entry.snapshot.mediaType !== mediaType) throw new HostCommandError(mediaType.toUpperCase()+"_ITEM_REQUIRED", "Effect media type differs from the target item");
  const before = await effectSnapshot(args,entry.raw, true);
  effectPhaseTimingsMs.beforeSnapshot=performance.now()-phaseStarted;phaseStarted=performance.now();
  assertEffectSequenceState(args,before);
  let insertion:EffectInsertionPlan;
  try { insertion=planEffectInsertion(before.map(component=>({componentIndex:component.componentIndex,matchName:component.matchName})),mediaType,args.insertionIndex==null?undefined:Number(args.insertionIndex)); }
  catch(error) {
    if(error instanceof EffectInsertionError)throw new HostCommandError(error.code,error.message);
    throw error;
  }
  effectPhaseTimingsMs.insertionPlan=performance.now()-phaseStarted;phaseStarted=performance.now();
  ({project,entry}=await exactEffectTarget(args));
  const installed = mediaType==="video"?await ppro.VideoFilterFactory.getMatchNames():await ppro.AudioFilterFactory.getDisplayNames();
  const requested = text(mediaType==="video"?args.matchName:args.displayName);
  if (!installed.includes(requested)) throw new HostCommandError(mediaType.toUpperCase()+"_EFFECT_NOT_FOUND", `Installed effect not found: ${requested}`);
  const identity=mediaType==="video"?{matchName:requested}:{displayName:requested};
  let filter;
  try{filter=mediaType==="video"?await ppro.VideoFilterFactory.createComponent(requested):await ppro.AudioFilterFactory.createComponentByDisplayName(requested,entry.raw);}
  catch(error){
    if(mediaType==="audio"&&/No audio filter found for the given display name and channel layout/i.test(String(error)))throw new HostCommandError("AUDIO_EFFECT_CHANNEL_LAYOUT_UNSUPPORTED",`The installed effect ${requested} cannot be created on this clip's audio channel layout; no effect was inserted. Intrinsic mono/stereo panner and track mixer writes are not exposed by this tool. Use stereo dual-mono source plus the installed Balance effect only after verifying channel layout; replacing media/effects needs separate readback`);
    throw error;
  }
  ({project,entry}=await exactEffectTarget(args));
  const chain = await entry.raw.getComponentChain();
  if (insertion.mode === "insert") assertMethod(chain, "createInsertComponentAction", "VideoComponentChain.createInsertComponentAction");
  else assertMethod(chain, "createAppendComponentAction", "VideoComponentChain.createAppendComponentAction");
  effectPhaseTimingsMs.factoryAndBinding=performance.now()-phaseStarted;
  let hostResult:boolean|undefined;
  const addedIndex = insertion.index;
  try {
    phaseStarted=performance.now();
    hostResult = executeTransaction(project, `Apply ${mediaType} effect ${requested}`, () => [insertion.mode === "append" ? chain.createAppendComponentAction(filter) : chain.createInsertComponentAction(filter, addedIndex)]);
    effectPhaseTimingsMs.insertAction=performance.now()-phaseStarted;phaseStarted=performance.now();
    let current = await exactEffectTarget(args);
    let after = await effectSnapshot(args,current.entry.raw, true);
    effectPhaseTimingsMs.postInsertRead=performance.now()-phaseStarted;phaseStarted=performance.now();
    const errors = verifyEffectChainChange(before, after, { kind: "add", index: addedIndex, ...identity });
    if (errors.length || !hostResult) throw Error([...errors,...(!hostResult ? ["Premiere rejected effect insertion"] : [])].join("; "));
    effectPhaseTimingsMs.postInsertCheck=performance.now()-phaseStarted;phaseStarted=performance.now();
    // Read native initialization after yielding, without constructing a UI by
    // replacing the user's selection. Initial-value guards use these observed
    // values, never assumed defaults from a future Effect Controls view.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    effectPhaseTimingsMs.initializationYield=performance.now()-phaseStarted;phaseStarted=performance.now();
    const initialized=await effectSnapshot(args,(await exactEffectTarget(args)).entry.raw,true);
    effectPhaseTimingsMs.initializedRead=performance.now()-phaseStarted;phaseStarted=performance.now();
    const initializationErrors=verifyEffectChainChange(before,initialized,{kind:"add",index:addedIndex,...identity});
    if(initializationErrors.length)throw Error(initializationErrors.join("; "));
    const factoryDefaultsNormalized=!snapshotsEqual(after[addedIndex],initialized[addedIndex]);
    after=initialized;
    effectPhaseTimingsMs.initializedCheck=performance.now()-phaseStarted;
    let valueResult;
    if (args.initialValues || args.initialParameters || args.initialColorAdjustments) {
      const valueWriteStarted=performance.now();
      try {
      // VideoFilterComponent is opaque until attached (proved in Premiere 26.5).
      // Preflight ALL writes on the attached component, then write as one action
      // transaction. Any failed preflight/readback removes only this new effect
      // and proves the complete original chain; never return a partial success.
      const writes = args.initialColorAdjustments ? resolveColorWrites(after[addedIndex]!,args.initialColorAdjustments,args.parameterIndices) : initialWrites!;
      const initializationPlan=preflightParameterWrites(after[addedIndex]!,writes,true);
      const defaultAnimation=initializationPlan.filter(p=>p.snapshot.timeVarying);
      current=await exactEffectTarget(args);
      if(defaultAnimation.length){
        const attached=(await current.entry.raw.getComponentChain()).getComponentAtIndex(addedIndex);
        executeTransaction(current.project,"Initialize new effect constants",()=>defaultAnimation.map(p=>attached.getParam(p.snapshot.paramIndex).createSetTimeVaryingAction(false)));
        current=await exactEffectTarget(args);
        after=await effectSnapshot(args,current.entry.raw,true);
        if(defaultAnimation.some(p=>after[addedIndex]!.params[p.snapshot.paramIndex].keyframes.length))throw Error("New effect acquired unexpected animation keys");
      }
      current=await exactEffectTarget(args);
      const initializationArgs={...args,expectedEffectState:undefined,componentIndex:addedIndex,componentMatchName:after[addedIndex]!.matchName,values:undefined,parameters:writes,preserveEmptyAnimation:true};
      valueResult = await withEffectTargetLookup(initializationArgs,()=>setEffectValuesOnce(initializationArgs, {project:current.project,entry:current.entry,before:after}),args);
      if (valueResult.status !== "pass") throw Error(valueResult.errors?.join("; ") ?? "Initial effect values did not verify");
      after = valueResult.after as AnyRecord[];
      } finally { effectPhaseTimingsMs.initialValueWrite=performance.now()-valueWriteStarted; }
    }
    phaseStarted=performance.now();
    const finalErrors=verifyEffectChainChange(before,after,{kind:"add",index:addedIndex,...identity});
    if(finalErrors.length)throw Error(finalErrors.join("; "));
    effectPhaseTimingsMs.finalContract=performance.now()-phaseStarted;
    return { status: "pass", before, hostResult: { transaction: hostResult, componentIndex: addedIndex, insertionPolicy:insertion.policy, ...(insertion.graphicGroupIndex===undefined?{}:{graphicGroupIndex:insertion.graphicGroupIndex}), factoryDefaultsNormalized, initialization: valueResult?.hostResult, initializationPolicy:"fresh_native_readback_without_selection_change",effectPhaseTimingsMs }, after, errors: [] };
  } catch (error) {
    const rollbackStarted=performance.now();
    try {
    const errors=[String(error)];
    let observedEffect:AnyRecord|undefined;
    try {
      let current=await exactEffectTarget(args);const now=await effectSnapshot(args,current.entry.raw);
      if(verifyEffectChainChange(before,now,{kind:"add",index:addedIndex,...identity}).length) throw Error("Cannot uniquely isolate the inserted effect for rollback");
      observedEffect={componentIndex:addedIndex,matchName:now[addedIndex]!.matchName,insertion:'verified',initialValues:'unverified',component:now[addedIndex]};
      current=await exactEffectTarget(args);
      const selected=await selectedComponent(current.entry.raw,{componentIndex:addedIndex,componentMatchName:now[addedIndex]!.matchName},now);
      const transaction=executeTransaction(current.project,"Rollback failed effect initialization",()=>[selected.chain.createRemoveComponentAction(selected.component)]);
      const restored=await effectSnapshot(args,(await exactEffectTarget(args)).entry.raw,true);
      if(!transaction || !snapshotsEqual(before,restored)) throw Error("Original effect chain did not read back after rollback");
      return {status:"fail",before,after:restored,hostResult:{transaction:hostResult,rollback:{attempted:true,verified:true},effectPhaseTimingsMs},errors,recovery:"Insertion/initialization failed; the exact original effect chain was restored."};
    }catch(rollbackError){return {status:"unverified",before,hostResult:{transaction:hostResult,componentIndex:addedIndex,partialState:observedEffect??{insertion:'unverified',initialValues:'unverified'},rollback:{attempted:true,verified:false},effectPhaseTimingsMs},errors:[...errors,String(rollbackError)],recovery:"Effect insertion may have applied. Inspect get_effect_values detail:chain; the same operationId returns its immutable receipt, never resumes. Once inactive, archive that exact operation, then use a new ID: if the exact effect exists, set_effect_values with preserveEmptyAnimation:true only for an empty key list; apply again only when fresh chain proof shows no insertion."};}
    } finally { effectPhaseTimingsMs.rollback=performance.now()-rollbackStarted; }
  }
  } finally { effectPhaseTimingsMs.total=performance.now()-totalStarted; }
}


async function removeEffect(args: AnyRecord): Promise<HostResult> {
  let { project, entry } = await exactEffectTarget(args);
  // The requested deleted instance need not expose every custom/keyframe value.
  // Its slot + match identity is the deletion guard; every survivor must remain
  // readable before dispatch and identical afterward. Otherwise a broken plug-in
  // could never be removed through the API that created it.
  const before = await effectSnapshot(args,entry.raw);
  assertEffectSequenceState(args,before);
  ({project,entry}=await exactEffectTarget(args));
  if (!args.componentMatchName) throw new HostCommandError("COMPONENT_GUARD_REQUIRED", "Effect removal requires the inspected componentMatchName");
  const selected = await selectedComponent(entry.raw, effectSelector(args), before);
  if(before.some(c=>c.componentIndex!==selected.snapshot.componentIndex&&c.readbackCoverage.unverifiedParameterIndices.length))throw new HostCommandError("SURVIVOR_STATE_UNVERIFIED","An unrelated effect cannot be verified before removal");
  if (!args.allowIntrinsic && isIntrinsicEffect(selected.snapshot)) {
    throw new HostCommandError("INTRINSIC_EFFECT_PROTECTED", `Refusing to remove intrinsic component without allowIntrinsic: ${text(selected.snapshot.displayName)}`);
  }
  assertMethod(selected.chain, "createRemoveComponentAction", "ComponentChain.createRemoveComponentAction");
  let hostResult:boolean|undefined;
  try {
    hostResult = executeTransaction(project, `Remove effect ${text(selected.snapshot.displayName)}`, () => [selected.chain.createRemoveComponentAction(selected.component)]);
    const current = await exactEffectTarget(args);
    const after = await effectSnapshot(args,current.entry.raw, true);
    const errors = verifyEffectChainChange(before, after, { kind: "remove", index: Number(args.componentIndex) });
    if (!hostResult) errors.push("Premiere rejected effect removal");
    return { status: errors.length ? "unverified" : "pass", before, hostResult, after, errors };
  } catch (error) { return { status: "unverified", before, hostResult, errors: [String(error)], recovery: "Effect removal was dispatched; inspect before retrying." }; }
}

function assertExpectedSequence(args: AnyRecord, sequence: any): void {
  const expected = text(args.expectedSequenceName);
  if (expected && text(sequence.name) !== expected) {
    throw new HostCommandError("ACTIVE_SEQUENCE_MISMATCH", "Expected active sequence " + expected + ", received " + text(sequence.name));
  }
}
function effectSelector(args: AnyRecord): AnyRecord {
  return { componentIndex: args.componentIndex, componentMatchName: args.componentMatchName, componentDisplayName: args.componentDisplayName };
}

function interpolationMode(value: unknown): number {
  const interpolation = text(value);
  return interpolation === "hold"
    ? ppro.Keyframe.INTERPOLATION_MODE_HOLD
    : interpolation === "bezier"
      ? ppro.Keyframe.INTERPOLATION_MODE_BEZIER
      : ppro.Keyframe.INTERPOLATION_MODE_LINEAR;
}

/** Audio effects rebuild native children during insertion and Effect Controls
 * reconstruction too. Keep media-backed video on its existing read path. */
function needsSettledEffectObjects(args:AnyRecord):boolean {
  return args.expectedMediaType==='audio'||args.expectedMediaType==='video'&&args.expectedProjectItemId==='';
}
async function exactEffectTarget(args: AnyRecord): Promise<{ project: any; sequence: any; entry: { raw: any; snapshot: AnyRecord } }> {
  // Structural/value transactions can also invalidate the track-item metadata
  // wrappers. Wait before acquiring those, not only before component values.
  if(needsSettledEffectObjects(args))await waitGraphicMutationQuiet();
  const { project, sequence } = await mutationContext(args);
  assertExpectedSequence(args, sequence);
  const currentProjectId = text(project.guid) || text(project.path) || text(project.name);
  const currentSequenceId = await sequenceId(sequence);
  if (currentProjectId !== text(args.expectedProjectId)) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", `Expected project ${text(args.expectedProjectId)}, active project is ${currentProjectId}`);
  }
  if (currentSequenceId !== text(args.expectedSequenceId)) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", `Expected sequence ${text(args.expectedSequenceId)}, active sequence is ${currentSequenceId}`);
  }
  const entry = await findTrackItemEntry(sequence, text(args.trackItemId), effectTargetLookupHint(args));
  const targetMismatches = [
    ...(!entry.snapshot.projectItemId && args.expectedClipName!==entry.snapshot.name ? ["native graphic clip name"]:[]),
    ...(entry.snapshot.projectItemId === text(args.expectedProjectItemId) ? [] : ["project item ID"]),
    ...(entry.snapshot.mediaType === text(args.expectedMediaType) ? [] : ["media type"]),
    ...(entry.snapshot.trackIndex === Number(args.expectedTrackIndex) ? [] : ["track index"]),
    ...(hostNumericValuesEqual(Number(entry.snapshot.start?.seconds), Number(args.expectedStartSeconds)) ? [] : ["start time"]),
    ...(hostNumericValuesEqual(Number(entry.snapshot.end?.seconds), Number(args.expectedEndSeconds)) ? [] : ["end time"]),
  ];
  if (targetMismatches.length) {
    throw new HostCommandError("TRACK_ITEM_PRECONDITION_FAILED", `Effect target changed since inspection: ${targetMismatches.join(", ")}`);
  }
  return { project, sequence, entry };
}

async function setEffectValuesOnce(args: AnyRecord, prepared?: { project: any; entry: { raw: any; snapshot: AnyRecord }; before: AnyRecord[] }): Promise<HostResult> {
  const started = performance.now();
  let { project, entry } = prepared ?? await exactEffectTarget(args);
  const selector = effectSelector(args);
  const before = (prepared?.before ?? await effectSnapshot(args,entry.raw)).map(c=>enrichEffectParameterSchema(c,args.__effectParameterSchema));
  assertEffectSequenceState(args,before);
  ({project,entry}=await exactEffectTarget(args));
  const components = before.filter(c => componentMatches(c, selector));
  if (components.length !== 1) throw new HostCommandError("COMPONENT_NOT_FOUND_OR_AMBIGUOUS", "An exact component is required");
  const preserveEmptyAnimation=args.preserveEmptyAnimation===true;
  const writePlan = preflightValue(() => preflightParameterWrites(components[0]!,parameterWrites(args.values,args.parameters),false,preserveEmptyAnimation));
  const requested=writePlan.map(p=>p.write);
  const derivedInference=deriveEffectValues(components[0]!,writePlan,args.expectedDerivedParameters??[],args.dependencies,preserveEmptyAnimation);
  const derivedInput:ParameterWrite[]=derivedInference.writes;
  if(derivedInput.some(p=>!Object.hasOwn(p,"expectedValue")))throw Error("DERIVED_PARAMETER_GUARD_REQUIRED: supply the inspected before value");
  const derivedPlan=preflightParameterWrites(components[0]!,derivedInput,false,preserveEmptyAnimation);
  if(derivedPlan.some(p=>writePlan.some(w=>w.snapshot.paramIndex===p.snapshot.paramIndex)))throw Error("DERIVED_PARAMETER_OVERLAP: a computed parameter cannot also be directly written");
  const derived=derivedPlan.map(p=>p.write),derivedTargets=derivedPlan.map(p=>({componentIndex:components[0]!.componentIndex,paramIndex:p.snapshot.paramIndex}));
  const linked=derivedInference.linkedWrites??[];
  // Explicit links share the guarded native transaction with their inputs.
  // All outputs passed the same type/range/animation preflight above. Native
  // automatic expectations stay read-only, and every untouched value remains
  // protected by the full component snapshot.
  const actualRequested=[...requested,...linked];
  const derivedErrors=(after:AnyRecord[])=>{
    const proof=componentValuesMatch(after,derived,selector,preserveEmptyAnimation);
    return [...proof.mismatched,...proof.missing].map(name=>`Native derived value did not verify: ${name}`);
  };
  const preflight = componentValuesMatch(before, actualRequested, selector,preserveEmptyAnimation);
  const preflightMs = performance.now() - started;
  if (preflight.mismatched.length === 0) {
    return {
      status: derivedErrors(before).length ? "unverified" : "pass",
      before,
      hostResult: { changed: [], missing: [], animated: [], readback: preflight, idempotentNoOp: true,...(derived.length?{derivedValues:{expected:derived,rules:derivedInference.rules,verified:derivedErrors(before).length===0,writeDispatched:false}}:{}), timingsMs: { preflight: preflightMs, total: performance.now() - started } },
      after: before,
      errors: derivedErrors(before),
    };
  }
  const actionStarted = performance.now();
  let result:Awaited<ReturnType<typeof setComponentValues>>|undefined;
  let dispatchError:string|undefined;
  try { result = await setComponentValues(project, entry.raw, actualRequested, selector, before,preserveEmptyAnimation); }
  catch(error) {
    if(!(error instanceof HostCommandError && error.code==="EFFECT_DISPATCH_UNVERIFIED"))throw error;
    // A completed dispatch exception is ambiguous. Do not replay the write:
    // reacquire after settling and adjudicate requested values, animation and
    // every untouched parameter against the original preflight snapshot.
    dispatchError=String(error);noteGraphicMutation();
  }
  const targets=result?.targets??actualRequested.map(write=>({componentIndex:Number(components[0]!.componentIndex),paramIndex:Number(resolveEffectParameter(components[0]!,write).paramIndex)}));
  const actionMs = performance.now() - actionStarted;
  const verificationStarted = performance.now();
  try {
    const current = await exactEffectTarget(args);
    const after = await effectSnapshot(args,current.entry.raw);
    const readback = componentValuesMatch(after, actualRequested, selector,preserveEmptyAnimation);
    const animationErrors=targets.flatMap(t=>{
      const b=before[t.componentIndex]?.params[t.paramIndex],a=after[t.componentIndex]?.params[t.paramIndex];
      return ['timeVarying','keyframes','keyframeDetails'].some(k=>!snapshotsEqual(b?.[k],a?.[k]))?[`Static/base-value write changed animation: ${t.paramIndex}`]:[];
    });
    const errors = [...animationErrors,...verifyParameterPreservation(before, after, targets,derivedTargets), ...derivedErrors(after), ...readback.mismatched.map(name => `Effect value mismatch: ${name}`), ...readback.missing.map(name => `Effect value/animation readback unavailable: ${name}`), ...(result&&!result.transaction ? ["Premiere rejected the value transaction"] : [])];
    return { status: errors.length ? "unverified" : "pass", before, after, hostResult: { ...result, readback, ...(dispatchError?{dispatchAdjudication:{error:dispatchError,readbackOnly:true,verified:errors.length===0},targets}:{}), ...(derived.length?{derivedValues:{expected:derived,rules:derivedInference.rules,verified:derivedErrors(after).length===0,writeDispatched:linked.length>0,linkedParameters:linked.map(p=>p.paramIndex)}}:{}), timingsMs: { preflight: preflightMs, action: actionMs, verification: performance.now() - verificationStarted, total: performance.now() - started } }, errors,
      ...(errors.length ? { recovery: "Inspect the exact target before another write; the value transaction may already have applied." } : {}) };
  } catch (error) {
    return { status: "unverified", before, hostResult: result, errors: [...(dispatchError?[dispatchError]:[]),String(error)], recovery: "Effect write was dispatched but readback failed. Inspect before retrying." };
  }
}

async function setEffectValues(args: AnyRecord): Promise<HostResult> {
  try {
    return await setEffectValuesOnce(args);
  } catch (error) {
    if (!isTransientHostObjectInvalidation(error)) throw error;
    const retry = await setEffectValuesOnce(args);
    return {
      ...retry,
      hostResult: { ...(retry.hostResult as AnyRecord), staleObjectRetryCount: 1 },
      recovery: "Premiere invalidated a transient effect object; the host reacquired the clip and retried this idempotent value write once.",
    };
  }
}
type PointReadback=(snapshots:AnyRecord[])=>Promise<AnyRecord[]>;
async function setEffectKeyframes(args: AnyRecord,pointReadback?:PointReadback): Promise<HostResult> {
  let { entry } = await exactEffectTarget(args);
  const selector = effectSelector(args);
  let before = await effectSnapshot(args,entry.raw);
  assertEffectSequenceState(args,before);
  if(pointReadback&&args.keyframes?.some((k:AnyRecord)=>k.value?.kind==='point')&&!before.some(c=>componentMatches(c,selector)&&c.params.some((p:AnyRecord)=>p.descriptor.inputKind==='point'&&p.keyframes.length)))before=await pointReadback(before);
  // Native saved proof may invalidate prior project/clip wrappers. Reacquire
  // only after it completes, before constructing any mutation action.
  ({entry}=await exactEffectTarget(args));
  before=before.map(c=>componentMatches(c,selector)?enrichEffectParameterSchema(c,args.__effectParameterSchema):c);
  const selected = await selectedComponent(entry.raw, selector, before);
  const requests = Array.isArray(args.keyframes) ? args.keyframes : [];
  const prepared = new Map<string, { entries: Array<{ request: AnyRecord }> }>();
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const request of requests) {
    const paramSnapshot = resolveEffectParameter(selected.snapshot, request);
    requireReadableParameter(paramSnapshot);
    const parameterName = text(paramSnapshot.displayName);
    const mapped = preflightValue(() => effectTime(entry.snapshot as any, request,args.__nativeEffectTimeProof));
    const timeSeconds = Number(mapped.sequenceTicks)/254016000000;
    const keyframeTime = ppro.TickTime.createWithTicks(mapped.nativeTicks);
    const requestedTick = asTickTime(keyframeTime).ticks;
    const requestKey = `${paramSnapshot.paramIndex}:${requestedTick}`;
    if (seen.has(requestKey)) throw new HostCommandError("DUPLICATE_KEYFRAME_REQUEST", `Duplicate keyframe request: ${parameterName} @ ${timeSeconds}s`);
    seen.add(requestKey);
    if ((paramSnapshot.keyframes ?? []).some((time: AnyRecord) => text(time.ticks) === requestedTick)) {
      throw new HostCommandError("KEYFRAME_ALREADY_EXISTS", `A keyframe already exists at ${parameterName} @ ${timeSeconds}s; inspect before choosing an explicit replacement route`);
    }
    const param = selected.component.getParam(Number(paramSnapshot.paramIndex));
    let supported = false;
    try { supported = Boolean(await param.areKeyframesSupported()); } catch { supported = false; }
    if (!supported) { missing.push(`${parameterName} (keyframes unsupported)`); continue; }
    const requestedValue=preflightParameterValue(paramSnapshot,request.value);
    const keyframe = checkedNativeKeyframe(param,requestedValue);
    const nativePoint=(requestedValue as AnyRecord)?.kind==="point"&&!!pointReadback;
    if(!nativePoint&&(typeof keyframe.setTemporalInterpolationMode!=="function" || typeof keyframe.getTemporalInterpolationMode!=="function"))
      throw new HostCommandError("UNSUPPORTED_API","KEYFRAME_INTERPOLATION_READBACK_UNSUPPORTED: this native keyframe type does not expose verifiable temporal interpolation; no keyframes were written");
    keyframe.position = keyframeTime;
    const mode = interpolationMode(request.interpolation);
    if(!nativePoint)await keyframe.setTemporalInterpolationMode(mode);
    const groupKey = String(paramSnapshot.paramIndex);
    const group = prepared.get(groupKey) ?? { entries: [] };
    group.entries.push({ request: { ...request, timeSeconds,parameterName,value:requestedValue, nativeTicks: mapped.nativeTicks, sequenceTicks: mapped.sequenceTicks, paramIndex: paramSnapshot.paramIndex, expectedDisplayName: paramSnapshot.displayName } });
    prepared.set(groupKey, group);
  }
  if (missing.length) {
    throw new HostCommandError("KEYFRAME_PREFLIGHT_FAILED", `No keyframes were written because parameters failed preflight: ${missing.join(", ")}`);
  }
  let hostResult:boolean|undefined;
  let phase='construct_keyframe_actions';
  try {
  const actionTarget=await exactEffectTarget(args),actionSelected=await selectedComponent(actionTarget.entry.raw,selector,before);
  hostResult = executeTransaction(actionTarget.project, `Set ${requests.length - missing.length} effect keyframes`, () => [...prepared].flatMap(([index,{entries}]) => {
    const param=actionSelected.component.getParam(Number(index));
    return [param.createSetTimeVaryingAction(true),...entries.map(({request})=>{
      const keyframe=checkedNativeKeyframe(param,request.value);keyframe.position=ppro.TickTime.createWithTicks(request.nativeTicks);
      if(request.value?.kind!=='point')keyframe.setTemporalInterpolationMode(interpolationMode(request.interpolation));
      return param.createAddKeyframeAction(keyframe);
    })];
  }));
  phase='verify_keyframe_content';
  // Premiere resolves Point interpolation actions against committed keys. In
  // the insertion compound they silently retain Linear. Commit first, then set
  // modes in a second bounded transaction; any failure remains UNVERIFIED.
  const pointKeys=[...prepared.values()].flatMap(g=>g.entries).filter(e=>e.request.value?.kind==="point");
  if(pointKeys.length){
    if(!hostResult)throw Error("POINT_KEY_INSERTION_UNVERIFIED");
    const pointTarget=await exactEffectTarget(args),pointComponent=await selectedComponent(pointTarget.entry.raw,selector);
    hostResult=executeTransaction(pointTarget.project,"Set Point temporal interpolation",()=>pointKeys.map(({request})=>pointComponent.component.getParam(request.paramIndex).createSetInterpolationAtKeyframeAction(ppro.TickTime.createWithTicks(request.nativeTicks),interpolationMode(request.interpolation),true)));
  }
  const current = await exactEffectTarget(args);
  const currentItem = current.entry.raw;
  const currentSelected = await selectedComponent(currentItem, selector,await effectSnapshot(args,currentItem));
  const mismatched: string[] = [];
  for (const { request } of [...prepared.values()].flatMap(({ entries }) => entries)) {
    const paramSnapshot = currentSelected.snapshot.params.find((param: AnyRecord) => param.paramIndex === request.paramIndex && param.displayName === request.expectedDisplayName);
    if (!paramSnapshot) { mismatched.push(`${text(request.parameterName)} @ ${Number(request.timeSeconds)}s`); continue; }
    try { requireReadableParameter(paramSnapshot); } catch { mismatched.push(`Unverified keyframe readback ${request.paramIndex}`); continue; }
    const requestedTime = Number(request.timeSeconds);
    const requestedTick = request.nativeTicks;
    const actualTime = (paramSnapshot.keyframes ?? []).find((time: AnyRecord) => text(time.ticks) === requestedTick);
    const actualKey=paramSnapshot.keyframeDetails.find((k:AnyRecord)=>k.time.ticks===requestedTick);
    const actual = actualKey?.value;
    const requestedMode = interpolationMode(request.interpolation);
    const actualMode=actualKey?.interpolationMode;
    if (!actualTime || !hostValuesEqual(actual, request.value) || actualMode !== requestedMode) {
      mismatched.push(`${text(request.parameterName)} @ ${requestedTime}s`);
    }
  }
  const after = currentSelected.snapshots;
  mismatched.push(...verifyParameterPreservation(before, after, [...prepared.keys()].map(index => ({ componentIndex: Number(selected.snapshot.componentIndex), paramIndex: Number(index) }))));
  for (const index of prepared.keys()) {
    const oldParam = selected.snapshot.params.find((p: AnyRecord) => p.paramIndex === Number(index));
    const newParam = currentSelected.snapshot.params.find((p: AnyRecord) => p.paramIndex === Number(index));
    for (const oldKey of oldParam.keyframeDetails) {
      const actual = newParam?.keyframeDetails?.find((k: AnyRecord) => k.time.ticks === oldKey.time.ticks);
      if (!actual || !hostValuesEqual(actual.value, oldKey.value) || actual.interpolationMode !== oldKey.interpolationMode) mismatched.push(`Existing keyframe changed: ${index}:${oldKey.time.ticks}`);
    }
  }
  const pass = hostResult && missing.length === 0 && mismatched.length === 0;
  return {
    status: pass ? "pass" : "unverified",
    before,
    hostResult: { transaction: hostResult, written: requests.length - missing.length, missing, mismatched, timeBasis: "sequence_ticks" },
    after,
    errors: [...missing.map((name) => `Keyframe parameter unavailable: ${name}`), ...mismatched.map((name) => `Keyframe time, value, or interpolation mismatch: ${name}`)],
    ...(pass ? {} : { recovery: "Inspect the parameter keyframe list before retrying. A failed readback may still have created keyframes; do not replay with a new operationId." }),
  };
  } catch (error) { return { status: "unverified", before, hostResult:{transaction:hostResult,phase}, errors: [String(error)], recovery: "Keyframe insertion was dispatched but its readback failed. Inspect before retrying." }; }
}

async function editEffectKeyframes(args: AnyRecord,pointReadback?:PointReadback): Promise<HostResult> {
  let { entry } = await exactEffectTarget(args);
  const selector = effectSelector(args);
  let before = await effectSnapshot(args,entry.raw);
  assertEffectSequenceState(args,before);
  ({entry}=await exactEffectTarget(args));
  before=before.map(c=>componentMatches(c,selector)?enrichEffectParameterSchema(c,args.__effectParameterSchema):c);
  const selected = await selectedComponent(entry.raw, selector, before);
  const operations = Array.isArray(args.operations) ? args.operations : [];
  const prepared: Array<{ operation: AnyRecord; replacement: boolean }> = [];
  const seen = new Set<string>();
  for (const operation of operations) {
    const paramSnapshot = resolveEffectParameter(selected.snapshot, operation);
    requireReadableParameter(paramSnapshot);
    const parameterName = text(paramSnapshot.displayName);
    const timeSeconds = Number(operation.timeSeconds);
    if (timeSeconds < Number(entry.snapshot.start?.seconds) || timeSeconds >= Number(entry.snapshot.end?.seconds)) {
      throw new HostCommandError("KEYFRAME_OUTSIDE_CLIP", `${parameterName} keyframe ${timeSeconds}s is outside ${entry.snapshot.start?.seconds}-${entry.snapshot.end?.seconds}s`);
    }
    const mapped = effectTime(entry.snapshot as any, operation,args.__nativeEffectTimeProof);
    const time = ppro.TickTime.createWithTicks(mapped.nativeTicks);
    const requestedTick = asTickTime(time).ticks;
    const requestKey = `${paramSnapshot.paramIndex}:${requestedTick}`;
    if (seen.has(requestKey)) throw new HostCommandError("DUPLICATE_KEYFRAME_REQUEST", `Duplicate keyframe edit request: ${parameterName} @ ${timeSeconds}s`);
    seen.add(requestKey);
    const detail = (paramSnapshot.keyframeDetails ?? []).find((candidate: AnyRecord) => text(candidate.time?.ticks) === requestedTick);
    if (!detail) throw new HostCommandError("KEYFRAME_NOT_FOUND", `No readable keyframe exists at ${parameterName} @ ${timeSeconds}s`);
    const expectedMode = interpolationMode(operation.expectedInterpolation);
    if (!hostValuesEqual(detail.value, operation.expectedValue) || Number(detail.interpolationMode) !== Number(expectedMode)) {
      throw new HostCommandError("KEYFRAME_PRECONDITION_FAILED", `Keyframe changed since inspection: ${parameterName} @ ${timeSeconds}s`);
    }
    const param = selected.component.getParam(Number(paramSnapshot.paramIndex));
    let supported = false;
    try { supported = Boolean(await param.areKeyframesSupported()); } catch { supported = false; }
    if (!supported) throw new HostCommandError("KEYFRAME_PREFLIGHT_FAILED", `Keyframes are not supported: ${parameterName}`);
    let replacement: any;
    if (text(operation.action) === "replace") {
      operation.value=preflightParameterValue(paramSnapshot,operation.value);
      replacement = checkedNativeKeyframe(param,operation.value);
      if(!(operation.value?.kind==="point"&&pointReadback)&&(typeof replacement.setTemporalInterpolationMode!=="function" || typeof replacement.getTemporalInterpolationMode!=="function"))
        throw new HostCommandError("UNSUPPORTED_API","KEYFRAME_INTERPOLATION_READBACK_UNSUPPORTED: native replacement cannot be verified; no edit was dispatched");
      replacement.position = time;
      if (typeof replacement.setTemporalInterpolationMode === "function") {
        await replacement.setTemporalInterpolationMode(interpolationMode(operation.interpolation));
      }
    }
    prepared.push({ operation: { ...operation, nativeTicks: mapped.nativeTicks, sequenceTicks: mapped.sequenceTicks, paramIndex: paramSnapshot.paramIndex, expectedDisplayName: paramSnapshot.displayName }, replacement:!!replacement });
  }
  const disableParams = new Set<number>();
  if (args.disableAnimationWhenEmpty) {
    for (const edit of prepared) {
      const index = Number(edit.operation.paramIndex);
      const oldParam = selected.snapshot.params.find((p: AnyRecord) => p.paramIndex === index);
      const removed = new Set(prepared.filter(p => p.operation.paramIndex === index && p.operation.action === "remove").map(p => p.operation.nativeTicks));
      if (prepared.some(p => p.operation.paramIndex === index && p.replacement) || oldParam.keyframes.some((k: AnyRecord) => !removed.has(text(k.ticks)))) throw new HostCommandError("ANIMATION_NOT_EMPTY", "Explicit animation disable requires removing every keyframe of each affected parameter");
      disableParams.add(index);
    }
  }
  let hostResult:boolean|undefined;
  let phase='construct_keyframe_edit_actions';
  try {
  const actionTarget=await exactEffectTarget(args),actionSelected=await selectedComponent(actionTarget.entry.raw,selector,before);
  hostResult = executeTransaction(actionTarget.project, `Edit ${prepared.length} effect keyframes`, () => [...prepared.flatMap(({operation,replacement}) => {
    const param=actionSelected.component.getParam(operation.paramIndex),remove=param.createRemoveKeyframeAction(ppro.TickTime.createWithTicks(operation.nativeTicks),true);
    if(!replacement)return [remove];
    const keyframe=checkedNativeKeyframe(param,operation.value);keyframe.position=ppro.TickTime.createWithTicks(operation.nativeTicks);
    if(operation.value?.kind!=='point')keyframe.setTemporalInterpolationMode(interpolationMode(operation.interpolation));
    return [remove,param.createAddKeyframeAction(keyframe)];
  })]);
  phase='verify_keyframe_edit_content';
  const pointReplacements=prepared.filter(p=>p.replacement&&p.operation.value?.kind==="point");
  if(pointReplacements.length){
    if(!hostResult)throw Error("POINT_KEY_REPLACEMENT_UNVERIFIED");
    const pointTarget=await exactEffectTarget(args),pointComponent=await selectedComponent(pointTarget.entry.raw,selector);
    hostResult=executeTransaction(pointTarget.project,"Set replaced Point interpolation",()=>pointReplacements.map(({operation})=>pointComponent.component.getParam(operation.paramIndex).createSetInterpolationAtKeyframeAction(ppro.TickTime.createWithTicks(operation.nativeTicks),interpolationMode(operation.interpolation),true)));
  }
  const current = await exactEffectTarget(args);
  const currentItem = current.entry.raw;
  let currentSelected = await selectedComponent(currentItem, selector,await effectSnapshot(args,currentItem));
  const mismatched: string[] = [];
  for (const { operation } of prepared) {
    const parameterName = text(operation.parameterName);
    const requestedTime = Number(operation.timeSeconds);
    const requestedTick = operation.nativeTicks;
    const paramSnapshot = currentSelected.snapshot.params.find((param: AnyRecord) => param.paramIndex === operation.paramIndex && param.displayName === operation.expectedDisplayName);
    if (!paramSnapshot) { mismatched.push(`Parameter disappeared: ${operation.paramIndex}`); continue; }
    try { requireReadableParameter(paramSnapshot); } catch { mismatched.push(`Unverified keyframe readback: ${operation.paramIndex}`); continue; }
    const detail = (paramSnapshot?.keyframeDetails ?? []).find((candidate: AnyRecord) => text(candidate.time?.ticks) === requestedTick);
    if (text(operation.action) === "remove") {
      if (detail || paramSnapshot.keyframes.some((k: AnyRecord) => text(k.ticks) === requestedTick)) mismatched.push(`${parameterName} @ ${requestedTime}s should be removed`);
      continue;
    }
    const requestedMode = interpolationMode(operation.interpolation);
    if (!detail || !hostValuesEqual(detail.value, operation.value) || Number(detail.interpolationMode) !== Number(requestedMode)) {
      mismatched.push(`${parameterName} @ ${requestedTime}s should be replaced`);
    }
  }
  let after = currentSelected.snapshots;
  const touched = [...new Set(prepared.map(p => Number(p.operation.paramIndex)))];
  mismatched.push(...verifyParameterPreservation(before, after, touched.map(paramIndex => ({ componentIndex: Number(selected.snapshot.componentIndex), paramIndex }))));
  for (const index of touched) {
    const oldParam = selected.snapshot.params.find((p: AnyRecord) => p.paramIndex === index);
    const newParam = currentSelected.snapshot.params.find((p: AnyRecord) => p.paramIndex === index);
    for (const oldKey of oldParam.keyframeDetails) {
      if (prepared.some(p => p.operation.paramIndex === index && p.operation.nativeTicks === oldKey.time.ticks)) continue;
      const actual = newParam?.keyframeDetails?.find((k: AnyRecord) => k.time.ticks === oldKey.time.ticks);
      if (!actual || !hostValuesEqual(actual.value, oldKey.value) || actual.interpolationMode !== oldKey.interpolationMode) mismatched.push(`Unrequested keyframe changed: ${index}:${oldKey.time.ticks}`);
    }
  }
  // Empty-key removal and disabling animation are different native states.
  // Do not construct a disable action against a parameter whose key-removal
  // actions have not executed/read back yet (notably native Color editors).
  // A failed removal must never be hidden by a disable action clearing keys.
  let disableResult:boolean|undefined;
  if(disableParams.size&&hostResult&&mismatched.length===0){
    phase='verify_empty_animation_before_disable';
    const disableTarget=await exactEffectTarget(args),disableSelected=await selectedComponent(disableTarget.entry.raw,selector,await effectSnapshot(args,disableTarget.entry.raw));
    if(!snapshotsEqual(after,disableSelected.snapshots))throw Error('ANIMATION_DISABLE_CONTENT_CHANGED');
    for(const index of disableParams){
      const p=disableSelected.snapshot.params.find((p:AnyRecord)=>p.paramIndex===index);
      if(p?.readStatus?.animation!=='pass'||p.keyframes.length||p.keyframeDetails.length)throw Error('ANIMATION_DISABLE_NOT_EMPTY');
    }
    phase='disable_verified_empty_animation';
    disableResult=executeTransaction(disableTarget.project,'Disable verified empty effect animation',()=>[...disableParams].map(index=>disableSelected.component.getParam(index).createSetTimeVaryingAction(false)));
    phase='verify_disabled_animation';
    const finalTarget=await exactEffectTarget(args);
    currentSelected=await selectedComponent(finalTarget.entry.raw,selector,await effectSnapshot(args,finalTarget.entry.raw));
    const finalAfter=currentSelected.snapshots;
    mismatched.push(...verifyParameterPreservation(after,finalAfter,[...disableParams].map(paramIndex=>({componentIndex:Number(selected.snapshot.componentIndex),paramIndex}))));
    for(const index of disableParams){const p=currentSelected.snapshot.params.find((p:AnyRecord)=>p.paramIndex===index);if(p?.readStatus?.animation!=='pass'||p.timeVarying!==false||p.keyframes.length||p.keyframeDetails.length)mismatched.push(`Animation was not disabled: ${index}`);}
    after=finalAfter;
    if(!disableResult)mismatched.push('Premiere rejected the empty-animation disable transaction');
  }
  const pass = Boolean(hostResult) && mismatched.length === 0;
  return {
    status: pass ? "pass" : "unverified",
    before,
    hostResult: {
      transaction: hostResult,
      ...(disableParams.size?{disableAnimationTransaction:disableResult??false}:{}),
      edited: prepared.length,
      replaced: prepared.filter(({ operation }) => text(operation.action) === "replace").length,
      removed: prepared.filter(({ operation }) => text(operation.action) === "remove").length,
      mismatched,
      timeBasis: "sequence_seconds",
    },
    after,
    errors: mismatched,
    ...(pass ? {} : { recovery: "Inspect keyframeDetails before retrying. The transaction may have partially changed the requested ticks; do not replay with a new operationId." }),
  };
  } catch (error) { return { status: "unverified", before, hostResult:{transaction:hostResult,phase}, errors: [String(error)], recovery: "Keyframe edit was dispatched but its readback failed. Inspect before retrying." }; }
}

const COLOR_PARAMETER_ALIASES: Record<string, string[]> = {
  temperature: ["temperature", "온도"], tint: ["tint", "색조"], exposure: ["exposure", "노출"], contrast: ["contrast", "대비"],
  highlights: ["highlights", "하이라이트", "밝은 영역"], shadows: ["shadows", "어두운 영역", "그림자"], whites: ["whites", "흰색"], blacks: ["blacks", "검정"],
  saturation: ["saturation", "채도"], vibrance: ["vibrance", "생동감"], sharpen: ["sharpen", "선명하게", "선명"], fadedFilm: ["faded film", "빛바랜 필름"],
  vignetteAmount: ["amount", "양"], vignetteMidpoint: ["midpoint", "중간점"], vignetteRoundness: ["roundness", "원형율", "원형률"], vignetteFeather: ["feather", "페더"],
};

function resolveColorWrites(component: AnyRecord, adjustments: AnyRecord, parameterIndices: AnyRecord = {}): ParameterWrite[] {
  const sections=new Map<number,string>(); let section="unknown";
  for(const p of component.params){
    const name=text(p.displayName).toLocaleLowerCase("en-US");
    if(["기본 교정","basic correction"].includes(name)) section="basic";
    else if(["크리에이티브","creative"].includes(name))section="creative";
    else if(["비네팅","vignette"].includes(name))section="vignette";
    else if(["곡선","curves","색상 휠 및 일치","color wheels & match","hsl 보조","hsl secondary"].includes(name))section="other";
    sections.set(p.paramIndex,section);
  }
  return Object.entries(adjustments).map(([canonical, value]) => {
    const aliases = COLOR_PARAMETER_ALIASES[canonical];
    if (!aliases) throw new HostCommandError("COLOR_PARAMETER_UNKNOWN", canonical);
    const desired=canonical.startsWith("vignette") ? "vignette" : ["vibrance","sharpen","fadedFilm"].includes(canonical) ? "creative" : "basic";
    let candidates = component.params.filter((p: AnyRecord) => aliases.includes(text(p.displayName).toLocaleLowerCase("en-US")) &&
      (parameterIndices[canonical] === undefined || p.paramIndex === parameterIndices[canonical]));
    if(parameterIndices[canonical] === undefined && sections.get(candidates[0]?.paramIndex)!=="unknown") candidates=candidates.filter((p:AnyRecord)=>sections.get(p.paramIndex)===desired);
    if (candidates.length !== 1) throw new HostCommandError("COLOR_PARAMETER_AMBIGUOUS_OR_MISSING", `${canonical}: inspect the component and provide parameterIndices; found ${candidates.length} matches`);
    return { paramIndex: candidates[0].paramIndex, expectedDisplayName: candidates[0].displayName, value };
  });
}

async function applyColorAdjustments(args: AnyRecord): Promise<HostResult> {
  const { project, entry } = await exactEffectTarget(args);
  if (entry.snapshot.mediaType !== "video") throw new HostCommandError("VIDEO_ITEM_REQUIRED", "Color adjustments require a video track item");
  const originalBefore = await effectSnapshot(args,entry.raw);
  const matches = originalBefore.filter(component => /lumetri/i.test(`${component.displayName} ${component.matchName}`) && (args.componentIndex === undefined || componentMatches(component, effectSelector(args))));
  if (!matches.length) {
    const catalog = await inspectEffectCatalog();
    const candidate = catalog.videoEffects.find((effect: AnyRecord) => `${text(effect.displayName)} ${text(effect.matchName)}`.toLocaleLowerCase("en-US").includes("lumetri"));
    if (!candidate) return { status: "unsupported", before: originalBefore, errors: ["Lumetri Color was not exposed by Premiere's public video effect catalog"] };
    const effectArgs={ ...args, matchName: candidate.matchName, initialColorAdjustments: args.adjustments };
    return withEffectTargetLookup(effectArgs,()=>applyVideoEffect(effectArgs),args);
  }
  if (matches.length !== 1) throw new HostCommandError("LUMETRI_AMBIGUOUS", "Specify componentIndex from inspection");
  const lumetri = matches[0]!;
  const parameters = resolveColorWrites(lumetri, args.adjustments, args.parameterIndices);
  const valueArgs={ ...args, componentIndex: lumetri.componentIndex, componentMatchName: lumetri.matchName, parameters, values: undefined };
  return withEffectTargetLookup(valueArgs,()=>setEffectValuesOnce(valueArgs, { project, entry, before: originalBefore }),args);
}

function transitionsAtClipEdge(snapshot: AnyRecord, item: AnyRecord, position: string): AnyRecord[] {
  const edge = Number(position === "end" ? item.end.seconds : item.start.seconds);
  const tolerance = 1 / Math.max(1, Number(snapshot.frameRate) || 30);
  return (snapshot.transitions ?? []).filter((transition: AnyRecord) => transition.trackIndex === item.trackIndex && Number(transition.start.seconds) <= edge + tolerance && Number(transition.end.seconds) >= edge - tolerance);
}

async function pollTransitionState(
  args: AnyRecord,
  item: AnyRecord,
  position: string,
  accept: (candidates: AnyRecord[]) => boolean,
): Promise<{ snapshot: AnyRecord; candidates: AnyRecord[]; attempts: number }> {
  const maximumAttempts = 16;
  let snapshot = await targetSequenceSnapshot(args);
  let candidates = transitionsAtClipEdge(snapshot, item, position);
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (accept(candidates) || attempt === maximumAttempts) return { snapshot, candidates, attempts: attempt };
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    snapshot = await targetSequenceSnapshot(args);
    candidates = transitionsAtClipEdge(snapshot, item, position);
  }
  return { snapshot, candidates, attempts: maximumAttempts };
}

async function applyTransition(args: AnyRecord): Promise<HostResult> {
  let current = await mutationContext(args);
  let entry = await findTrackItemEntry(current.sequence, text(args.trackItemId));
  if (entry.snapshot.mediaType !== "video") throw new HostCommandError("VIDEO_ITEM_REQUIRED", "Video transitions require a video track item");
  const before = await sequenceSnapshot(current.sequence);
  const position = text(args.position) === "end" ? "end" : "start";
  const existing = transitionsAtClipEdge(before, entry.snapshot, position);
  let removalResult: boolean | undefined;
  if (existing.length && Boolean(args.replaceExisting ?? true)) {
    assertMethod(entry.raw, "createRemoveVideoTransitionAction", "VideoClipTrackItem.createRemoveVideoTransitionAction");
    const transitionPosition = position === "end" ? ppro.Constants.TransitionPosition.END : ppro.Constants.TransitionPosition.START;
    removalResult = executeTransaction(current.project, `Replace ${position} video transition`, () => [entry.raw.createRemoveVideoTransitionAction(transitionPosition)]);
    if (!removalResult) return { status: "fail", before, hostResult: { removalResult }, errors: ["Existing transition could not be removed before replacement"] };
    current = await mutationContext(args);
    entry = await findTrackItemEntry(current.sequence, entry.snapshot.id);
  } else if (existing.length) {
    throw new HostCommandError("TRANSITION_ALREADY_EXISTS", `A transition already exists at the clip ${position}; set replaceExisting to replace it`);
  }
  assertMethod(ppro.TransitionFactory, "getVideoTransitionMatchNames", "TransitionFactory.getVideoTransitionMatchNames");
  assertMethod(ppro.TransitionFactory, "createVideoTransition", "TransitionFactory.createVideoTransition");
  const names = await ppro.TransitionFactory.getVideoTransitionMatchNames();
  const requested = text(args.matchName);
  if (!names.includes(requested)) throw new HostCommandError("TRANSITION_NOT_FOUND", `Transition match name is not installed: ${requested}`);
  const transition = await ppro.TransitionFactory.createVideoTransition(requested);
  const options = ppro.AddTransitionOptions();
  options.setApplyToStart(position !== "end");
  options.setForceSingleSided(Boolean(args.forceSingleSided ?? false));
  if (args.alignment != null) options.setTransitionAlignment(Number(args.alignment));
  if (args.durationSeconds != null) options.setDuration(tickFromSeconds(Number(args.durationSeconds)));
  const hostResult = executeTransaction(current.project, `Apply transition ${requested}`, () => [entry.raw.createAddVideoTransitionAction(transition, options)]);
  const readback = await pollTransitionState(args, entry.snapshot, position, (candidates) => candidates.some((candidate) => candidate.matchName === requested));
  const after = readback.snapshot;
  const candidates = readback.candidates;
  const matched = candidates.find((candidate) => candidate.matchName === requested);
  const durationPass = args.durationSeconds == null || (matched && isFrameAligned(Number(matched.duration.seconds), Number(args.durationSeconds)));
  const pass = hostResult && Boolean(matched) && durationPass;
  const domReadbackUnavailable = hostResult && candidates.length === 0;
  return {
    status: pass ? "pass" : domReadbackUnavailable ? "unverified" : hostResult && candidates.length ? "partial" : "fail",
    before,
    hostResult: { removalResult, applyResult: hostResult, readbackAttempts: readback.attempts, requested: { matchName: requested, position, durationSeconds: args.durationSeconds, forceSingleSided: Boolean(args.forceSingleSided ?? false), alignment: args.alignment }, matched },
    after,
    errors: domReadbackUnavailable
      ? ["Premiere's transition-list API returned no items; the MCP server must verify the saved project archive"]
      : [...(!matched && candidates.length ? [`Transition match name did not read back as ${requested}`] : []), ...(!durationPass ? ["Transition duration did not read back within one frame"] : [])],
  };
}

async function removeTransition(args: AnyRecord): Promise<HostResult> {
  const { project, sequence } = await mutationContext(args);
  const entry = await findTrackItemEntry(sequence, text(args.trackItemId));
  if (entry.snapshot.mediaType !== "video") throw new HostCommandError("VIDEO_ITEM_REQUIRED", "Video transition removal requires a video track item");
  const before = await sequenceSnapshot(sequence);
  const position = text(args.position) === "end" ? "end" : "start";
  const existing = transitionsAtClipEdge(before, entry.snapshot, position);
  assertMethod(entry.raw, "createRemoveVideoTransitionAction", "VideoClipTrackItem.createRemoveVideoTransitionAction");
  const transitionPosition = position === "end" ? ppro.Constants.TransitionPosition.END : ppro.Constants.TransitionPosition.START;
  const hostResult = executeTransaction(project, `Remove ${position} video transition`, () => [entry.raw.createRemoveVideoTransitionAction(transitionPosition)]);
  const readback = await pollTransitionState(args, entry.snapshot, position, (candidates) => candidates.length === 0);
  const after = readback.snapshot;
  const remaining = readback.candidates;
  const pass = hostResult && existing.length > 0 && remaining.length === 0;
  const domReadbackUnavailable = hostResult && existing.length === 0;
  return {
    status: pass ? "pass" : domReadbackUnavailable ? "unverified" : "fail",
    before,
    hostResult: { transaction: hostResult, removed: existing.length, readbackAttempts: readback.attempts },
    after,
    errors: domReadbackUnavailable
      ? ["Premiere's transition-list API returned no items; the MCP server must verify the saved project archive"]
      : pass ? [] : ["Transition remained at the requested clip edge"],
  };
}

async function setValues(args: AnyRecord, kind: "transform" | "grade" | "audio"): Promise<HostResult> {
  const { project, entry } = await exactEffectTarget(args);
  const before = await effectSnapshot(args,entry.raw);
  const matches = before.filter((candidate) => {
    if (args.componentIndex !== undefined && !componentMatches(candidate, effectSelector(args))) return false;
    const label = `${text(candidate.displayName)} ${text(candidate.matchName)}`.toLocaleLowerCase("en-US");
    if (kind === "grade") return label.includes("lumetri");
    if (kind === "audio") return /volume|볼륨/.test(label);
    return /motion|transform|모션|변형/.test(label);
  });
  if (!matches.length && kind === "grade") {
    const catalog = await inspectEffectCatalog();
    const lumetri = catalog.videoEffects.find((c: AnyRecord) => /lumetri/i.test(`${c.matchName} ${c.displayName}`));
    if (!lumetri) return { status: "unsupported", before, errors: ["Lumetri is not installed"] };
    const effectArgs={ ...args, matchName: lumetri.matchName, initialValues: args.values, initialParameters: args.parameters };
    return withEffectTargetLookup(effectArgs,()=>applyVideoEffect(effectArgs),args);
  }
  if (matches.length !== 1) throw new HostCommandError("COMPONENT_NOT_FOUND_OR_AMBIGUOUS", `Specify the inspected componentIndex for ${kind}; found ${matches.length} candidates`);
  const component = matches[0]!;
  const valueArgs={ ...args, componentIndex: component.componentIndex, componentMatchName: component.matchName };
  return withEffectTargetLookup(valueArgs,()=>setEffectValuesOnce(valueArgs, { project, entry, before }),args);
}

async function scaleClipToFill(args: AnyRecord): Promise<HostResult> {
  const {project,sequence,entry} = await exactEffectTarget(args);
  if (entry.snapshot.mediaType !== "video") throw new HostCommandError("VIDEO_ITEM_REQUIRED", "Scale-to-fill requires a video track item");
  const before = await effectSnapshot(args,entry.raw);
  const motion = before.find(c => c.matchName === "AE.ADBE Motion");
  if (!motion || before.some(c => !["AE.ADBE Motion", "AE.ADBE Opacity"].includes(c.matchName))) throw new HostCommandError("FILL_GEOMETRY_UNSUPPORTED", "Additional effects can change frame coverage; use an explicit transform until their geometry is verified");
  const role = (name: string) => {
    const p = motion.params.find((p: AnyRecord) => p.descriptor.semanticRole === name);
    if (!p) throw Error(`Motion ${name} is not exposed`);
    requireReadableParameter(p,true); return p;
  };
  const scale = role("scale");
  if (!effectValuesEqual(role("position").value,{kind:"point",x:.5,y:.5}) || !effectValuesEqual(role("anchor").value,{kind:"point",x:.5,y:.5}) || role("rotation").value !== 0 || role("uniformScale").value !== true) {
    throw new HostCommandError("FILL_GEOMETRY_PRECONDITION_FAILED", "Fill requires centered position/anchor, zero rotation and uniform scale. Inspect/set those controls explicitly first.");
  }
  const crops = motion.params.filter((p: AnyRecord) => /crop|자르기/i.test(p.displayName));
  for (const p of crops) { requireReadableParameter(p,true); if(p.value !== 0) throw Error("FILL_GEOMETRY_PRECONDITION_FAILED: Motion cropping must be zero"); }
  const source = await sourceMetadata(entry.raw,sequence);
  const dimensions = text(JSON.parse(source.columns).find((c: AnyRecord) => c.ColumnID === "Column.Intrinsic.VideoInfo")?.ColumnValue).match(/^(\d+)\s*[x×]\s*(\d+)/);
  if (!dimensions || source.pixelAspectRatio !== 1 || source.sequencePixelAspectRatio !== "1:1") throw new HostCommandError("FILL_SOURCE_GEOMETRY_UNVERIFIED", "Native source dimensions and square source/sequence pixels are required");
  const width = Number(dimensions[1]), height = Number(dimensions[2]);
  if (width !== Number(args.sourceWidth) || height !== Number(args.sourceHeight)) throw new HostCommandError("SOURCE_DIMENSIONS_CHANGED", "Requested source dimensions differ from Premiere metadata");
  const frame = await sequence.getFrameSize();
  const plan = computeScaleToFill(Number(frame.width),Number(frame.height),width,height);
  const valueArgs={ ...args, componentIndex: motion.componentIndex, componentMatchName: motion.matchName,
    parameters:[{paramIndex:scale.paramIndex,expectedDisplayName:scale.displayName,expectedValue:scale.value,value:plan.scalePercent}] };
  const receipt = await withEffectTargetLookup(valueArgs,()=>setEffectValuesOnce(valueArgs, {project,entry,before}),args);
  const proven = receipt.status === "pass";
  return {
    ...receipt,
    hostResult: { scaleWrite: receipt.hostResult, fillPlan: plan, aspectRatioPreserved: proven, noUnusedFrameSpace: proven,
      coverage: "geometric_source_bounds; embedded bars, transparency, masks and intrinsic image content are not removed", sourceDimensionsVerified: true },
    after: { host: receipt.after, fillPlan: plan },
  };
}

async function placeAudio(args: AnyRecord): Promise<HostResult> {
  const imported = await importMedia({ ...args, filePaths: [args.filePath], binId: args.binId });
  if (imported.status === "fail") return imported;
  const {project} = await mutationContext(args);
  const match = (await projectItems(project,Infinity)).find((item) => item.snapshot.path && normalizeHostPath(item.snapshot.path) === normalizeHostPath(text(args.filePath)));
  if (!match) return { status: "fail", before: imported.before, hostResult: imported.hostResult, after: imported.after, errors: ["Imported audio project item was not found"] };
  return placeClips({ ...args, placements: [{ projectItemId: match.snapshot.id, timeSeconds: Number(args.timeSeconds ?? 0), videoTrackIndex: Number(args.videoTrackIndex ?? 0), audioTrackIndex: Number(args.audioTrackIndex ?? 0), mode: "overwrite" }] });
}


async function exportFrame(args: AnyRecord): Promise<HostResult> {
  const {sequence} = await mutationContext(args);
  const outputPath = text(args.outputPath);
  const outputRoot = LOCAL_SCRATCH_ROOT.replace(/scratch$/i, "output");
  if (!pathIsWithin(outputRoot, outputPath)) throw new HostCommandError("PATH_NOT_ALLOWED", "Frame export must be inside artifacts\\output");
  const { directory, filename } = splitWindowsPath(outputPath);
  const settings = await sequence.getSettings();
  const rect = await settings.getVideoFrameRect();
  assertMethod(ppro.Exporter, "exportSequenceFrame", "Exporter.exportSequenceFrame");
  const hostResult = await dispatchContent(()=>ppro.Exporter.exportSequenceFrame(sequence, tickFromSeconds(Number(args.timeSeconds ?? 0)), filename, directory, Number(args.width ?? rect.width), Number(args.height ?? rect.height)));
  return { status: hostResult ? "unverified" : "fail", hostResult, changedFiles: hostResult ? [outputPath] : [], errors: hostResult ? ["Node server must verify the exported file exists"] : ["Premiere frame export failed"] };
}

async function exportReviewFrames(args: AnyRecord): Promise<HostResult> {
  const times = Array.isArray(args.timesSeconds) ? args.timesSeconds.map(Number) : [];
  const outputs = Array.isArray(args.outputPaths) ? args.outputPaths.map(text) : [];
  if (times.length !== outputs.length) throw new HostCommandError("INVALID_ARGUMENTS", "timesSeconds and outputPaths must have the same length");
  const receipts: HostResult[] = [];
  for (let index = 0; index < times.length; index += 1) receipts.push(await exportFrame({ timeSeconds: times[index], outputPath: outputs[index] }));
  const files = receipts.flatMap((receipt) => receipt.changedFiles ?? []);
  return { status: receipts.every((receipt) => receipt.status !== "fail") ? "unverified" : "fail", hostResult: receipts, changedFiles: files, errors: receipts.flatMap((receipt) => receipt.errors ?? []) };
}

async function exportSequence(args: AnyRecord): Promise<HostResult> {
  const {sequence} = await mutationContext(args);
  const outputPath = text(args.outputPath);
  const outputRoot = LOCAL_SCRATCH_ROOT.replace(/scratch$/i, "output");
  if (!pathIsWithin(outputRoot, outputPath)) throw new HostCommandError("PATH_NOT_ALLOWED", "Sequence export must be inside artifacts\\output");
  assertMethod(ppro.EncoderManager, "getManager", "EncoderManager.getManager");
  const manager = ppro.EncoderManager.getManager();
  assertMethod(manager, "exportSequence", "EncoderManager.exportSequence");
  const hostResult = await dispatchContent(()=>manager.exportSequence(sequence, ppro.Constants.ExportType.IMMEDIATELY, outputPath, text(args.presetPath), Boolean(args.exportFull ?? true)));
  return { status: hostResult ? "unverified" : "fail", hostResult, changedFiles: hostResult ? [outputPath] : [], errors: hostResult ? ["Node server must verify the exported file exists and matches delivery requirements"] : ["Premiere sequence export failed"] };
}

async function saveWorkingProject(args:AnyRecord={}): Promise<HostResult> {
  const project = await activeProject();
  assertWorkingProject(project);
  let scopedSequence:{sequenceId:string;sequenceName:string}|undefined;
  if(args.expectedProjectId||args.expectedSequenceId||args.expectedSequenceName){
    const sequence=await activeSequence(project);
    scopedSequence={sequenceId:await sequenceId(sequence),sequenceName:text(sequence.name)};
    // IDs pin the save; the public schema permits omitting the name after a rename.
    if(text(project.guid)!==args.expectedProjectId||scopedSequence.sequenceId!==args.expectedSequenceId||(args.expectedSequenceName!==undefined&&scopedSequence.sequenceName!==args.expectedSequenceName))
      throw new HostCommandError('CONTEXT_CHANGED','Scoped save requires exact current project/sequence IDs. expectedSequenceName is optional; if supplied it must match the fresh name. Save was not dispatched.',
        {contentDispatched:false,retryable:false,errorClassification:'preflight',actualTarget:{projectId:text(project.guid),...scopedSequence}});
  }
  assertMethod(project, "save", "Project.save");
  const before = { path: text(project.path), name: text(project.name),projectId:text(project.guid),...scopedSequence };
  if(args.expectedProjectPath!==undefined && normalizeHostPath(before.path)!==normalizeHostPath(text(args.expectedProjectPath)))
    throw new HostCommandError('PROJECT_PATH_PRECONDITION_FAILED','Save requires the exact expected project path. Save was not dispatched.',
      {contentDispatched:false,retryable:false,errorClassification:'preflight',actualTarget:before});
  const hostResult = await dispatchContent(()=>project.save());
  const afterProject = await activeProject();
  const afterSequence=scopedSequence?await activeSequence(afterProject):undefined;
  const after = { path: text(afterProject.path), name: text(afterProject.name),projectId:text(afterProject.guid),
    ...(afterSequence?{sequenceId:await sequenceId(afterSequence),sequenceName:text(afterSequence.name)}:{}) };
  const matches=normalizeHostPath(before.path)===normalizeHostPath(after.path)&&before.projectId===after.projectId
    &&(!scopedSequence||after.sequenceId===scopedSequence.sequenceId&&(args.expectedSequenceName===undefined||after.sequenceName===args.expectedSequenceName));
  return { status: hostResult && matches ? "pass" : "fail", before, hostResult, after, changedFiles: hostResult ? [before.path] : [], errors: !hostResult ? ["Premiere project save failed"] : matches?[]:['SAVE_TARGET_READBACK_CHANGED: save returned but project/sequence identity differs; inspect before retrying'] };
}

async function closeWorkingProject(args: AnyRecord, lifecycle: ProjectLifecycle): Promise<HostResult> {
  const project = await activeProject();
  assertWorkingProject(project);
  const active = await activeSequence(project);
  const projectPath = text(project.path);
  const sequenceName = text(args.sequenceName);
  const sequenceUid = text(args.sequenceId);
  const activeName = text(active.name);
  const activeUid = await sequenceId(active);
  let targetExists = false;
  for (const candidate of await project.getSequences()) {
    if (text(candidate.name) === sequenceName && await sequenceId(candidate) === sequenceUid) {
      targetExists = true;
      break;
    }
  }
  const projectIdentity = { guid: text(project.guid), path: projectPath, name: text(project.name) };
  const before = { projectPath, projectId: projectIdentity.guid, sequenceName: activeName, sequenceId: activeUid };
  if (normalizeHostPath(projectPath) !== normalizeHostPath(text(args.projectPath))) {
    throw new HostCommandError("ACTIVE_TARGET_MISMATCH", "Refusing to close a project that differs from the explicit target");
  }
  if (args.recovery === true) {
    if (!targetExists) throw new HostCommandError("TARGET_SEQUENCE_NOT_FOUND", "Recovery close requires the exact target sequence to remain in the project");
  } else if (activeName !== sequenceName || activeUid !== sequenceUid) {
    throw new HostCommandError("ACTIVE_TARGET_MISMATCH", "Refusing to close a sequence that differs from the explicit target");
  }
  const openProjects = await readOpenProjects(ppro);
  if (!openProjects.projects.some(value => value.guid === projectIdentity.guid && normalizeHostPath(value.path) === normalizeHostPath(projectPath)))
    throw new HostCommandError('PROJECT_VIEW_TARGET_MISSING','The exact close target is absent from the strict project-view inventory.',
      {contentDispatched:false,retryable:false,errorClassification:'preflight'});
  if (args.requireExclusiveProject === true && openProjects.projects.some(value => normalizeHostPath(value.path) !== normalizeHostPath(projectPath)))
    throw new HostCommandError('PROJECT_CLOSE_REQUIRES_EXCLUSIVE_TARGET','Another project view is open. The archive workflow cannot save or close until only its exact target remains.',
      {contentDispatched:false,retryable:false,errorClassification:'preflight',actualTarget:{...before,openProjects}});
  // Listener availability and registration must succeed before the first save.
  const prepared = lifecycle.prepareClose(projectIdentity);
  try {
  // Typed opaque-curve lifecycle only: release the selected native editor
  // before its project closes. No values or clip content are changed. Reopening
  // must acquire a fresh selection/editor, never the old graph's UI lifetime.
  if (args.releaseEffectControls === true) {
    const releaseProject = await activeProject();
    if (text(releaseProject.guid) !== projectIdentity.guid || normalizeHostPath(text(releaseProject.path)) !== normalizeHostPath(projectPath))
      throw new HostCommandError('ACTIVE_TARGET_MISMATCH','Project changed before releasing Effect Controls');
    const releaseSequence = await activeSequence(releaseProject);
    if (await sequenceId(releaseSequence) !== activeUid || text(releaseSequence.name) !== activeName)
      throw new HostCommandError('ACTIVE_TARGET_MISMATCH','Sequence changed before releasing Effect Controls');
    await releaseSequence.clearSelection();
    await new Promise(resolve=>setTimeout(resolve,0));
    const verificationProject = await activeProject();
    if (text(verificationProject.guid) !== projectIdentity.guid || normalizeHostPath(text(verificationProject.path)) !== normalizeHostPath(projectPath))
      throw new HostCommandError('ACTIVE_TARGET_MISMATCH','Project changed after releasing Effect Controls');
    const verificationSequence = await activeSequence(verificationProject);
    if (await sequenceId(verificationSequence) !== activeUid || text(verificationSequence.name) !== activeName)
      throw new HostCommandError('ACTIVE_TARGET_MISMATCH','Sequence changed after releasing Effect Controls');
    if ((await (await verificationSequence.getSelection()).getTrackItems()).length !== 0) {
      throw new HostCommandError("SELECTION_CLEAR_UNVERIFIED", "Effect Controls selection was not released before close");
    }
  }
  const save = await saveWorkingProject({expectedProjectId:projectIdentity.guid,expectedProjectPath:projectPath,
    expectedSequenceId:activeUid,expectedSequenceName:activeName});
  if (save.status !== 'pass') return { status: save.status, before: {...before,openProjects}, hostResult: { saved: save.hostResult, closed: false, closeDispatched: false },
    changedFiles: save.changedFiles ?? [], errors: save.errors ?? ['Premiere project save was not verified before close'] };
  // Save may rebuild project objects. Reacquire and validate before close; no
  // old project/sequence wrapper is accessed after native close dispatch.
  const closingProject = await activeProject();
  if (text(closingProject.guid) !== projectIdentity.guid || normalizeHostPath(text(closingProject.path)) !== normalizeHostPath(projectPath))
    return {status:'unverified',before:{...before,openProjects},hostResult:{saved:true,closed:false,closeDispatched:false},changedFiles:[projectPath],errors:['PROJECT_CLOSE_TARGET_CHANGED_AFTER_SAVE']};
  const options = new ppro.CloseProjectOptions();
  options.setPromptIfDirty(false).setShowCancelButton(false).setSaveWorkspace(false);
  const result = await prepared.execute(() => closingProject.close(options));
  return { status: result.closeVerification.status, before: {...before,openProjects},
    hostResult: { saved: true, ...result, closeDispatched: true, effectControlsReleased: args.releaseEffectControls === true },
    changedFiles: [before.projectPath], errors: result.closeVerification.status === 'pass' ? [] : [result.closeVerification.reason ?? 'Project close was not verified'] };
  } finally { prepared.dispose(); }
}

async function openWorkingProject(args: AnyRecord): Promise<HostResult> {
  const projectPath = text(args.projectPath);
  const sequenceName = text(args.sequenceName);
  const sequenceUid = text(args.sequenceId);
  assertWorkingProject({path:projectPath});
  if(!sequenceName||!sequenceUid)throw new HostCommandError("INVALID_SEQUENCE","An exact existing sequence name and ID are required");
  if (!ppro.Project.isProject(projectPath)) throw new HostCommandError("INVALID_PROJECT", "Premiere does not recognize the requested project path");
  const options = new ppro.OpenProjectOptions();
  options.setShowConvertProjectDialog(false).setShowLocateFileDialog(false).setShowWarningDialog(false).setAddToMRUList(false);
  const project = await ppro.Project.open(projectPath, options);
  assertWorkingProject(project);
  let sequence: any;
  for (const candidate of await project.getSequences()) {
    if (text(candidate.name) === sequenceName && await sequenceId(candidate) === sequenceUid) {
      sequence = candidate;
      break;
    }
  }
  if (!sequence) throw new HostCommandError("WORKING_SEQUENCE_NOT_FOUND", "The reopened project does not contain the exact expected sequence");
  const opened = await project.openSequence(sequence);
  const active = await ppro.Project.getActiveProject();
  const activeSequenceValue = await active.getActiveSequence();
  const after = { projectPath: text(active.path), sequenceName: text(activeSequenceValue.name), sequenceId: await sequenceId(activeSequenceValue) };
  const verified = opened
    && normalizeHostPath(after.projectPath) === normalizeHostPath(projectPath)
    && after.sequenceName === sequenceName
    && after.sequenceId === sequenceUid;
  return { status: verified ? "pass" : "fail", hostResult: { opened }, after, errors: verified ? [] : ["Reopened project or active sequence readback mismatch"] };
}

export class PremiereHost {
  private readonly parameterSchemas=new Map<string,AnyRecord>();
  private readonly commandQueue = new HostCommandQueue();
  private readonly projectLifecycle = new ProjectLifecycle(ppro);
  private contextReadId = 0;
  private readonly commandSequences = new TrackCommandSequences(event=>this.onSequenceProgress(event));
  constructor(private readonly onWorkTarget: (id: string, target: WorkTarget) => void = () => {},
    private readonly onSequenceTask: (event: TaskEvent) => void = () => {},
    private readonly nativeVisibility: (id:string,panel:NativeWorkPanel,projectName:string,sequenceName:string)=>Promise<Record<string,unknown>> = async()=>({status:"unsupported",reason:"Native panel runtime unavailable"}),
    private readonly waitForFrame: (id:string)=>Promise<Record<string,unknown>> = async()=>({status:"unsupported",reason:"Frame verification runtime unavailable"}),
    private readonly projectSelection: (id:string,target:NativeProjectItemTarget)=>Promise<Record<string,unknown>> = async()=>({status:"unsupported",reason:"Project selection runtime unavailable"}),
    private readonly nativeVisual: (id:string)=>Promise<Record<string,unknown>> = async()=>({status:"unsupported",reason:"Native visual SDK runtime unavailable"}),
    private readonly effectDisclosure:(id:string,phase:EffectDisclosurePhase,work:EffectDisclosureWork)=>Promise<Record<string,unknown>> = async()=>({status:"unsupported",available:false,reason:"Effect disclosure runtime unavailable"}),
    private readonly maskTracking:(id:string,phase:MaskTrackingPhase,step:number,work:MaskTrackingWork)=>Promise<Record<string,unknown>> = async()=>({status:"unsupported",reason:"Mask tracking runtime unavailable"}),
    private readonly nativeMaskArchive:(id:string,work:NativeMaskWork)=>Promise<Record<string,unknown>> = async()=>({status:"unsupported",reason:"Native mask archive runtime unavailable"}),
    private readonly onSequenceProgress:(event:{jobId:string;state:string;completedSteps:number;totalSteps:number;durationMs:number})=>void=()=>{},
    private readonly effectChainProof?:((id:string,work:EffectChainProofWork)=>Promise<Record<string,unknown>>),
    private readonly effectNativeSample?:((id:string,work:EffectNativeSampleWork)=>Promise<Record<string,unknown>>)) {}

  private async prepareNativeEffectTime(request:BridgeRequest):Promise<void> {
    const args=request.args as AnyRecord;
    delete args.__nativeEffectTimeProof;
    if(!['get_effect_values','set_effect_keyframes','edit_effect_keyframes'].includes(request.command)||args.detail==='chain')return;
    const current=await exactEffectTarget(args),snap=current.entry.snapshot;
    if(snap.mediaType==='audio'&&snap.speed===1&&snap.reversed===false)return;
    // getSpeed()==1 does not exclude native Time Remapping (live O02 ramp).
    if(snap.mediaType!=='video'||!Number.isFinite(snap.speed)||snap.speed<=0||snap.speed>1000||typeof snap.reversed!=='boolean'||!this.effectNativeSample)throw Error('EFFECT_TIME_MAPPING_UNSUPPORTED: exact SDK time proof is required');
    const sampleTimes=requestedEffectTimes(request.command,args,snap.start.ticks);
    if(!sampleTimes.length||sampleTimes.length>64||sampleTimes.some(t=>!/^\d+$/.test(t)||BigInt(t)<BigInt(snap.start.ticks)||BigInt(t)>=BigInt(snap.end.ticks)))throw Error('KEYFRAME_OUTSIDE_CLIP_OR_TIME_PROOF_LIMIT');
    const before=await effectComponents(args,current.entry.raw),component=before.find(c=>componentMatches(c,effectSelector(args)));
    if(!component||!component.params.length)throw Error('NATIVE_TIME_EFFECT_NOT_FOUND');
    const source=await current.entry.raw.getProjectItem(),media=await ppro.ClipProjectItem.cast(source),mediaPath=text(await media?.getMediaFilePath?.());
    await current.project.openSequence(current.sequence);
    const visibleTicks=text((await current.sequence.getPlayerPosition()).ticks);
    const work:EffectNativeSampleWork={purpose:'time_mapping',exactMapping:true,reversed:snap.reversed,speed:snap.speed,sampleTimes,projectId:String(args.expectedProjectId),sequenceId:String(args.expectedSequenceId),sequenceName:String(args.expectedSequenceName),trackItemId:String(args.trackItemId),
      projectItemId:snap.projectItemId,clipName:snap.name,mediaType:'video',trackIndex:snap.trackIndex,startTicks:snap.start.ticks,endTicks:snap.end.ticks,
      mediaPath,inTicks:snap.inPoint.ticks,outTicks:snap.outPoint.ticks,sequenceTicks:snap.start.ticks,nativeTicks:'0',
      componentMatchNames:before.map(c=>c.matchName),components:[{componentIndex:component.componentIndex,componentMatchName:component.matchName,parameterNames:component.params.map((p:AnyRecord)=>text(p.displayName))}],
      componentIndex:component.componentIndex,componentMatchName:component.matchName,paramIndex:0,parameterCount:component.params.length};
    if(request.command==='get_effect_values')work.keyNativeTimes=[...new Set<string>(component.params.filter((p:AnyRecord)=>args.detail!=='parameter'||p.paramIndex===args.paramIndex).flatMap((p:AnyRecord)=>p.keyframeDetails.map((k:AnyRecord)=>text(k.time.ticks))))].slice(0,64);
    if(!mediaPath)throw Error("EFFECT_TIME_MAPPING_UNSUPPORTED: native timeline graphics have no media source");
    const proof=await this.effectNativeSample(request.id,work);
    if(proof.status!=='pass')throw Error('EFFECT_TIME_MAPPING_UNSUPPORTED: '+String(proof.reason??proof.status));
    const after=await exactEffectTarget(args);
    if(!snapshotsEqual(snap,after.entry.snapshot)||!snapshotsEqual(before,await effectComponents(args,after.entry.raw))||text((await after.sequence.getPlayerPosition()).ticks)!==visibleTicks)throw Error('NATIVE_TIME_CONTEXT_CHANGED');
    // Proof lives only in this serialized command; every requested key/read time
    // was evaluated by the SDK before any action can be constructed.
    args.__nativeEffectTimeProof=proof;
  }

  private async prepareNativeColorSamples(request:BridgeRequest):Promise<void> {
    const args=request.args as AnyRecord;
    if(args.detail==='chain')return;
    const target=await exactEffectTarget(args),snap=target.entry.snapshot;
    if(snap.mediaType!=='video'||(snap.speed!==1||snap.reversed!==false)&&!args.__nativeEffectTimeProof)return;
    const time=effectTime(snap as any,{timeTicks:args.timeSeconds===undefined?snap.start.ticks:undefined,timeSeconds:args.timeSeconds},args.__nativeEffectTimeProof);
    const sample=ppro.TickTime.createWithTicks(time.nativeTicks);
    const visibleTicks=text(framePosition(Number(time.sequenceTicks)/254016000000,text(await target.sequence.getTimebase())).ticks);
    const projected=await effectComponents(args,target.entry.raw,sample,{componentIndex:Number(args.componentIndex),...(args.detail==='parameter'?{paramIndex:Number(args.paramIndex)}:{})});
    const needed=projected[0]?.params.filter((p:AnyRecord)=>p.nativeValueType==='color'&&p.readStatus.value==='unsupported');
    if(!needed?.length||!this.effectNativeSample)return;
    if(needed.length>16)throw Error('NATIVE_COLOR_SAMPLE_LIMIT');
    const before=await effectComponents(args,target.entry.raw,sample),component=before.find(c=>componentMatches(c,effectSelector(args)));
    if(!component)throw Error('NATIVE_SAMPLE_COMPONENT_CHANGED');
    const source=await target.entry.raw.getProjectItem(),media=await ppro.ClipProjectItem.cast(source),mediaPath=text(await media?.getMediaFilePath?.());
    if(!mediaPath)return;
    const values:AnyRecord[]=[];
    for(const param of needed){
      const current=await exactEffectTarget(args);
      if(!snapshotsEqual(snap,current.entry.snapshot)||!snapshotsEqual(before,await effectComponents(args,current.entry.raw,sample)))throw Error('NATIVE_SAMPLE_CONTENT_CHANGED');
      // openSequence re-focuses the actual timeline, enabling Adobe's bounded
      // Export Controller. The normal effect-panel protocol runs after sampling.
      await current.project.openSequence(current.sequence);
      if(text((await current.sequence.getPlayerPosition()).ticks)!==visibleTicks)throw Error('NATIVE_SAMPLE_PLAYHEAD_CHANGED');
      const work:EffectNativeSampleWork={projectId:String(args.expectedProjectId),sequenceId:String(args.expectedSequenceId),sequenceName:String(args.expectedSequenceName),trackItemId:String(args.trackItemId),
        projectItemId:snap.projectItemId,clipName:snap.name,mediaType:'video',trackIndex:snap.trackIndex,startTicks:snap.start.ticks,endTicks:snap.end.ticks,
        mediaPath,inTicks:snap.inPoint.ticks,outTicks:snap.outPoint.ticks,sequenceTicks:time.sequenceTicks,nativeTicks:time.nativeTicks,
        componentMatchNames:before.map(c=>c.matchName),components:[{componentIndex:component.componentIndex,componentMatchName:component.matchName,parameterNames:component.params.map((p:AnyRecord)=>text(p.displayName))}],
        componentIndex:component.componentIndex,componentMatchName:component.matchName,paramIndex:param.paramIndex,parameterCount:component.params.length};
      if(args.__nativeEffectTimeProof){work.reversed=snap.reversed;work.speed=snap.speed;work.originTicks=args.__nativeEffectTimeProof.originTicks;if(args.__nativeEffectTimeProof.exactOnly)work.exactMapping=true;}
      work.references=param.keyframeDetails.map((key:AnyRecord)=>({nativeTicks:key.time.ticks,sequenceTicks:nativeToSequenceTime(snap as any,key.time.ticks,args.__nativeEffectTimeProof)?.ticks,value:key.value}))
        .filter((r:AnyRecord)=>r.sequenceTicks&&BigInt(r.sequenceTicks)>=BigInt(snap.start.ticks)&&BigInt(r.sequenceTicks)<BigInt(snap.end.ticks)&&r.value&&['red','green','blue','alpha'].every(k=>Number.isFinite(r.value[k]))).slice(0,8);
      const result=await this.effectNativeSample(request.id,work);
      values.push({paramIndex:param.paramIndex,result});
      if(result.status!=='pass')break;
    }
    // Plain snapshots cross the native/UI boundary; no retained component proxy.
    args.__nativeColorSamples={before,snapshot:snap,nativeTicks:time.nativeTicks,visibleTicks,values};
  }

  private async readPointChain(request:BridgeRequest,snapshots:AnyRecord[],forceIndices:number[]=[]):Promise<AnyRecord[]> {
    const selected=snapshots.filter(c=>c.params.some((p:AnyRecord)=>p.descriptor?.inputKind==='point'&&(p.keyframes.length>0||forceIndices.includes(c.componentIndex))));
    if(!selected.length)return snapshots;
    if(!this.effectChainProof)throw new HostCommandError('POINT_ANIMATION_WORK_TARGET_REQUIRED','Saved native Point proof is required before any Point animation edit');
    if(snapshots.some((c,i)=>c.componentIndex!==i))throw Error('POINT_PROOF_FULL_CHAIN_REQUIRED');
    const args=request.args as AnyRecord,current=await exactEffectTarget(args),snap=current.entry.snapshot;
    if(!await dispatchContent(()=>current.project.save()))throw Error('POINT_CHAIN_SAVE_UNVERIFIED');
    const work:EffectChainProofWork={projectId:String(args.expectedProjectId),sequenceId:String(args.expectedSequenceId),sequenceName:String(args.expectedSequenceName),trackItemId:String(args.trackItemId),
      projectItemId:String(snap.projectItemId),clipName:String(snap.name),mediaType:snap.mediaType,trackIndex:snap.trackIndex,startTicks:snap.start.ticks,endTicks:snap.end.ticks,
      componentMatchNames:snapshots.map(c=>c.matchName),components:selected.map(c=>({componentIndex:c.componentIndex,componentMatchName:c.matchName,parameterNames:c.params.map((p:AnyRecord)=>text(p.displayName))}))};
    const archive=await this.effectChainProof(request.id,work) as AnyRecord;
    if(archive.status!=='pass'||!Array.isArray(archive.components)||archive.components.length!==selected.length)throw Error('POINT_CHAIN_ARCHIVE_UNVERIFIED: '+String(archive.reason??archive.status));
    const sampleTicks=snapshots[0]?.params[0]?.sampledAt?.ticks;if(typeof sampleTicks!=='string')throw Error('POINT_CHAIN_SAMPLE_REQUIRED');
    const after=await exactEffectTarget(args),raw=await effectComponents(args,after.entry.raw,ppro.TickTime.createWithTicks(sampleTicks));
    if(!snapshotsEqual(snap,after.entry.snapshot)||verifyParameterPreservation(snapshots,raw,[]).length)throw Error('POINT_CHAIN_CHANGED_DURING_SAVE');
    return snapshots.map(c=>{
      if(!selected.includes(c))return c;
      const matches=archive.components.filter((a:AnyRecord)=>a.componentIndex===c.componentIndex);
      if(matches.length!==1)throw Error('POINT_CHAIN_ARCHIVE_COMPONENT_CHANGED');
      return enrichPointAnimation(c,matches[0]);
    });
  }

  private async pointAnimationReadback(request:BridgeRequest,snapshots:AnyRecord[]):Promise<AnyRecord[]> {
    const args=request.args as AnyRecord,selected=snapshots.find(c=>componentMatches(c,effectSelector(args)));
    if(!selected)throw Error('POINT_ANIMATION_EFFECT_CHANGED');
    const current=await exactEffectTarget(args),sample=snapshots[0]?.params[0]?.sampledAt?.ticks;
    const raw=await effectComponents(args,current.entry.raw,ppro.TickTime.createWithTicks(sample));
    const proven=await this.readPointChain(request,raw,[selected.componentIndex]);
    // Forced empty-Point capability checks preserve already-proven unrelated
    // Point modes. No mode is stripped to make a comparison succeed.
    if(!snapshotsEqual(effectStateProjection(snapshots),effectStateProjection(proven)))throw Error('POINT_CAPABILITY_CHECK_CHANGED_STATE');
    return proven;
  }

  private async inspectNativeMasks(request:BridgeRequest):Promise<unknown>{
    const args=request.args,original=await exactEffectTarget(args),snap=original.entry.snapshot;
    if(snap.mediaType!=="video"||snap.name!==args.expectedClipName)throw Error("EXACT_VIDEO_CLIP_REQUIRED");
    const before=await componentSnapshot(original.entry.raw);
    if(!await dispatchContent(()=>original.project.save()))throw Error("MASK_PROJECT_SAVE_UNVERIFIED");
    const result=await this.nativeMaskArchive(request.id,{sequenceName:text(original.sequence.name),target:{sequenceId:String(args.expectedSequenceId),trackIndex:snap.trackIndex,startTicks:snap.start.ticks,endTicks:snap.end.ticks,projectItemId:snap.projectItemId,clipName:snap.name}});
    const after=await exactEffectTarget(args);
    if(!snapshotsEqual(snap,after.entry.snapshot)||!snapshotsEqual(before,await componentSnapshot(after.entry.raw)))throw Error("MASK_INSPECTION_CONTEXT_CHANGED");
    return {status:result.status,hostResult:result,changedFiles:[text(original.project.path)],errors:result.status==="pass"?[]:[String(result.reason??"Mask archive unavailable")]};
  }

  private async trackMask(request:BridgeRequest):Promise<unknown> {
    const args:AnyRecord=request.args,original=await exactEffectTarget(args),snap=original.entry.snapshot;
    if(snap.mediaType!=="video"||snap.name!==args.expectedClipName||snap.speed!==1||snap.reversed||!Number.isInteger(args.frames)||args.frames<1||args.frames>30||!["forward","backward"].includes(args.direction)||typeof args.maskName!=="string"||!args.maskName)throw new HostCommandError("MASK_TRACKING_TARGET_UNSUPPORTED","Tracking requires an exact forward 1x video clip, one native Object Mask, and 1–30 frames");
    const before=await componentSnapshot(original.entry.raw);
    const assertTarget=async()=>{
      const current=await exactEffectTarget(args),selection=await(await current.sequence.getSelection()).getTrackItems();
      if(!snapshotsEqual(snap,current.entry.snapshot)||!snapshotsEqual(before,await componentSnapshot(current.entry.raw))||selection.length!==1||!await current.entry.raw.getIsSelected())throw new HostCommandError("MASK_TRACKING_CONTEXT_CHANGED","Clip, selection, or normal effects changed during mask tracking");
    };
    const work:MaskTrackingWork={sequenceName:text(original.sequence.name),maskName:args.maskName,direction:args.direction,frames:args.frames,target:{sequenceId:args.expectedSequenceId,trackIndex:snap.trackIndex,startTicks:snap.start.ticks,endTicks:snap.end.ticks,projectItemId:snap.projectItemId,clipName:snap.name}};
    const result=await trackObjectMaskFrames(work,text(await original.sequence.getTimebase()),{
      assertTarget,position:async()=>text((await original.sequence.getPlayerPosition()).ticks),
      save:async()=>{await assertTarget();if(!await dispatchContent(()=>original.project.save()))throw Error("MASK_PROJECT_SAVE_UNVERIFIED");await assertTarget();},
      request:(phase,step,target)=>this.maskTracking(request.id,phase,step,target),
      yieldToHost:()=>new Promise(resolve=>setTimeout(resolve,80)),
    });
    return {status:result.status,hostResult:result,before:{clip:snap,effects:before},changedFiles:[text(original.project.path)],errors:result.status==="pass"?[]:[String(result.reason??"Mask tracking was not verified")],recovery:result.status==="pass"?undefined:"Inspect current mask and playhead before another tracking command; do not replay unknown steps"};
  }

  private async revealEffect(request:BridgeRequest):Promise<Record<string,unknown>> {
    const args:AnyRecord=request.args;
    if((!isEffectValueQuery(request.command,args)&&!["get_effect_values","set_effect_disclosure","apply_video_effect","apply_audio_effect","set_transform","scale_clip_to_fill","set_effect_values","set_effect_keyframes","edit_effect_keyframes","remove_effect","set_basic_grade","apply_color_adjustments","set_audio_level"].includes(request.command))||!args.trackItemId)return {status:"unsupported",reason:"Effect target mapping is not yet verified for this command"};
    // Sibling phases are exclusive; nativeFollow contains disclosure.timingsMs.
    // Keep this numeric record shared with the returned result so finally work
    // (especially finalValues) is visible after the promise has settled.
    const effectPhaseTimingsMs:Record<string,number>={},totalStarted=performance.now();
    let phaseStarted=totalStarted;
    try {
    const original=await exactEffectTarget(args);
    // Unsupported native-graphic disclosure must not hydrate every value before
    // discovering that the bounded helper has no media identity to correlate.
    const source=await original.entry.raw.getProjectItem(),clip=await ppro.ClipProjectItem.cast(source),mediaPath=text(await clip?.getMediaFilePath?.());
    if(!mediaPath)return {status:"unsupported",reason:"Media-backed clip required for disclosure identity"};
    const inspectedTarget=await exactEffectTarget(args);
    if(!snapshotsEqual(original.entry.snapshot,inspectedTarget.entry.snapshot))throw new HostCommandError('TRACK_ITEM_PRECONDITION_FAILED','Disclosure target changed during media identity inspection');
    effectPhaseTimingsMs.identityAndMedia=performance.now()-phaseStarted;phaseStarted=performance.now();
    const rawBefore=await effectComponents(args,inspectedTarget.entry.raw);
    effectPhaseTimingsMs.baselineSnapshot=performance.now()-phaseStarted;phaseStarted=performance.now();
    const proveNative=(raw:AnyRecord[])=>typeof args.__readEffectChain==='function'?args.__readEffectChain(raw):Promise.resolve(raw);
    const before:AnyRecord[]=await proveNative(rawBefore);
    effectPhaseTimingsMs.baselineNativeProof=performance.now()-phaseStarted;phaseStarted=performance.now();
    // Add handlers reveal the newly inserted state after their own guarded edit.
    if(!['apply_video_effect','apply_audio_effect'].includes(request.command))assertEffectSequenceState(args,before);
    const selector=["set_transform","scale_clip_to_fill"].includes(request.command)?{...effectSelector(args),componentMatchName:args.componentMatchName??"AE.ADBE Motion"}:request.command==="apply_video_effect"?{componentMatchName:text(args.matchName),componentIndex:args.componentIndex}:effectSelector(args);
    const nativeTimeHeader=request.command==="set_effect_disclosure"&&args.componentMatchName==="BE.TimeRemapping"&&args.componentIndex===undefined
      &&before.some(c=>c.matchName==="AE.ADBE Motion")&&before.some(c=>c.matchName==="AE.ADBE Opacity");
    const matches=nativeTimeHeader?[{matchName:"BE.TimeRemapping"}]:before.filter(c=>componentMatches(c,selector));
    if(matches.length!==1)return {status:"unsupported",reason:"A unique effect is required for native disclosure"};
    const sourceTarget=await exactEffectTarget(args);
    if(!snapshotsEqual(original.entry.snapshot,sourceTarget.entry.snapshot))throw new HostCommandError('TRACK_ITEM_PRECONDITION_FAILED','Disclosure target changed during effect inspection');
    const snap=original.entry.snapshot;
    const selected=matches[0]!;
    // Generated intrinsic owners ignore per-instance disclosure. Audio factory
    // catalogs also contain their labels, so catalog membership is not proof.
    const disclosureScope=isIntrinsicEffect(selected)?"match_name":"component";
    const work:EffectDisclosureWork={trackItemId:text(args.trackItemId),...(request.command==="set_effect_disclosure"?{expanded:args.expanded!==false}:{}),sequenceName:text(original.sequence.name),componentMatchNames:before.map(c=>text(c.matchName)),target:{mediaType:snap.mediaType,trackIndex:Number(snap.trackIndex),startTicks:text(snap.start.ticks),endTicks:text(snap.end.ticks),clipName:text(snap.name),mediaPath,componentMatchName:text(selected.matchName),disclosureScope,...(!nativeTimeHeader?{componentIndex:Number(selected.componentIndex),parameterCount:selected.params.length}:{parameterCount:1})}};
    args.__effectDisclosureWork=work;
    const requestedParameter=firstEffectParameter(args);
    let parameterSchema:AnyRecord|undefined;
    effectPhaseTimingsMs.selectorAndSource=performance.now()-phaseStarted;phaseStarted=performance.now();
    if(requestedParameter&&!nativeTimeHeader&&!isEffectValueQuery(request.command,args)&&!["remove_effect","set_effect_disclosure"].includes(request.command)){
      const key=JSON.stringify([args.expectedProjectId,args.expectedSequenceId,work.trackItemId,work.componentMatchNames,selected.componentIndex,selected.params.map((p:AnyRecord)=>[p.displayName,p.valueKind])]);
      parameterSchema=this.parameterSchemas.get(key);
      if(!parameterSchema){
        // One save per observed definition/layout lifetime, not per value edit.
        // Metadata contains no editable values and is never host-state proof.
        const current=await exactEffectTarget(args);
        if(await dispatchContent(()=>current.project.save())){
          parameterSchema=await this.effectDisclosure(request.id,"metadata",{...work,schemaTarget:{projectItemId:text(snap.projectItemId),parameterNames:selected.params.map((p:AnyRecord)=>text(p.displayName))}});
          if(parameterSchema.status==="pass"){if(this.parameterSchemas.size>=64)this.parameterSchemas.clear();this.parameterSchemas.set(key,parameterSchema);}
        }
      }
    effectPhaseTimingsMs.parameterSchema=performance.now()-phaseStarted;phaseStarted=performance.now();
      if(parameterSchema?.status==="pass")args.__effectParameterSchema=parameterSchema;
    }
    // Deleting a running analyzer must not depend on its progress counter staying
    // still. Only its intentionally removed parameter contents may evolve;
    // component identity/order and every surviving effect remain guarded.
    const discardable=request.command==="remove_effect"?selected.params.map((p:AnyRecord)=>({componentIndex:Number(selected.componentIndex),paramIndex:Number(p.paramIndex)})):[];
    const readBoundary=async()=>{
      const structure=await readEffectStructure(async()=>{
        const current=(await exactEffectTarget(args)).entry;
        if(!snapshotsEqual(original.entry.snapshot,current.snapshot))throw new HostCommandError('TRACK_ITEM_PRECONDITION_FAILED','Disclosure target metadata changed during UI work');
        return current;
      });
      if(!effectStructureMatches(rawBefore,structure))throw new HostCommandError('EFFECT_DISCLOSURE_CONTEXT_CHANGED','Effect topology changed during UI work');
    };
    const preservation=effectVisibilityPreservation(rawBefore,before,discardable,async()=>effectComponents(args,(await exactEffectTarget(args)).entry.raw),proveNative,readBoundary);
    const assertTarget=preservation.check;
    const parameterSnapshot=requestedParameter?resolveEffectParameter(enrichEffectParameterSchema(selected,parameterSchema),requestedParameter):undefined;
    const disclosurePath=parameterSnapshot?parameterDisclosurePath(parameterSnapshot,parameterSchema):undefined;
    const propertyWrites:AnyRecord[]=[];
    // Audio Effect Controls can still be reconstructing after its synchronous
    // selection/property calls return. Keep this quiet boundary inside the host
    // command, including after the last follow, rather than racing the next job.
    const settleDisclosure=async()=>{
      if(needsSettledEffectObjects(args)){noteGraphicMutation();await waitGraphicMutationQuiet();}
      else await new Promise(resolve=>setTimeout(resolve,0));
    };
    const acquireProperties=async(def?:{paramIndex:number;name:string})=>{
      const checked=await exactEffectTarget(args),checkedChain=await checked.entry.raw.getComponentChain(),checkedComponent=checkedChain.getComponentAtIndex(selected.componentIndex);
      if(!checkedComponent||await checkedComponent.getMatchName()!==selected.matchName)throw new HostCommandError('COMPONENT_CHANGED','Disclosure component moved');
      // Do not retain the checked component over its asynchronous name getter.
      const current=await exactEffectTarget(args),chain=await current.entry.raw.getComponentChain(),component=chain.getComponentAtIndex(selected.componentIndex);
      if(!component||component.getParamCount()!==selected.params.length)throw new HostCommandError('COMPONENT_CHANGED','Disclosure component layout changed');
      const owner=def?component.getParam(def.paramIndex):component;
      if(!owner||def&&text(owner.displayName)!==def.name)throw new HostCommandError('PARAMETER_DEFINITION_CHANGED','Disclosure parameter changed');
      return {project:current.project,properties:await ppro.Properties.getProperties(owner)};
    };
    const writeProperty=(def:{paramIndex:number;name:string}|undefined,key:string,value:boolean)=>writeEffectProperty(
      ()=>acquireProperties(def),key,value,
      ({project,properties},property,expanded)=>executeTransaction(project,'Set effect display',()=>[properties.createSetValueAction(property,expanded,ppro.Properties.PROPERTY_PERSISTENT)]),
      settleDisclosure,
    );
    effectPhaseTimingsMs.preservationSetup=performance.now()-phaseStarted;
    try {
    phaseStarted=performance.now();
    const disclosure=await revealEffectDisclosure(work,{
      deferSectionToParameter:!!disclosurePath,
      request:(phase,target)=>this.effectDisclosure(request.id,phase,target),assertTarget,
      writeComponentDisclosure:async(expanded)=>{
        const {accepted,actual}=await writeProperty(undefined,'ECP.Filter.Expanded',expanded);
        return {status:accepted&&String(actual)===String(expanded)?"pass":"unverified",route:"uxp_component_properties",uiVerified:false};
      },
      clearSelection:async()=>{
        const current=await exactEffectTarget(args);
        try{await current.sequence.clearSelection();}finally{await settleDisclosure();}
        const checked=await exactEffectTarget(args);
        if((await(await checked.sequence.getSelection()).getTrackItems()).length)throw new HostCommandError("SELECTION_CLEAR_UNVERIFIED","Effect panel selection was not cleared");
      },
      restoreSelection:async()=>{const current=await exactEffectTarget(args);try{await liveTrackItemSelection(current.sequence,[current.entry]);}finally{await settleDisclosure();}},
      yieldToHost:()=>waitGraphicMutationQuiet(),
    });
    effectPhaseTimingsMs.nativeFollow=performance.now()-phaseStarted;phaseStarted=performance.now();
    let parameterScroll=disclosure.parameterScroll;
    if(requestedParameter&&parameterSchema?.status!=="pass")parameterScroll={status:"unverified",scope:"exact_parameter",reason:"Exact parameter metadata could not be correlated; effect section proof does not prove the parameter row",parameterSchema};
    if(disclosure.status==="pass"&&parameterSnapshot){
      const snapshot=parameterSnapshot;
      if(disclosurePath?.length){
        const parameterWork:EffectDisclosureWork={...work,parameter:{paramIndex:snapshot.paramIndex,name:snapshot.displayName,expanded:true,disclosureKey:disclosurePath.at(-1)!.key}};
        if(snapshot.descriptor?.inputKind==='color'&&typeof snapshot.timeVarying==='boolean')parameterWork.parameter!.inlineColor={indices:selected.params.filter((p:AnyRecord)=>p.descriptor?.inputKind==='color').map((p:AnyRecord)=>p.paramIndex),timeVarying:snapshot.timeVarying};
        let forceAncestors=false;
        if(disclosurePath.length>1){
          for(const def of disclosurePath.slice(0,-1)){try{if(String(await readEffectProperty(()=>acquireProperties(def),def.key))!=='true')forceAncestors=true;}catch{forceAncestors=true;}}
        }
        parameterScroll=await revealParameter(parameterWork,{assertTarget,request:(phase,target)=>this.effectDisclosure(request.id,phase,target),write:async(expanded)=>{
          let cleared=false;
          try{
            await assertTarget();const current=await exactEffectTarget(args);cleared=true;try{await current.sequence.clearSelection();}finally{await settleDisclosure();}
            const empty=await this.effectDisclosure(request.id,"parameter_clear_verify",parameterWork);if(empty.status!=="pass"||empty.empty!==true)throw Error("PARAMETER_SELECTION_CLEAR_UNVERIFIED");
            await assertTarget();
            let flushAudioContainer=false;
            for(const def of disclosurePath){
              const value=def.paramIndex===snapshot.paramIndex?expanded:true;
              if(def.key==='ECP.NonParamGroup.Expanded'){try{flushAudioContainer=String(await readEffectProperty(()=>acquireProperties(def),def.key))!==String(value);}catch{flushAudioContainer=true;}}
              const {accepted,actual}=await writeProperty(def,def.key,value);
              if(!accepted)throw Error("PARAMETER_DISCLOSURE_TRANSACTION_REJECTED");
              propertyWrites.push({paramIndex:def.paramIndex,key:def.key,requested:value,actual});
              if(String(actual)!==String(value))throw Error('PARAMETER_DISCLOSURE_PROPERTY_UNVERIFIED');
            }
            // Audio GUI reconstruction restores its old container flag unless
            // the newly written native property is flushed before selection.
            // Save the already-authorized exact project only on a group change.
            if(flushAudioContainer){const current=await exactEffectTarget(args);if(!await dispatchContent(()=>current.project.save()))throw Error('AUDIO_CONTAINER_SAVE_UNVERIFIED');}
          }finally{if(cleared){const current=await exactEffectTarget(args);try{await liveTrackItemSelection(current.sequence,[current.entry]);}finally{await settleDisclosure();}}}
        }},false,forceAncestors);
      }else parameterScroll={status:"unsupported",scope:"exact_parameter",paramIndex:snapshot.paramIndex,reason:"Native control has no general disclosure property; effect section remains visible"};
    }
    effectPhaseTimingsMs.parameterFollow=performance.now()-phaseStarted;
    return {...disclosure,parameterScroll,parameterPath:disclosurePath,propertyWrites,effectPhaseTimingsMs,...(parameterSchema?{parameterSchema}:{} )};
    } finally {
      // UI mutation sites already mark/settle their own boundary. Repeating a
      // fresh 250ms period here would wait without any intervening mutation.
      phaseStarted=performance.now();
      try { await waitGraphicMutationQuiet(); }
      finally { effectPhaseTimingsMs.finalQuiet=performance.now()-phaseStarted; }
      phaseStarted=performance.now();
      try { await readBoundary(); }
      finally { effectPhaseTimingsMs.finalTopology=performance.now()-phaseStarted; }
      phaseStarted=performance.now();
      try { await preservation.finish(); }
      finally { effectPhaseTimingsMs.finalValues=performance.now()-phaseStarted; }
    }
    } finally { effectPhaseTimingsMs.total=performance.now()-totalStarted; }
  }

  private async revealPanel(request:BridgeRequest):Promise<Record<string,unknown>|undefined> {
    const panel=nativePanelForCommand(request.command,request.args);
    if(!panel)return undefined;
    const panelPhaseTimingsMs:Record<string,number>={},totalStarted=performance.now();
    let phaseStarted=totalStarted;
    try {
    const before=await inspectHostContext();
    if(request.args.expectedProjectId && request.args.expectedProjectId!==before.projectId)throw new HostCommandError("CONTEXT_CHANGED","Native panel target project changed");
    if(request.args.expectedSequenceId && request.args.expectedSequenceId!==before.sequenceId)throw new HostCommandError("CONTEXT_CHANGED","Native panel target sequence changed");
    panelPhaseTimingsMs.contextBefore=performance.now()-phaseStarted;
    let result:Awaited<ReturnType<typeof this.nativeVisibility>>;
    try {
      phaseStarted=performance.now();
      try {result=await this.nativeVisibility(request.id,panel,text(before.projectName),text(before.sequenceName));}
      finally { panelPhaseTimingsMs.nativeRequest=performance.now()-phaseStarted; }
    }
    finally {
      // A panel command can rebuild audio controls even when UI proof fails or
      // the adapter throws. Settle before followPanels skips disclosure.
      phaseStarted=performance.now();
      try { if(request.args.expectedMediaType==='audio'){noteGraphicMutation();await waitGraphicMutationQuiet();} }
      finally { panelPhaseTimingsMs.audioQuiet=performance.now()-phaseStarted; }
    }
    phaseStarted=performance.now();
    const after=await inspectHostContext();
    if(before.projectId!==after.projectId || before.sequenceId!==after.sequenceId)throw new HostCommandError("CONTEXT_CHANGED","Active identity changed during panel navigation");
    panelPhaseTimingsMs.contextAfter=performance.now()-phaseStarted;
    return {...result,panelPhaseTimingsMs,...(panel==="effect_controls"||panel==="properties"?{effectExpansion:"unsupported",parameterScroll:"unsupported"}:{})};
    } finally { panelPhaseTimingsMs.total=performance.now()-totalStarted; }
  }

  /** Automatic follow before dispatch: the command's native panel, its effect
   * disclosure and its Project item. Failures are reported, never blocking. */
  private async followPanels(request:BridgeRequest):Promise<AnyRecord|undefined> {
    if(!workFollow.enabled||isEffectValueQuery(request.command,request.args)||request.command==="query_media")return undefined;
    const panel=await attemptFollow("before_command",()=>this.revealPanel(request));
    const expansion=panel&&!followFailed(panel)&&nativePanelForCommand(request.command)==="effect_controls"&&!["apply_video_effect","apply_audio_effect"].includes(request.command)
      ?await attemptFollow("before_command",()=>this.revealEffect(request)):undefined;
    const projectItemId=projectWorkItemId(request.command,request.args);
    const projectItemSelection=projectItemId?await attemptFollow("before_command",()=>revealProjectItem(request,projectItemId,this.projectSelection)):undefined;
    if(!panel&&!projectItemSelection)return undefined;
    return {...panel,...(expansion?{effectExpansion:expansion,parameterScroll:(expansion as AnyRecord).parameterScroll??"unsupported"}:{}),...(projectItemSelection?{projectItemSelection}:{})};
  }

  /** Automatic follow after dispatch: items that exist only in the result. */
  private async followResult(request:BridgeRequest,result:unknown,visibility:AnyRecord|undefined):Promise<unknown> {
    if(!workFollow.enabled||!result||typeof result!=="object"||Array.isArray(result))return result;
    const record=result as AnyRecord;
    let final=visibility;
    if(request.command==="query_media"){
      const id=projectWorkItemId(request.command,request.args,record);
      if(id)final={...await attemptFollow("after_read",()=>this.revealPanel(request)),projectItemSelection:await attemptFollow("after_read",()=>revealProjectItem(request,id,this.projectSelection))};
    }
    // MOGRT insertion changes selection and may reveal another tab; show the resulting graphic.
    if(["insert_editable_graphic","insert_mogrt_caption"].includes(request.command))final=await attemptFollow("after_command",()=>this.revealPanel(request))??final;
    // The appended effect exists only after dispatch.
    if(["apply_video_effect","apply_audio_effect"].includes(request.command)&&record.status==="pass"){
      const reveal=await attemptFollow("after_command",()=>{const index=record.hostResult.componentIndex,added=record.after[index];
        const args={...request.args,componentIndex:index,componentMatchName:added.matchName};
        return withEffectTargetLookup(args,()=>this.revealEffect({...request,args}),request.args);});
      final={...final,effectExpansion:reveal,parameterScroll:(reveal as AnyRecord).parameterScroll??"unsupported"};
    }
    if(!final)return result;
    return {...record,visibility:final,...(record.hostResult&&typeof record.hostResult==="object"?{hostResult:{...record.hostResult,visibility:final}}:{})};
  }

  /** Effect queries follow the actual first result after filtering: select that
   * clip, move to it and disclose the effect. Ordinary reads keep their result. */
  private async followEffectQuery(request:BridgeRequest,followed:unknown):Promise<unknown> {
    const result=followed as AnyRecord,first=result?.items?.[0],component=first?.components?.[0];
    if(!component||!readWorkIntent(request.command,request.args,result,request.readPurpose))return followed;
    if(result.editBoundary?.allowed===false)return {...result,visibility:{effectExpansion:{status:"unsupported",reason:"Effect display changes require the approved working target"}}};
    const shown=await attemptFollow("after_read",async()=>{
      const context=await inspectHostContext(),id=first.id??first.trackItemId;
      if((result.project?.id&&result.project.id!==context.projectId)||(result.sequence?.id&&result.sequence.id!==context.sequenceId))throw new HostCommandError("CONTEXT_CHANGED","Effect query context changed before display");
      const entry=await findTrackItemEntry(await activeSequence(),id),clip=entry.snapshot;
      const args={...request.args,expectedProjectId:context.projectId,expectedSequenceId:context.sequenceId,expectedSequenceName:context.sequenceName,
        trackItemId:id,expectedProjectItemId:clip.projectItemId,expectedClipName:clip.name,expectedMediaType:clip.mediaType,expectedTrackIndex:clip.trackIndex,
        expectedStartSeconds:clip.start.seconds,expectedEndSeconds:clip.end.seconds,componentIndex:component.componentIndex,componentMatchName:component.matchName,
        ...(result.workTarget?.playhead?.seconds===undefined?{}:{timeSeconds:result.workTarget.playhead.seconds})};
      const specific={...request,args};
      return withEffectTargetLookup(args,async()=>{
        const workTarget=await focusWorkTarget({...specific,command:"get_effect_values"},liveTrackItemSelection);
        if(workTarget){try{this.onWorkTarget(request.id,workTarget);}catch{/* observation only */}}
        const panel=await this.revealPanel(specific),expansion=await this.revealEffect(specific);
        return {workTarget,visibility:{...panel,effectExpansion:expansion,parameterScroll:expansion.parameterScroll??"unsupported"}};
      });
    });
    return followFailed(shown)?{...result,visibility:{effectExpansion:shown}}:{...result,...shown};
  }

  async dispatch(request: BridgeRequest): Promise<unknown> {
    if(request.command==='inspect_host_activity')return {status:'pass',protocol:1,
      commands:this.commandQueue.inspect(),activeJobId:this.commandSequences.busy?this.commandSequences.activeJobId:null};
    // These are cached job observations, not timeline queries. They bypass the
    // owned host queue so clients can inspect/cancel one submitted command list.
    if (request.command === "get_track_command_sequence_status") return this.commandSequences.status(String(request.args.jobId), Number(request.args.cursor ?? 0));
    if (request.command === "cancel_track_command_sequence") return this.commandSequences.cancel(String(request.args.jobId));
    const assertIdle = () => { if (this.commandSequences.busy) throw new HostCommandError("COMMAND_SEQUENCE_BUSY", `Command sequence ${this.commandSequences.activeJobId} owns Premiere. Use its status/cancel tools; other host work is rejected until it stops.`); };
    assertIdle();
    return this.commandQueue.run(request, () => withEffectTargetLookup(request.args, async () => {
      assertIdle();
      if(this.projectLifecycle.quarantined && request.command==='inspect_host_context' && request.args.includeOpenProjects===true)
        return {activeProject:null,activeSequence:null,contextStatus:'unknown',projectLifecycle:'unverified',openProjects:await readOpenProjects(ppro)};
      this.projectLifecycle.assertReady();
      if(needsSettledEffectObjects(request.args))await waitGraphicMutationQuiet();
      bindCommandEditTarget(request.id,await observeHostAwait(request.command==='create_sequence'?hostCommandProgress(request)?.at('sequence.dispatch_preflight'):undefined,'inspectHostContext',()=>inspectHostContext()));
      if((effectChainProofCommands as readonly string[]).includes(request.command)){
        request.args.__readEffectChain=(snapshots:AnyRecord[])=>this.readPointChain(request,snapshots);
      }
      if(request.command==="capture_program_frame") {
        const {project,sequence}=await mutationContext();
        const args=request.args;
        if(text(project.guid)!==args.expectedProjectId || await sequenceId(sequence)!==args.expectedSequenceId || text(sequence.name)!==args.expectedSequenceName)throw new HostCommandError("CONTEXT_CHANGED","Program frame target differs from the active project/sequence");
        const requested=Number(args.timeSeconds);
        if(!Number.isFinite(requested)||requested<0)throw new HostCommandError("INVALID_TIME","Frame time must be finite and non-negative");
        const timebase=BigInt(text(await sequence.getTimebase()));
        if(timebase<=0n)throw new HostCommandError("INVALID_TIMEBASE","Frame timebase must be positive");
        const requestedTicks=BigInt(exactTicksFromSeconds(requested));
        const frameIndex=(requestedTicks+timebase/2n)/timebase;
        const ticks=frameIndex*timebase;
        if(ticks>=BigInt(text((await sequence.getEndTime()).ticks)))throw new HostCommandError("FRAME_OUT_OF_RANGE","Requested frame is outside the active sequence");
        const position=ppro.TickTime.createWithTicks(ticks.toString());
        const settings=await sequence.getSettings(), rect=await settings.getVideoFrameRect();
        const outputPath=text(args.outputPath), outputRoot=LOCAL_SCRATCH_ROOT.replace(/scratch$/i,"output");
        if(!pathIsWithin(outputRoot, outputPath) || !/\.png$/i.test(outputPath))throw new HostCommandError("PATH_NOT_ALLOWED","Frame capture requires a local output PNG");
        const {directory,filename}=splitWindowsPath(outputPath);
        // With automatic follow the Program Monitor is shown and the playhead stays on the captured frame unless restore is requested.
        const visibility=workFollow.enabled?await attemptFollow("before_command",()=>this.revealPanel(request)):undefined;
        const restorePlayhead=typeof args.restorePlayhead==="boolean"?args.restorePlayhead:!workFollow.enabled;
        const captured=await withCapturePlayhead(sequence,position,restorePlayhead,async()=>{
          const accepted=await ppro.Exporter.exportSequenceFrame(sequence,position,filename,directory,Number(rect.width),Number(rect.height));
          let artifact:Record<string,unknown>|undefined;
          if(accepted){artifact=await this.waitForFrame(request.id);if(artifact.status!=="pass"||artifact.width!==Number(rect.width)||artifact.height!==Number(rect.height))throw new HostCommandError("FRAME_UNVERIFIED",String(artifact.reason??"Native frame is incomplete or has mismatched dimensions"));}
          const current=await inspectHostContext();
          if(current.projectId!==args.expectedProjectId||current.sequenceId!==args.expectedSequenceId||String((await sequence.getPlayerPosition()).ticks)!==ticks.toString())throw new HostCommandError('CAPTURE_CONTEXT_DRIFT','Project, sequence or playhead changed during frame export');
          return {accepted,artifact};
        },async()=>{const current=await inspectHostContext();return current.projectId===args.expectedProjectId&&current.sequenceId===args.expectedSequenceId;});
        const {accepted,artifact}=captured.value;
        return {status:accepted?"pass":"fail",exportAccepted:Boolean(accepted),projectId:args.expectedProjectId,sequenceId:args.expectedSequenceId,sequenceName:args.expectedSequenceName,
          frame:{requestedSeconds:requested,timeSeconds:Number(position.seconds),ticks:ticks.toString(),frameIndex:Number(frameIndex),timebase:timebase.toString(),width:Number(rect.width),height:Number(rect.height),outputPath,finalizedSha256:artifact?.sha256},
          navigation:captured.navigation,...(visibility?{visibility}:{}),content:"Premiere composited sequence frame; caption pixels require visual verification",errors:accepted?[]:["Native frame export failed"]};
      }

      if (request.command === "submit_track_command_sequence") {
        const accepted = this.commandSequences.accept(request.id, request.args);
        if (accepted.fresh) {
          const event = (value: TaskEvent) => { try { this.onSequenceTask(value); } catch { /* observation only */ } };
          let firstRead = true;
          void this.commandQueue.run({ ...request, timeoutMs: 300000 }, () => this.commandSequences.run(request.id, {
            read: async plan => {
              const serialBaseline = firstRead;
              if (firstRead) {
                firstRead = false;
                const first = plan.steps[0]!;
                const clip = plan.clips.find(value => value.ref === first.clipRef)!;
                const focus = { ...request, command: "move_clip_to_track", args: { ...plan, move: { ...clip, destinationTrackIndex: first.destinationTrackIndex } } };
                await followTimelineWork(focus, liveTrackItemSelection, async () => ({ status: "partial" }), this.onWorkTarget);
              }
              // Independent serial baseline: the first fast step must prove the
              // same complete projection before any native clone is dispatched.
              return readRelocationState(plan, plan.clips.map(clip => clip.expectedProjectItemId), !serialBaseline);
            },
            move: async (plan, move, id, expected, verified) => {
              const stepRequest = { ...request, id, command: "move_clip_to_track", args: { ...plan, move } };
              const started = performance.now();
              event({ phase: "started", id, command: "move_clip_to_track", startedAt: Date.now() });
              try {
                const result = await followTimelineWork(stepRequest, liveTrackItemSelection,
                  () => moveClipToTrack(stepRequest.args, { execute: executeTransaction, select: liveTrackItemSelection, verified,
                    reuseAppliedSourceSelection: true,
                    strictSourceIds: plan.clips.map(clip => clip.expectedProjectItemId),
                    validateBefore: observed => {
                      const errors = stateErrors(expected, observed);
                      if (errors.length) throw new HostCommandError("COMMAND_SEQUENCE_STATE_CHANGED", errors.join("; "));
                    } }), this.onWorkTarget) as HostResult;
                event({ phase: "finished", id, response: { version: 1, id, ok: true, result, durationMs: performance.now() - started } });
                return result;
              } catch (error) {
                event({ phase: "finished", id, response: { version: 1, id, ok: false, error: { code: "SEQUENCE_STEP_ERROR", message: String(error) }, durationMs: performance.now() - started } });
                throw error;
              }
            },
          })).catch(error => this.commandSequences.rejectedBeforeRun(request.id, error));
        }
        return { status: "partial", hostResult: { accepted: true, acceptanceOnly: true, jobId: request.id,
          statusTool: "get_track_command_sequence_status", protocolVersion: 1 }, errors: [],
          recovery: "Acceptance is not edit completion. Read job status to terminal state. Never replay after an unknown/reloaded session." };
      }
      const followed=await withMutationPhase(request.command,()=>followTimelineWork(request, liveTrackItemSelection, async () => {
        // Selection can reconstruct audio Effect Controls without a content
        // transaction. Finish that boundary before acquiring its native graph.
        if(request.args.expectedMediaType==='audio'){noteGraphicMutation();await waitGraphicMutationQuiet();}
        await this.prepareNativeEffectTime(request);
        if(request.command==='get_effect_values')await this.prepareNativeColorSamples(request);
        if(request.command==='set_effect_disclosure') {
          const panel=await this.revealPanel(request),expansion=await this.revealEffect(request);
          return explicitDisclosureResult(expansion,panel,request.args.expanded);
        }
        const visibility=await this.followPanels(request);
        if(['apply_video_effect','apply_audio_effect','remove_effect'].includes(request.command))this.parameterSchemas.clear();
        const dispatched=await this.dispatchCommand(request);
        const result=request.args.__nativeEffectTimeProof&&dispatched&&typeof dispatched==='object'
          ?{...dispatched,hostResult:{...(dispatched as AnyRecord).hostResult,nativeTimeProof:request.args.__nativeEffectTimeProof}}:dispatched;
        return this.followResult(request,result,visibility);
      }, this.onWorkTarget).catch(error=>{
        if(error instanceof Error && /^(PARAMETER_VALUE_SHAPE_UNSUPPORTED|EFFECT_TIME_MAPPING_UNSUPPORTED):/.test(error.message))throw new HostCommandError("UNSUPPORTED_API",error.message);
        throw error;
      }));
      return workFollow.enabled&&isEffectValueQuery(request.command,request.args)?this.followEffectQuery(request,followed):followed;
    })).finally(()=>releaseCommandEditTarget(request.id));
  }

  private async dispatchCommand(request: BridgeRequest): Promise<unknown> {
    const args:AnyRecord = request.args ?? {};
    switch (request.command) {
      case "track_object_mask_frames": return this.trackMask(request);
      case "inspect_native_masks": return this.inspectNativeMasks(request);
      case "inspect_native_visual_commands": return this.nativeVisual(request.id);
      case "activate_native_tool": {
        const before=await inspectHostContext();
        if(!args.expectedProjectId||!args.expectedSequenceId||!args.expectedSequenceName||before.projectId!==args.expectedProjectId||before.sequenceId!==args.expectedSequenceId||before.sequenceName!==args.expectedSequenceName)throw new HostCommandError("CONTEXT_CHANGED","Native tool requires the exact active working target");
        if(!["selection","razor","object_selection"].includes(String(args.tool))||!Array.isArray(args.trackItemIds)||args.trackItemIds.length!==1)throw new HostCommandError("INVALID_NATIVE_TOOL","One inspected clip and an allowlisted tool are required");
        const native=await this.nativeVisual(request.id);
        const after=await inspectHostContext();
        if(before.projectId!==after.projectId||before.sequenceId!==after.sequenceId)throw new HostCommandError("CONTEXT_CHANGED","Context changed during native tool dispatch; inspect before retrying");
        const verified=native.id===request.id&&native.dispatchAccepted===true&&native.sdkError===0&&nativeToolStateProves(nativeVisualFeatureForCommand(request.command,args),native.readback,native.premierePid);
        return {status:verified?"pass":native.status==="pass"?"unverified":native.status,hostResult:native,before,after,errors:[],verification:"SDK dispatch plus an independent same-process native Tools pane readback"};
      }
      case "premiere_ping": return {
        status: "pass",
        host: "premierepro",
        premiereVersion: text(uxp.host?.version),
        uxpVersion: text(uxp.versions?.uxp ?? uxp.version),
        deployment: {
          panelEntrypointId: PANEL_ENTRYPOINT_ID,
          panelVersion: PANEL_VERSION,
          panelMode: PANEL_MODE,
          localScratchRoot: LOCAL_SCRATCH_ROOT,
          editScope: "active_local_project_any_sequence",
        },
        time: new Date().toISOString(),
      };
      case "get_capabilities": return this.capabilities();
      case "inspect_host_context": return inspectHostContext(args);
      case "get_agent_context": return getAgentContext(args);
      case "inspect_ripple_capabilities": return inspectRippleCapabilities(args);
      case "inspect_timeline_ripple": return inspectTimelineRipple(args);
      case "ripple_timeline": return rippleTimeline(args,{split:(splitArgs,context)=>withMutationPhase('split_clips',()=>splitClips(splitArgs,context)),execute:executeTransaction});
      case "query_timeline": return queryTimeline(args);
      case "get_effect_values": {
        const target=await exactEffectTarget(args);
        if(args.detail!==undefined&&!['effect','parameter','chain'].includes(text(args.detail)))throw Error("INVALID_EFFECT_READ_DETAIL");
        if(args.detail==='parameter'&&(!Number.isInteger(args.paramIndex)||typeof args.expectedDisplayName!=='string'))throw Error("EXACT_PARAMETER_REQUIRED");
        if(args.detail==='chain'&&args.timeSeconds!==undefined)throw Error('CHAIN_STATE_USES_NATIVE_ZERO_SAMPLE');
        const mapped=args.detail!=='chain'&&(args.__nativeEffectTimeProof||args.timeSeconds!==undefined)?effectTime(target.entry.snapshot as any,args.timeSeconds===undefined?{timeTicks:target.entry.snapshot.start.ticks}:{timeSeconds:Number(args.timeSeconds)},args.__nativeEffectTimeProof):null;
        const sample=ppro.TickTime.createWithTicks(args.detail==='chain'?'0':mapped?.nativeTicks??text(target.entry.snapshot.inPoint?.ticks));
        // UI preservation still compares the complete chain. Response hydration
        // reads only this effect, never unrelated effects/keys. Point archive
        // correlation needs the complete selected parameter-name vector.
        let components=args.detail==='chain'?await effectSnapshot(args,target.entry.raw,false,false,sample,target.entry.snapshot):await effectComponents(args,target.entry.raw,sample,{componentIndex:Number(args.componentIndex),...(args.detail==='parameter'?{paramIndex:Number(args.paramIndex)}:{})},target.entry.snapshot);
        if(components.some((c:AnyRecord)=>componentMatches(c,effectSelector(args))&&c.params.some((p:AnyRecord)=>p.descriptor.inputKind==="point"&&p.keyframes.length))){
          if(args.detail!=='chain')components=await effectSnapshot(args,target.entry.raw,false,false,sample,target.entry.snapshot);
        }
        const matches=components.filter((c:AnyRecord)=>componentMatches(c,effectSelector(args)));
        if(matches.length!==1)throw new HostCommandError("COMPONENT_NOT_FOUND_OR_AMBIGUOUS","An exact effect is required");
        let component=enrichEffectParameterSchema(matches[0]!,args.__effectParameterSchema as AnyRecord|undefined,args.detail==='parameter');
        if(args.__nativeColorSamples){
          const proof=args.__nativeColorSamples as AnyRecord,current=await exactEffectTarget(args);
          if(text((await current.sequence.getPlayerPosition()).ticks)!==proof.visibleTicks)throw Error('NATIVE_SAMPLE_PLAYHEAD_CHANGED');
          if(!snapshotsEqual(proof.snapshot,current.entry.snapshot)||sample.ticks!==proof.nativeTicks||!snapshotsEqual(proof.before,await effectComponents(args,current.entry.raw,sample)))throw Error('NATIVE_SAMPLE_CONTENT_CHANGED');
          component={...component,params:component.params.map((p:AnyRecord)=>{
            const result=proof.values.find((v:AnyRecord)=>v.paramIndex===p.paramIndex)?.result;
            if(!result)return p;
            if(result.status!=='pass')return {...p,nativeSample:result};
            if(result.nativeTicks!==p.sampledAt.ticks||!result.value||!['red','green','blue','alpha'].every(k=>Number.isFinite(result.value[k])))throw Error('NATIVE_SAMPLE_RECEIPT_CHANGED');
            return {...p,value:result.value,valueKind:'object',valueReadMethod:'adobe_sdk_GetParam',readStatus:{...p.readStatus,value:'pass'},readErrors:p.readErrors.filter((e:string)=>!e.startsWith('NATIVE_COLOR_SAMPLE_UNSUPPORTED:')),nativeSample:result};
          })};
        }
        if(args.paramIndex!==undefined)resolveEffectParameter(component,{paramIndex:Number(args.paramIndex),expectedDisplayName:text(args.expectedDisplayName)});
        component={...component,params:component.params.filter((p:AnyRecord)=>args.detail!=='parameter'||p.paramIndex===args.paramIndex).map((p:AnyRecord)=>({...p,
          sampledSequenceTime:args.detail==='chain'?null:mapped?{ticks:mapped.sequenceTicks,seconds:Number(mapped.sequenceTicks)/254016000000}:nativeToSequenceTime(target.entry.snapshot as any,p.sampledAt.ticks,args.__nativeEffectTimeProof),keyframeDetails:p.keyframeDetails.map((k:AnyRecord)=>({...k,clipTime:k.time,timeBasis:"native_source",sequenceTime:args.detail==='chain'?null:nativeToSequenceTime(target.entry.snapshot as any,k.time.ticks,args.__nativeEffectTimeProof)})),
          timeMapping:args.detail==='chain'?'native_only_use_get_effect_values':args.__nativeEffectTimeProof?(args.__nativeEffectTimeProof.exactOnly?'sdk_exact_samples':target.entry.snapshot.speed===1?'sdk_reverse_1x':'sdk_constant_rate'):target.entry.snapshot.speed===1&&target.entry.snapshot.reversed===false?'source_to_sequence_1x':'unsupported_retimed_or_reversed'}))};
        await exactEffectTarget(args);
        return {status:"pass",item:target.entry.snapshot,component,...(args.detail==='chain'?{components}:{}),...(args.__nativeEffectTimeProof?{nativeTimeProof:args.__nativeEffectTimeProof}:{}),readScope:args.detail??'effect'};
      }
      case "query_media": return queryMedia(args);
      case "inspect_caption_track": return inspectCaptionTrack(args);
      case "inspect_caption_import_capabilities": return inspectCaptionImportCapabilities(args);
      case "finalize_caption_import": return finalizeCaptionImport(args,executeTransaction);
      case "inspect_premiere_feature_routes": return inspectPremiereFeatureRoutes({
        visualWorkSurface: await inspectVisualSurface(),
        trackTargetingSurface: await inspectTrackTargetingSurface().catch(error => ({ error: String(error) })),
        pluginManager: uxp.pluginManager,
        premiereModule: ppro,
        premiereVersion: text(uxp.host?.version),
        publicRoutes: [
          { feature: "scene_edit_detection", api: "SequenceUtils.performSceneEditDetectionOnSelection", available: typeof ppro.SequenceUtils?.performSceneEditDetectionOnSelection === "function" },
          { feature: "object_mask_presence", api: "ObjectMaskUtils.hasObjectMask", available: typeof ppro.ObjectMaskUtils?.hasObjectMask === "function" },
          { feature: "object_mask_create_track_convert", api: "Premiere public UXP DOM", available: false },
          { feature: "clip_speech_text_presence", api: "Transcript.hasTranscript", available: typeof ppro.Transcript?.hasTranscript === "function" },
          { feature: "clip_speech_text_export", api: "Transcript.exportToJSON", available: typeof ppro.Transcript?.exportToJSON === "function" },
          { feature: "clip_speech_text_import", api: "Transcript.importFromJSON + Transcript.createImportTextSegmentsAction", available: typeof ppro.Transcript?.importFromJSON === "function" && typeof ppro.Transcript?.createImportTextSegmentsAction === "function" },
          { feature: "clip_speech_to_text_start", api: "Transcript.transcribeClipProjectItem", available: typeof ppro.Transcript?.transcribeClipProjectItem === "function" },
        ],
        hostNamespaceRoutes: [
          { feature: "speech_to_text_sequence", api: "mediaCoreSpeechToText.SpeechToTextAPI.transcribeSequence", available: typeof uxp.mediaCoreSpeechToText?.SpeechToTextAPI?.transcribeSequence === "function", access: "adobe_internal_host_namespace" },
          { feature: "speech_to_text_caption_segmentation", api: "mediaCoreSpeechToText.AutoCaptioningAPI.segmentIntoCaptions", available: typeof uxp.mediaCoreSpeechToText?.AutoCaptioningAPI?.segmentIntoCaptions === "function", access: "adobe_internal_host_namespace" },
          { feature: "caption_track_create", api: "hSLScripting.CaptioningScriptAPI.createCaptionTrack", available: typeof uxp.hSLScripting?.CaptioningScriptAPI?.createCaptionTrack === "function", access: "adobe_internal_host_namespace" },
          { feature: "caption_track_import", api: "hSLScripting.CaptioningScriptAPI.createCaptionTrackFromClip", available: typeof uxp.hSLScripting?.CaptioningScriptAPI?.createCaptionTrackFromClip === "function", access: "adobe_internal_host_namespace" },
        ],
      });
      case "inspect_project": return inspectProject();
      case "inspect_designated_track_state": {
        // Recovery-only observation: no activation, selection, edit or save.
        // A changing active tab cannot redirect this bounded native read.
        const project=await activeProject();assertWorkingProject(project);
        const target={sequenceId:text(args.expectedSequenceId)||(await inspectHostContext()).sequenceId};
        if(!target)throw new HostCommandError('DESIGNATED_TARGET_REQUIRED','Track recovery requires an exact designated sequence');
        const matches=(await project.getSequences()).filter((s:any)=>text(s.guid)===target.sequenceId);
        if(matches.length!==1)throw new HostCommandError('RECOVERY_SEQUENCE_AMBIGUOUS','Exact designated sequence is unavailable');
        assertWorkingSequence(matches[0]);const snapshot=await sequenceSnapshot(matches[0]);
        return {status:'pass',projectId:text(project.guid),sequenceId:snapshot.id,sequenceName:snapshot.name,tracks:snapshot.tracks};
      }
      case "inspect_sequence": return sequenceSnapshot(await activeSequence());
      case "inspect_media": {
        const items = (await projectItems(await activeProject())).map((item) => item.snapshot);
        return { items, limit: PROJECT_ITEM_LIMIT, truncated: items.length >= PROJECT_ITEM_LIMIT };
      }
      case "inspect_proxies": {
        const items = (await projectItems(await activeProject())).map((item) => item.snapshot);
        return { items: items.filter((item) => item.kind === "clip").map((item) => ({ id: item.id, name: item.name, path: item.path, hasProxy: item.hasProxy, proxyPath: item.proxyPath, offline: item.offline })), limit: PROJECT_ITEM_LIMIT, truncated: items.length >= PROJECT_ITEM_LIMIT };
      }
      case "inspect_markers": return inspectMarkers();
      case "inspect_effects": {
        const items = await inspectEffects();
        return { items, limit: TRACK_ITEM_LIMIT, truncated: items.length >= TRACK_ITEM_LIMIT };
      }
      case "inspect_effect_catalog": return inspectEffectCatalog();
      case "inspect_timeline_selection": return inspectTimelineSelection();
      case "inspect_object_mask_state": return inspectObjectMaskState();
      case "inspect_clip_speech_text": return inspectClipSpeechText(args);
      case "collect_object_mask_prompt": return collectObjectMaskPrompt(args);
      case "inspect_delivery_state": return sequenceSnapshot(await activeSequence());
      case "open_native_speech_to_text_workflow": return openNativeTranscriptionWorkflow(args);
      case "import_clip_speech_text": return importClipSpeechText(args);
      case "export_review_frames": return exportReviewFrames(args);
      case "create_working_copy": return createWorkingCopy(args);
      case "activate_sequence": return activateSequence(args);
      case "duplicate_working_sequence": return duplicateWorkingSequence(args);
      case "import_media": return importMedia(args);
      case "create_bin": return createBin(args);
      case "rename_project_items": return renameProjectItems(args);
      case "move_project_items": return moveProjectItems(args);
      case "set_project_item_labels": return setProjectItemLabels(args);
      case "attach_proxy": return attachProxy(args);
      case "create_subclip": return createSubclip(args);
      case "create_sequence": return createSequence(args,hostCommandProgress(request));
      case "place_clips": return placeClips(args);
      case "import_caption_track": return importCaptionTrack(args);
      case "place_on_new_layer": return placeOnNewLayer(args);
      case "set_track_state": return setTrackState(args);
      case "read_track_locks": return trackLocks('read_track_locks', args, request.id);
      case "set_track_locks": return trackLocks('set_track_locks', args, request.id);
      case "set_timeline_item_state": return setTimelineItemState(args);
      case "set_timeline_selection": return setTimelineSelection(args);
      case "clone_clips": return cloneClips(args);
      case "split_clips": return splitClips(args);
      case "trim_clips": return trimClips(args);
      case "trim_clip_exact": return trimClipExact(args);
      case "move_clips": return moveClips(args);
      case "move_clip_to_track": return moveClipToTrack(args, { execute: executeTransaction, select: liveTrackItemSelection });
      case "remove_clips": return removeClips(args);
      case "detect_scene_cuts": return detectSceneCuts(args);
      case "add_markers": return addMarkers(args);
      case "insert_mogrt_caption": return insertMogrtCaption(args,hostCommandProgress(request));
      case "insert_editable_graphic": return insertEditableGraphic(args,hostCommandProgress(request));
      case "apply_transition": return applyTransition(args);
      case "remove_transition": return removeTransition(args);
      case "apply_video_effect": return applyVideoEffect(args);
      case "apply_audio_effect": return applyAudioEffect(args);
      case "remove_effect": return removeEffect(args);
      case "set_effect_values": return setEffectValues(args);
      case "set_effect_keyframes": return setEffectKeyframes(args,snapshots=>this.pointAnimationReadback(request,snapshots));
      case "edit_effect_keyframes": return editEffectKeyframes(args,snapshots=>this.pointAnimationReadback(request,snapshots));
      case "apply_color_adjustments": return applyColorAdjustments(args);
      case "set_transform": return setValues(args, "transform");
      case "scale_clip_to_fill": return scaleClipToFill(args);
      case "set_basic_grade": return setValues(args, "grade");
      case "set_audio_level": return setValues(args, "audio");
      case "place_voiceover": return placeAudio(args);
      case "place_music": return placeAudio(args);
      case "export_sequence": return exportSequence(args);
      case "export_frame": return exportFrame(args);
      case "save_working_project": return saveWorkingProject(args);
      case "close_working_project": return closeWorkingProject(args,this.projectLifecycle);
      case "open_working_project": return openWorkingProject(args);
      default: throw new HostCommandError("UNSUPPORTED_COMMAND", `Unsupported UXP command: ${request.command}`);
    }
  }

  async connectionSnapshot(): Promise<AnyRecord> {
    try {
      return await this.commandQueue.run({version:1,id:`panel-identity-${++this.contextReadId}`,command:'connection_snapshot',args:{},timeoutMs:30000},async()=>{
      this.projectLifecycle.assertReady();
      const project = await activeProject();
      const projectPath = text(project.path);
      const projectName = text(project.name);
      return {
        projectId: text(project.guid) || projectPath || projectName,
        projectName,
        projectPath,
        activeSequence: null,
        capturedAt: new Date().toISOString(),
        detail: "minimal_connection_identity",
      };
      }) as AnyRecord;
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), ...(error instanceof HostCommandError ? {code:error.code} : {}) };
    }
  }

  async panelSnapshot(): Promise<AnyRecord> {
    try { return await this.commandQueue.run({version:1,id:`panel-snapshot-${++this.contextReadId}`,command:'panel_snapshot',args:{},timeoutMs:30000},async()=>{
      this.projectLifecycle.assertReady(); return inspectProject();
    }) as AnyRecord; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }

  private async capabilities(): Promise<AnyRecord> {
    const supports = (owner: any, name: string) => typeof owner?.[name] === "function";
    const premiereVersion = text(uxp.host?.version);
    const runtimeCompatibility = assessRuntimeCompatibility(premiereVersion);
    const runtimeSupported = runtimeCompatibility.status === "compatible";
    const internalCaptioningApi = uxp.hSLScripting?.CaptioningScriptAPI;
    const supportedWhenCompatible = (available: boolean): boolean => runtimeSupported && available;
    const runtimeReason = runtimeSupported ? {} : { reason: runtimeCompatibility.reason ?? "Premiere runtime compatibility is unknown" };
    let project: any;
    try { project = await ppro.Project.getActiveProject(); } catch { project = undefined; }
    let sequence: any;
    try { sequence = project ? await project.getActiveSequence() : undefined; } catch { sequence = undefined; }
    let installedMogrtPath: string | undefined;
    try { installedMogrtPath = text(await ppro.SequenceEditor.getInstalledMogrtPath()); } catch { installedMogrtPath = undefined; }
    return {
      premiereVersion,
      uxpVersion: text(uxp.versions?.uxp ?? uxp.version),
      runtimeCompatibility,
      ...(installedMogrtPath ? { installedMogrtPath } : {}),
      hostContext: { activeProject: Boolean(project), activeSequence: Boolean(sequence) },
      read: [
        { name: "programMonitorFrame", supported: supportedWhenCompatible(supports(ppro.Exporter, "exportSequenceFrame")), minimumPremiereVersion: "25.6", reason: "capture_program_frame: exact frame ticks, selection preservation, finalized PNG and MCP image; updated owner runtime required" },
        ...["project", "sequence", "tracks", "media", "proxies", "markers", "effects", "timelineSelection"].map((name) => ({ name, supported: runtimeSupported, minimumPremiereVersion: "25.6", ...runtimeReason })),
        { name: "objectMaskPresence", supported: supportedWhenCompatible(supports(ppro.ObjectMaskUtils, "hasObjectMask")), minimumPremiereVersion: "26.3", ...runtimeReason },
        { name: "clipSpeechText", supported: supportedWhenCompatible(supports(ppro.Transcript, "hasTranscript") && supports(ppro.Transcript, "exportToJSON")), minimumPremiereVersion: "26.3", ...runtimeReason },
      ],
      write: [
        { name: "sourceRangePlacement", supported: supportedWhenCompatible(Boolean(ppro.SequenceEditor?.getEditor)), minimumPremiereVersion: "26.3", reason: "Protocol 1: original-file sourceRange, restored source marks, exact empty destination. Per-item API/readback and MCP program-frame comparison required; live validation pending." },
        { name: "nativeToolActivation", supported: supportedWhenCompatible(/^26\.5(?:\.|$)/.test(premiereVersion)), minimumPremiereVersion: "26.5", reason: "Selection/Razor/Object Mask tools require the separately installed SDK adapter and independent native selected-state proof per request" },
        { name: "nativeMaskInspectionAndTracking", supported: supportedWhenCompatible(/^26\.5(?:\.|$)/.test(premiereVersion)), minimumPremiereVersion: "26.5", reason: "inspect_native_masks saves the designated local project; track_object_mask_frames tracks one existing Type 4 mask on a forward 1x video clip, with exact frame and native-byte proof. Repository native helpers required; no creation" },
        { name: "nativeEffectSectionScroll", supported: supportedWhenCompatible(/^26\.5(?:\.|$)/.test(premiereVersion)), minimumPremiereVersion: "26.5", reason: "Installed effect instances use public Properties and causal native header mapping across arbitrary bounded layouts; generated intrinsic owners use the approved CEP helper. Fresh native expansion/section-scroll proof is required per request. Deep parameter graphs and opaque vendor controls are separate capabilities" },
        { name: "trackTargeting", supported: trackTargetingConfigured, reason: TRACK_TARGETING_REASON, liveReadback: "required_per_request" },
        { name: "trackLocks", supported: trackLockConfigured, reason: "Dedicated CEP Track.isLocked/setLocked helper for video/audio; exact identity and full native lock readback required. Caption locks unsupported.", liveReadback: "required_per_request" },
        { name: "timelineNavigation", supported: supportedWhenCompatible(supports(project, "openSequence") && supports(project, "setActiveSequence") && supports(sequence, "getPlayerPosition") && supports(sequence, "setPlayerPosition")), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "saveAs", supported: supportedWhenCompatible(supports(project, "saveAs") || supports(ppro.Project, "getActiveProject")), minimumPremiereVersion: "25.6", ...runtimeReason, ...(runtimeSupported && !project ? { reason: "No active project; support inferred from the Premiere 26.3 module contract" } : {}) },
        { name: "sequenceClone", supported: supportedWhenCompatible(supports(sequence, "createCloneAction") || !sequence), minimumPremiereVersion: "25.6", ...runtimeReason, ...(runtimeSupported && !sequence ? { reason: "No active sequence; runtime instance check deferred" } : {}) },
        { name: "mediaImport", supported: supportedWhenCompatible(supports(project, "importFiles") || !project), minimumPremiereVersion: "25.6", ...runtimeReason, ...(runtimeSupported && !project ? { reason: "No active project; runtime instance check deferred" } : {}) },
        { name: "projectPanelOrganization", supported: supportedWhenCompatible(Boolean(ppro.FolderItem?.cast)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "sequenceEditor", supported: supportedWhenCompatible(Boolean(ppro.SequenceEditor?.getEditor)), minimumPremiereVersion: "25.6", ...runtimeReason },
        {
          name: "nativeCaptionTrackImport",
          supported: supportedWhenCompatible(supports(internalCaptioningApi, "createCaptionTrackFromClip")),
          minimumPremiereVersion: "25.6",
          reason: supports(internalCaptioningApi, "createCaptionTrackFromClip")
            ? "Available through Adobe's bundled hSLScripting.CaptioningScriptAPI; this is an internal same-host API and is guarded by runtime capability checks"
            : "Adobe's bundled hSLScripting.CaptioningScriptAPI.createCaptionTrackFromClip is unavailable in this plugin context",
        },
        { name: "clipSpeechTextImport", supported: supportedWhenCompatible(supports(ppro.Transcript, "importFromJSON") && supports(ppro.Transcript, "createImportTextSegmentsAction")), minimumPremiereVersion: "26.3", ...runtimeReason },
        { name: "trackAndClipState", supported: supportedWhenCompatible(Boolean(sequence)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "timelineSelection", supported: supportedWhenCompatible(Boolean(sequence) && supports(sequence, "getSelection") && supports(sequence, "clearSelection")), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "clipClone", supported: supportedWhenCompatible(Boolean(ppro.SequenceEditor?.getEditor)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "clipTrackRelocation", supported: supportedWhenCompatible(Boolean(ppro.SequenceEditor?.getEditor)), minimumPremiereVersion: "26.3", reason: "Individual clip: verify clone timing/source/components before lift; empty existing destination, no possible A/V counterpart or transitions" },
        { name: "exactClipTrim", supported: supportedWhenCompatible(Boolean(sequence)), minimumPremiereVersion: "26.3", reason: runtimeSupported ? "Exact one-item timeline-boundary trim with coupled source, component, and rollback readback" : runtimeCompatibility.reason },
        { name: "clipSplitByCloneTrimMove", supported: supportedWhenCompatible(Boolean(ppro.SequenceEditor?.getEditor)), minimumPremiereVersion: "26.3", reason: runtimeSupported ? "Implemented as a guarded public-UXP clone/trim/move composition with full timeline and component readback plus automatic rollback" : runtimeCompatibility.reason },
        { name: "nativeSceneEditDetection", supported: supportedWhenCompatible(supports(ppro.SequenceUtils, "performSceneEditDetectionOnSelection") && Boolean(ppro.SequenceUtils?.SEQUENCE_OPERATION_APPLYCUT)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "mogrt", supported: supportedWhenCompatible(Boolean(ppro.SequenceEditor?.getEditor)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "proxyAttach", supported: supportedWhenCompatible(Boolean(ppro.ClipProjectItem?.cast)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "markers", supported: supportedWhenCompatible(Boolean(ppro.Markers?.getMarkers)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "transitions", supported: supportedWhenCompatible(Boolean(ppro.TransitionFactory?.getVideoTransitionMatchNames)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "videoEffects", supported: supportedWhenCompatible(Boolean(ppro.VideoFilterFactory?.getMatchNames)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "audioEffects", supported: supportedWhenCompatible(Boolean(ppro.AudioFilterFactory?.getDisplayNames)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "effectKeyframes", supported: supportedWhenCompatible(Boolean(ppro.Keyframe)), minimumPremiereVersion: "25.6", ...runtimeReason },
        { name: "export", supported: supportedWhenCompatible(Boolean(ppro.EncoderManager?.getManager)), minimumPremiereVersion: "25.6", ...runtimeReason },
      ],
      unsupported: [
        { name: "arbitraryEffectExpansionAndParameterScroll", supported: false, reason: "Scoped section scrolling is implemented; collapsed-effect expansion needs the separately approved CEP helper. Arbitrary/custom/deep parameter layouts remain unverified" },
        { name: "linkedTrackItemReadback", supported: false, reason: "Premiere 26.3 public UXP DOM does not expose clip-link relationship getters" },
        { name: "emptyTrackOnlyCreation", supported: false, reason: "The public SequenceEditor creates a new track only while placing or cloning real media beyond the existing track count" },
        { name: "nativeRazorAction", supported: false, reason: "Premiere 26.3 exposes no dedicated public razor action; split_clips supplies the user-visible exact-time result through guarded public clone/trim/move actions" },
        { name: "setClipSpeed", supported: false, reason: "Premiere 26.3 public UXP exposes speed readback but no speed-change action" },
        { name: "createObjectMask", supported: false, reason: "Existing-mask tracking is implemented separately. Native seed archive loads but does not generate tracker data; creation, correction and Opacity conversion are not proven" },
        { name: "generalCEP", supported: false, reason: "Only explicitly approved feature-specific helpers are permitted; no general script endpoint" },
        { name: "QE DOM", supported: false, reason: "Intentionally excluded" },
        { name: "arbitrary ExtendScript", supported: false, reason: "Intentionally excluded" },
      ],
    };
  }
}
