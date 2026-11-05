import { HostCommandError } from "./bridge-client.js";
import { text, asTickTime, PROJECT_ITEM_LIMIT, TRACK_ITEM_LIMIT, type AnyRecord } from "./host-foundation.js";
import { ppro, assertMethod, itemId, sequenceId, activeProject, activeSequence } from "./host-context.js";
import { matchesName, overlapsRange, parseTimelineId, queryBounds, type ItemQuery } from "./item-query.js";
import { boundedRead } from "./bounded-read.js";
import { readNativeObject } from "./native-object-read.js";

export type ItemEntry = { raw: any; parentRaw?: any; snapshot: AnyRecord; pathSegments?: string[] };
type ProjectRef = { raw: any; parentRaw: any; parentId: string; id: string; folder?: any; pathSegments: string[] };
type TimelineRef = { raw: any; mediaType: "video" | "audio"; trackIndex: number };

/** Request-local traversal: enumerate identity first; hydrate only returned targets. */
async function* projectRefs(project: any, limit = PROJECT_ITEM_LIMIT): AsyncGenerator<ProjectRef> {
  const root = await project.getRootItem();
  const seen = new Set<string>();
  let visited = 0;
  const visit = async function* (raw: any, parentRaw: any, parentId: string, parents: string[]): AsyncGenerator<ProjectRef> {
    if (!raw || visited >= limit) return;
    visited++;
    const id = await itemId(raw);
    if (seen.has(id)) throw new HostCommandError('PROJECT_TREE_IDENTITY_AMBIGUOUS', 'Repeated project item ID; traversal stopped without claiming completeness');
    seen.add(id);
    let folder: any;
    try { folder = await ppro.FolderItem.cast(raw); } catch { /* not a folder */ }
    const pathSegments = [...parents, text(raw.name)];
    yield { raw, parentRaw, parentId, id, folder, pathSegments };
    if (folder && typeof folder.getItems === "function") {
      for (const child of await folder.getItems()) {
        if (visited >= limit) break;
        yield* visit(child, folder, id, pathSegments);
      }
    }
  };
  const rootId = await itemId(root);
  for (const child of await root.getItems()) {
    if (visited >= limit) break;
    yield* visit(child, root, rootId, []);
  }
}

async function projectEntry(ref: ProjectRef): Promise<ItemEntry> {
  const { raw, parentRaw, parentId, id, folder } = ref;
  const snapshot: AnyRecord = { id, name: text(raw.name), kind: "unknown", parentId };
  try { snapshot.colorLabelIndex = Number(await raw.getColorLabelIndex?.()); } catch { /* unsupported */ }
  if (folder && typeof folder.getItems === "function") snapshot.kind = "folder";
  else {
    let clip: any;
    try { clip = await ppro.ClipProjectItem.cast(raw); } catch { /* not a clip */ }
    if (clip) {
      snapshot.kind = await clip.isSequence?.() ? "sequence" : "clip";
      try { snapshot.path = text(await clip.getMediaFilePath?.()); } catch { /* no linked file */ }
      try { snapshot.offline = Boolean(await clip.isOffline?.()); } catch { /* unsupported */ }
      try { snapshot.hasProxy = Boolean(await clip.hasProxy?.()); } catch { /* unsupported */ }
      if (snapshot.hasProxy) {
        try { snapshot.proxyPath = text(await clip.getProxyPath?.()); } catch { /* unsupported */ }
      }
    }
  }
  return { raw, parentRaw, snapshot, pathSegments: ref.pathSegments };
}

export async function projectItems(project: any, limit = PROJECT_ITEM_LIMIT): Promise<ItemEntry[]> {
  const items: ItemEntry[] = [];
  for await (const ref of projectRefs(project, limit)) items.push(await projectEntry(ref));
  return items;
}

export async function findProjectItemEntry(project: any, id: string): Promise<ItemEntry> {
  for await (const ref of projectRefs(project, Infinity)) if (ref.id === id) return projectEntry(ref);
  throw new HostCommandError("PROJECT_ITEM_NOT_FOUND", "Project item ID not found in the current project: " + id + '; refresh query_media with expectedProjectId and ids; no name fallback');
}

export async function findProjectItem(project: any, id: string): Promise<any> {
  return (await findProjectItemEntry(project, id)).raw;
}

