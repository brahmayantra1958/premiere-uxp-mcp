import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it, vi } from 'vitest';
import { registerPlacementTools } from '../../apps/mcp-server/src/timeline-edit-tools.js';

it('publishes sourceRange, sourceMapping and renderChecks; invalid ranges cannot reach the host', async () => {
  const server = new McpServer({ name: 'placement-contract', version: '1' });
  const mutate = vi.fn(async () => ({ status: 'pass' })), read = vi.fn();
  const mutateLocal = vi.fn(async () => ({ status: 'pass' }));
  registerPlacementTools(server, { mutate, read, mutateLocal } as any, {} as any);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  try {
    const tool = (await client.listTools()).tools.find(tool => tool.name === 'place_clips')!;
    expect(JSON.stringify(tool.inputSchema)).toContain('sourceRange'); expect(JSON.stringify(tool.inputSchema)).toContain('sourceMapping'); expect(JSON.stringify(tool.inputSchema)).toContain('renderChecks');
    const pins = { expectedProjectId: 'p', expectedSequenceId: 's' };
    for (const sourceRange of [{ inPointSeconds: 3, outPointSeconds: 2 }, { inPointSeconds: -1, outPointSeconds: 2 }]) {
      const result = await client.callTool({ name: 'place_clips', arguments: { ...pins, placements: [{ projectItemId: 'source', timeSeconds: 0, sourceRange }] } });
      expect(result.isError).toBe(true);
    }
    expect(mutate).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    await client.callTool({ name: 'place_clips', arguments: { ...pins, placements: [{ projectItemId: 'source', timeSeconds: 0 }] } });
    expect(mutate).toHaveBeenCalledOnce();
    const placement = { projectItemId: 'source', timeSeconds: 10, mode: 'overwrite', requireEmpty: true, expectedMediaTypes: ['video'], sourceRange: { inPointSeconds: 2, outPointSeconds: 5 }, sourceMapping: { originalPath: 'C:/original.mov', originalStartSeconds: 10, originalEndSeconds: 22 } };
    const renderChecks = [{ timeSeconds: 11, expectedSha256: 'a'.repeat(64) }];
    await client.callTool({ name: 'place_clips', arguments: { ...pins, expectedSequenceName: 'Sequence', placements: [placement], renderChecks } });
    expect(mutateLocal).toHaveBeenCalledWith('place_clips', expect.objectContaining({ placements: [expect.objectContaining(placement)], renderChecks }), expect.any(Function), expect.any(String));
  } finally { await client.close(); await server.close(); }
});
