import { text, asTickTime, durationBetween, TRACK_ITEM_LIMIT, type AnyRecord } from "./host-foundation.js";
import { ppro, sequenceId, activeProject, activeSequence, mutationContext } from "./host-context.js";
import { trackItems, type ItemEntry } from "./host-items.js";

export async function timelineTracks(sequence: any): Promise<AnyRecord[]> {
  const tracks: AnyRecord[] = [];
  const verifiedTransitionCount = async (track: any): Promise<number> => {
    let count = 0;
    try {
      const items = await Promise.resolve(track.getTrackItems(ppro.Constants.TrackItemType.TRANSITION, true));
      for (const item of items ?? []) {
        try {
          await item.getStartTime();
          await item.getEndTime();
          count += 1;
        } catch { /* Premiere may return one unusable transition sentinel for a track with no transitions. */ }
      }
    } catch { /* unsupported */ }
    return count;
  };
  const collect = async (mediaType: "video" | "audio", count: number, getter: (index: number) => Promise<any>) => {
    for (let index = 0; index < count; index += 1) {
      const track = await getter(index);
      let muted = false;
      let itemCount = 0;
      let transitionCount = 0;
      try { muted = Boolean(await track.isMuted()); } catch { /* unsupported */ }
      try { itemCount = Number((await Promise.resolve(track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)))?.length ?? 0); } catch { /* unsupported */ }
      transitionCount = await verifiedTransitionCount(track);
      tracks.push({ mediaType, index, id: Number(track.id), name: text(track.name), muted, itemCount, transitionCount });
    }
  };
  await collect("video", Number(await sequence.getVideoTrackCount()), (index) => sequence.getVideoTrack(index));
  await collect("audio", Number(await sequence.getAudioTrackCount()), (index) => sequence.getAudioTrack(index));
  return tracks;
}

export async function captionTrackStates(sequence: any): Promise<AnyRecord[]> {
  const tracks: AnyRecord[] = [];
  const count = Number(await sequence.getCaptionTrackCount());
  for (let index = 0; index < count; index += 1) {
    const track = await sequence.getCaptionTrack(index);
    let muted = false;
    let itemCount: number | undefined;
    try { muted = Boolean(await track.isMuted()); } catch { /* unsupported */ }
    try { itemCount = Number((await Promise.resolve(track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)))?.length ?? 0); } catch { /* unsupported */ }
    tracks.push({ index, id: Number(track.id), name: text(track.name), muted, ...(itemCount === undefined ? {} : { itemCount }), transitionCount: 0 });
  }
  return tracks;
}

export async function transitionItems(sequence: any): Promise<AnyRecord[]> {
  const transitions: AnyRecord[] = [];
  const count = Number(await sequence.getVideoTrackCount());
  for (let trackIndex = 0; trackIndex < count; trackIndex += 1) {
    const track = await sequence.getVideoTrack(trackIndex);
    const items = await Promise.resolve(track.getTrackItems(ppro.Constants.TrackItemType.TRANSITION, true));
    for (const item of items) {
      try {
        const start = asTickTime(await item.getStartTime());
        const end = asTickTime(await item.getEndTime());
        const matchName = text(await item.getMatchName?.());
        const name = text(await item.getName?.()) || matchName;
        transitions.push({
          id: `transition:${trackIndex}:${start.ticks}:${matchName || name}`,
          name,
          matchName,
          trackIndex,
          start,
          end,
          duration: durationBetween(start, end),
        });
      } catch { /* A transition wrapper without timing readback is not proof. */ }
    }
  }
  return transitions;
}

export async function sequenceSnapshot(sequence: any, entries?: ItemEntry[]): Promise<AnyRecord> {
  const settings = await sequence.getSettings();
  const rect = await settings.getVideoFrameRect();
  const rate = await settings.getVideoFrameRate();
  let duration: AnyRecord | undefined;
  try { duration = asTickTime(await sequence.getEndTime()); } catch { /* empty sequence */ }
  const items = (entries ?? await trackItems(sequence)).map((item) => item.snapshot);
  const tracks = await timelineTracks(sequence);
  const captionTrackState = await captionTrackStates(sequence);
  const transitions = await transitionItems(sequence);
  return {
    id: await sequenceId(sequence),
    name: text(sequence.name),
    width: Number(rect?.width),
    height: Number(rect?.height),
    frameRate: Number(rate?.value),
    duration,
    videoTracks: Number(await sequence.getVideoTrackCount()),
    audioTracks: Number(await sequence.getAudioTrackCount()),
    captionTracks: Number(await sequence.getCaptionTrackCount()),
    captionTrackStates: captionTrackState,
    itemLimit: TRACK_ITEM_LIMIT,
    itemsTruncated: items.length >= TRACK_ITEM_LIMIT,
    items,
    tracks,
    transitions,
  };
}

export async function freshActiveSequenceSnapshot(): Promise<AnyRecord> {
  const project = await activeProject();
  return sequenceSnapshot(await activeSequence(project));
}

/** Content readback belongs to the pinned sequence, not the user's active tab. */
export async function targetSequenceSnapshot(args:AnyRecord):Promise<AnyRecord>{
  return sequenceSnapshot((await mutationContext(args)).sequence);
}

export function sequenceContentSignature(snapshot: AnyRecord): string {
  return JSON.stringify({
    width: snapshot.width,
    height: snapshot.height,
    frameRate: snapshot.frameRate,
    videoTracks: snapshot.videoTracks,
    audioTracks: snapshot.audioTracks,
    captionTracks: snapshot.captionTracks,
    items: (snapshot.items ?? []).map((item: AnyRecord) => ({
      name: item.name,
      mediaType: item.mediaType,
      trackIndex: item.trackIndex,
      start: item.start,
      end: item.end,
      inPoint: item.inPoint,
      outPoint: item.outPoint,
      disabled: item.disabled,
      projectItemId: item.projectItemId,
    })),
  });
}