async function* timelineRefCollections(sequence: any, query: ItemQuery = {}): AsyncGenerator<TimelineRef[]> {
  let visited = 0;
  for (const mediaType of ["video", "audio"] as const) {
    if (query.mediaType && query.mediaType !== mediaType) continue;
    const count = Number(await (mediaType === "video" ? sequence.getVideoTrackCount() : sequence.getAudioTrackCount()));
    for (let trackIndex = 0; trackIndex < count; trackIndex++) {
      if (query.trackIndex !== undefined && query.trackIndex !== trackIndex) continue;
      if (visited >= TRACK_ITEM_LIMIT) return;
      const acquire = async () => {
        const track = await (mediaType === "video" ? sequence.getVideoTrack(trackIndex) : sequence.getAudioTrack(trackIndex));
        return track ? await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false) : null;
      };
      // Effect Controls reconstruction can briefly return null clip wrappers.
      // Reacquire this read-only collection once, before yielding any consumer.
      // Never omit missing clips or replay a consumer/mutation to hide the gap.
      let collection = await acquire();
      const complete = (value: any): value is any[] => Array.isArray(value) && value.every(item => item != null);
      if (!complete(collection)) collection = await acquire();
      if (!complete(collection)) throw new HostCommandError("TIMELINE_COLLECTION_UNVERIFIED", "Premiere returned an incomplete clip collection after read-only reacquisition");
      const items = collection.slice(0, TRACK_ITEM_LIMIT - visited);
      visited += items.length;
      yield items.map((raw: any) => ({ raw, mediaType, trackIndex }));
    }
  }
}

async function* timelineRefs(sequence: any, query: ItemQuery = {}): AsyncGenerator<TimelineRef> {
  for await (const collection of timelineRefCollections(sequence, query)) yield* collection;
}

async function timelineIdentity(ref: TimelineRef): Promise<AnyRecord> {
  const projectItem = await ref.raw.getProjectItem?.();
  const projectItemId = projectItem ? await itemId(projectItem) : "";
  const start = asTickTime(await ref.raw.getStartTime());
  return {
    id: [ref.mediaType, ref.trackIndex, start.ticks, projectItemId].join(":"),
    name: text(await ref.raw.getName?.()) || text(projectItem?.name),
    mediaType: ref.mediaType, trackIndex: ref.trackIndex, start,
    end: asTickTime(await ref.raw.getEndTime()), projectItemId,
  };
}

async function timelineEntry(ref: TimelineRef, identity?: AnyRecord): Promise<ItemEntry> {
  const snapshot = identity ?? await timelineIdentity(ref);
  const item = ref.raw;
  try { snapshot.inPoint = asTickTime(await item.getInPoint()); } catch { /* unsupported */ }
  try { snapshot.outPoint = asTickTime(await item.getOutPoint()); } catch { /* unsupported */ }
  try { snapshot.disabled = Boolean(await item.isDisabled()); } catch { /* unsupported */ }
  try { snapshot.speed = Number(await item.getSpeed()); } catch { /* unsupported */ }
  try { snapshot.reversed = Boolean(await item.isSpeedReversed()); } catch { /* unsupported */ }
  try { snapshot.adjustmentLayer = Boolean(await item.isAdjustmentLayer()); } catch { /* unsupported */ }
  return { raw: item, snapshot };
}

export async function trackItems(sequence: any): Promise<ItemEntry[]> {
  const items: ItemEntry[] = [];
  for await (const ref of timelineRefs(sequence)) items.push(await timelineEntry(ref));
  return items;
}

/** Consume a wrapper before advancing the traversal. Callers must retain plain
 * snapshots only; a later traversal/transaction can invalidate native objects. */
export async function visitTrackItems(sequence: any, consume: (entry: ItemEntry) => Promise<void>, _parallel = false): Promise<void> {
  void _parallel;
  for await (const ref of timelineRefs(sequence)) await consume(await timelineEntry(ref));
}

/** Finish ONE item's component/value reads before acquiring the next item's
 * native component chain. A short concurrent parity probe passed, but a repeated
 * full run invalidated a native wrapper. Never overlap item consumers.
 * Consumers return plain data, never native wrappers. */
export async function mapTrackItemReads<R>(sequence: any, consume: (entry: ItemEntry) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for await (const collection of timelineRefCollections(sequence)) {
    for (const ref of collection) results.push(await consume(await timelineEntry(ref)));
  }
  return results;
}

/** Command-local numeric search hint only; never retain a collection, native
 * wrapper, identity or value. Even a hit reacquires the collection and reads the
 * complete current identity and metadata. A stale slot falls back to the scan. */
