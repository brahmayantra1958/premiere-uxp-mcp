import { activeProject, activeSequence, ppro, sequenceId } from "./host-context.js";
import { collectRuntimeSurface } from "./premiere-feature-routes.js";
import { text } from "./host-foundation.js";
import { readTrackTargeting } from "./host-track-targeting.js";

/** Bounded capability discovery only. Never invokes a discovered command or setter. */
export async function inspectTrackTargetingSurface() {
  const project = await activeProject();
  const sequence = await activeSequence(project);
  const objects: Record<string, unknown> = { sequence, editor: ppro.SequenceEditor.getEditor(sequence), selection: await sequence.getSelection() };
  if (await sequence.getVideoTrackCount()) objects.videoTrack = await sequence.getVideoTrack(0);
  if (await sequence.getAudioTrackCount()) objects.audioTrack = await sequence.getAudioTrack(0);
  const trackProperties: Record<string, unknown> = {};
  // These exact backend keys were observed in this project's saved track Node/
  // Properties, not guessed command IDs. Probe existence; never create a key.
  for (const name of ["videoTrack", "audioTrack"]) {
    try {
      const properties = await ppro.Properties.getProperties(objects[name]);
      trackProperties[name] = { surface: collectRuntimeSurface(properties), values: Object.fromEntries(
        ["MZ.TrackTargeted", "MZ.SourceTrackState", "MZ.SourceTrackNumber"].map(key => [key,
          properties.hasValue(key) ? { exists: true, value: properties.getValue(key) } : { exists: false }])) };
    } catch (error) { trackProperties[name] = { error: String(error) }; }
  }
  for (const name of ["SequenceUtils", "ProjectUtils", "Utils", "Properties", "AppPreference", "Application"]) {
    objects[name] = ppro[name]; objects[`${name}.prototype`] = ppro[name]?.prototype;
  }
  return { projectId: text(project.guid), sequenceId: await sequenceId(sequence), surfaces: Object.fromEntries(
    Object.entries(objects).map(([name, value]) => [name, collectRuntimeSurface(value)])), trackProperties, trackTargeting: await readTrackTargeting(sequence).catch(error => ({ error: String(error) })), mutationCalls: 0 };
}
