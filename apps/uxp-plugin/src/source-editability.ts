/** File-relative source ticks, independent of sequence time and media timecode. */
export type SourceMapping = { originalPath: string; originalStartSeconds: number; originalEndSeconds: number; originalDurationSeconds?: number };
const ticksPerSecond = 254016000000;

/** A filename is a clue, never authority to relink or guess a source offset. */
export function derivativeEvidence(path: string, mapping?: SourceMapping): string[] {
  const clues: string[] = [];
  if (/편집용_\d+f(?:\.[^/\\]+)?$/i.test(path)) clues.push('cut_length_filename');
  if (/(?:^|[/\\])[^/\\]*조각[^/\\]*(?:[/\\]|$)/.test(path)) clues.push('fragment_path');
  if (/_f\d+-\d+\.[^/\\]+$/i.test(path)) clues.push('frame_range_filename');
  if (mapping && mapping.originalPath.replaceAll('\\', '/') !== path.replaceAll('\\', '/')) clues.push('caller_recorded_source_mapping');
  return clues;
}

/** Unknown bounds stay null. Never turn absent metadata into zero handles. */
export function sourceEditability(path: string, durationTicks: string | undefined, inTicks: string | undefined, outTicks: string | undefined, mapping?: SourceMapping) {
  const evidence = derivativeEvidence(path, mapping);
  const warnings: string[] = evidence.length ? ['POSSIBLE_PRETRIMMED_SOURCE: inspect the original and its recorded range; do not relink from filename guesses'] : [];
  let headSeconds: number | null = null, tailSeconds: number | null = null;
  try {
    if (!durationTicks || !inTicks || !outTicks) throw Error('missing');
    const duration = BigInt(durationTicks), start = BigInt(inTicks), end = BigInt(outTicks);
    if (duration <= 0n || start < 0n || end <= start || end > duration) throw Error('bounds');
    headSeconds = Number(start) / ticksPerSecond;
    tailSeconds = Number(duration - end) / ticksPerSecond;
    if (start === 0n && end === duration) warnings.push('NO_SOURCE_HANDLES: both ends reach the source file boundary; explain why before completion');
  } catch { warnings.push('SOURCE_HANDLES_UNVERIFIED: source duration or source range is unavailable/inconsistent'); }
  return { sourcePath: path, handles: { headSeconds, tailSeconds, basis: 'media_file_duration', extensionVerified: false },
    derivative: { suspected: evidence.length > 0, evidence, ...(mapping ? { mapping, mappingVerification: 'caller_recorded_not_verified' } : {}) }, warnings };
}
