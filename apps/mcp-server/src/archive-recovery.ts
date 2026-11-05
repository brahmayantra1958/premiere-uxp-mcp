import {assertEditTarget} from "./active-edit-target.js";
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runtimePaths} from './config.js';
import {canonicalizeOperationValue} from './operation-identity.js';
export type ArchiveRecoveryHost={read:(command:string,args?:Record<string,unknown>,options?:{timeoutMs?:number})=>Promise<unknown>;mutate:(command:string,args:Record<string,unknown>,id?:string)=>Promise<unknown>};
const normal=(s:string)=>s.replace(/^\\\\\?\\/,'').replaceAll('/','\\').toLowerCase();
export async function recoveryPin(args:Record<string,any>,recorded?:unknown){
 const pin=recorded?assertEditTarget(recorded,args):JSON.parse(await readFile(path.join(runtimePaths.runtimeDirectory,'designated-edit-target.json'),'utf8')); // Legacy unfinished journals only.
 if(pin.projectId!==args.expectedProjectId||pin.sequenceId!==args.expectedSequenceId||pin.sequenceName!==args.expectedSequenceName||typeof pin.projectPath!=='string'||!path.isAbsolute(pin.projectPath)||/^\\\\(?!\?\\)/.test(pin.projectPath))throw Error('RECOVERY_DESIGNATED_TARGET_CHANGED');
 return pin;
}
/** At most one recovery-open, recorded before dispatch. A timed-out recovery
 * itself must obtain a terminal execution witness before any later attempt. */
export async function ensureArchiveRecoveryProject(host:ArchiveRecoveryHost,pin:Record<string,any>,directory:string,operationId:string,verifyClosedFile:()=>Promise<void>){
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(operationId))throw Error('RECOVERY_OPERATION_ID_INVALID');
 const file=path.join(directory,operationId+'.recovery-open.json');let prior:any;
 try{prior=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(prior){
  const ledger=await host.read('inspect_command_execution',{commandIds:[prior.id]}) as any,row=ledger.commands?.[0];
  const expected={projectPath:pin.projectPath,sequenceId:pin.sequenceId,sequenceName:pin.sequenceName};
  if(JSON.stringify(canonicalizeOperationValue(prior.args))!==JSON.stringify(canonicalizeOperationValue(expected))||ledger.status!=='pass'||ledger.protocol!==1||ledger.active?.length!==0||ledger.commands?.length!==1||row?.id!==prior.id||row.command!=='open_working_project'||row.fingerprint!==JSON.stringify(['open_working_project',canonicalizeOperationValue(expected)])||row.state!=='complete'||row.response?.id!==prior.id||!row.response?.ok||row.response.result?.status!=='pass')throw Error('RECOVERY_OPEN_STILL_UNVERIFIED');
 }
 let context=await host.read('inspect_host_context') as any;
 if(context.activeProject===false){
  if(prior)throw Error('RECOVERY_PROJECT_CLOSED_AFTER_VERIFIED_OPEN');
  await verifyClosedFile();
  const id=randomUUID(),args={projectPath:pin.projectPath,sequenceId:pin.sequenceId,sequenceName:pin.sequenceName};
  await writeFile(file,JSON.stringify({id,args,at:new Date().toISOString()}),{flag:'wx',flush:true});
  const response=await host.mutate('open_working_project',args,id) as any;if(response.status!=='pass')throw Error('RECOVERY_OPEN_UNVERIFIED');
  context=await host.read('inspect_host_context') as any;
 }
 if(context.projectId!==pin.projectId||context.sequenceId!==pin.sequenceId||context.sequenceName!==pin.sequenceName||typeof context.projectPath!=='string'||normal(context.projectPath)!==normal(pin.projectPath))throw Error('RECOVERY_ACTIVE_TARGET_CHANGED');
}
