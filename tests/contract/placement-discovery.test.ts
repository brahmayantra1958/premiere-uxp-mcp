import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {expect, it, vi} from 'vitest';
import {registerAgentTools} from '../../apps/mcp-server/src/agent-tools.js';
import {agentContextWithPlacement} from '../../apps/mcp-server/src/agent-context-discovery.js';
import recorded from '../fixtures/placement-capabilities-20261103.json';

const context = {status: 'ready', panelVersion: '0.15.1', project: {id: 'p'}, sequence: {id: 's', playhead: {seconds: 23.2}}, selection: {items: []}};
it('shows unsupported sourceRange during initial MCP discovery on an unchanged old panel', async () => {
  const read = vi.fn(async (command: string) => command === 'get_agent_context' ? structuredClone(context) : recorded);
  const mutate = vi.fn(), server = new McpServer({name: 'discovery-test', version: '1'});
  registerAgentTools(server, {read, mutate} as any);
  const client = new Client({name: 'discovery-client', version: '1'});
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  try {
    const result = await client.callTool({name: 'get_agent_context', arguments: {expectedProjectId: 'p', expectedSequenceId: 's'}});
    expect(result.structuredContent).toMatchObject({...context, placementCapabilities: {sourceRange: {status: 'unsupported'}, recommendedRoute: {audio: 'full_original_then_exact_trim'}}});
    expect(read.mock.calls.map(call => call[0])).toEqual(['get_agent_context', 'get_capabilities']);
    expect(read).toHaveBeenNthCalledWith(1, 'get_agent_context', {expectedProjectId: 'p', expectedSequenceId: 's'});
    expect(mutate).not.toHaveBeenCalled();
  } finally {await client.close(); await server.close();}
});
it('keeps useful context while marking failed capability observation unknown', async () => {
  const read = vi.fn(async (command: string) => {if (command === 'get_agent_context') return context; throw Error('panel busy');});
  expect(await agentContextWithPlacement({read}, {})).toMatchObject({...context, placementCapabilities: {sourceRange: {status: 'unverified'}, readError: 'Error: panel busy', recommendedRoute: {audio: 'inspect_capabilities_or_manual_edit'}}});
});
it('does not query capabilities when the intended project/sequence is not ready', async () => {
  const read = vi.fn(async () => ({status: 'no_sequence', project: {id: 'p'}}));
  expect(await agentContextWithPlacement({read}, {})).toMatchObject({status: 'no_sequence', placementCapabilities: {sourceRange: {status: 'unverified'}}});
  expect(read).toHaveBeenCalledOnce();
});
it('re-reads support each time rather than caching version-based assumptions', async () => {
  let supported = false;
  const read = vi.fn(async (command: string) => command === 'get_agent_context' ? context : {...recorded, write: supported ? [...recorded.write, {name: 'sourceRangePlacement', supported: true}] : recorded.write});
  expect((await agentContextWithPlacement({read}, {})).placementCapabilities.sourceRange.status).toBe('unsupported');
  supported = true;
  expect((await agentContextWithPlacement({read}, {})).placementCapabilities.sourceRange.status).toBe('pass');
});
it('propagates stale target rejection without a second host read', async () => {
  const read = vi.fn(async () => {throw Error('PROJECT_PRECONDITION_FAILED');});
  await expect(agentContextWithPlacement({read}, {expectedProjectId: 'old'})).rejects.toThrow('PROJECT_PRECONDITION_FAILED');
  expect(read).toHaveBeenCalledOnce();
});
