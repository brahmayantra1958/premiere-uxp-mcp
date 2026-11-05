import { ppro } from "./host-context.js";
import { HostCommandError } from "./bridge-client.js";
import type { WorkTrack } from "./work-target.js";
import { requestTrackTargeting } from "./track-targeting-client.js";

// Premiere 26.5 stores this exact native targeting bit on the track's Properties
// owner. Properties.getProperties accepts tracks in the live host despite the
// narrower .d.ts union. Only this exact observed native key may be written.
export const TRACK_TARGET_KEY = "MZ.TrackTargeted";
type TrackState = WorkTrack & { exists: boolean; targeted: boolean | null; value: number | null; name: string; muted: boolean; sourceState: string | null; sourceNumber: string | null };
type Entry = { properties: any; state: TrackState };

async function entries(sequence: any): Promise<Entry[]> {
  const result: Entry[] = [];
  for (const mediaType of ["video", "audio"] as const) {
    const count = Number(await sequence[mediaType === "video" ? "getVideoTrackCount" : "getAudioTrackCount"]());
    if (count > 64) throw Error("Track targeting exceeds the bounded track count");
    for (let trackIndex = 0; trackIndex < count; trackIndex++) {
      const track = await sequence[mediaType === "video" ? "getVideoTrack" : "getAudioTrack"](trackIndex);
      const properties = await ppro.Properties.getProperties(track);
      const exists = Boolean(properties.hasValue(TRACK_TARGET_KEY));
      const raw = exists ? String(properties.getValue(TRACK_TARGET_KEY)) : null;
      if (exists && raw !== "0" && raw !== "1") throw Error(`Unknown native targeting value: ${raw}`);
      const source = (key: string) => properties.hasValue(key) ? String(properties.getValue(key)) : null;
      result.push({ properties, state: { mediaType, trackIndex, exists, targeted: exists ? raw === "1" : null, value: exists ? Number(raw) : null, name: String(track.name), muted: Boolean(await track.isMuted()),
        sourceState: source("MZ.SourceTrackState"), sourceNumber: source("MZ.SourceTrackNumber") } });
    }
  }
  return result;
}
export async function readTrackTargeting(sequence: any) {
  return (await entries(sequence)).map(entry => entry.state);
}
function write(project: any, source: Entry[], desired: TrackState[]) {
  const changes = source.filter((entry, i) => entry.state.targeted !== desired[i]!.targeted);
  if (!changes.length) return;
  let accepted = false;
  project.lockedAccess(() => {
    const actions = changes.map(entry => {
      const state = desired.find(track => track.mediaType === entry.state.mediaType && track.trackIndex === entry.state.trackIndex)!;
      return state.exists ? entry.properties.createSetValueAction(TRACK_TARGET_KEY, state.targeted ? 1 : 0, ppro.Properties.PROPERTY_PERSISTENT)
        : entry.properties.createClearValueAction(TRACK_TARGET_KEY);
    });
    accepted = project.executeTransaction((compound: any) => actions.forEach(action => compound.addAction(action)), "Show AI working tracks");
  });
  if (!accepted) throw Error("Premiere rejected native track targeting transaction");
}

/** Approved CEP route; the visually rejected Properties writer below is never called. */
export async function targetWorkingTracks(project: any, sequence: any, tracks: WorkTrack[]) {
  return requestTrackTargeting(project, sequence, tracks);
}

/** Experimental backend-property writer. Not called by MCP commands: the user
 * proved that its successful property readback is NOT native button activation. */
export async function applyTrackTargetProperties(project: any, sequence: any, tracks: WorkTrack[]) {
  let before: Entry[];
  try { before = await entries(sequence); }
  catch (error) { return { status: "unsupported" as const, reason: String(error) }; }
  if (!tracks.length) return { status: "preserved" as const, route: "uxp_track_properties", after: before.map(entry => entry.state) };
  // Newly created tracks can omit the native bit. Absence is unknown, not proof
  // of false. Materialize 0/1 on every track; recovery restores absent keys.
  const desired = before.map(({ state }) => { const targeted = tracks.some(track => track.mediaType === state.mediaType && track.trackIndex === state.trackIndex); return { ...state, exists: true, targeted, value: targeted ? 1 : 0 }; });
  for (const track of tracks) if (track.mediaType !== "caption" && !desired.some(candidate => candidate.mediaType === track.mediaType && candidate.trackIndex === track.trackIndex)) {
    return { status: "unsupported" as const, reason: "Requested new track does not yet exist" };
  }
  try {
    write(project, before, desired);
    const after = await readTrackTargeting(sequence);
    if (JSON.stringify(after) !== JSON.stringify(desired)) throw Error("Native targeting/source-patching readback differs from request");
    return { status: tracks.some(track => track.mediaType === "caption") ? "unsupported" as const : "pass" as const,
      route: "uxp_track_properties", property: TRACK_TARGET_KEY, after, sourcePatchingPreserved: true,
      ...(tracks.some(track => track.mediaType === "caption") ? { reason: "Caption track targeting is not a V/A button" } : {}) };
  } catch (error) {
    let restored = false;
    try { write(project, await entries(sequence), before.map(entry => entry.state)); restored = JSON.stringify(await readTrackTargeting(sequence)) === JSON.stringify(before.map(entry => entry.state)); } catch { /* report unverified restoration */ }
    throw new HostCommandError("TRACK_TARGETING_UNVERIFIED", `${String(error)}; previous targeting restored: ${restored}`);
  }
}
