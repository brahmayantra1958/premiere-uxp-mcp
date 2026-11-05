import { describe, expect, it } from "vitest";
import {
  MAXIMUM_PREMIERE_TRANSCRIPT_JSON_BYTES,
  parsePremiereTranscript,
  parsePremiereTranscriptJson,
} from "../../apps/mcp-server/src/premiere-transcript.js";

const speakerId = "631fbbc0-9c02-47c4-bb8c-732c020fa24f";

function validSpeechText() {
  return {
    language: "ko-kr" as const,
    segments: [{
      duration: 1.25,
      language: "ko-kr" as const,
      speaker: speakerId,
      start: 2,
      words: [
        { confidence: 0.98, duration: 0.7, eos: false, start: 2, tags: [] as Array<"profanity" | "filler">, text: "안녕", type: "word" as const },
        { confidence: 1, duration: 0, eos: true, start: 2.7, tags: [] as Array<"profanity" | "filler">, text: ".", type: "punctuation" as const },
      ],
    }],
    speakers: [{ id: speakerId, name: "계백" }],
  };
}

describe("Premiere official speech-text document", () => {
  it("validates, canonicalizes, fingerprints, and summarizes Adobe's public JSON contract", () => {
    const document = parsePremiereTranscript(validSpeechText());

    expect(document.summary).toEqual({
      language: "ko-kr",
      segmentCount: 1,
      speakerCount: 1,
      wordCount: 2,
      durationSeconds: 3.25,
    });
    expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.sizeBytes).toBe(Buffer.byteLength(document.canonicalJson, "utf8"));
    expect(parsePremiereTranscriptJson(document.canonicalJson)).toEqual(document);
  });

  it("gives equivalent object-key orders one canonical identity while preserving array order", () => {
    const value = validSpeechText();
    const reordered = {
      speakers: value.speakers,
      segments: value.segments.map((segment) => ({ words: segment.words, start: segment.start, speaker: segment.speaker, language: segment.language, duration: segment.duration })),
      language: value.language,
    };

    expect(parsePremiereTranscript(reordered).sha256).toBe(parsePremiereTranscript(value).sha256);
  });

  it("rejects unknown fields, non-v4 speaker IDs, duplicates, and dangling speaker references", () => {
    expect(() => parsePremiereTranscript({ ...validSpeechText(), unsupported: true })).toThrow();
    expect(() => parsePremiereTranscript({
      ...validSpeechText(),
      speakers: [{ id: "631fbbc0-9c02-37c4-bb8c-732c020fa24f", name: "계백" }],
    })).toThrow(/UUID v4/);
    expect(() => parsePremiereTranscript({
      ...validSpeechText(),
      speakers: [validSpeechText().speakers[0], validSpeechText().speakers[0]],
    })).toThrow(/DUPLICATE_PREMIERE_SPEAKER_ID/);
    expect(() => parsePremiereTranscript({
      ...validSpeechText(),
      segments: [{ ...validSpeechText().segments[0], speaker: "11111111-1111-4111-8111-111111111111" }],
    })).toThrow(/UNKNOWN_PREMIERE_SEGMENT_SPEAKER/);
  });

  it("rejects documents that cannot fit safely inside the bounded bridge envelope", () => {
    const value = validSpeechText();
    value.segments[0].words[0].text = "가".repeat(MAXIMUM_PREMIERE_TRANSCRIPT_JSON_BYTES);
    expect(() => parsePremiereTranscript(value)).toThrow(/PREMIERE_SPEECH_TEXT_TOO_LARGE/);
  });
});
