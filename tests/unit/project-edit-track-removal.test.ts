import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { registerProjectStructureTools } from '../../apps/mcp-server/src/project-edit-tools.js';
import { structurePreservationFixture } from '../fixtures/sequence-structure-preservation.js';

describe('public structural edit route', () => {
  const registration = () => {
    const registrations = new Map<string, { inputSchema: any; description: string }>();
    registerProjectStructureTools({ registerTool: (name: string, config: any) => registrations.set(name, config) } as any, {} as any, {} as any);
    return registrations.get('edit_existing_sequence_structure')!;
  };
  it('defaults to archive, accepts explicit native, and rejects unknown routes without losing target guards', () => {
    const definition = registration(), schema = z.object(definition.inputSchema), input = structurePreservationFixture().edit;
    input.removeTracks.forEach((row, index) => { row.uid = `00000000-0000-4000-8000-00000000000${index + 1}`; });
    expect(schema.parse(input)).toMatchObject({ trackRemovalRoute: 'archive', expectedProjectId: input.expectedProjectId, expectedSequenceId: input.expectedSequenceId });
    expect(schema.parse({ ...input, trackRemovalRoute: 'native' })).toMatchObject({ trackRemovalRoute: 'native' });
    expect(schema.safeParse({ ...input, trackRemovalRoute: 'fallback' }).success).toBe(false);
    expect(schema.safeParse({ ...input, expectedSequenceId: undefined }).success).toBe(false);
    expect(definition.description).toContain('26.3-only'); expect(definition.description).toContain('no automatic fallback');
  });
  it('retains the separate operation and empty request guards before any mutation', async () => {
    const callbacks = new Map<string, (input: any) => Promise<any>>(), host = { mutateLocal: vi.fn() };
    registerProjectStructureTools({ registerTool: (name: string, _config: any, callback: any) => callbacks.set(name, callback) } as any, host as any, {} as any);
    const call = callbacks.get('edit_existing_sequence_structure')!, f = structurePreservationFixture();
    expect(JSON.stringify(await call({ ...f.edit, removeTracks: [] }))).toContain('EMPTY_SEQUENCE_STRUCTURE_EDIT');
    expect(JSON.stringify(await call({ ...f.edit, captionStyle: {} }))).toContain('SEPARATE_TRACK_REMOVAL_AND_CAPTION_STYLE_EDITS_REQUIRED');
    expect(host.mutateLocal).not.toHaveBeenCalled();
  });
});
