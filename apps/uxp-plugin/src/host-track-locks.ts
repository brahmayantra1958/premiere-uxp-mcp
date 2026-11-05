import { HostCommandError } from './bridge-client.js';
import { inspectHostContext, mutationContext } from './host-context.js';
import { deployment } from './installation-config.js';
import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';

type Identity = { id: string; name: string };
type Tracks = { video: Identity[]; audio: Identity[] };
type Edit = { mediaType: 'video' | 'audio'; trackIndex: number; expectedTrackId: string; expectedTrackName: string; locked: boolean; expectedLocked?: boolean };
type Row = { mediaType: 'video' | 'audio'; trackIndex: number; trackId: string; name: string; locked: boolean; targeted?: boolean; muted?: boolean };
export const trackLockConfigured = Boolean(deployment.trackLock);

async function trackIdentities(sequence: any): Promise<Tracks> {
  const tracks: Tracks = { video: [], audio: [] };
  for (const mediaType of ['video', 'audio'] as const) {
    const prefix = mediaType === 'video' ? 'Video' : 'Audio';
    const count = Number(await sequence[`get${prefix}TrackCount`]());
    if (!Number.isInteger(count) || count < 0 || count > 64) throw Error('TRACK_LOCK_LIMIT');
    for (let index = 0; index < count; index++) {
      const track = await sequence[`get${prefix}Track`](index);
      if (!/^\d+$/.test(String(track.id)) || typeof track.name !== 'string') throw Error('TRACK_IDENTITY_UNAVAILABLE');
      tracks[mediaType].push({ id: String(track.id), name: track.name });
    }
  }
  return tracks;
}

/** Fixed authenticated CEP operations, serialized by the existing host queue.
 * No navigation, automatic unlock, replay, script argument or content edit. */
export async function trackLocks(operation: 'read_track_locks' | 'set_track_locks', args: Record<string, any>, requestId: string) {
  let posted = false;
  let native: Record<string, any> | undefined;
  let actualTarget: Record<string, any> | undefined;
  try {
    actualTarget = await inspectHostContext();
    if (!args.expectedProjectId || !args.expectedSequenceId || actualTarget.projectId !== args.expectedProjectId || actualTarget.sequenceId !== args.expectedSequenceId || (args.expectedSequenceName !== undefined && actualTarget.sequenceName !== args.expectedSequenceName)) throw Error('CONTEXT_CHANGED');
    const { sequence } = await mutationContext(args);
    const tracks = await trackIdentities(sequence);
    const edits: Edit[] = operation === 'set_track_locks' ? args.edits : [];
    if (!Array.isArray(edits) || edits.length > 128 || (operation === 'set_track_locks' && edits.length === 0)) throw Error('INVALID_TRACK_LOCK_EDITS');
    const keys = new Set<string>();
    for (const edit of edits) {
      const identity = tracks[edit.mediaType]?.[edit.trackIndex];
      const key = `${edit.mediaType}:${edit.trackIndex}`;
      if (!Number.isInteger(edit.trackIndex) || !identity || identity.id !== edit.expectedTrackId || identity.name !== edit.expectedTrackName || typeof edit.locked !== 'boolean' || (edit.expectedLocked !== undefined && typeof edit.expectedLocked !== 'boolean') || keys.has(key)) throw Error('TRACK_IDENTITY_OR_STATE_INVALID');
      keys.add(key);
    }
    const connection = deployment.trackLock;
    if (!connection) return { status: 'unsupported', actualTarget, hostResult: { contentDispatched: false }, errors: ['TRACK_LOCK_HELPER_NOT_CONFIGURED: install the dedicated track-lock helper and load its local deployment configuration'] };
    const request = { version: 1, id: requestId, operation, expiresAt: Date.now() + 15000, projectPath: actualTarget.projectPath, sequenceId: actualTarget.sequenceId, sequenceName: actualTarget.sequenceName, tracks, edits };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      posted = true;
      native = await Promise.race([
        fetch(`http://localhost:${connection.port}/locks`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${connection.token}` }, body: JSON.stringify(request) }).then(async response => {
          const value = await response.json() as Record<string, any>;
          if (!response.ok) {
            if (value.contentDispatched === false) return { ...value, status: 'fail' };
            throw Error(`Track lock helper HTTP ${response.status}`);
          }
          return value;
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('TRACK_LOCK_TIMEOUT_DO_NOT_REPLAY')), 14000); }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
    if (native.status !== 'pass') {
      const noWrite = native.contentDispatched === false;
      return { status: noWrite || operation === 'read_track_locks' ? 'fail' : 'unverified', actualTarget, hostResult: native, errors: [String(native.error ?? native.status)], recovery: 'Read current lock states before another edit; never replay an uncertain setter. Archive only the exact inactive operation if quarantined.' };
    }
    if (native.route !== 'cep_track_lock' || native.version !== connection.version || native.requestId !== requestId || normalizeLocalPath(String(native.projectPath)) !== normalizeLocalPath(request.projectPath) || native.sequenceId !== request.sequenceId || native.sequenceName !== request.sequenceName) throw Error('TRACK_LOCK_RESPONSE_IDENTITY_MISMATCH');
    const identities = (['video', 'audio'] as const).flatMap(mediaType => tracks[mediaType].map((t, trackIndex) => ({ mediaType, trackIndex, trackId: t.id, name: t.name })));
    const verify = (rows: Row[]) => {
      if (!Array.isArray(rows) || rows.length !== identities.length || identities.some((t, i) => !rows[i] || typeof rows[i]!.locked !== 'boolean' || Object.entries(t).some(([key, value]) => (rows[i] as any)[key] !== value))) throw Error('TRACK_LOCK_VECTOR_MISMATCH');
    };
    verify(native.before); verify(native.after);
    for (let i = 0; i < identities.length; i++) {
      const row = identities[i]!;
      const edit = edits.find(t => t.mediaType === row.mediaType && t.trackIndex === row.trackIndex);
      if (native.after[i].locked !== (edit?.locked ?? native.before[i].locked) || (edit?.expectedLocked !== undefined && edit.expectedLocked !== native.before[i].locked) || native.after[i].muted !== native.before[i].muted) throw Error('TRACK_LOCK_POSTCONDITION_FAILED');
    }
    const current = await inspectHostContext();
    if (current.projectId !== actualTarget.projectId || current.sequenceId !== actualTarget.sequenceId || current.sequenceName !== actualTarget.sequenceName || normalizeLocalPath(String(current.projectPath)) !== normalizeLocalPath(actualTarget.projectPath)) throw Error('CONTEXT_CHANGED_AFTER_TRACK_LOCK');
    const fresh = await mutationContext(args);
    if (JSON.stringify(await trackIdentities(fresh.sequence)) !== JSON.stringify(tracks)) throw Error('TRACK_IDENTITY_CHANGED_AFTER_TRACK_LOCK');
    return { status: 'pass', actualTarget, before: native.before, after: native.after, hostResult: { route: native.route, version: native.version, contentDispatched: native.contentDispatched, changed: native.changed, unrequestedLocksPreserved: true, mutePreserved: true, targeting: 'reported in before/after; Premiere may untarget a newly locked track' }, errors: [], unsupportedMediaTypes: ['caption'] };
  } catch (error) {
    const unknownWrite = operation === 'set_track_locks' && posted && native?.contentDispatched !== false;
    return { status: unknownWrite ? 'unverified' : 'fail', actualTarget, hostResult: { contentDispatched: unknownWrite, ...(native ? { native } : {}) }, errors: [error instanceof HostCommandError ? `${error.code}: ${error.message}` : String(error)] };
  }
}
