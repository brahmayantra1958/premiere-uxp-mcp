/** Saved-sequence evidence, independent of archive I/O and host state.
 * Times are decimal Premiere ticks. ObjectID/indices locate serialized objects;
 * they are not persistent identities across saves. SHA-256 covers encoded bytes. */
export type ArchiveMediaType = 'video' | 'audio' | 'caption';

export type CaptionStyleSnapshot = {
  binaryHash: string;
  contentSha256?: string;
  fontPostScriptName: string;
  fontSize: number;
  byteLength: number;
};

export type CaptionCueBinarySnapshot = CaptionStyleSnapshot & {
  text: string;
  /** null means no stored override; the renderer's default is not inferred. */
  fillColor: {r:number;g:number;b:number}|null;
  /** Rooted style/document semantics excluding separately checked font/size/fill. */
  preservedStyleSha256: string;
};

export type CaptionCueSnapshot = CaptionCueBinarySnapshot & {
  index: number;
  itemObjectId: string;
  blockObjectId: string;
  startTicks: string;
  endTicks: string;
};

export type ArchiveTrackSnapshot = {
  mediaType: ArchiveMediaType;
  index: number;
  id: number;
  uid: string;
  name: string;
  itemCount: number;
  transitionCount: number;
  empty: boolean;
  style?: CaptionStyleSnapshot;
  captionCues?: CaptionCueSnapshot[];
};

export type SequenceArchiveSnapshot = {
  projectPath: string;
  sequenceName: string;
  sequenceUid: string;
  tracks: ArchiveTrackSnapshot[];
  trackCounts: Record<ArchiveMediaType, number>;
  totalItems: number;
};
