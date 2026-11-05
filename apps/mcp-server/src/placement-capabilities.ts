type Support = 'pass' | 'unsupported' | 'unverified';
type Capability = { name?: unknown; supported?: unknown };

/** Missing capability in a readable catalog is unsupported. Missing/ambiguous
 * catalog data is unknown. Panel version and server schema are never evidence. */
export function placementCapabilityStatus(catalog: unknown, group: 'read' | 'write', name: string): Support {
  const entries = catalog && typeof catalog === 'object' ? (catalog as Record<string, unknown>)[group] : undefined;
  if (!Array.isArray(entries)) return 'unverified';
  const matches = entries.filter((entry: Capability | null) => entry?.name === name);
  if (!matches.length) return 'unsupported';
  if (matches.length !== 1 || typeof matches[0].supported !== 'boolean') return 'unverified';
  return matches[0].supported ? 'pass' : 'unsupported';
}

const both = (a: Support, b: Support): Support => a === 'unsupported' || b === 'unsupported' ? 'unsupported' : a === 'pass' && b === 'pass' ? 'pass' : 'unverified';

/** PASS here means advertised support, never a completed placement, approved
 * deployment, render proof or permission to execute the two-step alternative. */
export function placementCapabilities(catalog: unknown, readError?: string) {
  const sourceRange = placementCapabilityStatus(catalog, 'write', 'sourceRangePlacement');
  const video = both(sourceRange, placementCapabilityStatus(catalog, 'read', 'programMonitorFrame'));
  const fallback = both(placementCapabilityStatus(catalog, 'write', 'sequenceEditor'), placementCapabilityStatus(catalog, 'write', 'exactClipTrim'));
  const route = (support: Support) => support === 'pass' ? 'source_range' : support === 'unsupported' && fallback === 'pass' ? 'full_original_then_exact_trim' : 'inspect_capabilities_or_manual_edit';
  return {
    evidence: 'live_get_capabilities', scope: 'advertised_support_only', sourcePolicy: 'full_original_file_with_source_in_out',
    sourceRange: { status: sourceRange, videoStatus: video, capability: 'write.sourceRangePlacement',
      reason: sourceRange === 'pass' ? 'Advertised by this panel; rechecked at dispatch with source marks, exact range and readback'
        : sourceRange === 'unsupported' ? 'This panel does not advertise sourceRangePlacement:true; do not submit sourceRange or infer it from panelVersion/tools/list'
          : 'Capability observation unavailable or ambiguous; do not infer support or unsupported status',
      videoRequirement: 'Reviewed independent renderChecks references and live programMonitorFrame support are also required' },
    fullOriginalThenExactTrim: { status: fallback, tools: ['place_clips', 'trim_clip_exact'], automatic: false,
      conditions: [
        'Inspect the original file and actual full insertion range; the ENTIRE temporary placement must be empty on every inserted stream, not only the final cut',
        'Use overwrite + requireEmpty + expectedMediaTypes + full expectedDurationSeconds; never use insert to shift unrelated edits',
        'For a head trim, derive the temporary timeline start so the coupled source trim lands at the requested final position; reject negative time or occupied staging',
        'Refresh placed IDs and exact source/timeline guards, trim each supported target, verify source in/out, handles, effects/link limitations and requested frame/audio evidence',
        'No automatic execution, no cut-length derivatives, no replay after unknown completion; use approved scratch/manual editing when these conditions cannot be proved',
      ] },
    recommendedRoute: { audio: route(sourceRange), video: route(video) },
    recheckAtDispatch: true, ...(readError ? { readError } : {}),
  };
}
