import { HostCommandError } from "./bridge-client.js";
import { ppro, sequenceId, tickFromSeconds, assertWorkingProject, assertWorkingSequence } from "./host-context.js";
import { text, asTickTime, type AnyRecord } from "./host-foundation.js";
import { queryTimelineEntries, queryProjectItems, findTrackItemEntry, type TrackItemLookupHint } from "./host-items.js";
import { componentSnapshot, GraphicObjectUnavailableError } from "./host-components.js";
import { graphicComponentSnapshot } from "./host-graphic-components.js";
import { waitGraphicMutationQuiet } from "./graphic-lifecycle.js";
import { parseTimelineId, type ItemQuery } from "./item-query.js";
import { PANEL_VERSION } from "./plugin-contract.js";
import { TRACK_TARGETING_REASON } from "./work-target.js";
import { workFollow } from "./work-follow.js";
import { effectTime, nativeToSequenceTime } from "./effect-time.js";

type Pin = { expectedProjectId?: string; expectedSequenceId?: string };
type Context = { project: any; sequence: any; identity: AnyRecord };

async function context(pin: Pin = {}): Promise<Context> {
  const project = await ppro.Project.getActiveProject();
  const sequence = project ? await project.getActiveSequence() : null;
  const identity = {
    project: project ? { id: text(project.guid) || text(project.path) || text(project.name), name: text(project.name), path: text(project.path) } : null,
    sequence: sequence ? { id: await sequenceId(sequence), name: text(sequence.name) } : null,
  };
  if (pin.expectedProjectId !== undefined && identity.project?.id !== pin.expectedProjectId) {
    throw new HostCommandError("PROJECT_PRECONDITION_FAILED", "Active project differs from the requested query target");
  }
  if (pin.expectedSequenceId !== undefined && identity.sequence?.id !== pin.expectedSequenceId) {
    throw new HostCommandError("SEQUENCE_PRECONDITION_FAILED", "Active sequence differs from the requested query target");
  }
  return { project, sequence, identity };
}

async function assertStillCurrent(before: Context): Promise<void> {
  const after = await context();
  if (JSON.stringify(after.identity) !== JSON.stringify(before.identity)) {
    throw new HostCommandError("CONTEXT_CHANGED", "Project or sequence changed during inspection; obtain fresh context");
  }
}

