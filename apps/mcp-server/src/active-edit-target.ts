import {AsyncLocalStorage} from 'node:async_hooks';
import {realpathSync,statSync} from 'node:fs';
import { isLocalProjectPath } from '@premiere-uxp/contracts/local-path';
import {z} from 'zod/v4';

export const editTargetSchema=z.object({projectPath:z.string().min(1).max(4096),projectId:z.string().min(1).max(200),sequenceId:z.string().min(1).max(200),sequenceName:z.string().min(1).max(500)}).strict();
export type ActiveEditTarget=z.infer<typeof editTargetSchema>;
const targets=new AsyncLocalStorage<ActiveEditTarget>();
export function localProjectPath(candidate:string){
  const clean=candidate.replace(/^\\\\\?\\/,'');
  if(!isLocalProjectPath(clean))throw Error('LOCAL_PROJECT_REQUIRED');
  const resolved=realpathSync.native(clean).replace(/^\\\\\?\\/,'');
  if(!isLocalProjectPath(resolved)||!statSync(resolved).isFile())throw Error('LOCAL_PROJECT_REQUIRED');
  return resolved;
}
export function assertEditTarget(input:unknown,args:Record<string,unknown>={}){
  const target=editTargetSchema.parse(input);target.projectPath=localProjectPath(target.projectPath);
  for(const [expected,actual] of [['expectedProjectId','projectId'],['expectedSequenceId','sequenceId'],['expectedSequenceName','sequenceName']] as const)
    if(args[expected]!==undefined&&args[expected]!==target[actual])throw Error('COMMAND_EDIT_TARGET_CHANGED');
  return target;
}
export function withEditTarget<T>(target:ActiveEditTarget,run:()=>T):T{return targets.run(target,run);}
export function currentRequestEditTarget(){const target=targets.getStore();if(!target)throw Error('COMMAND_EDIT_TARGET_REQUIRED');return target;}
export async function readActiveEditTarget(host:{read:(command:string,args?:Record<string,unknown>)=>Promise<unknown>},args:Record<string,unknown>){
  const c=await host.read('inspect_host_context') as Record<string,any>;
  if(!c.activeProject||!c.activeSequence)throw Error('ACTIVE_PROJECT_AND_SEQUENCE_REQUIRED');
  return assertEditTarget({projectPath:c.projectPath,projectId:c.projectId,sequenceId:c.sequenceId,sequenceName:c.sequenceName},args);
}
