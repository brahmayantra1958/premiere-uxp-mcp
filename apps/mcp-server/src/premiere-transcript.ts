import { createHash } from "node:crypto";
import { z } from "zod/v4";

export const PREMIERE_TRANSCRIPT_LANGUAGE_CODES = [
  "en-us", "en-gb", "zh-hk", "cmn-hans", "cmn-hant", "es-es", "de-de",
  "fr-fr", "ja-jp", "pt-pt", "pt-br", "ko-kr", "it-it", "ru-ru", "hi-in",
  "nb-no", "sv-se", "nl-nl", "da-dk", "id-id", "th-th", "vi-vn", "ms-my",
  "tr-tr", "pl-pl", "fil-ph", "te-in", "ml-in", "pa-in", "??-??",
] as const;

/**
 * The bridge accepts 8 MiB frames. A 1 MiB inner document leaves room for the
 * request envelope and worst-case JSON string escaping in both directions.
 */
export const MAXIMUM_PREMIERE_TRANSCRIPT_JSON_BYTES = 1024 * 1024;

const languageCode = z.enum(PREMIERE_TRANSCRIPT_LANGUAGE_CODES);
const speakerId = z.string().uuid().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  "Premiere transcript speaker IDs must be UUID v4 values",
);

const wordSchema = z.object({
  confidence: z.number().finite().min(0).max(1),
  duration: z.number().finite().nonnegative(),
  eos: z.boolean(),
  start: z.number().finite().nonnegative(),
  tags: z.array(z.enum(["profanity", "filler"])),
  text: z.string(),
  type: z.enum(["word", "punctuation"]),
}).strict();

const segmentSchema = z.object({
  duration: z.number().finite().nonnegative(),
  language: languageCode,
  speaker: speakerId,
  start: z.number().finite().nonnegative(),
  words: z.array(wordSchema).min(1),
}).strict();

const speakerSchema = z.object({
  id: speakerId,
  name: z.string().min(1),
}).strict();

export const premiereTranscriptSchema = z.object({
  language: languageCode,
  segments: z.array(segmentSchema).min(1),
  speakers: z.array(speakerSchema).min(1),
}).strict();

export type PremiereTranscript = z.infer<typeof premiereTranscriptSchema>;

export type PremiereTranscriptDocument = {
  transcript: PremiereTranscript;
  canonicalJson: string;
  sha256: string;
  sizeBytes: number;
  summary: {
    language: PremiereTranscript["language"];
    segmentCount: number;
    speakerCount: number;
    wordCount: number;
    durationSeconds: number;
  };
};

function assertBoundedJson(json: string): number {
  const sizeBytes = Buffer.byteLength(json, "utf8");
  if (sizeBytes > MAXIMUM_PREMIERE_TRANSCRIPT_JSON_BYTES) {
    throw new Error(`PREMIERE_SPEECH_TEXT_TOO_LARGE: ${sizeBytes} bytes exceeds ${MAXIMUM_PREMIERE_TRANSCRIPT_JSON_BYTES}`);
  }
  return sizeBytes;
}

function assertSpeakerReferences(transcript: PremiereTranscript): void {
  const speakerIds = new Set<string>();
  for (const speaker of transcript.speakers) {
    if (speakerIds.has(speaker.id)) throw new Error(`DUPLICATE_PREMIERE_SPEAKER_ID: ${speaker.id}`);
    speakerIds.add(speaker.id);
  }
  for (const segment of transcript.segments) {
    if (!speakerIds.has(segment.speaker)) {
      throw new Error(`UNKNOWN_PREMIERE_SEGMENT_SPEAKER: ${segment.speaker}`);
    }
  }
}

function documentFromTranscript(transcript: PremiereTranscript): PremiereTranscriptDocument {
  assertSpeakerReferences(transcript);
  // Zod emits object keys in schema order, giving semantically equivalent input
  // objects one stable representation without changing array order.
  const canonicalJson = JSON.stringify(transcript);
  const sizeBytes = assertBoundedJson(canonicalJson);
  return {
    transcript,
    canonicalJson,
    sha256: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
    sizeBytes,
    summary: {
      language: transcript.language,
      segmentCount: transcript.segments.length,
      speakerCount: transcript.speakers.length,
      wordCount: transcript.segments.reduce((total, segment) => total + segment.words.length, 0),
      durationSeconds: transcript.segments.reduce((end, segment) => Math.max(end, segment.start + segment.duration), 0),
    },
  };
}

export function parsePremiereTranscript(value: unknown): PremiereTranscriptDocument {
  let rawJson: string;
  try { rawJson = JSON.stringify(value); }
  catch (error) { throw new Error(`INVALID_PREMIERE_SPEECH_TEXT_JSON: ${error instanceof Error ? error.message : String(error)}`); }
  assertBoundedJson(rawJson);
  return documentFromTranscript(premiereTranscriptSchema.parse(value));
}

export function parsePremiereTranscriptJson(json: string): PremiereTranscriptDocument {
  assertBoundedJson(json);
  let value: unknown;
  try { value = JSON.parse(json); }
  catch (error) { throw new Error(`INVALID_PREMIERE_SPEECH_TEXT_JSON: ${error instanceof Error ? error.message : String(error)}`); }
  return documentFromTranscript(premiereTranscriptSchema.parse(value));
}
