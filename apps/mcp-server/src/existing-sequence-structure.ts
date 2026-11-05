import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  projectSnapshotSchema,
  type OperationReceipt,
  type ProjectSnapshot,
} from "@premiere-uxp/contracts";
import { z } from "zod/v4";
import type { HostExecutor } from "./host-executor.js";
import { assertExclusiveLifecycleTarget, assertLifecycleStillClosed, lifecyclePreflight, readLifecycleContext, verifiedProjectClose, type LifecycleTarget } from './project-lifecycle-preflight.js';
import {
  cancelPremiereDeleteTracksDialogWithNativeBridge,
  deletePremiereEmptyTracksWithNativeBridge,
  probePremiereNativeBridge,
  resolveSinglePremiereProcessId,
  type PremiereNativeBridgeResponse,
} from "./premiere-native-bridge.js";
import {
  commitPremiereSequenceArchive,
  restorePremiereSequenceArchive,
  snapshotPremiereSequenceArchive,
  assertCaptionStyleTarget,
  captionStyleReadbackErrors,
  readPremiereArchiveXml,
  patchPremiereSequenceArchive,
  type CaptionStyleTarget,
  type RemoveTrackTarget,
  type SequenceArchiveSnapshot,
} from "./premiere-sequence-archive.js";

import { captionStyleAvPreservation, trackRemovalHostPreservation, trackRemovalArchivePreservation } from "./sequence-structure-preservation.js";
export { captionStyleAvPreservation } from "./sequence-structure-preservation.js";

export type ExistingSequenceStructureEdit = {
  expectedProjectId?: string;
  expectedSequenceId?: string;
  expectedProjectPath: string;
  expectedSequenceName: string;
  expectedSequenceUid: string;
  removeTracks: Array<RemoveTrackTarget & { expectedHostName: string }>;
  captionStyle?: CaptionStyleTarget;
  /** Archive is the default; native remains explicit and version-gated. No fallback. */
  trackRemovalRoute?: "archive" | "native";
};

const sequenceStructureSchema = z.object({
  id: z.string(),
  name: z.string(),
  videoTracks: z.number().int().nonnegative(),
  audioTracks: z.number().int().nonnegative(),
  captionTracks: z.number().int().nonnegative(),
  items: z.array(z.unknown()),
  tracks: z.array(z.object({
    mediaType: z.enum(["video", "audio"]),
    index: z.number().int().nonnegative(),
    id: z.number().int().nonnegative(),
    name: z.string(),
    itemCount: z.number().int().nonnegative(),
    transitionCount: z.number().int().nonnegative(),
  }).passthrough()),
  captionTrackStates: z.array(z.object({
    index: z.number().int().nonnegative(),
    id: z.number().int().nonnegative(),
    name: z.string(),
    itemCount: z.number().int().nonnegative(),
    transitionCount: z.literal(0),
  }).passthrough()),
}).passthrough();
type SequenceStructureSnapshot = z.infer<typeof sequenceStructureSchema>;

const hostContextSchema = z.object({
  activeProject: z.boolean(),
  activeSequence: z.boolean(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  projectPath: z.string().optional(),
  sequenceId: z.string().optional(),
  sequenceName: z.string().optional(),
});

async function readHostState(host: HostExecutor,pins:Record<string,unknown>={}): Promise<{ project: ProjectSnapshot; sequence: SequenceStructureSnapshot }> {
  const project = projectSnapshotSchema.parse(await host.read("inspect_project",pins));
  const sequence = sequenceStructureSchema.parse(await host.read("inspect_sequence",pins));
  const active = activeSequence(project);
  if (active.id !== sequence.id || active.name !== sequence.name) throw new Error("HOST_SEQUENCE_READBACK_RACE");
  return { project, sequence };
}

function summarizeHost(project: ProjectSnapshot, sequence: SequenceStructureSnapshot) {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectPath: project.projectPath,
    capturedAt: project.capturedAt,
    offlineMediaCount: project.offlineMediaIds.length,
    markerCount: project.markers.length,
    activeSequence: {
      id: sequence.id,
      name: sequence.name,
      videoTracks: sequence.videoTracks,
      audioTracks: sequence.audioTracks,
      captionTracks: sequence.captionTracks,
      timelineItemCount: sequence.items.length,
      tracks: sequence.tracks,
      captionTrackStates: sequence.captionTrackStates,
    },
  };
}

function summarizeReceipt(receipt: { commandId: string; status: string; errors: string[] }) {
  return { commandId: receipt.commandId, status: receipt.status, errors: receipt.errors };
}

function cueIntegritySha256(cues: NonNullable<SequenceArchiveSnapshot["tracks"][number]["captionCues"]>): string {
  return createHash("sha256").update(JSON.stringify(cues.map((cue) => ({
    index: cue.index,
    startTicks: cue.startTicks,
    endTicks: cue.endTicks,
    text: cue.text,
  })))).digest("hex");
}

function summarizeArchive(archive: SequenceArchiveSnapshot) {
  return {
    projectPath: archive.projectPath,
    sequenceName: archive.sequenceName,
    sequenceUid: archive.sequenceUid,
    trackCounts: archive.trackCounts,
    totalItems: archive.totalItems,
    tracks: archive.tracks.map((track) => ({
      mediaType: track.mediaType,
      index: track.index,
      id: track.id,
      uid: track.uid,
      name: track.name,
      itemCount: track.itemCount,
      transitionCount: track.transitionCount,
      empty: track.empty,
      ...(track.style ? { style: track.style } : {}),
      ...(track.captionCues ? {
        captionCueSummary: {
          count: track.captionCues.length,
          integritySha256: cueIntegritySha256(track.captionCues),
          fonts: [...new Set(track.captionCues.map((cue) => cue.fontPostScriptName))],
          sizes: [...new Set(track.captionCues.map((cue) => cue.fontSize))],
        },
      } : {}),
    })),
  };
}

function summarizeObservation<T>(observation: Observation<T>) {
  return observation.status === "pass"
    ? { status: observation.status, attempts: observation.attempts }
    : observation;
}

type Observation<T> =
  | { status: "pass"; attempts: number; value: T }
  | { status: "unverified"; attempts: number; errors: string[] };

function observeProjectClose(receipt: OperationReceipt, target: LifecycleTarget): Observation<ReturnType<typeof verifiedProjectClose>> {
  try { return { status: 'pass', attempts: 1, value: verifiedProjectClose(receipt, target) }; }
  catch (error) { return { status: 'unverified', attempts: 1, errors: ['PROJECT_CLOSE_NOT_OBSERVED: ' + String(error)] }; }
}

type ExpectedProjectReadiness = {
  offlineMediaCount: number;
  markerCount: number;
};

function projectReadiness(snapshot: ProjectSnapshot): ExpectedProjectReadiness {
  return { offlineMediaCount: snapshot.offlineMediaIds.length, markerCount: snapshot.markers.length };
}

