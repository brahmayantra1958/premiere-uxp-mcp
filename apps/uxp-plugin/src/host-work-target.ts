import { HostCommandError } from "./bridge-client.js";
import { activeProject, activeSequence, inspectHostContext, assertWorkingProject, assertWorkingSequence, assertMethod, sequenceId, ppro } from "./host-context.js";
import { findTrackItemEntry, timelineSelectionSnapshot, type ItemEntry } from "./host-items.js";
import { asTickTime, text } from "./host-foundation.js";
import { workIntent, type WorkIntent, type WorkTarget, type WorkTrack } from "./work-target.js";
import { timelineReadCommands, readWorkIntent } from "./read-work-target.js";
import type { BridgeRequest } from "./wire.js";
import { targetWorkingTracks } from "./host-track-targeting.js";
import { workFollow, attemptFollow, followFailed, type FollowFailure } from "./work-follow.js";
import { hostCommandProgress, observeHostAwait } from './host-command-progress.js';
import { exactTicksFromSeconds, nearestFrameTicks } from './tick-conversion.js';

type SelectItems = (sequence: any, entries: ItemEntry[]) => Promise<any>;
type Observer = (id: string, target: WorkTarget) => void;
function reject(code: string, message: string): never { throw new HostCommandError(code, message); }

async function targetSequence(args: Record<string, any>, explicit: boolean, viewOnly: boolean) {
  const project = await activeProject();
  if (!viewOnly) assertWorkingProject(project);
  const projectId = text(project.guid) || text(project.path) || text(project.name);
  const expectedProjectId = args.expectedProjectId ?? args.seed?.project?.id;
  const expectedSequenceId = args.expectedSequenceId ?? args.seed?.sequence?.id;
  if (expectedProjectId !== undefined && expectedProjectId !== projectId) reject("PROJECT_PRECONDITION_FAILED", "Work target project changed");
  let sequence;
  if (explicit) {
    if (!args.expectedProjectId || !args.sequenceId) reject("TARGET_REQUIRED", "focus_timeline requires exact project and sequence IDs");
    const matches = [];
    for (const candidate of await project.getSequences()) if (await sequenceId(candidate) === args.sequenceId) matches.push(candidate);
    if (matches.length !== 1) reject("SEQUENCE_PRECONDITION_FAILED", "Requested sequence was not uniquely found");
    sequence = matches[0];
  } else sequence = await activeSequence(project);
  if (!viewOnly) assertWorkingSequence(sequence);
  const id = await sequenceId(sequence);
  // Automatic focus must never switch to a stale expected target to make an edit pass.
  if ((expectedSequenceId !== undefined && expectedSequenceId !== id) ||
      (args.expectedSequenceName !== undefined && args.expectedSequenceName !== text(sequence.name))) {
    reject("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the edit target; inspect fresh context");
  }
  return { project, projectId, sequence, id };
}

export function framePosition(seconds: number, timebase: string): any {
  if (!Number.isFinite(seconds) || seconds < 0) reject("INVALID_TIME", "Work position must be finite and non-negative");
  const frame = BigInt(timebase);
  if (frame <= 0n) reject("INVALID_TIMEBASE", "Sequence timebase must be positive");
  return ppro.TickTime.createWithTicks(nearestFrameTicks(exactTicksFromSeconds(seconds), frame));
}

