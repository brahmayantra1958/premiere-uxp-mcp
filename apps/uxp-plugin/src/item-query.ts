/** Pure query rules. Offset counts matching items, never host objects visited. */
export type ItemQuery = {
  offset?: number; limit?: number; ids?: string[]; nameContains?: string; binId?:string; cursor?:string;
  mediaType?: "video" | "audio"; trackIndex?: number; selectedOnly?: boolean;
  startSeconds?: number; endSeconds?: number; includeEffects?: boolean; effectSampleTimeSeconds?: number; effectTimeSeconds?: number; includeSourceMetadata?: boolean;
};

export function queryBounds(query: ItemQuery): { offset: number; limit: number } {
  const offset = query.offset ?? 0, limit = query.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > (query.includeEffects || query.includeSourceMetadata ? 20 : 100)) {
    throw new Error("INVALID_QUERY: offset must be a nonnegative safe integer and limit 1..100 (effects/source metadata: 20); continue with page.nextOffset or query_media page.nextCursor");
  }
  return { offset, limit };
}

export function matchesName(name: string, contains?: string): boolean {
  return contains === undefined || name.toLocaleLowerCase().includes(contains.toLocaleLowerCase());
}

/** Half-open overlap excludes clips ending at the start or starting at the end. */
export function overlapsRange(start: number, end: number, query: ItemQuery): boolean {
  // Compare Premiere's integer clock. Adding decimal start + duration can
  // land a few picoseconds past a shared cut and falsely occupy [start,end).
  const tick=(seconds:number)=>BigInt(Math.round(seconds*254016000000));
  return (query.startSeconds === undefined || tick(end) > tick(query.startSeconds))
    && (query.endSeconds === undefined || tick(start) < tick(query.endSeconds));
}

export function parseTimelineId(id: string): { mediaType: "video" | "audio"; trackIndex: number; ticks: string; projectItemId: string } | null {
  // Timeline-native graphics have no project media item. Their empty source
  // field is real, not a malformed ID; edits also require the observed clip name.
  const match = /^(video|audio):(\d+):(\d+):(.*)$/.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return { mediaType: match[1] as "video" | "audio", trackIndex: Number(match[2]), ticks: match[3]!, projectItemId: match[4]! };
}
