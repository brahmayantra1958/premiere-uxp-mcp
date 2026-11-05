import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTrackLockTools } from '../../apps/mcp-server/src/track-lock-tools.js';
import { prepareHostMutation } from '../../apps/mcp-server/src/host-mutation-plan.js';
let client:Client,server:McpServer;
const host={read:vi.fn(async()=>({status:'pass',after:[]})),mutate:vi.fn(async()=>({status:'pass'}))};
const pins={expectedProjectId:'p',expectedSequenceId:'s'};
const edit={mediaType:'audio',trackIndex:0,expectedTrackId:'4',expectedTrackName:'Dialogue',locked:false,expectedLocked:true};
beforeEach(async()=>{
  host.read.mockClear();host.mutate.mockClear();server=new McpServer({name:'locks',version:'1'});registerTrackLockTools(server,host as any,true);
  client=new Client({name:'lock-test',version:'1'});const [c,s]=InMemoryTransport.createLinkedPair();await server.connect(s);await client.connect(c);
});
afterEach(async()=>{await client.close();await server.close();});
it('exposes one read and one guarded edit with explicit desired states',async()=>{
  expect((await client.callTool({name:'read_track_locks',arguments:pins})).isError).not.toBe(true);
  expect(host.read).toHaveBeenCalledExactlyOnceWith('read_track_locks',pins);
  expect((await client.callTool({name:'set_track_locks',arguments:{...pins,edits:[edit]}})).isError).not.toBe(true);
  expect(host.mutate).toHaveBeenCalledExactlyOnceWith('set_track_locks',{...pins,edits:[edit]},undefined);
});
it.each([{...edit,mediaType:'caption'},{...edit,locked:'false'},{...edit,expectedTrackId:undefined},{...edit,script:'arbitrary code'},{...edit,trackIndex:64}])('rejects invalid targets before mutation (%j)',async bad=>{
  expect((await client.callTool({name:'set_track_locks',arguments:{...pins,edits:[bad]}})).isError).toBe(true);expect(host.mutate).not.toHaveBeenCalled();
});
it('rejects missing scope and duplicate tracks',async()=>{
  for(const args of [{edits:[edit]},{...pins,edits:[edit,edit]}])expect((await client.callTool({name:'set_track_locks',arguments:args})).isError).toBe(true);
  expect(host.mutate).not.toHaveBeenCalled();
});
it('does not expose writing in inspect-only mode or take a broad planning snapshot',async()=>{
  const registerTool=vi.fn();registerTrackLockTools({registerTool} as any,host as any,false);expect(registerTool.mock.calls.map(c=>c[0])).toEqual(['read_track_locks']);
  const read=vi.fn(),append=vi.fn();await prepareHostMutation('set_track_locks',{...pins,edits:[edit]},'operation',undefined,read,{append} as any);
  expect(read).not.toHaveBeenCalled();expect(append).toHaveBeenCalledWith(expect.objectContaining({kind:'host-preflight-plan'}));
});
