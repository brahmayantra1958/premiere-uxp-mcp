import { expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BridgeRequest, BridgeResponse } from '@premiere-uxp/contracts';
import { registerTimelineEditTools } from '../../apps/mcp-server/src/timeline-edit-tools.js';
import { HostExecutor } from '../../apps/mcp-server/src/host-executor.js';
import { AuditLog, ReceiptStore } from '../../apps/mcp-server/src/audit.js';
import { BridgeTransportError } from '../../apps/mcp-server/src/bridge-transport.js';
import { freshTestDirectory } from '../helpers/workspace.js';

function registration(host:HostExecutor) {
  const tools=new Map<string,any>();
  registerTimelineEditTools({registerTool:(name:string,config:any,handler:any)=>tools.set(name,{config,handler})} as any,host);
  const tool=tools.get('clone_clips'),schema=z.object(tool.config.inputSchema);
  const args=(count:number)=>({expectedProjectId:'fresh-project',expectedSequenceId:'fresh-sequence',expectedSequenceName:'Exact sequence',
    operationId:randomUUID(),clones:Array.from({length:count},(_,index)=>({trackItemId:'audio:0:0:original',timeOffsetSeconds:index+1,audioTrackOffset:0,mode:'overwrite'}))});
  return {tools,tool,schema,args};
}
async function fixture(defaultTimeoutMs=15_000,throwTimeout=false) {
  const directory=await freshTestDirectory('clone-timeout-'+randomUUID()),requests:BridgeRequest[]=[];
  const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{
    requests.push(request);
    if(throwTimeout)throw new BridgeTransportError('native command deadline exceeded',{code:'PANEL_COMMAND_TIMEOUT',dispatchState:'unknown'});
    return {version:1,id:request.id,ok:true,durationMs:1,result:{status:'pass',errors:[]}};
  }};
  const store=new ReceiptStore(path.join(directory,'receipts.json'));
  const host=new HostExecutor(bridge as any,new AuditLog(path.join(directory,'audit.jsonl')),store,defaultTimeoutMs);
  return {...registration(host),host,store,requests};
}

it.each([[1,16_000],[51,66_000],[100,115_000]])('sends %i clones with a %i ms proof floor through the actual executor',async(count,timeoutMs)=>{
  const f=await fixture(),input=f.schema.parse(f.args(count)),{operationId,...payload}=input;
  expect((await f.tool.handler(input)).structuredContent.status).toBe('pass');
  expect(f.requests).toEqual([{version:1,id:operationId,command:'clone_clips',args:payload,timeoutMs}]);
  expect(timeoutMs).toBeGreaterThanOrEqual(15_000);expect(timeoutMs).toBeLessThanOrEqual(115_000);
});

it('preserves a longer 180s configured default for clone commands',async()=>{
  const f=await fixture(180_000);await f.tool.handler(f.schema.parse(f.args(100)));
  expect(f.requests[0]?.timeoutMs).toBe(180_000);
});

it('also covers internal mutate calls, respecting longer options and raising shorter ones',async()=>{
  const f=await fixture(),{operationId,...args}=f.schema.parse(f.args(51));
  await f.host.mutate('clone_clips',args,operationId,{timeoutMs:1_000});
  await f.host.mutate('clone_clips',args,randomUUID(),{timeoutMs:180_000});
  expect(f.requests.map(request=>request.timeoutMs)).toEqual([66_000,180_000]);
});

it('keeps existing 1..100 input bounds and exposes no caller-controlled timeout',async()=>{
  const f=await fixture();expect(f.schema.safeParse(f.args(0)).success).toBe(false);expect(f.schema.safeParse(f.args(101)).success).toBe(false);
  expect(f.requests).toEqual([]);expect(f.tool.config.inputSchema).not.toHaveProperty('timeoutMs');
  const input=f.schema.parse({...f.args(51),timeoutMs:1,timeout:999999999});await f.tool.handler(input);
  expect(f.requests[0]?.args).not.toHaveProperty('timeoutMs');expect(f.requests[0]?.args).not.toHaveProperty('timeout');
  expect(f.requests[0]?.timeoutMs).toBe(66_000);
});

it('does not derive an unbounded timeout from invalid internal clone counts',async()=>{
  const f=await fixture();
  for(const clones of [[],Array.from({length:101},()=>({})),{length:1000000},undefined]){
    await f.host.mutate('clone_clips',{expectedProjectId:'p',expectedSequenceId:'s',clones},randomUUID());
  }
  expect(f.requests.map(request=>request.timeoutMs)).toEqual([15_000,15_000,15_000,15_000]);
});

it('keeps other commands at the original15s default and leaves the effect floor unchanged',async()=>{
  const f=await fixture();await f.host.read('inspect_host_activity');await f.host.read('get_effect_values');
  expect(f.requests.map(request=>request.timeoutMs)).toEqual([15_000,45_000]);
});

it('keeps a timeout UNVERIFIED with one dispatch and preserves its immutable receipt',async()=>{
  const f=await fixture(15_000,true),input=f.schema.parse(f.args(51));
  const result=await f.tool.handler(input);
  expect(result.structuredContent).toMatchObject({status:'unverified',retryable:false,hostResult:{transport:{code:'PANEL_COMMAND_TIMEOUT',dispatchState:'unknown'}}});
  expect(f.requests).toHaveLength(1);expect(await f.store.get(input.operationId!)).toEqual(result.structuredContent);
});

it('registration still delegates once without a lower fixed timeout override',async()=>{
  const host={mutate:vi.fn(async()=>({status:'pass'}))},f=registration(host as any),input=f.schema.parse(f.args(51));
  await f.tool.handler(input);expect(host.mutate).toHaveBeenCalledTimes(1);expect(host.mutate.mock.calls[0]).toHaveLength(3);
});
