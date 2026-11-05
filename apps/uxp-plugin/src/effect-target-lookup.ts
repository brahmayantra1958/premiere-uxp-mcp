import { HostCommandError } from './bridge-client.js';
import type { AnyRecord } from './host-foundation.js';
import type { TrackItemLookupHint } from './host-items.js';

const hints = new WeakMap<object, TrackItemLookupHint>();
const targetKeys = ['expectedProjectId','expectedSequenceId','expectedSequenceName','trackItemId','expectedProjectItemId','expectedClipName','expectedMediaType','expectedTrackIndex','expectedStartSeconds','expectedEndSeconds'] as const;

export function effectTargetLookupHint(args: AnyRecord): TrackItemLookupHint | undefined {
  return hints.get(args);
}

/** Only a command-local numeric slot is shared. Every lookup still acquires a
 * fresh collection and verifies the complete native identity and metadata.
 * Derived effect arguments may change values/selectors, never their target. */
export async function withEffectTargetLookup<T>(args: AnyRecord, work: () => Promise<T>, inheritFrom?: AnyRecord): Promise<T> {
  if(inheritFrom&&targetKeys.some(key=>!Object.is(args[key],inheritFrom[key])))throw new HostCommandError('EFFECT_TARGET_LOOKUP_SCOPE_MISMATCH','Derived effect arguments must retain the exact project, sequence and clip target');
  const previous=hints.get(args);
  hints.set(args,inheritFrom?hints.get(inheritFrom)??{}:{});
  try { return await work(); } finally {
    if(previous)hints.set(args,previous);else hints.delete(args);
  }
}
