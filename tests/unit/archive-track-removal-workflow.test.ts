import { afterEach, describe, expect, it, vi } from 'vitest';
import { editExistingSequenceStructure } from '../../apps/mcp-server/src/existing-sequence-structure.js';
import * as archiveApi from '../../apps/mcp-server/src/premiere-sequence-archive.js';
import * as native from '../../apps/mcp-server/src/premiere-native-bridge.js';
import type { HostExecutor } from '../../apps/mcp-server/src/host-executor.js';
import { structurePreservationFixture } from '../fixtures/sequence-structure-preservation.js';
import { closeReceiptFixture, lifecycleContextFixture } from '../fixtures/project-lifecycle.js';

afterEach(() => vi.restoreAllMocks());

describe('archive track removal workflow', () => {
  it.each(['pass', 'explicit-archive', 'close-save-reserialized', 'closed-caption-changed', 'closed-track-changed', 'candidate-stale', 'candidate-corruption', 'close-unverified', 'strict-read-failed', 'reopened-before-commit', 'source-changed-preflight', 'source-changed-commit', 'value-drift', 'caption-drift', 'roundtrip-unverified'] as const)('uses one archive operation and proves retained content: %s', async fault => {
    const f = structurePreservationFixture(), calls: string[] = [];
    const target = { projectId: f.project.projectId, projectPath: f.project.projectPath, sequenceId: f.sequence.id, sequenceName: f.sequence.name };
    let closed = false, reopened = false, saves = 0;
    const probe = vi.spyOn(native, 'probePremiereNativeBridge').mockRejectedValue(Error('native must not run'));
    const pid = vi.spyOn(native, 'resolveSinglePremiereProcessId').mockRejectedValue(Error('native must not run'));
    vi.spyOn(archiveApi, 'snapshotPremiereSequenceArchive').mockImplementation(async () => { calls.push('archive-read'); return structuredClone(reopened ? f.after.archive : f.archive); });
    vi.spyOn(archiveApi, 'readPremiereArchiveXml').mockImplementation(async () => ({ xml: closed ? 'closed-saved-file' : 'saved-file', compressed: true, sha256: closed ? 'closed-save-sha' : 'initial-save-sha' }));
    const candidate = vi.spyOn(archiveApi, 'patchPremiereSequenceArchive').mockImplementation((xml, input) => {
      calls.push('candidate'); expect(input.removeTracks).toEqual(f.removals); expect(xml).toBe(closed ? 'closed-saved-file' : 'saved-file');
      if (fault === 'candidate-stale') throw Error('STALE_ARCHIVE_TRACK_TARGET');
      const before = structuredClone(f.archive);
      if (closed && fault === 'close-save-reserialized') { const cue = before.tracks.at(-1)!.captionCues![0]!; cue.itemObjectId = 'close-renumbered'; cue.blockObjectId = 'close-block'; cue.binaryHash = 'close-token'; }
      if (closed && fault === 'closed-caption-changed') before.tracks.at(-1)!.captionCues![0]!.contentSha256 = 'changed';
      if (closed && fault === 'closed-track-changed') before.tracks[1]!.name = 'changed';
      const after = structuredClone(f.after.archive);
      if (fault === 'candidate-corruption') after.tracks.at(-1)!.captionCues![0]!.fontSize = 999;
      return { xml: 'candidate', before, after };
    });
    const commit = vi.spyOn(archiveApi, 'commitPremiereSequenceArchive').mockImplementation(async input => {
      calls.push('commit'); expect(closed).toBe(true); expect(input.expectedSourceSha256).toBe('closed-save-sha');
      if (fault === 'source-changed-preflight') throw Error('PROJECT_ARCHIVE_CHANGED_SINCE_PREFLIGHT');
      if (fault === 'source-changed-commit') throw Error('PROJECT_ARCHIVE_CHANGED_BEFORE_COMMIT');
      return { before: f.archive, after: f.after.archive, backupPath: 'C:/scratch/backup.prproj' } as any;
    });
    const restore = vi.spyOn(archiveApi, 'restorePremiereSequenceArchive');
    const host = {
      read: vi.fn(async (command: string, args?: Record<string, unknown>) => {
        calls.push(command);
        if (command === 'inspect_project') return structuredClone(reopened ? f.after.project : f.project);
        if (command === 'inspect_sequence') return structuredClone(reopened ? f.after.sequence : f.sequence);
        if (command === 'inspect_host_context') {
          if (closed && !reopened) {
            expect(args).toEqual({ includeOpenProjects: true });
            calls.push('strict-closed-check');
            if (fault === 'strict-read-failed') throw Error('native view enumeration failed');
            if (fault === 'reopened-before-commit') return lifecycleContextFixture(target, true);
          }
          return lifecycleContextFixture(target, !closed || reopened);
        }
        throw Error(command);
      }),
      mutate: vi.fn(async (command: string, args: Record<string, unknown>) => {
        expect(command).toBe('save_working_project'); expect(args.expectedProjectPath).toBe(f.project.projectPath);
        calls.push(`save-${++saves}`);
        if (saves === 2 && fault === 'value-drift') (f.after.project.effects as any[])[0]!.components[0].params[0].value++;
        if (saves === 2 && fault === 'caption-drift') f.after.archive.tracks.at(-1)!.captionCues![0]!.preservedStyleSha256 = 'drift';
        return { commandId: 'save', status: saves === 2 && fault === 'roundtrip-unverified' ? 'unverified' : 'pass', errors: [] };
      }),
      mutateLifecycle: vi.fn(async (command: string, args: Record<string, unknown>) => {
        calls.push(command); expect(args.requireExclusiveProject).toBe(true);
        if (command === 'close_working_project') { closed = true; const receipt = closeReceiptFixture(target); if (fault === 'close-unverified') receipt.status = 'unverified'; return receipt; }
        if (command === 'open_working_project') { reopened = true; return { commandId: 'open', status: 'pass', errors: [] }; }
        throw Error(command);
      }),
    };
    if (fault === 'explicit-archive') f.edit.trackRemovalRoute = 'archive';
    if (fault.startsWith('candidate-')) {
      await expect(editExistingSequenceStructure(host as unknown as HostExecutor, f.edit, 'operation')).rejects.toThrow(fault === 'candidate-stale' ? 'STALE' : 'CANDIDATE_PRESERVATION');
      expect(host.mutateLifecycle).not.toHaveBeenCalled();
    } else {
      const result = await editExistingSequenceStructure(host as unknown as HostExecutor, f.edit, 'operation');
      expect(result.status).toBe(['pass', 'explicit-archive', 'close-save-reserialized'].includes(fault) ? 'pass' : 'unverified');
      if (['strict-read-failed', 'reopened-before-commit', 'closed-caption-changed', 'closed-track-changed'].includes(fault)) expect(result.result).toMatchObject({ phase: 'before_archive_commit', archiveDispatched: false, reopenDispatched: false });
      if (fault.startsWith('source-changed-')) expect(result.result).toMatchObject({ phase: 'archive_commit', archiveReplaced: false, reopenDispatched: false });
      if (result.status === 'pass') {
        expect(result.result).toMatchObject({ trackRemovalPreservation: { status: 'pass', host: 'pass', archive: 'pass', roundtrip: 'pass' } });
        expect(calls.indexOf('candidate')).toBeLessThan(calls.indexOf('close_working_project'));
        expect(calls.indexOf('strict-closed-check')).toBeLessThan(calls.indexOf('commit'));
        expect(saves).toBe(2);
      }
    }
    expect(candidate).toHaveBeenCalledTimes(['candidate-stale', 'candidate-corruption', 'close-unverified', 'strict-read-failed', 'reopened-before-commit'].includes(fault) ? 1 : 2); expect(probe).not.toHaveBeenCalled(); expect(pid).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled();
    if (['candidate-stale', 'candidate-corruption', 'close-unverified', 'strict-read-failed', 'reopened-before-commit', 'closed-caption-changed', 'closed-track-changed'].includes(fault)) {
      expect(commit).not.toHaveBeenCalled(); expect(calls).not.toContain('open_working_project');
    } else { expect(commit).toHaveBeenCalledTimes(1); expect(calls.filter(row => row === 'open_working_project')).toHaveLength(fault.startsWith('source-changed-') ? 0 : 1); }
  });

  it('rejects explicit native unsupported version before save or backup without archive fallback', async () => {
    const f = structurePreservationFixture(); f.edit.trackRemovalRoute = 'native';
    const target = { projectId: f.project.projectId, projectPath: f.project.projectPath, sequenceId: f.sequence.id, sequenceName: f.sequence.name };
    vi.spyOn(native, 'resolveSinglePremiereProcessId').mockResolvedValue(123);
    const probe = vi.spyOn(native, 'probePremiereNativeBridge').mockRejectedValue(Error('PREMIERE_VERSION_UNVERIFIED: 26.5.2'));
    const snapshot = vi.spyOn(archiveApi, 'snapshotPremiereSequenceArchive'), commit = vi.spyOn(archiveApi, 'commitPremiereSequenceArchive');
    const host = { read: vi.fn(async (command: string) => command === 'inspect_project' ? f.project : command === 'inspect_sequence' ? f.sequence : lifecycleContextFixture(target)), mutate: vi.fn(), mutateLifecycle: vi.fn() };
    const result = await editExistingSequenceStructure(host as unknown as HostExecutor, f.edit, 'operation');
    expect(result).toMatchObject({ status: 'fail', changedFiles: [], result: { phase: 'preflight', contentDispatched: false } });
    expect(result.errors[0]).toContain('PREMIERE_VERSION_UNVERIFIED'); expect(probe).toHaveBeenCalledExactlyOnceWith(123);
    expect(host.mutate).not.toHaveBeenCalled(); expect(host.mutateLifecycle).not.toHaveBeenCalled(); expect(snapshot).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
});