function editBoundary(current: Context): AnyRecord {
  try {
    if (!current.project || !current.sequence) throw new Error("Open a project and an active sequence first");
    assertWorkingProject(current.project);
    assertWorkingSequence(current.sequence);
    return { allowed: true, scope: "project_and_sequence", operationChecks: "Each mutation still validates target, timing, occupancy and readback" };
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function graphicQueryIdentity(snapshot: AnyRecord): string {
  return JSON.stringify([snapshot.id,snapshot.name,snapshot.projectItemId,snapshot.mediaType,snapshot.trackIndex,
    snapshot.start,snapshot.end,snapshot.inPoint,snapshot.outPoint,snapshot.speed,snapshot.reversed,snapshot.disabled,snapshot.adjustmentLayer]);
}

/** Small orientation result: no project-media traversal, effects or keyframes. */
export async function getAgentContext(pin: Pin = {}): Promise<AnyRecord> {
  const current = await context(pin);
  let sequence = current.identity.sequence;
  let selection: AnyRecord | null = null;
  if (current.sequence) {
    const raw = current.sequence;
    const settings = await raw.getSettings();
    const rect = await settings.getVideoFrameRect();
    const rate = await settings.getVideoFrameRate();
    let duration, playhead;
    try { duration = asTickTime(await raw.getEndTime()); } catch { /* empty sequence */ }
    try { playhead = asTickTime(await raw.getPlayerPosition()); } catch { /* unsupported host */ }
    sequence = { ...sequence, width: Number(rect?.width), height: Number(rect?.height), frameRate: Number(rate?.value), duration, playhead,
      videoTracks: Number(await raw.getVideoTrackCount()), audioTracks: Number(await raw.getAudioTrackCount()), captionTracks: Number(await raw.getCaptionTrackCount()) };
    const selected = await queryTimelineEntries(raw, { selectedOnly: true, limit: 10 });
    selection = { items: selected.entries.map(entry => entry.snapshot), page: selected.page };
  }
  await assertStillCurrent(current);
  return { status: !current.project ? "no_project" : !current.sequence ? "no_sequence" : "ready",
    panelVersion: PANEL_VERSION, capturedAt: new Date().toISOString(), project: current.identity.project, sequence,
    editBoundary: editBoundary(current), selection,
    navigation: { automatic: workFollow.enabled
        ? "Automatic work follow: edits reveal their target; an unspecified time keeps the playhead if it is already within that clip. Overview/context/selection verification preserves the last work position and native panel. Exact clip/name/time queries follow the requested target without reopening the timeline tab; placements/relocations select placed clips. No end-of-command restoration. Follow failure is reported as workTarget/visibility status unverified and never changes the content result. Commands remain serialized."
        : "Ordinary metadata and content operations preserve user navigation. Explicit focus/disclosure/tool requests perform their requested UI action. Commands remain serialized.",
      explicitTool: "focus_timeline (edit profile)", trackTargeting: "runtime_checked", trackTargetingReason: TRACK_TARGETING_REASON,
      panels: workFollow.enabled
        ? "Commands reveal their native panel (Effect Controls, Properties, Program Monitor, Project) and disclose the target effect, best effort. Content success never depends on panel visibility. Explicit set_effect_disclosure retains display proof."
        : "Ordinary effects do not require panel visibility for content success. Explicit set_effect_disclosure retains display proof. Specialized native sampling routes have feature-specific requirements.",
      projectSelection: workFollow.enabled
        ? "Targeted query_media (ids/name/bin) and Project item edits select their first item through the approved CEP helper, best effort. Media inventory reads preserve the current panel and selection."
        : "Metadata and source operations do not select Project panel items automatically.",
      effectExpansion: "runtime_checked", parameterScroll: "runtime_checked_effect_section", nativeToolActivation: "runtime_checked", objectMaskCreateTrack: "existing_mask_tracking_only" },
    next: { trackLocks: "read_track_locks then set_track_locks with exact track IDs/names and locked true/false; requires the dedicated helper", clips: "query_timeline", media: "query_media", effects: "query_timeline with includeEffects: true and ids for discovery; get_effect_values for automatic reveal of one exact effect",
      programFrame: "capture_program_frame returns the composited native frame as an MCP image; exact identity and timeSeconds required",
      command: "prepare_clip_edit returns guarded arguments; call the returned tool separately", fullSnapshot: "inspect_project" } };
}

export async function queryTimeline(query: ItemQuery & Pin = {}): Promise<AnyRecord> {
  // An audio/mixed discovery may hydrate the very wrappers invalidated by the
  // preceding effect/UI transaction. Explicit video-only reads keep their path.
  const mayIncludeAudio=query.mediaType!=='video'&&!(query.ids?.length&&query.ids.every(id=>parseTimelineId(id)?.mediaType==='video'));
  if(query.includeEffects&&mayIncludeAudio)await waitGraphicMutationQuiet();
  const current = await context(query);
  if (!current.sequence) throw new HostCommandError("NO_ACTIVE_SEQUENCE", "Open an active sequence before querying clips");
  const { entries, page } = await queryTimelineEntries(current.sequence, query);
  const items = [];
  if (query.effectTimeSeconds !== undefined && query.effectSampleTimeSeconds !== undefined) throw Error("Choose sequence effectTimeSeconds or native effectSampleTimeSeconds, not both");
  for (const entry of entries) {
    let components;
    let reacquireGraphic: (()=>Promise<typeof entry>) | undefined;
    if (query.includeEffects) {
      // Public speed=1 also describes a real native time-remapping ramp.
      // Discovery has no per-effect SDK proof, so never invent sequence times.
      const nativeOnly=entry.snapshot.mediaType==='video';
      if(nativeOnly&&query.effectTimeSeconds!==undefined)throw Error('EFFECT_TIME_MAPPING_REQUIRES_EXACT_EFFECT: use get_effect_values for SDK-verified video sequence-time sampling');
      const sample = query.effectTimeSeconds !== undefined ? ppro.TickTime.createWithTicks(effectTime(entry.snapshot as any, { timeSeconds: query.effectTimeSeconds }).nativeTicks)
        : query.effectSampleTimeSeconds !== undefined ? tickFromSeconds(query.effectSampleTimeSeconds) : ppro.TickTime.createWithTicks(text(entry.snapshot.inPoint?.ticks));
      // Audio editors also rebuild native children during effect/UI work. For
      // video, only an explicit empty source identity denotes a native graphic;
      // missing metadata must not opt ordinary media into the protected route.
      if(entry.snapshot.mediaType==='audio'||nativeOnly&&entry.snapshot.projectItemId===''){
        const expectedIdentity=graphicQueryIdentity(entry.snapshot),hint:TrackItemLookupHint={};
        reacquireGraphic=async()=>{
          await waitGraphicMutationQuiet();
          const freshContext=await context({expectedProjectId:current.identity.project.id,expectedSequenceId:current.identity.sequence.id});
          if(JSON.stringify(freshContext.identity)!==JSON.stringify(current.identity))throw new HostCommandError('CONTEXT_CHANGED','Project or sequence changed during effect inspection; obtain fresh context');
          const fresh=await findTrackItemEntry(freshContext.sequence,text(entry.snapshot.id),hint);
          if(graphicQueryIdentity(fresh.snapshot)!==expectedIdentity)throw new GraphicObjectUnavailableError('effect query target metadata changed; obtain fresh timeline metadata');
          return fresh;
        };
      }
      const snapshot=reacquireGraphic?await graphicComponentSnapshot(reacquireGraphic,false,sample):await componentSnapshot(entry.raw, false, false, sample);
      components = snapshot.map(c => ({ ...c, params: c.params.map((p: AnyRecord) => ({ ...p,
        sampledSequenceTime: nativeOnly?null:nativeToSequenceTime(entry.snapshot as any, p.sampledAt.ticks),
        keyframeDetails: p.keyframeDetails.map((k: AnyRecord) => ({ ...k, clipTime:k.time, timeBasis:"native_source", sequenceTime: nativeOnly?null:nativeToSequenceTime(entry.snapshot as any, k.time.ticks) })),
        timeMapping: nativeOnly?'native_only_use_get_effect_values':entry.snapshot.speed === 1 && entry.snapshot.reversed === false ? "source_to_sequence_1x" : "unsupported_retimed_or_reversed" })) }));
    }
    let source;
    if(query.includeSourceMetadata){
      const raw=reacquireGraphic?(await reacquireGraphic()).raw:entry.raw;
      source=await sourceMetadata(raw,current.sequence);
      if(reacquireGraphic)await reacquireGraphic();
    }
    items.push({ ...entry.snapshot, ...(query.includeSourceMetadata ? { sourceMetadata: source } : {}), ...(components ? { components } : {}) });
  }
  await assertStillCurrent(current);
  return { ...current.identity, capturedAt: new Date().toISOString(), items, page, editBoundary: editBoundary(current) };
}

export async function sourceMetadata(item: any, sequence: any): Promise<AnyRecord> {
  const source = await item.getProjectItem();
  if(!source) return {status:"unsupported",reason:"Timeline-native graphic has no project media source"};
  const clip = await ppro.ClipProjectItem.cast(source);
  if(!clip) return {status:"unsupported",reason:"Timeline-native graphic is not a media clip"};
  const interpretation = await clip.getFootageInterpretation();
  const settings = await sequence.getSettings();
  return { path: text(await clip.getMediaFilePath()), columns: await ppro.Metadata.getProjectColumnsMetadata(source),
    projectMetadata: await ppro.Metadata.getProjectMetadata(source),
    pixelAspectRatio: Number(interpretation.getPixelAspectRatio()), sequencePixelAspectRatio: text(await settings.getVideoPixelAspectRatio()) };
}

export async function queryMedia(query: ItemQuery & Pin = {}): Promise<AnyRecord> {
  const current = await context(query);
  if (!current.project) throw new HostCommandError("NO_ACTIVE_PROJECT", "Open a project before querying media");
  const result = await queryProjectItems(current.project, query);
  await assertStillCurrent(current);
  return { ...current.identity, capturedAt: new Date().toISOString(), ...result };
}
