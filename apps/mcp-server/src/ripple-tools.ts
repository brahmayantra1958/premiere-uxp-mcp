import {randomUUID} from 'node:crypto';
import {z} from 'zod/v4';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {HostExecutor} from './host-executor.js';
import {operationId,seconds} from './tool-inputs.js';
import {result,failure} from './tool-values.js';
import {rippleTimelineOperation} from './ripple-operation.js';

const input={expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),
  boundaries:z.array(z.object({atSeconds:seconds,frames:z.number().int().min(1).max(3000)})).min(1).max(32)};

export function registerRipplePreparation(server:McpServer,host:HostExecutor){
  server.registerTool('prepare_timeline_ripple',{
    description:'Read-only plan for positive gaps at frame-aligned original timeline coordinates across every AV and caption track. Returns exact ripple_timeline arguments. Crossing AV is split without dropping source; a crossing caption keeps its text/style and extends its end. Preserves navigation.',
    inputSchema:input,annotations:{readOnlyHint:true}},async args=>{
    try{const prepared=await host.read('inspect_timeline_ripple',args) as Record<string,any>;
      return result({...prepared,arguments:{...prepared.arguments,operationId:randomUUID()}});
    }catch(error){return failure(error);}
  });
}

export function registerRippleEdit(server:McpServer,host:HostExecutor){
  server.registerTool('ripple_timeline',{
    description:'Insert positive gaps on all AV/caption tracks in the exact prepared sequence. Boundaries use ORIGINAL coordinates. Splits crossing AV, moves later clips/cues, extends crossing captions. Saves this same local project before and after and reads caption archive bytes to verify text/style. Never closes/reopens or patches a project. Stop on UNVERIFIED; never replay under a new ID.',
    inputSchema:{...input,expectedSequenceName:z.string().min(1),expectedFrameTicks:z.string().regex(/^\d+$/),operationId},
    annotations:{destructiveHint:true}},async({operationId:id,...args})=>{
    try{return result(await rippleTimelineOperation(host,args,id));}catch(error){return failure(error);}
  });
}
