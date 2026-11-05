import {readFileSync} from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {describe,it,expect} from 'vitest';
import {z} from 'zod/v4';
import {loadAgentGuidance} from '../../apps/mcp-server/src/agent-guidance.js';
import {registerTools} from '../../apps/mcp-server/src/tools.js';
import {enabledProfiles} from '../../apps/mcp-server/src/config.js';

describe('portable agent guidance',()=>{
  it('delivers initialization instructions and every fixed resource without a host',async()=>{
    const root=path.resolve('.'),guidance=loadAgentGuidance(root);
    const server=new McpServer({name:'guidance-test',version:guidance.serverVersion},{instructions:guidance.instructions});
    guidance.register(server);
    const client=new Client({name:'guidance-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
    try{
      await server.connect(b);await client.connect(a);
      expect(client.getInstructions()).toBe(readFileSync(path.join(root,'docs/agent-instructions.md'),'utf8'));
      const bundle=JSON.parse(readFileSync(path.join(root,'skills/bundle.json'),'utf8'));
      const listed=await client.listResources();expect(listed.resources).toHaveLength(bundle.resources.length);
      for(const resource of bundle.resources){
        const result=await client.readResource({uri:`premiere://guide/${resource.name}`});
        const source=readFileSync(path.join(root,resource.path),'utf8');
        const content=result.contents[0];
        expect(content.mimeType).toBe(resource.path.endsWith('.json')?'application/json':'text/markdown');
        const prose=(text:string)=>text.replace(/(\[[^\]]*\]\()([^\s)]+)(\))/g,'$1LINK$3');
        expect(prose(String(content.text))).toBe(prose(source));
        if(resource.name==='contract')expect(content.text).toContain('](premiere://guide/operate)');
      }
      await expect(client.readResource({uri:'premiere://guide/../../artifacts/runtime/bridge-token.txt'})).rejects.toThrow();
      expect((await client.listResources()).resources).toHaveLength(bundle.resources.length);
    }finally{await client.close();await server.close();}
  });

  it('validates every published argument template against the actual registered schema without dispatch',()=>{
    const schemas=new Map<string,z.ZodType>();
    const server={registerTool(name:string,config:{inputSchema?:z.ZodType|z.ZodRawShape}){schemas.set(name,config.inputSchema instanceof z.ZodType?config.inputSchema:z.object(config.inputSchema??{}));}};
    const profiles=[...enabledProfiles];
    try{
      enabledProfiles.add('edit');enabledProfiles.add('delivery');
      registerTools(server as unknown as McpServer,{} as never,{} as never,{} as never,{} as never);
      const examples=JSON.parse(readFileSync('docs/examples/agent-calls.json','utf8'));
      expect(examples.kind).toBe('template_only_not_a_job');
      for(const example of examples.examples){
        const schema=schemas.get(example.tool);expect(schema,example.tool).toBeDefined();
        const parsed=schema!.safeParse(example.arguments);
        expect(parsed.success,`${example.id}: ${parsed.success?'':parsed.error.message}`).toBe(true);
        if(parsed.success)for(const key of Object.keys(example.arguments))expect(parsed.data,`${example.id}.${key} was silently stripped`).toHaveProperty(key);
      }
    }finally{enabledProfiles.clear();for(const profile of profiles)enabledProfiles.add(profile);}
  });
});
