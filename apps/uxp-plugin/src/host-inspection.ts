import { text, asTickTime, PROJECT_ITEM_LIMIT, TRACK_ITEM_LIMIT, type AnyRecord } from "./host-foundation.js";
import { ppro, sequenceId, activeProject, activeSequence } from "./host-context.js";
import { projectItems, trackItems } from "./host-items.js";
import { sequenceSnapshot } from "./host-sequence.js";
import { inspectEffects } from "./host-components.js";

export async function inspectProject(): Promise<AnyRecord> {
  const project = await activeProject();
  const active = await project.getActiveSequence();
  const sequences = await project.getSequences();
  const items = await projectItems(project);
  const itemSnapshots = items.map((item) => item.snapshot);
  // Share handles only within this request; never cache across project changes.
  const entries = active ? await trackItems(active) : [];
  const activeSnapshot = active ? await sequenceSnapshot(active, entries) : null;
  const markers = active ? await inspectMarkers(active) : [];
  const effects = active ? await inspectEffects(entries) : [];
  const mogrtItems = effects.filter((item) => item.components.some((component: AnyRecord) => {
    const label = `${text(component.displayName)} ${text(component.matchName)}`.toLocaleLowerCase("en-US");
    return label.includes("graphic") || label.includes("mogrt") || label.includes("essential");
  }));
  return {
    projectId: text(project.guid),
    projectName: text(project.name),
    projectPath: text(project.path),
    capturedAt: new Date().toISOString(),
    activeSequence: activeSnapshot,
    sequences: await Promise.all(sequences.map(async (sequence: any) => ({ id: await sequenceId(sequence), name: text(sequence.name) }))),
    projectItems: itemSnapshots,
    projectItemLimit: PROJECT_ITEM_LIMIT,
    projectItemsTruncated: itemSnapshots.length >= PROJECT_ITEM_LIMIT,
    offlineMediaIds: itemSnapshots.filter((item) => item.offline).map((item) => item.id),
    proxyAttachments: itemSnapshots.filter((item) => item.hasProxy && item.proxyPath).map((item) => ({ projectItemId: item.id, proxyPath: item.proxyPath })),
    markers,
    mogrtItems,
    effects,
    audioState: effects.filter((item) => item.mediaType === "audio"),
    unsupportedFields: [
      { field: "trackItem.linkState", reason: "Premiere 26.3 public UXP DOM exposes no linked-item relationship getter" },
      ...(itemSnapshots.length >= PROJECT_ITEM_LIMIT ? [{ field: "projectItems", reason: `Snapshot reached the safety limit of ${PROJECT_ITEM_LIMIT} items` }] : []),
      ...(activeSnapshot?.itemsTruncated ? [{ field: "activeSequence.items", reason: `Snapshot reached the safety limit of ${TRACK_ITEM_LIMIT} track items` }] : []),
    ],
  };
}

export async function inspectMarkers(target?: any): Promise<AnyRecord[]> {
  const sequence = target ?? await activeSequence();
  const owner = await ppro.Markers.getMarkers(sequence);
  const markers = await Promise.resolve(owner.getMarkers());
  return markers.map((marker: any) => ({
    id: text(marker.guid),
    name: text(marker.getName()),
    comments: text(marker.getComments()),
    type: text(marker.getType()),
    start: asTickTime(marker.getStart()),
    duration: asTickTime(marker.getDuration()),
    colorIndex: Number(marker.getColorIndex()),
  }));
}
