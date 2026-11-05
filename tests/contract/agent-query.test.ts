import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentTools } from "../../apps/mcp-server/src/agent-tools.js";
import type { HostExecutor } from "../../apps/mcp-server/src/host-executor.js";

describe("timeline query limits at the MCP boundary", () => {
  let client: Client;
  let server: McpServer;
  const read = vi.fn(async () => ({ items: [], page: { hasMore: false } }));
  const pins = { expectedProjectId: 'project', expectedSequenceId: 'sequence' };

  beforeEach(async () => {
    read.mockClear();
    server = new McpServer({ name: "query-limit-test", version: "1" });
    registerAgentTools(server, { read } as unknown as HostExecutor);
    client = new Client({ name: "query-limit-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  for (const flags of [
    { includeEffects: true },
    { includeSourceMetadata: true },
    { includeEffects: true, includeSourceMetadata: true },
  ]) {
    it.each([21, 100])(`rejects expensive pages before host dispatch: ${JSON.stringify(flags)}, limit %i`, async limit => {
      const response = await client.callTool({ name: "query_timeline", arguments: { ...pins, ...flags, limit } });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response.content)).toContain("at most 20");
      expect(read).not.toHaveBeenCalled();
    });

    it.each([undefined, 20])(`accepts default and boundary pages: ${JSON.stringify(flags)}, limit %s`, async limit => {
      const response = await client.callTool({ name: "query_timeline", arguments: { ...pins, ...flags, ...(limit === undefined ? {} : { limit }) } });
      expect(response.isError).not.toBe(true);
      expect(read).toHaveBeenCalledExactlyOnceWith("query_timeline", expect.objectContaining({ ...flags, limit: 20 }));
    });
  }

  it("preserves the 100-clip limit for ordinary timeline and media queries", async () => {
    for (const name of ["query_timeline", "query_media"]) {
      const response = await client.callTool({ name, arguments: { ...pins, limit: 100 } });
      expect(response.isError).not.toBe(true);
      expect(read).toHaveBeenLastCalledWith(name, expect.objectContaining({ limit: 100 }));
    }
  });
  it.each([
    {name:'query_media',input:{limit:200}},
    {name:'query_timeline',input:{mediaType:'caption'}},
  ])('rejects the recorded unsupported $name input before host dispatch (I)',async ({name,input})=>{
    const response=await client.callTool({name,arguments:{...pins,...input}});
    expect(response.isError).toBe(true);expect(read).not.toHaveBeenCalled();
  });
});