export async function waitForExpectedProject(
  host: HostExecutor,
  edit: ExistingSequenceStructureEdit,
  timeoutMs = 30_000,
  expectedReadiness?: ExpectedProjectReadiness,
): Promise<Observation<{
  project: ProjectSnapshot;
  sequence: SequenceStructureSnapshot;
}>> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError = "Expected project was not observed";
  do {
    attempts += 1;
    try {
      const context = hostContextSchema.parse(await host.read("inspect_host_context"));
      if (!context.activeProject) {
        lastError = "NO_ACTIVE_PROJECT: Premiere has no active project";
        await delay(500);
        continue;
      }
      const state = await readHostState(host,structurePins(edit));
      assertExpectedHost(state.project, edit);
      if (expectedReadiness) {
        const actualReadiness = projectReadiness(state.project);
        if (actualReadiness.offlineMediaCount !== expectedReadiness.offlineMediaCount
          || actualReadiness.markerCount !== expectedReadiness.markerCount) {
          lastError = `PROJECT_MEDIA_NOT_READY: ${JSON.stringify(actualReadiness)} != ${JSON.stringify(expectedReadiness)}`;
          await delay(500);
          continue;
        }
      }
      return { status: "pass", attempts, value: state };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  } while (Date.now() < deadline);
  return { status: "unverified", attempts, errors: [`PROJECT_REOPEN_NOT_OBSERVED: ${lastError}`] };
}

function lifecycleArgs(edit: ExistingSequenceStructureEdit, recovery = false): Record<string, unknown> {
  return {
    projectPath: edit.expectedProjectPath,
    sequenceName: edit.expectedSequenceName,
    sequenceId: edit.expectedSequenceUid,
    requireExclusiveProject: true,
    ...(recovery ? { recovery: true } : {}),
  };
}

function comparablePath(value: string): string {
  return normalizeLocalPath(value);
}

function activeSequence(snapshot: ProjectSnapshot) {
  if (!snapshot.activeSequence) throw new Error("NO_ACTIVE_SEQUENCE");
  return snapshot.activeSequence;
}

function assertExpectedHost(snapshot: ProjectSnapshot, edit: ExistingSequenceStructureEdit): void {
  if(edit.expectedProjectId!==undefined&&snapshot.projectId!==edit.expectedProjectId)throw Error('PROJECT_PRECONDITION_FAILED: structural edit project changed');
  const sequence = activeSequence(snapshot);
  if (comparablePath(snapshot.projectPath) !== comparablePath(edit.expectedProjectPath)) {
    throw new Error(`ACTIVE_PROJECT_MISMATCH: expected ${edit.expectedProjectPath}, found ${snapshot.projectPath}`);
  }
  if (sequence.name !== edit.expectedSequenceName || sequence.id !== edit.expectedSequenceUid) {
    throw new Error(`ACTIVE_SEQUENCE_MISMATCH: expected ${edit.expectedSequenceName} ${edit.expectedSequenceUid}, found ${sequence.name} ${sequence.id}`);
  }
}

function structurePins(edit:ExistingSequenceStructureEdit):Record<string,unknown>{
  return {...(edit.expectedProjectId?{expectedProjectId:edit.expectedProjectId}:{}),expectedProjectPath:edit.expectedProjectPath,expectedSequenceId:edit.expectedSequenceId??edit.expectedSequenceUid,expectedSequenceName:edit.expectedSequenceName};
}

function lifecycleTarget(edit: ExistingSequenceStructureEdit, projectId: string): LifecycleTarget {
  return { projectId, projectPath: edit.expectedProjectPath, sequenceId: edit.expectedSequenceUid, sequenceName: edit.expectedSequenceName };
}

function assertArchiveMatchesHost(hostSnapshot: ProjectSnapshot, archive: SequenceArchiveSnapshot): void {
  const sequence = activeSequence(hostSnapshot);
  if (archive.sequenceUid !== sequence.id) throw new Error(`ARCHIVE_SEQUENCE_UID_MISMATCH: ${archive.sequenceUid} != ${sequence.id}`);
  if (archive.trackCounts.video !== sequence.videoTracks
    || archive.trackCounts.audio !== sequence.audioTracks
    || archive.trackCounts.caption !== sequence.captionTracks) {
    throw new Error(`ARCHIVE_TRACK_COUNTS_MISMATCH: ${JSON.stringify(archive.trackCounts)} != ${JSON.stringify({ video: sequence.videoTracks, audio: sequence.audioTracks, caption: sequence.captionTracks })}`);
  }
}

function assertTargetsMatchArchive(archive: SequenceArchiveSnapshot, edit: ExistingSequenceStructureEdit): void {
  for (const target of edit.removeTracks) {
    const track = archive.tracks.find((candidate) => candidate.uid === target.uid);
    if (!track
      || track.mediaType !== target.mediaType
      || track.index !== target.index
      || track.id !== target.id) {
      throw new Error(`STALE_ARCHIVE_TRACK_TARGET: ${target.mediaType} ${target.index} ${target.uid}`);
    }
    if (!track.empty || track.itemCount !== 0 || track.transitionCount !== 0) {
      throw new Error(`ARCHIVE_TRACK_NOT_EMPTY: ${target.mediaType} ${target.index} ${target.uid}`);
    }
  }
}

function assertTargetsMatchHost(sequence: SequenceStructureSnapshot, edit: ExistingSequenceStructureEdit): void {
  for (const target of edit.removeTracks) {
    const track = target.mediaType === "caption"
      ? sequence.captionTrackStates.find((candidate) => candidate.index === target.index)
      : sequence.tracks.find((candidate) => candidate.mediaType === target.mediaType && candidate.index === target.index);
    if (!track || track.id !== target.id || track.name !== target.expectedHostName) {
      throw new Error(`STALE_HOST_TRACK_TARGET: ${target.mediaType} ${target.index} ${target.uid}`);
    }
    if ((track.itemCount ?? -1) !== 0 || (track.transitionCount ?? -1) !== 0) {
      throw new Error(`HOST_TRACK_NOT_EMPTY: ${target.mediaType} ${target.index} ${target.uid}`);
    }
  }
  if (edit.captionStyle) {
    const target = edit.captionStyle;
    const track = sequence.captionTrackStates.find((candidate) => candidate.id === target.expectedTrackId);
    if (!track || track.name !== target.expectedTrackName || track.itemCount !== target.expectedItemCount) {
      throw new Error(`STALE_HOST_CAPTION_STYLE_TARGET: ${target.trackUid}`);
    }
  }
}

function hostTrackRows(sequence: SequenceStructureSnapshot, mediaType?: "video" | "audio" | "caption") {
  const rows = [
    ...sequence.tracks.map((track) => ({
      mediaType: track.mediaType,
      index: track.index,
      id: track.id,
      name: track.name,
      itemCount: track.itemCount,
      transitionCount: track.transitionCount,
    })),
    ...sequence.captionTrackStates.map((track) => ({
      mediaType: "caption" as const,
      index: track.index,
      id: track.id,
      name: track.name,
      itemCount: track.itemCount,
      transitionCount: track.transitionCount,
    })),
  ];
  return mediaType ? rows.filter((track) => track.mediaType === mediaType) : rows;
}

