import { mutationContext, ppro, sequenceId } from "./host-context.js";
import { text, type AnyRecord } from "./host-foundation.js";
import { findTrackItemEntry, timelineSelectionSnapshot, visitTrackItems, mapTrackItemReads, type ItemEntry } from "./host-items.js";
import { sequenceSnapshot } from "./host-sequence.js";
import { componentSnapshot } from "./host-components.js";
import { HostCommandError } from "./bridge-client.js";
import { executeTrackRelocation, stableValue, type RelocationItem, type RelocationRequest, type RelocationState } from "./track-relocation.js";

type Dependencies = {
  execute(project: any, label: string, actions: () => any[]): boolean;
  select(sequence: any, entries: ItemEntry[]): Promise<any>;
  validateBefore?(state: RelocationState): void;
  verified?(state: RelocationState): void;
  // Batch preflight and EVERY step use the same set: strict reads include
  // timeVarying fields that cannot be compared with a non-strict projection.
  strictSourceIds?: string[];
  // Only the host-local wrapper sets this after mandatory source UI application.
  reuseAppliedSourceSelection?: boolean;
};

export async function relocationContext(args: AnyRecord) {
  const current = await mutationContext();
  if ((text(current.project.guid) || text(current.project.path) || text(current.project.name)) !== args.expectedProjectId ||
      await sequenceId(current.sequence) !== args.expectedSequenceId || text(current.sequence.name) !== args.expectedSequenceName) {
    throw new HostCommandError("RELOCATION_CONTEXT_CHANGED", "Exact relocation project/sequence changed");
  }
  return current;
}

export async function readRelocationState(args: AnyRecord, strictSourceIds: string[], parallel = true): Promise<RelocationState> {
  const start = performance.now();
  const { sequence } = await relocationContext(args);
  const contextMs = performance.now() - start;
  const traversalStart = performance.now();
  let componentsMs = 0;
  const effects: Record<string, unknown> = {};
  const entries: ItemEntry[] = [];
  // One traversal reads every item and every component. Repeated find-by-ID
  // scans were quadratic within each track. Do not cache native wrappers.
  const consume = async (entry: ItemEntry) => {
    const componentStart = performance.now();
    const components = await componentSnapshot(entry.raw, strictSourceIds.includes(entry.snapshot.projectItemId), parallel);
    componentsMs += performance.now() - componentStart;
    return { snapshot: entry.snapshot, components };
  };
  const capture = (value: { snapshot: AnyRecord; components: AnyRecord[] }) => {
    effects[value.snapshot.id] = value.components;
    entries.push({ raw: undefined, snapshot: value.snapshot });
  };
  if (parallel) for (const value of await mapTrackItemReads(sequence, consume)) capture(value);
  else await visitTrackItems(sequence, async entry => { capture(await consume(entry)); });
  const traversalMs = performance.now() - traversalStart;
  const metadataStart = performance.now();
  const snapshot = await sequenceSnapshot(sequence, entries);
  const metadataMs = performance.now() - metadataStart;
  if (snapshot.itemsTruncated) throw new HostCommandError("TIMELINE_READBACK_TRUNCATED", "Relocation requires a complete sequence");
  await relocationContext(args);
  return { sequence: snapshot, effects, readTimingsMs: { total: performance.now() - start, context: contextMs,
    traversalWall: traversalMs, componentService: componentsMs, ...(parallel ? {} : { items: traversalMs - componentsMs }), metadata: metadataMs } };
}

export async function moveClipToTrack(args: AnyRecord, dependencies: Dependencies) {
  const request = args.move as RelocationRequest;
  const context = () => relocationContext(args);
  const freshItem = async (sequence: any, expected: RelocationItem) => {
    const entry = await findTrackItemEntry(sequence, expected.id);
    if (stableValue(entry.snapshot) !== stableValue(expected)) throw new HostCommandError("RELOCATION_ITEM_CHANGED", "Clip changed before relocation action");
    return entry;
  };
  let firstRead = true;
  return executeTrackRelocation(request, {
    read: () => {
      // Individual operations get an independent sampled baseline. Batches
      // already hold one and validate their first fast read against it.
      const parallel = !firstRead || Boolean(dependencies.validateBefore);
      firstRead = false;
      return readRelocationState(args, dependencies.strictSourceIds ?? [request.expectedProjectItemId], parallel);
    },
    validateBefore: state => dependencies.validateBefore?.(state),
    verified: state => dependencies.verified?.(state),
    async clone(source, destinationTrackIndex) {
      const { project, sequence } = await context();
      const entry = await freshItem(sequence, source);
      const offset = destinationTrackIndex - source.trackIndex;
      // Resolve the editor in the locked action factory, AFTER fresh-item
      // asynchronous reads. No editor proxy crosses an await/collection read.
      const result = dependencies.execute(project, "Move clip to track: verified copy", () => [ppro.SequenceEditor.getEditor(sequence).createCloneTrackItemAction(
        entry.raw, ppro.TickTime.TIME_ZERO, source.mediaType === "video" ? offset : 0, source.mediaType === "audio" ? offset : 0, true, false,
      )]);
      if (!result) throw new HostCommandError("RELOCATION_CLONE_REJECTED", "Premiere rejected the relocation clone; inspect readback before retry");
    },
    async lift(item) {
      const { project, sequence } = await context();
      const entry = await freshItem(sequence, item);
      let selection;
      if (dependencies.reuseAppliedSourceSelection && await entry.raw.getIsSelected()) {
        const live = await sequence.getSelection();
        if ((await live.getTrackItems()).length === 1) selection = live;
      }
      // Source focus already applied the sole selected clip. Avoid broadcasting
      // the identical selection again; native clone changes/user changes fall
      // back to a fresh application. Full post-lift content proof still runs.
      if (!selection) selection = await dependencies.select(sequence, [await freshItem(sequence, item)]);
      const media = item.mediaType === "video" ? ppro.Constants.MediaType.VIDEO : ppro.Constants.MediaType.AUDIO;
      const result = dependencies.execute(project, "Move clip to track: lift verified source", () => [ppro.SequenceEditor.getEditor(sequence).createRemoveItemsAction(selection, false, media, true)]);
      if (!result) throw new HostCommandError("RELOCATION_LIFT_REJECTED", "Premiere rejected source lift; inspect readback before retry");
    },
    async select(item) {
      const { sequence } = await context();
      const entry = await freshItem(sequence, item);
      await dependencies.select(sequence, [entry]);
      const selected = await timelineSelectionSnapshot(sequence);
      if (selected.truncated || selected.itemIds.length !== 1 || selected.itemIds[0] !== item.id) throw new HostCommandError("RELOCATION_SELECTION_UNVERIFIED", "Moved clip selection readback failed");
    },
  });
}