export type TrackItemLookupHint = { id?: string; index?: number };
export async function findTrackItemEntry(sequence: any, id: string, hint?: TrackItemLookupHint): Promise<ItemEntry> {
  const identity = parseTimelineId(id);
  if (identity) for await (const collection of timelineRefCollections(sequence, identity)) {
    if (hint?.id === id && Number.isInteger(hint.index) && hint.index! >= 0 && hint.index! < collection.length) {
      const ref = collection[hint.index!]!;
      const snapshot = await timelineIdentity(ref);
      if (snapshot.id === id) return timelineEntry(ref, snapshot);
    }
    for (let offset = 0; offset < collection.length; offset += 8) {
      const window = collection.slice(offset, offset + 8);
      const starts = await boundedRead(window, ref => readNativeObject(async () => asTickTime(await ref.raw.getStartTime()).ticks), 1);
      // Drain all candidate reads before hydrating/returning a native wrapper.
      for (let index = 0; index < window.length; index++) {
        if (starts[index] !== identity.ticks) continue;
        const ref = window[index]!;
        const snapshot = await timelineIdentity(ref);
        if (snapshot.id === id) {
          if (hint) { hint.id = id; hint.index = offset + index; }
          return timelineEntry(ref, snapshot);
        }
      }
    }
  }
  throw new HostCommandError("TRACK_ITEM_NOT_FOUND", "Track item not found: " + id);
}

/** One validated collection owns all returned wrappers. Read metadata serially,
 * then consume them in one immediate synchronous transaction; do not acquire a
 * second collection or any component handles before consuming these sources.
 * A null-collection retry occurs only before any wrapper is read or retained. */
export async function findTrackItemEntriesFromOneTrack(sequence: any, ids: readonly string[]): Promise<ItemEntry[]> {
  const identities = ids.map(parseTimelineId), scope = identities[0];
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || !scope
    || identities.some(identity => !identity || identity.mediaType !== scope.mediaType || identity.trackIndex !== scope.trackIndex)) {
    throw new HostCommandError('TRACK_ITEM_BATCH_SCOPE_INVALID', 'Batch source IDs must be unique, exact and belong to one media type/track (1..100 sources)');
  }
  const requested = new Set(ids), starts = new Set(identities.map(identity => identity!.ticks));
  for await (const collection of timelineRefCollections(sequence, scope)) {
    if (collection.length >= TRACK_ITEM_LIMIT) throw new HostCommandError('TIMELINE_COLLECTION_UNVERIFIED', 'Batch source collection may be truncated');
    const found = new Map<string, ItemEntry>();
    for (const ref of collection) {
      const start = await readNativeObject(async () => asTickTime(await ref.raw.getStartTime()).ticks);
      if (!starts.has(start)) continue;
      const identity = await timelineIdentity(ref);
      if (!requested.has(identity.id)) continue;
      if (found.has(identity.id)) throw new HostCommandError('TRACK_ITEM_IDENTITY_AMBIGUOUS', 'More than one native track item matches a requested batch source ID');
      const entry = await timelineEntry(ref, identity), snapshot = entry.snapshot;
      const clocks = ['start', 'end', 'inPoint', 'outPoint'];
      if (!clocks.every(key => /^-?\d+$/.test(text(snapshot[key]?.ticks)) && Number.isFinite(snapshot[key]?.seconds))
        || snapshot.end.seconds <= snapshot.start.seconds || snapshot.outPoint.seconds <= snapshot.inPoint.seconds
        || !['disabled', 'reversed', 'adjustmentLayer'].every(key => typeof snapshot[key] === 'boolean') || !Number.isFinite(snapshot.speed)) {
        throw new HostCommandError('TRACK_ITEM_METADATA_UNVERIFIED', 'Batch source timing and playback metadata must be completely readable');
      }
      found.set(identity.id, entry);
    }
    if (found.size !== ids.length) throw new HostCommandError('TRACK_ITEM_NOT_FOUND', 'One or more exact batch source IDs are missing from their current track; no source was substituted');
    return ids.map(id => found.get(id)!);
  }
  throw new HostCommandError('TRACK_ITEM_NOT_FOUND', 'The exact batch source track is unavailable');
}

export async function findTrackItem(sequence: any, id: string): Promise<any> {
  return (await findTrackItemEntry(sequence, id)).raw;
}