function expectedRowsAfterDeletes(
  sequence: SequenceStructureSnapshot,
  mediaType: ExistingSequenceStructureEdit["removeTracks"][number]["mediaType"],
  targets: ExistingSequenceStructureEdit["removeTracks"],
) {
  const removedIndexes = new Set(targets.map((target) => target.index));
  return hostTrackRows(sequence, mediaType)
    .filter((track) => !removedIndexes.has(track.index))
    .map((track, index) => ({ ...track, index }));
}

function sameTrackRows(
  actual: ReturnType<typeof hostTrackRows>,
  expected: ReturnType<typeof hostTrackRows>,
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function sequenceIdentityAndCounts(sequence: SequenceStructureSnapshot) {
  return {
    id: sequence.id,
    name: sequence.name,
    videoTracks: sequence.videoTracks,
    audioTracks: sequence.audioTracks,
    captionTracks: sequence.captionTracks,
    itemCount: sequence.items.length,
    tracks: hostTrackRows(sequence),
  };
}

async function waitForNativeTrackDeletes(
  host: HostExecutor,
  before: { project: ProjectSnapshot; sequence: SequenceStructureSnapshot },
  mediaType: ExistingSequenceStructureEdit["removeTracks"][number]["mediaType"],
  targets: ExistingSequenceStructureEdit["removeTracks"],
  timeoutMs = 5_000,
): Promise<Observation<{ project: ProjectSnapshot; sequence: SequenceStructureSnapshot }>> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError = "Premiere has not exposed the requested track deletion";
  const expectedCounts = {
    videoTracks: before.sequence.videoTracks - (mediaType === "video" ? targets.length : 0),
    audioTracks: before.sequence.audioTracks - (mediaType === "audio" ? targets.length : 0),
    captionTracks: before.sequence.captionTracks - (mediaType === "caption" ? targets.length : 0),
  };
  const expectedRows = expectedRowsAfterDeletes(before.sequence, mediaType, targets);
  do {
    attempts += 1;
    try {
      const state = await readHostState(host,{expectedProjectId:before.project.projectId,expectedSequenceId:before.sequence.id,expectedSequenceName:before.sequence.name});
      const sameSequence = state.sequence.id === before.sequence.id && state.sequence.name === before.sequence.name;
      const countsMatch = state.sequence.videoTracks === expectedCounts.videoTracks
        && state.sequence.audioTracks === expectedCounts.audioTracks
        && state.sequence.captionTracks === expectedCounts.captionTracks;
      const itemsPreserved = state.sequence.items.length === before.sequence.items.length;
      const targetRows = hostTrackRows(state.sequence, mediaType);
      const survivorsMatch = sameTrackRows(targetRows, expectedRows);
      if (sameSequence && countsMatch && itemsPreserved && survivorsMatch) return { status: "pass", attempts, value: state };
      lastError = JSON.stringify({ sameSequence, countsMatch, itemsPreserved, survivorsMatch, actual: sequenceIdentityAndCounts(state.sequence) });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  } while (Date.now() < deadline);
  return { status: "unverified", attempts, errors: [`NATIVE_TRACK_DELETE_NOT_OBSERVED: ${lastError}`] };
}

function summarizeNativeDispatches(
  dispatches: Array<{
    mediaType: ExistingSequenceStructureEdit["removeTracks"][number]["mediaType"];
    targets: ExistingSequenceStructureEdit["removeTracks"];
    receipt: PremiereNativeBridgeResponse;
    observation: Awaited<ReturnType<typeof waitForNativeTrackDeletes>>;
  }>,
) {
  return dispatches.map((dispatch) => ({
    mediaType: dispatch.mediaType,
    targets: dispatch.targets,
    receipt: dispatch.receipt,
    observation: summarizeObservation(dispatch.observation),
  }));
}

async function cancelOrphanedDeleteTracksDialog(premierePid: number): Promise<{
  receipt?: PremiereNativeBridgeResponse;
  errors: string[];
}> {
  try {
    return { receipt: await cancelPremiereDeleteTracksDialogWithNativeBridge(premierePid), errors: [] };
  } catch (error) {
    return { errors: [`DELETE_TRACKS_DIALOG_CLEANUP_FAILED: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

async function editExistingTracksWithNativeBridge(
  host: HostExecutor,
  edit: ExistingSequenceStructureEdit,
  operationId: string,
): Promise<{
  status: "pass" | "fail" | "unverified";
  result: unknown;
  changedFiles: string[];
  errors: string[];
}> {
  const before = await readHostState(host,structurePins(edit));
  assertExpectedHost(before.project, edit);
  assertTargetsMatchHost(before.sequence, edit);
  const preflight = await lifecyclePreflight(host, lifecycleTarget(edit, before.project.projectId));
  if (preflight) return preflight;
  let premierePid: number;
  let probe: PremiereNativeBridgeResponse;
  try { premierePid = await resolveSinglePremiereProcessId(); probe = await probePremiereNativeBridge(premierePid); }
  catch(error){return {status:'fail',result:{route:'premiere_win32_allowlisted_feature_bridge',phase:'preflight',contentDispatched:false},changedFiles:[],errors:[String(error)]};}
  try { trackRemovalHostPreservation(before.sequence,before.project,edit.removeTracks); }
  catch(error){return {status:'fail',result:{phase:'preflight',contentDispatched:false},changedFiles:[],errors:[String(error)]};}
  const saveBefore = await host.mutate("save_working_project", structurePins(edit), randomUUID());
  if (saveBefore.status !== "pass") {
    return { status: "fail", result: { route: "premiere_win32_allowlisted_feature_bridge", before: summarizeHost(before.project, before.sequence), saveBefore: summarizeReceipt(saveBefore) }, changedFiles: [], errors: saveBefore.errors };
  }
  const beforeArchive = await snapshotPremiereSequenceArchive(edit.expectedProjectPath, edit.expectedSequenceName);
  assertArchiveMatchesHost(before.project, beforeArchive);
  assertTargetsMatchArchive(beforeArchive, edit);
  const projectExtension = path.extname(edit.expectedProjectPath);
  const projectBaseName = path.basename(edit.expectedProjectPath, projectExtension);
  const backupDirectory = path.join(path.dirname(edit.expectedProjectPath), "project-backups");
  const backupPath = path.join(backupDirectory, `${projectBaseName}.${operationId}.native-before${projectExtension}`);
  await mkdir(backupDirectory, { recursive: true });
  await copyFile(edit.expectedProjectPath, backupPath, fsConstants.COPYFILE_EXCL);

  const mediaTypes: Array<ExistingSequenceStructureEdit["removeTracks"][number]["mediaType"]> = ["caption", "audio", "video"];
  const groups = mediaTypes
    .map((mediaType) => ({
      mediaType,
      targets: edit.removeTracks.filter((target) => target.mediaType === mediaType).sort((left, right) => right.index - left.index),
    }))
    .filter((group) => group.targets.length > 0);
  const dispatches: Array<{
    mediaType: ExistingSequenceStructureEdit["removeTracks"][number]["mediaType"];
    targets: ExistingSequenceStructureEdit["removeTracks"];
    receipt: PremiereNativeBridgeResponse;
    observation: Awaited<ReturnType<typeof waitForNativeTrackDeletes>>;
  }> = [];
  let current = before;
  for (const group of groups) {
    const mediaRows = hostTrackRows(current.sequence, group.mediaType);
    const requestedRows = group.targets.map((target) => {
      const currentTrack = mediaRows.find((track) => track.index === target.index);
      if (!currentTrack || currentTrack.id !== target.id || currentTrack.name !== target.expectedHostName || currentTrack.itemCount !== 0 || currentTrack.transitionCount !== 0) return undefined;
      return currentTrack;
    });
    const exactRequestedRows = requestedRows.filter((track): track is NonNullable<typeof track> => track !== undefined).sort((left, right) => left.index - right.index);
    const allEmptyRows = mediaRows.filter((track) => track.itemCount === 0 && track.transitionCount === 0);
    if (exactRequestedRows.length !== group.targets.length || !sameTrackRows(allEmptyRows, exactRequestedRows)) {
      const recovery = await recoverNativeProjectBackup(host, edit, backupPath, operationId, before.project);
      return {
        status: recovery.status === "pass" ? "fail" : "unverified",
        result: { route: "premiere_win32_allowlisted_feature_bridge", before: summarizeHost(before.project, before.sequence), beforeArchive: summarizeArchive(beforeArchive), backupPath, probe, dispatches: summarizeNativeDispatches(dispatches), recovery: summarizeRecovery(recovery) },
        changedFiles: [edit.expectedProjectPath, backupPath, ...(recovery.restore ? [recovery.restore.failedProjectPath] : [])],
        errors: [`NATIVE_EMPTY_TRACK_SET_MISMATCH: ${group.mediaType}`, ...recovery.errors],
      };
    }
    let receipt: PremiereNativeBridgeResponse;
    try {
      receipt = await deletePremiereEmptyTracksWithNativeBridge(premierePid, {
        mediaType: group.mediaType,
        expectedTrackNames: exactRequestedRows.map((track) => track.name),
      });
    } catch (error) {
      const modalCleanup = await cancelOrphanedDeleteTracksDialog(premierePid);
      const recovery = await recoverNativeProjectBackup(host, edit, backupPath, operationId, before.project);
      return {
        status: recovery.status === "pass" ? "fail" : "unverified",
        result: { route: "premiere_win32_allowlisted_feature_bridge", before: summarizeHost(before.project, before.sequence), beforeArchive: summarizeArchive(beforeArchive), backupPath, probe, dispatches: summarizeNativeDispatches(dispatches), modalCleanup, recovery: summarizeRecovery(recovery) },
        changedFiles: [edit.expectedProjectPath, backupPath, ...(recovery.restore ? [recovery.restore.failedProjectPath] : [])],
        errors: [error instanceof Error ? error.message : String(error), ...modalCleanup.errors, ...recovery.errors],
      };
    }
    const observation = await waitForNativeTrackDeletes(host, current, group.mediaType, group.targets);
    dispatches.push({ mediaType: group.mediaType, targets: group.targets, receipt, observation });
    if (observation.status !== "pass") {
      const recovery = await recoverNativeProjectBackup(host, edit, backupPath, operationId, before.project);
      return {
        status: recovery.status === "pass" ? "fail" : "unverified",
        result: { route: "premiere_win32_allowlisted_feature_bridge", before: summarizeHost(before.project, before.sequence), beforeArchive: summarizeArchive(beforeArchive), backupPath, probe, dispatches: summarizeNativeDispatches(dispatches), recovery: summarizeRecovery(recovery) },
        changedFiles: [edit.expectedProjectPath, backupPath, ...(recovery.restore ? [recovery.restore.failedProjectPath] : [])],
        errors: [...observation.errors, ...recovery.errors],
      };
    }
    current = observation.value;
    await delay(500);
  }

  const saveAfter = await host.mutate("save_working_project", structurePins(edit), randomUUID());
  if (saveAfter.status !== "pass") {
    const recovery = await recoverNativeProjectBackup(host, edit, backupPath, operationId, before.project);
    return {
      status: recovery.status === "pass" ? "fail" : "unverified",
      result: { route: "premiere_win32_allowlisted_feature_bridge", before: summarizeHost(before.project, before.sequence), beforeArchive: summarizeArchive(beforeArchive), backupPath, probe, dispatches: summarizeNativeDispatches(dispatches), saveAfter: summarizeReceipt(saveAfter), recovery: summarizeRecovery(recovery) },
      changedFiles: [edit.expectedProjectPath, backupPath, ...(recovery.restore ? [recovery.restore.failedProjectPath] : [])],
      errors: [...saveAfter.errors, ...recovery.errors],
    };
  }

  const closeAfter = await host.mutateLifecycle("close_working_project", lifecycleArgs(edit), randomUUID());
  const closeObservation = observeProjectClose(closeAfter, lifecycleTarget(edit, before.project.projectId));
  if (closeObservation.status !== "pass") {
    return {
      status: "unverified",
      result: {
        route: "premiere_win32_allowlisted_feature_bridge",
        before: summarizeHost(before.project, before.sequence),
        beforeArchive: summarizeArchive(beforeArchive),
        backupPath,
        probe,
        dispatches: summarizeNativeDispatches(dispatches),
        saveAfter: summarizeReceipt(saveAfter),
        closeAfter: summarizeReceipt(closeAfter),
        closeObservation: summarizeObservation(closeObservation),
        recovery: { status: 'unverified', reason: 'Close was not proved. Inspect before another close, archive restore or reopen; do not replay.' },
      },
      changedFiles: [edit.expectedProjectPath, backupPath],
      errors: [...closeAfter.errors, ...closeObservation.errors],
    };
  }

  const reopenAfter = await host.mutateLifecycle("open_working_project", lifecycleArgs(edit), randomUUID());
  const reopenObservation = await waitForExpectedProject(host, edit, 30_000, projectReadiness(before.project));
  if (reopenObservation.status !== "pass") {
    const recovery = await recoverNativeProjectBackup(host, edit, backupPath, operationId, before.project, closeAfter);
    return {
      status: recovery.status === "pass" ? "fail" : "unverified",
      result: {
        route: "premiere_win32_allowlisted_feature_bridge",
        before: summarizeHost(before.project, before.sequence),
        beforeArchive: summarizeArchive(beforeArchive),
        backupPath,
        probe,
        dispatches: summarizeNativeDispatches(dispatches),
        saveAfter: summarizeReceipt(saveAfter),
        closeAfter: summarizeReceipt(closeAfter),
        closeObservation: summarizeObservation(closeObservation),
        reopenAfter: summarizeReceipt(reopenAfter),
        reopenObservation: summarizeObservation(reopenObservation),
        recovery: summarizeRecovery(recovery),
      },
      changedFiles: [edit.expectedProjectPath, backupPath, ...(recovery.restore ? [recovery.restore.failedProjectPath] : [])],
      errors: [...reopenAfter.errors, ...reopenObservation.errors, ...recovery.errors],
    };
  }

  const after = reopenObservation.value;
  const afterArchive = await snapshotPremiereSequenceArchive(edit.expectedProjectPath, edit.expectedSequenceName);
  const errors = afterReadbackErrors(before.project, before.sequence, beforeArchive, after.project, after.sequence, afterArchive, edit);
  if (errors.length) {
    const recovery = await recoverNativeProjectBackup(host, edit, backupPath, operationId, before.project);
    return {
      status: recovery.status === "pass" ? "fail" : "unverified",
      result: { route: "premiere_win32_allowlisted_feature_bridge", before: summarizeHost(before.project, before.sequence), beforeArchive: summarizeArchive(beforeArchive), backupPath, probe, dispatches: summarizeNativeDispatches(dispatches), saveAfter: summarizeReceipt(saveAfter), closeAfter: summarizeReceipt(closeAfter), closeObservation: summarizeObservation(closeObservation), reopenAfter: summarizeReceipt(reopenAfter), reopenObservation: summarizeObservation(reopenObservation), after: summarizeHost(after.project, after.sequence), afterArchive: summarizeArchive(afterArchive), recovery: summarizeRecovery(recovery) },
      changedFiles: [edit.expectedProjectPath, backupPath, ...(recovery.restore ? [recovery.restore.failedProjectPath] : [])],
      errors: [...errors, ...recovery.errors],
    };
  }
  return {
    status: "pass",
    result: {
      route: "premiere_win32_allowlisted_feature_bridge",
      before: summarizeHost(before.project, before.sequence),
      beforeArchive: summarizeArchive(beforeArchive),
      backupPath,
      probe,
      dispatches: summarizeNativeDispatches(dispatches),
      saveAfter: summarizeReceipt(saveAfter),
      closeAfter: summarizeReceipt(closeAfter),
      closeObservation: summarizeObservation(closeObservation),
      reopenAfter: summarizeReceipt(reopenAfter),
      reopenObservation: summarizeObservation(reopenObservation),
      after: summarizeHost(after.project, after.sequence),
      afterArchive: summarizeArchive(afterArchive),
    },
    changedFiles: [edit.expectedProjectPath, backupPath],
    errors: [],
  };
}


function afterReadbackErrors(
  beforeHost: ProjectSnapshot,
  beforeSequence: SequenceStructureSnapshot,
  beforeArchive: SequenceArchiveSnapshot,
  afterHost: ProjectSnapshot,
  afterSequence: SequenceStructureSnapshot,
  afterArchive: SequenceArchiveSnapshot,
  edit: ExistingSequenceStructureEdit,
): string[] {
  const errors: string[] = [];
  if(edit.captionStyle){try{if(captionStyleAvPreservation(beforeSequence,beforeHost)!==captionStyleAvPreservation(afterSequence,afterHost))errors.push('CAPTION_AV_PRESERVATION_MISMATCH');}catch(error){errors.push(String(error));}}
  if(edit.removeTracks.length){
    try{if(trackRemovalHostPreservation(beforeSequence,beforeHost,edit.removeTracks)!==trackRemovalHostPreservation(afterSequence,afterHost,[]))errors.push('TRACK_REMOVAL_HOST_PRESERVATION_MISMATCH');}catch(error){errors.push(String(error));}
    try{if(trackRemovalArchivePreservation(beforeArchive,edit.removeTracks)!==trackRemovalArchivePreservation(afterArchive,[]))errors.push('TRACK_REMOVAL_ARCHIVE_PRESERVATION_MISMATCH');}catch(error){errors.push(String(error));}
  }
  if (comparablePath(afterHost.projectPath) !== comparablePath(edit.expectedProjectPath)) errors.push("Reopened project path mismatch");
  if (afterSequence.id !== edit.expectedSequenceUid || afterSequence.name !== edit.expectedSequenceName) errors.push("Reopened active sequence mismatch");
  if (afterSequence.items.length !== beforeSequence.items.length) errors.push(`Timeline item count changed: ${beforeSequence.items.length} -> ${afterSequence.items.length}`);
  if (afterHost.markers.length !== beforeHost.markers.length) errors.push(`Marker count changed: ${beforeHost.markers.length} -> ${afterHost.markers.length}`);
  if (afterHost.offlineMediaIds.length !== beforeHost.offlineMediaIds.length) errors.push(`Offline media count changed: ${beforeHost.offlineMediaIds.length} -> ${afterHost.offlineMediaIds.length}`);
  if (afterArchive.totalItems !== beforeArchive.totalItems) errors.push(`Archive item count changed: ${beforeArchive.totalItems} -> ${afterArchive.totalItems}`);
  const expectedCounts = {
    video: beforeSequence.videoTracks - edit.removeTracks.filter((target) => target.mediaType === "video").length,
    audio: beforeSequence.audioTracks - edit.removeTracks.filter((target) => target.mediaType === "audio").length,
    caption: beforeSequence.captionTracks - edit.removeTracks.filter((target) => target.mediaType === "caption").length,
  };
  if (afterSequence.videoTracks !== expectedCounts.video
    || afterSequence.audioTracks !== expectedCounts.audio
    || afterSequence.captionTracks !== expectedCounts.caption) {
    errors.push(`Unexpected Premiere track counts: ${JSON.stringify({ video: afterSequence.videoTracks, audio: afterSequence.audioTracks, caption: afterSequence.captionTracks })} != ${JSON.stringify(expectedCounts)}`);
  }
  if (afterSequence.videoTracks !== afterArchive.trackCounts.video
    || afterSequence.audioTracks !== afterArchive.trackCounts.audio
    || afterSequence.captionTracks !== afterArchive.trackCounts.caption) errors.push("Premiere and saved archive track counts differ after reopen");
  for (const target of edit.removeTracks) {
    if (afterArchive.tracks.some((track) => track.uid === target.uid)) errors.push(`Removed track UID remains in archive: ${target.uid}`);
  }
  const removedUids = new Set(edit.removeTracks.map((target) => target.uid));
  for (const beforeTrack of beforeArchive.tracks.filter((track) => track.mediaType === "caption" && !removedUids.has(track.uid))) {
    const afterTrack = afterArchive.tracks.find((track) => track.uid === beforeTrack.uid);
    if (!beforeTrack.captionCues || !afterTrack?.captionCues
      || cueIntegritySha256(beforeTrack.captionCues) !== cueIntegritySha256(afterTrack.captionCues)) {
      errors.push(`Caption cue text or timing changed: ${beforeTrack.uid}`);
    }
  }
  if (edit.captionStyle) {
    const captionStyle = edit.captionStyle;
    errors.push(...captionStyleReadbackErrors(beforeArchive,afterArchive,captionStyle));
    const hostTrack = afterSequence.captionTrackStates.find((track) => track.id === captionStyle.expectedTrackId);
    if (!hostTrack || hostTrack.name !== captionStyle.expectedTrackName || hostTrack.itemCount !== captionStyle.expectedItemCount) {
      errors.push("Styled caption track identity or item count changed in Premiere");
    }
  }
  return errors;
}

type ArchiveMutation = Awaited<ReturnType<typeof commitPremiereSequenceArchive>>;

function summarizeArchiveMutation(mutation: ArchiveMutation) {
  return {
    backupPath: mutation.backupPath,
    before: summarizeArchive(mutation.before),
    after: summarizeArchive(mutation.after),
  };
}

async function closeForRecovery(host: HostExecutor, edit: ExistingSequenceStructureEdit, target: LifecycleTarget, knownClose?: OperationReceipt): Promise<{
  receipt?: OperationReceipt;
  observation: Observation<ReturnType<typeof verifiedProjectClose>>;
}> {
  try {
    const context = await readLifecycleContext(host);
    if (!context.activeProject && !context.activeSequence && context.openProjects.projects.length === 0) {
      if (!knownClose) throw Error('RECOVERY_PROJECT_CLOSE_PROOF_MISSING: absence in views alone is not a native close witness');
      return { receipt: knownClose, observation: observeProjectClose(knownClose, target) };
    }
    assertExclusiveLifecycleTarget(context, target);
  } catch (error) {
    return {
      observation: {
        status: "unverified",
        attempts: 1,
        errors: [`RECOVERY_PROJECT_STATE_UNKNOWN: ${error instanceof Error ? error.message : String(error)}`],
      },
    };
  }
  const receipt = await host.mutateLifecycle("close_working_project", lifecycleArgs(edit, true), randomUUID());
  return { receipt, observation: observeProjectClose(receipt, target) };
}

async function recoverOriginalArchive(
  host: HostExecutor,
  edit: ExistingSequenceStructureEdit,
  archiveMutation: ArchiveMutation,
  operationId: string,
  expectedHost: ProjectSnapshot,
  knownClose?: OperationReceipt,
): Promise<{
  status: "pass" | "unverified";
  close: Awaited<ReturnType<typeof closeForRecovery>>;
  restore?: Awaited<ReturnType<typeof restorePremiereSequenceArchive>>;
  reopen?: OperationReceipt;
  observation?: Awaited<ReturnType<typeof waitForExpectedProject>>;
  errors: string[];
}> {
  const close = await closeForRecovery(host, edit, lifecycleTarget(edit, expectedHost.projectId), knownClose);
  if (close.observation.status !== "pass") return { status: "unverified", close, errors: close.observation.errors };
  try {
    const restore = await restorePremiereSequenceArchive(edit.expectedProjectPath, archiveMutation.backupPath, operationId);
    const reopen = await host.mutateLifecycle("open_working_project", lifecycleArgs(edit), randomUUID());
    const observation = await waitForExpectedProject(host, edit, 30_000, projectReadiness(expectedHost));
    return observation.status === "pass"
      ? { status: "pass", close, restore, reopen, observation, errors: [] }
      : { status: "unverified", close, restore, reopen, observation, errors: observation.errors };
  } catch (error) {
    return {
      status: "unverified",
      close,
      errors: [`ORIGINAL_ARCHIVE_RECOVERY_FAILED: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

async function recoverNativeProjectBackup(
  host: HostExecutor,
  edit: ExistingSequenceStructureEdit,
  backupPath: string,
  operationId: string,
  expectedHost: ProjectSnapshot,
  knownClose?: OperationReceipt,
): Promise<{
  status: "pass" | "unverified";
  close: Awaited<ReturnType<typeof closeForRecovery>>;
  restore?: Awaited<ReturnType<typeof restorePremiereSequenceArchive>>;
  reopen?: OperationReceipt;
  observation?: Awaited<ReturnType<typeof waitForExpectedProject>>;
  errors: string[];
}> {
  const close = await closeForRecovery(host, edit, lifecycleTarget(edit, expectedHost.projectId), knownClose);
  if (close.observation.status !== "pass") return { status: "unverified", close, errors: close.observation.errors };
  try {
    const restore = await restorePremiereSequenceArchive(edit.expectedProjectPath, backupPath, operationId);
    const reopen = await host.mutateLifecycle("open_working_project", lifecycleArgs(edit), randomUUID());
    const observation = await waitForExpectedProject(host, edit, 30_000, projectReadiness(expectedHost));
    return observation.status === "pass"
      ? { status: "pass", close, restore, reopen, observation, errors: [] }
      : { status: "unverified", close, restore, reopen, observation, errors: observation.errors };
  } catch (error) {
    return {
      status: "unverified",
      close,
      errors: [`NATIVE_PROJECT_RECOVERY_FAILED: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function summarizeRecovery(recovery: Awaited<ReturnType<typeof recoverOriginalArchive>>) {
  return {
    status: recovery.status,
    close: {
      ...(recovery.close.receipt ? { receipt: summarizeReceipt(recovery.close.receipt) } : {}),
      observation: summarizeObservation(recovery.close.observation),
    },
    ...(recovery.restore ? { restore: recovery.restore } : {}),
    ...(recovery.reopen ? { reopen: summarizeReceipt(recovery.reopen) } : {}),
    ...(recovery.observation ? { observation: summarizeObservation(recovery.observation) } : {}),
    errors: recovery.errors,
  };
}

export async function inspectExistingSequenceStructure(host: HostExecutor, authorizeProjectPath: (candidate: string) => string,pins:Record<string,unknown>={}): Promise<{
  host: ReturnType<typeof summarizeHost>;
  savedArchive: ReturnType<typeof summarizeArchive>;
}> {
  const hostState = await readHostState(host,pins);
  const projectPath = authorizeProjectPath(hostState.project.projectPath);
  const archive = await snapshotPremiereSequenceArchive(projectPath, hostState.sequence.name);
  assertArchiveMatchesHost(hostState.project, archive);
  return { host: summarizeHost(hostState.project, hostState.sequence), savedArchive: summarizeArchive(archive) };
}

export async function editExistingSequenceStructure(
  host: HostExecutor,
  edit: ExistingSequenceStructureEdit,
  operationId: string,
): Promise<{
  status: "pass" | "fail" | "unverified";
  result: unknown;
  changedFiles: string[];
  errors: string[];
}> {
  if(edit.captionStyle)assertCaptionStyleTarget(edit.captionStyle);
  if (edit.removeTracks.length && edit.captionStyle) {
    throw new Error("SEPARATE_TRACK_REMOVAL_AND_CAPTION_STYLE_EDITS_REQUIRED");
  }
  if (edit.removeTracks.length && edit.trackRemovalRoute === "native") {
    return editExistingTracksWithNativeBridge(host, edit, operationId);
  }

  const beforeState = await readHostState(host,structurePins(edit));
  const beforeHost = beforeState.project;
  const beforeSequence = beforeState.sequence;
  assertExpectedHost(beforeHost, edit);
  assertTargetsMatchHost(beforeSequence, edit);

  if(edit.captionStyle || edit.removeTracks.length){
    try{if(edit.captionStyle)captionStyleAvPreservation(beforeSequence,beforeHost);else trackRemovalHostPreservation(beforeSequence,beforeHost,edit.removeTracks);}
    catch(error){return {status:'fail',result:{phase:'preflight',contentDispatched:false,beforeHost:summarizeHost(beforeHost,beforeSequence)},changedFiles:[],errors:[String(error)]};}
  }

  const preflight = await lifecyclePreflight(host, lifecycleTarget(edit, beforeHost.projectId));
  if (preflight) return preflight;

  let save:OperationReceipt;
  try{save=await host.mutate("save_working_project",structurePins(edit),randomUUID());}
  catch(error){return {status:'unverified',result:{beforeHost:summarizeHost(beforeHost,beforeSequence),save:{status:'unverified',error:String(error)}},changedFiles:[edit.expectedProjectPath],errors:['CAPTION_INITIAL_SAVE_UNVERIFIED: '+String(error)]};}
  if(save.status!=='pass')return {status:save.status==='fail'?'fail':'unverified',result:{beforeHost:summarizeHost(beforeHost,beforeSequence),save:summarizeReceipt(save)},changedFiles:[edit.expectedProjectPath],errors:save.errors};
  const beforeArchive = await snapshotPremiereSequenceArchive(edit.expectedProjectPath, edit.expectedSequenceName);
  assertArchiveMatchesHost(beforeHost, beforeArchive);

  // Validate exact cue ticks, binary layout and shared-payload isolation before
  // closing the user's project. This computes a candidate only; commit re-reads
  // and guards the actual closed file before an atomic replacement.
  assertTargetsMatchArchive(beforeArchive, edit);
  const candidateArchive = await readPremiereArchiveXml(edit.expectedProjectPath);
  const candidate = patchPremiereSequenceArchive(candidateArchive.xml,{sequenceName:edit.expectedSequenceName,expectedSequenceUid:edit.expectedSequenceUid,removeTracks:edit.removeTracks,...(edit.captionStyle?{captionStyle:edit.captionStyle}:{})});
  if(edit.removeTracks.length && trackRemovalArchivePreservation(beforeArchive,edit.removeTracks)!==trackRemovalArchivePreservation(candidate.after,[]))throw Error("TRACK_REMOVAL_CANDIDATE_PRESERVATION_MISMATCH");

  const close = await host.mutateLifecycle("close_working_project", lifecycleArgs(edit), randomUUID());
  const closeObservation = observeProjectClose(close, lifecycleTarget(edit, beforeHost.projectId));
  if (closeObservation.status !== "pass") {
    return {
      status: "unverified",
      result: {
        route: "public_uxp_lifecycle_and_verified_project_archive",
        beforeHost: summarizeHost(beforeHost, beforeSequence),
        beforeArchive: summarizeArchive(beforeArchive),
        save: summarizeReceipt(save),
        close: summarizeReceipt(close),
        closeObservation: summarizeObservation(closeObservation),
      },
      changedFiles: [edit.expectedProjectPath],
      errors: closeObservation.errors,
    };
  }

  // close_working_project saves again. Its legitimate serialization can change
  // bytes/ObjectIDs; validate the closed saved input's meaning, then freeze its
  // SHA. Never adopt a changed file after a failed/unknown commit or retry one.
  let closedSourceSha256: string;
  try {
    assertLifecycleStillClosed(await readLifecycleContext(host));
    const closedArchive = await readPremiereArchiveXml(edit.expectedProjectPath);
    const closedCandidate = patchPremiereSequenceArchive(closedArchive.xml,{sequenceName:edit.expectedSequenceName,expectedSequenceUid:edit.expectedSequenceUid,removeTracks:edit.removeTracks,...(edit.captionStyle?{captionStyle:edit.captionStyle}:{})});
    assertArchiveMatchesHost(beforeHost,closedCandidate.before);
    assertTargetsMatchArchive(closedCandidate.before,edit);
    if(trackRemovalArchivePreservation(beforeArchive,[])!==trackRemovalArchivePreservation(closedCandidate.before,[]))throw Error('CLOSED_SAVE_ARCHIVE_PRESERVATION_MISMATCH');
    if(edit.removeTracks.length && trackRemovalArchivePreservation(closedCandidate.before,edit.removeTracks)!==trackRemovalArchivePreservation(closedCandidate.after,[]))throw Error('CLOSED_TRACK_REMOVAL_CANDIDATE_PRESERVATION_MISMATCH');
    if(edit.captionStyle){const errors=captionStyleReadbackErrors(beforeArchive,closedCandidate.after,edit.captionStyle);if(errors.length)throw Error(errors.join('; '));}
    closedSourceSha256=closedArchive.sha256;
    assertLifecycleStillClosed(await readLifecycleContext(host));
  }
  catch(error){return {status:'unverified',result:{route:'public_uxp_lifecycle_and_verified_project_archive',phase:'before_archive_commit',contentDispatched:true,archiveDispatched:false,reopenDispatched:false,close:summarizeReceipt(close),closeObservation:summarizeObservation(closeObservation)},changedFiles:[edit.expectedProjectPath],errors:['PROJECT_STATE_BEFORE_ARCHIVE_UNVERIFIED: '+String(error)]};}

  let archiveMutation: ArchiveMutation;
  try {
    archiveMutation = await commitPremiereSequenceArchive({
      projectPath: edit.expectedProjectPath,
      sequenceName: edit.expectedSequenceName,
      expectedSequenceUid: edit.expectedSequenceUid,
      expectedSourceSha256: closedSourceSha256,
      removeTracks: edit.removeTracks,
      ...(edit.captionStyle ? { captionStyle: edit.captionStyle } : {}),
    }, operationId);
  } catch (error) {
    // Saved bytes changed after the verified closed candidate was captured.
    // Preserve the file and uncertainty; do not reopen or replay automatically.
    if (/PROJECT_ARCHIVE_CHANGED_(SINCE_PREFLIGHT|BEFORE_COMMIT)/.test(String(error))) {
      return {status:'unverified',result:{route:'public_uxp_lifecycle_and_verified_project_archive',phase:'archive_commit',archiveReplaced:false,reopenDispatched:false,close:summarizeReceipt(close)},changedFiles:[edit.expectedProjectPath],errors:[String(error)]};
    }
    const reopen = await host.mutateLifecycle("open_working_project", lifecycleArgs(edit), randomUUID());
    const reopenObservation = await waitForExpectedProject(host, edit, 30_000, projectReadiness(beforeHost));
    const archiveError = error instanceof Error ? error.message : String(error);
    return {
      status: reopenObservation.status === "pass" ? "fail" : "unverified",
      result: {
        route: "public_uxp_lifecycle_and_verified_project_archive",
        beforeHost: summarizeHost(beforeHost, beforeSequence),
        beforeArchive: summarizeArchive(beforeArchive),
        save: summarizeReceipt(save),
        close: summarizeReceipt(close),
        closeObservation: summarizeObservation(closeObservation),
        archiveError,
        reopen: summarizeReceipt(reopen),
        reopenObservation: summarizeObservation(reopenObservation),
      },
      changedFiles: [edit.expectedProjectPath],
      errors: [archiveError, ...(reopenObservation.status === "unverified" ? reopenObservation.errors : [])],
    };
  }

  const reopen = await host.mutateLifecycle("open_working_project", lifecycleArgs(edit), randomUUID());
  const reopenObservation = await waitForExpectedProject(host, edit, 30_000, projectReadiness(beforeHost));
  if (reopenObservation.status !== "pass") {
    if (reopen.status === "unverified") {
      return {
        status: "unverified",
        result: {
          route: "public_uxp_lifecycle_and_verified_project_archive",
          beforeHost: summarizeHost(beforeHost, beforeSequence),
          beforeArchive: summarizeArchive(beforeArchive),
          save: summarizeReceipt(save),
          close: summarizeReceipt(close),
          closeObservation: summarizeObservation(closeObservation),
          archiveMutation: summarizeArchiveMutation(archiveMutation),
          reopen: summarizeReceipt(reopen),
          reopenObservation: summarizeObservation(reopenObservation),
        },
        changedFiles: [edit.expectedProjectPath, archiveMutation.backupPath],
        errors: [...reopen.errors, ...reopenObservation.errors],
      };
    }
    const recovery = await recoverOriginalArchive(host, edit, archiveMutation, operationId, beforeHost, close);
    return {
      status: recovery.status === "pass" ? "fail" : "unverified",
      result: {
        route: "public_uxp_lifecycle_and_verified_project_archive",
        beforeHost: summarizeHost(beforeHost, beforeSequence),
        beforeArchive: summarizeArchive(beforeArchive),
        save: summarizeReceipt(save),
        close: summarizeReceipt(close),
        closeObservation: summarizeObservation(closeObservation),
        archiveMutation: summarizeArchiveMutation(archiveMutation),
        reopen: summarizeReceipt(reopen),
        reopenObservation: summarizeObservation(reopenObservation),
        recovery: summarizeRecovery(recovery),
      },
      changedFiles: [edit.expectedProjectPath, archiveMutation.backupPath, ...(recovery.restore ? [recovery.restore.failedProjectPath] : [])],
      errors: [...reopenObservation.errors, ...recovery.errors],
    };
  }

  const afterState = reopenObservation.value;
  let afterHost = afterState.project;
  let afterSequence = afterState.sequence;
  // The file we wrote is not host acceptance proof. Require Premiere to save
  // its reopened state, then verify that serialized roundtrip. An uncertain
  // save must not trigger close/rollback while its write may still be running.
  let roundtripSave:OperationReceipt;
  try{roundtripSave=await host.mutate('save_working_project',structurePins(edit),randomUUID());}
  catch(error){return {status:'unverified',result:{route:'public_uxp_lifecycle_and_verified_project_archive',archiveMutation:summarizeArchiveMutation(archiveMutation),roundtripSave:{status:'unverified',error:String(error)},reopenObservation:summarizeObservation(reopenObservation)},changedFiles:[edit.expectedProjectPath,archiveMutation.backupPath],errors:['REOPENED_CAPTION_SAVE_UNVERIFIED: '+String(error)]};}
  if(roundtripSave.status!=='pass')return {status:'unverified',result:{route:'public_uxp_lifecycle_and_verified_project_archive',archiveMutation:summarizeArchiveMutation(archiveMutation),roundtripSave:summarizeReceipt(roundtripSave),reopenObservation:summarizeObservation(reopenObservation)},changedFiles:[edit.expectedProjectPath,archiveMutation.backupPath],errors:['REOPENED_CAPTION_SAVE_UNVERIFIED',...roundtripSave.errors]};
  let afterArchive: SequenceArchiveSnapshot;
  let errors: string[];
  try {
    const savedHost=await readHostState(host,structurePins(edit));afterHost=savedHost.project;afterSequence=savedHost.sequence;
    afterArchive = await snapshotPremiereSequenceArchive(edit.expectedProjectPath, edit.expectedSequenceName);
    errors = afterReadbackErrors(beforeHost, beforeSequence, beforeArchive, afterHost, afterSequence, afterArchive, edit);
  } catch (error) {
    afterArchive = archiveMutation.after;
    errors = [`AFTER_ARCHIVE_READBACK_FAILED: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (errors.length) {
    return {
      status: "unverified",
      result: {
        route: "public_uxp_lifecycle_and_verified_project_archive",
        beforeHost: summarizeHost(beforeHost, beforeSequence),
        beforeArchive: summarizeArchive(beforeArchive),
        save: summarizeReceipt(save),
        close: summarizeReceipt(close),
        closeObservation: summarizeObservation(closeObservation),
        archiveMutation: summarizeArchiveMutation(archiveMutation),
        reopen: summarizeReceipt(reopen),
        reopenObservation: { status: reopenObservation.status, attempts: reopenObservation.attempts },
        afterHost: summarizeHost(afterHost, afterSequence),
        afterArchive: summarizeArchive(afterArchive),
        roundtripSave:summarizeReceipt(roundtripSave),
        recovery: {status:'unverified',reason:'Post-save preservation or requested-style readback differs. Keep the reopened project and backup; inspect possible concurrent edits before any explicit recovery.'},
      },
      changedFiles: [edit.expectedProjectPath, archiveMutation.backupPath],
      errors,
    };
  }
  return {
    status: "pass",
    result: {
      route: "public_uxp_lifecycle_and_verified_project_archive",
      beforeHost: summarizeHost(beforeHost, beforeSequence),
      beforeArchive: summarizeArchive(beforeArchive),
      save: summarizeReceipt(save),
      close: summarizeReceipt(close),
      closeObservation: summarizeObservation(closeObservation),
      archiveMutation: summarizeArchiveMutation(archiveMutation),
      reopen: summarizeReceipt(reopen),
      reopenObservation: { status: reopenObservation.status, attempts: reopenObservation.attempts },
      afterHost: summarizeHost(afterHost, afterSequence),
      afterArchive: summarizeArchive(afterArchive),
      roundtripSave:summarizeReceipt(roundtripSave),
      ...(edit.removeTracks.length?{trackRemovalPreservation:{status:'pass',host:'pass',archive:'pass',roundtrip:'pass'}}:{}),
      avPreservation:{
        status:'pass',scope:edit.removeTracks.length?'track_index_remap_all_av_bounds_sources_exposed_effect_values_keyframes_video_transitions_and_caption_payloads':'timeline_bounds_source_ids_and_native_graphic_component_chains',
        nativeGraphicItems:beforeSequence.items.filter((item:any)=>item.projectItemId==='').length,
        nativeGraphicSourceContent:'unverified',
        limitation:'Native graphics without ProjectItem IDs are correlated by unique slot, name and ordered component matchName chain (Graphic Group by count only: Premiere re-creates its slot on reopen). Opaque graphic text/private payload and rendered pixels are not verified by this AV proof.',
      },
    },
    changedFiles: [edit.expectedProjectPath, archiveMutation.backupPath],
    errors: [],
  };
}