/** Navigation only. All targets and API prerequisites are checked before changing the view. */
export async function focusWorkTarget(request: BridgeRequest, selectItems: SelectItems, readIntent?: WorkIntent, timingsMs: Record<string, number> = {}, revealed?: WorkTarget): Promise<WorkTarget | undefined> {
  const start = performance.now();
  const intent = readIntent ?? workIntent(request.command, request.args);
  if (!intent) return undefined;
  const reading = timelineReadCommands.has(request.command);
  const { project, projectId, sequence, id } = await targetSequence(request.args, request.command === "focus_timeline", reading);
  const entries: ItemEntry[] = [];
  for (const itemId of intent.itemIds) entries.push(await findTrackItemEntry(sequence, itemId));
  const tracks: WorkTrack[] = [...intent.tracks];
  for (const entry of entries) {
    const track = { mediaType: entry.snapshot.mediaType, trackIndex: entry.snapshot.trackIndex } as WorkTrack;
    if (!tracks.some(existing => existing.mediaType === track.mediaType && existing.trackIndex === track.trackIndex)) tracks.push(track);
    if (!reading) assertMethod(entry.raw, "getIsSelected");
  }
  for (const track of tracks) {
    const count = await sequence[track.mediaType === "video" ? "getVideoTrackCount" : track.mediaType === "audio" ? "getAudioTrackCount" : "getCaptionTrackCount"]();
    // Placement may intentionally create a new track; focus reports its requested index without creating it.
    const createsTracks = ["place_clips", "insert_mogrt_caption", "place_voiceover", "place_music"].includes(request.command);
    if (!createsTracks && track.trackIndex >= count) reject("TRACK_NOT_FOUND", "Work track does not exist");
  }
  for (const name of ["openSequence", "setActiveSequence"]) assertMethod(project, name);
  for (const name of ["getPlayerPosition", "setPlayerPosition", "getTimebase", ...(!reading ? ["clearSelection", "getSelection"] : [])]) assertMethod(sequence, name);
  const first = entries[0]?.snapshot;
  // Without an explicit time, keep an in-clip position. Returning to its start
  // on each parameter edit/read would rewind a long clip to 00:00 repeatedly.
  const current = asTickTime(await sequence.getPlayerPosition());
  const keepPosition = request.command !== "focus_timeline" && intent.timeSeconds === undefined && intent.edge === undefined && intent.offsetSeconds === undefined &&
    first && current.seconds >= Number(first.start.seconds) && current.seconds < Number(first.end.seconds);
  const requestedSeconds = intent.timeSeconds ?? (!keepPosition && first ? Number((intent.edge === "end" ? first.end : first.start).seconds) + (intent.offsetSeconds ?? 0) : undefined);
  const position = requestedSeconds === undefined ? undefined : framePosition(requestedSeconds, text(await sequence.getTimebase()));
  const assertIdentity = async () => {
    const active = await activeProject();
    if ((text(active.guid) || text(active.path) || text(active.name)) !== projectId || await sequenceId(await activeSequence(active)) !== id) {
      reject("CONTEXT_CHANGED", "Active work target changed; content command was not dispatched");
    }
  };
  // Reveal the timeline tab through Premiere's API, never native input emulation.
  const beforeReveal = await activeProject();
  if ((text(beforeReveal.guid) || text(beforeReveal.path) || text(beforeReveal.name)) !== projectId) reject("CONTEXT_CHANGED", "Project changed before navigation");
  if (request.command !== "focus_timeline" && await sequenceId(await activeSequence(beforeReveal)) !== id) {
    reject("CONTEXT_CHANGED", "Active work target changed; content command was not dispatched");
  }
  const activationStart = performance.now();
  timingsMs.preconditions = activationStart - start;
  // Only a same-command post-edit witness can avoid reopening a tab that this
  // call already revealed. Fresh active identity checks above/below still run.
  const alreadyRevealed = revealed?.phase === "before_command" && revealed.projectId === projectId && revealed.sequenceId === id;
  // The active sequence is already identity-checked. A targeted read can seek
  // without reopening its tab and stealing the user's native panel focus.
  if (!alreadyRevealed && !reading) {
    await project.openSequence(sequence);
    await project.setActiveSequence(sequence);
  }
  await assertIdentity();
  timingsMs.activation = performance.now() - activationStart;
  const positionStart = performance.now();
  // Prove the requested or retained position after targeting/selection.
  if (position) await sequence.setPlayerPosition(position);
  timingsMs.position = performance.now() - positionStart;
  const targetingStart = performance.now();
  const targeting = await targetWorkingTracks(project, sequence, tracks);
  timingsMs.targeting = performance.now() - targetingStart;
  const selectionStart = performance.now();
  if (!reading) {
    // A passing relocation has already applied its destination with setSelection.
    // Reuse that same-command UI proof only when fresh full selection still
    // matches after targeting; otherwise apply and verify again as usual.
    // Insertion may set internal selection flags without updating the timeline's
    // visible selection. It must always commit through Sequence.setSelection.
    let selected = alreadyRevealed && request.command === "move_clip_to_track" ? await timelineSelectionSnapshot(sequence) : undefined;
    if (!selected || selected.truncated || selected.itemIds.length !== intent.itemIds.length || intent.itemIds.some(itemId => !selected!.itemIds.includes(itemId))) {
      await selectItems(sequence, entries);
      selected = await timelineSelectionSnapshot(sequence);
    }
    if (selected.truncated || selected.itemIds.length !== intent.itemIds.length || intent.itemIds.some(itemId => !selected.itemIds.includes(itemId))) {
      reject("WORK_SELECTION_UNVERIFIED", "Clip selection readback differs from requested targets; content command was not dispatched");
    }
  }
  timingsMs.selection = performance.now() - selectionStart;
  const verificationStart = performance.now();
  const playhead = asTickTime(await sequence.getPlayerPosition());
  if (playhead.ticks !== (position ? text(position.ticks) : current!.ticks)) reject("WORK_POSITION_UNVERIFIED", "Playhead readback differs; content command was not dispatched");
  await assertIdentity();
  timingsMs.verification = performance.now() - verificationStart;
  timingsMs.total = performance.now() - start;
  return { status: targeting.status === "unsupported" ? "partial" : "pass", phase: reading ? "after_read" : "before_command", projectId, sequenceId: id, sequenceName: text(sequence.name),
    tracks, itemIds: intent.itemIds, playhead, ...(requestedSeconds === undefined ? {} : { requestedSeconds }),
    sequenceActivation: "pass", playheadReadback: "pass", clipSelection: reading ? "preserved" : "pass",
    trackTargeting: targeting.status, trackTargetingReason: targeting.reason,
    trackTargetingReadback: targeting };
}