export async function timelineSelectionSnapshot(sequence: any): Promise<AnyRecord> {
  const selected: AnyRecord[] = [];
  let scannedItemCount = 0;
  for await (const collection of timelineRefCollections(sequence)) {
    const flags = await boundedRead(collection, async ref => {
      assertMethod(ref.raw, "getIsSelected", "TrackItem.getIsSelected");
      return Boolean(await ref.raw.getIsSelected());
    }, 1);
    scannedItemCount += collection.length;
    for (let index = 0; index < collection.length; index++) {
      if (flags[index]) selected.push((await timelineEntry(collection[index]!)).snapshot);
    }
  }
  return { items: selected, itemIds: selected.map(item => text(item.id)), scannedItemCount, truncated: scannedItemCount >= TRACK_ITEM_LIMIT };
}

export async function inspectTimelineSelection(): Promise<AnyRecord> {
  const project = await activeProject();
  const sequence = await activeSequence(project);
  return {
    status: "pass",
    project: { id: text(project.guid) || text(project.path) || text(project.name), name: text(project.name), path: text(project.path) },
    sequence: { id: await sequenceId(sequence), name: text(sequence.name) },
    selection: await timelineSelectionSnapshot(sequence), errors: [],
  };
}

export async function queryTimelineEntries(sequence: any, query: ItemQuery = {}): Promise<{ entries: ItemEntry[]; page: AnyRecord }> {
  const { offset, limit } = queryBounds(query);
  const ids = query.ids ? new Set(query.ids) : undefined;
  const entries: ItemEntry[] = [];
  let scanned = 0, matched = 0, hasMore = false;
  for await (const ref of timelineRefs(sequence, query)) {
    scanned++;
    if (query.selectedOnly) {
      assertMethod(ref.raw, "getIsSelected", "TrackItem.getIsSelected");
      if (!await ref.raw.getIsSelected()) continue;
    }
    const snapshot = await timelineIdentity(ref);
    if ((ids && !ids.has(snapshot.id)) || !matchesName(snapshot.name, query.nameContains)
      || !overlapsRange(snapshot.start.seconds, snapshot.end.seconds, query)) continue;
    if (matched++ < offset) continue;
    if (entries.length === limit) { hasMore = true; break; }
    entries.push(await timelineEntry(ref, snapshot));
  }
  return { entries, page: { offset, limit, returned: entries.length, hasMore, nextOffset: hasMore ? offset + entries.length : null,
    scannedItemCount: scanned, scanTruncated: !hasMore && scanned >= TRACK_ITEM_LIMIT } };
}

export async function queryProjectItems(project: any, query: ItemQuery = {}): Promise<AnyRecord> {
  const scope = JSON.stringify([text(project.guid), query.ids ?? null, query.nameContains ?? null, query.binId ?? null]);
  let continuation: {offset:number; afterId:string; scope:string}|undefined;
  if(query.cursor) {
    try { continuation=JSON.parse(query.cursor); } catch { throw Error('INVALID_MEDIA_CURSOR: use page.nextCursor unchanged'); }
    if(!continuation || continuation.scope!==scope || typeof continuation.afterId!=='string' || !Number.isSafeInteger(continuation.offset) || continuation.offset<1)
      throw Error('INVALID_MEDIA_CURSOR: project/filter changed; restart the query without a cursor');
    if(query.offset)throw Error('INVALID_MEDIA_CURSOR: use cursor or offset, not both');
  }
  const { offset, limit } = queryBounds({...query,offset:continuation?.offset??query.offset??0});
  const ids = query.ids ? new Set(query.ids) : undefined;
  const items: AnyRecord[] = [];
  let scanned = 0, matched = 0, hasMore = false;
  for await (const ref of projectRefs(project, Infinity)) {
    scanned++;
    if ((ids && !ids.has(ref.id)) || (query.binId && ref.parentId!==query.binId) || !matchesName(text(ref.raw.name), query.nameContains)) continue;
    if(continuation && matched===offset-1 && ref.id!==continuation.afterId)throw Error('MEDIA_CURSOR_STALE: project changed; restart pagination after edits');
    if (matched++ < offset) continue;
    if (items.length === limit) { hasMore = true; break; }
    items.push((await projectEntry(ref)).snapshot);
  }
  if(continuation && matched<offset)throw Error('MEDIA_CURSOR_STALE: project changed; restart pagination after edits');
  return { items, page: { offset, limit, returned: items.length, hasMore, nextOffset: hasMore ? offset + items.length : null,
    nextCursor:hasMore?JSON.stringify({offset:offset+items.length,afterId:items.at(-1)!.id,scope}):null,
    scannedItemCount: scanned, scanTruncated: false } };
}
