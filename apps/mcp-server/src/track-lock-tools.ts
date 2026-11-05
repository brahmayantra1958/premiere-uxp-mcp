import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HostExecutor } from './host-executor.js';
import { targetInputs } from './target-inputs.js';
import { operationId } from './tool-inputs.js';
import { failure, result } from './tool-values.js';

export function registerTrackLockTools(server: McpServer, host: HostExecutor, editsEnabled: boolean): void {
  server.registerTool('read_track_locks', {
    description: 'Read all video/audio track lock states, track IDs/names, and available targeting/mute states from the dedicated native CEP helper. Requires exact active project/sequence. Preserves playhead and panel; caption locks are unsupported. Use returned IDs/names to prepare set_track_locks.',
    inputSchema: targetInputs, annotations: { readOnlyHint: true },
  }, async args => { try { return result(await host.read('read_track_locks', args)); } catch (error) { return failure(error); } });
  if (!editsEnabled) return;
  server.registerTool('set_track_locks', {
    description: 'Lock or unlock explicitly listed video/audio tracks, individually or in one batch. Supply IDs/names from read_track_locks; locked true locks, false unlocks. Optional expectedLocked rejects stale state before any setter. Verifies requested and untouched locks by native isLocked readback. No automatic unlock around other edits; no toggle/replay/save/navigation. Premiere may untarget a track when locking it; before/after reports this. Caption locks are unsupported.',
    inputSchema: { ...targetInputs, edits: z.array(z.object({ mediaType: z.enum(['video', 'audio']), trackIndex: z.number().int().min(0).max(63), expectedTrackId: z.string().regex(/^\d+$/), expectedTrackName: z.string().max(512), locked: z.boolean(), expectedLocked: z.boolean().optional() }).strict()).min(1).max(128).refine(items => new Set(items.map(t => `${t.mediaType}:${t.trackIndex}`)).size === items.length, 'Duplicate track edits are not allowed'), operationId },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ operationId: id, ...args }) => { try { return result(await host.mutate('set_track_locks', args, id)); } catch (error) { return failure(error); } });
}