const explicitNavigation = ["focus_timeline", "set_effect_disclosure", "activate_native_tool", "track_object_mask_frames"];
const placementCommands = ["place_clips", "place_voiceover", "place_music", "place_on_new_layer"];

/** Explicit navigation keeps its UI proof and blocks on failure. Ordinary work
 * follows visibly while workFollow is enabled: edits reveal their target before
 * dispatch, targeted reads follow their actual result, placements/relocations select
 * the host-proven destination. That navigation never changes the content outcome. */
export async function followTimelineWork(request: BridgeRequest, selectItems: SelectItems, dispatch: () => Promise<unknown>, notify: Observer): Promise<unknown> {
  const before = await observeHostAwait(request.command==='create_sequence'?hostCommandProgress(request)?.at('sequence.follow_preflight'):undefined,'inspectHostContext',()=>inspectHostContext());
  if(['import_media','place_clips'].includes(request.command)&&((request.args.expectedProjectId!==undefined&&request.args.expectedProjectId!==before.projectId)||(request.args.expectedSequenceId!==undefined&&request.args.expectedSequenceId!==before.sequenceId)||(request.args.expectedSequenceName!==undefined&&request.args.expectedSequenceName!==before.sequenceName)))return {status:'fail',hostResult:{contentDispatched:false},errors:['Requested project/sequence differs from current target']};
  if (request.args.expectedProjectId !== undefined && request.args.expectedProjectId !== before.projectId)
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", "Active project differs from the requested target; get_agent_context and bind fresh IDs. No automatic activation.", {contentDispatched:false,retryable:false,errorClassification:'preflight',actualTarget:before});
  if ((request.args.expectedSequenceId !== undefined && request.args.expectedSequenceId !== before.sequenceId) ||
      (request.args.expectedSequenceName !== undefined && request.args.expectedSequenceName !== before.sequenceName))
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the requested target; get_agent_context and bind fresh IDs. Do not treat another sequence as the requested one.", {contentDispatched:false,retryable:false,errorClassification:'preflight',actualTarget:before});
  const explicit = explicitNavigation.includes(request.command);
  if (explicit) {
    const target = await focusWorkTarget(request, selectItems);
    if(target) { try { notify(request.id,target); } catch { /* observation only */ } }
    if(request.command === "focus_timeline")return {status:target?.status ?? 'pass',workTarget:target,hostResult:target,errors:[]};
  }
  const publish = (target: WorkTarget | FollowFailure | undefined) => {
    if (target && !followFailed(target)) { try { notify(request.id, target); } catch { /* observation only */ } }
    return target;
  };
  const following = workFollow.enabled && before.activeSequence && !explicit;
  const reading = timelineReadCommands.has(request.command);
  let workTarget: WorkTarget | FollowFailure | undefined;
  if (following && !reading && workIntent(request.command, request.args)) {
    workTarget = publish(await attemptFollow("before_command", () => focusWorkTarget(request, selectItems)));
    if (followFailed(workTarget)) {
      // A failed reveal may leave the view changed, but never a different edit target.
      const now = await inspectHostContext();
      if (now.projectId !== before.projectId || now.sequenceId !== before.sequenceId)
        throw new HostCommandError("CONTEXT_CHANGED", "Active target changed during work navigation; content was not dispatched", {contentDispatched:false,retryable:false,errorClassification:'preflight',actualTarget:now});
    }
  }
  const value = await dispatch();
  if(['inspect_project','inspect_sequence','inspect_media','inspect_proxies','inspect_markers','inspect_effects','inspect_timeline_selection','inspect_delivery_state','inspect_object_mask_state','inspect_clip_speech_text'].includes(request.command)) {
    const after=await inspectHostContext();
    if(before.projectId!==after.projectId || before.sequenceId!==after.sequenceId)
      throw new HostCommandError('READ_TARGET_CHANGED','Project/sequence changed during inspection; discard this read and retry with fresh get_agent_context IDs. No automatic activation.');
  }
  let merged: unknown = value;
  const readIntent = reading ? readWorkIntent(request.command, request.args, value, request.readPurpose) : undefined;
  if (following && readIntent) {
    // Overview reads leave navigation entirely alone, including the active panel.
    workTarget = publish(await attemptFollow("after_read", () => focusWorkTarget({ ...request, args: { ...request.args, expectedProjectId: before.projectId, expectedSequenceId: before.sequenceId } },
      selectItems, readIntent)));
    if (workTarget && !followFailed(workTarget) && request.command === "get_agent_context" && value && typeof value === "object") {
      const context = value as Record<string, any>;
      merged = { ...context, sequence: { ...context.sequence, playhead: workTarget.playhead },
        navigation: { ...context.navigation, trackTargeting: workTarget.trackTargeting, trackTargetingReason: workTarget.trackTargetingReason } };
    }
  }
  const placement = placementCommands.includes(request.command);
  if (following && (placement || request.command === "move_clip_to_track") && (value as any)?.status === "pass") {
    // Before insertion there are no timeline IDs to select. Select only host-proven
    // results and derive their real media tracks (an audio source's unused video slot is not V1 work).
    const itemIds = placement ? (value as any).placedItemIds : [(value as any).hostResult?.plan?.destination?.id];
    const revealed = followFailed(workTarget) ? undefined : workTarget;
    workTarget = publish(await attemptFollow("after_command", async () => {
      if (!Array.isArray(itemIds) || !itemIds.length || itemIds.some(id => typeof id !== "string" || !id)) throw Error("PLACEMENT_WORK_TARGET_MISSING");
      const focused = await focusWorkTarget(request, selectItems, { itemIds, tracks: [] }, {}, revealed);
      return { ...focused!, phase: "after_command" as const };
    }));
  }
  const follow = workTarget ? { workTarget } : {};
  // A JSON array cannot carry serialized metadata. Contextual collection reads
  // use a named items field, with a result alias for existing MCP consumers.
  return Array.isArray(merged)?{items:merged,result:merged,actualTarget:before,...follow}
    :merged && typeof merged === 'object'?{...merged,actualTarget:before,...follow}:merged;
}
