import {describe,it,expect,vi} from 'vitest';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {freshTestDirectory} from '../helpers/workspace.js';
import {ensureArchiveRecoveryProject} from '../../apps/mcp-server/src/archive-recovery.js';
import {CommandExecutionLedger} from '../../apps/uxp-plugin/src/command-execution-ledger.js';
const pin={projectPath:'C:\\scoped.prproj',projectId:'p',sequenceId:'s',sequenceName:'WORKING__s'};
describe('bounded archive recovery, without replay or backup restoration',()=>{
 it('opens only the verified closed file once; a lost response requires terminal proof before continuing',async()=>{
  const directory=await freshTestDirectory('archive-reopen'),ledger=new CommandExecutionLedger();let active=false,pending:any;
  const read=vi.fn(async(command:string,args:any)=>command==='inspect_command_execution'?ledger.inspect(args.commandIds):active?{...pin,activeProject:true,activeSequence:true}:{activeProject:false});
  const mutate=vi.fn(async(command:string,args:any,id?:string)=>{
   expect(JSON.parse(await readFile(path.join(directory,'operation.recovery-open.json'),'utf8')).id).toBe(id);
   pending={version:1,id,command,args,timeoutMs:1000};ledger.begin(pending);active=true;throw Error('response lost');
  });
  const verify=vi.fn(async()=>{}),host={read,mutate};
  await expect(ensureArchiveRecoveryProject(host,pin,directory,'operation',verify)).rejects.toThrow('response lost');
  await expect(ensureArchiveRecoveryProject(host,pin,directory,'operation',verify)).rejects.toThrow('RECOVERY_OPEN_STILL_UNVERIFIED');
  ledger.complete({version:1,id:pending.id,ok:true,result:{status:'pass'},durationMs:1});
  await ensureArchiveRecoveryProject(host,pin,directory,'operation',verify);
  expect(mutate).toHaveBeenCalledOnce();expect(verify).toHaveBeenCalledOnce();
  active=false;await expect(ensureArchiveRecoveryProject(host,pin,directory,'operation',verify)).rejects.toThrow('CLOSED_AFTER_VERIFIED_OPEN');expect(mutate).toHaveBeenCalledOnce();
 });
 it.each(['different_file','different_project','corrupt_file','wrong_recovery_args','path_escape'])('refuses unsafe recovery: %s',async fault=>{
  const directory=await freshTestDirectory('archive-recovery-guard'),mutate=vi.fn();
  const read=vi.fn(async()=>fault==='corrupt_file'?{activeProject:false}:{...pin,activeProject:true,...(fault==='different_file'?{projectPath:'C:\\other.prproj'}:{}),...(fault==='different_project'?{projectId:'other'}:{})});
  if(fault==='wrong_recovery_args')await writeFile(path.join(directory,'operation.recovery-open.json'),JSON.stringify({id:'previous',args:{projectPath:'C:\\other'}}));
  const verify=async()=>{throw Error('CONTENT_CHANGED');};
  await expect(ensureArchiveRecoveryProject({read,mutate},pin,directory,fault==='path_escape'?'../other':'operation',verify)).rejects.toThrow();expect(mutate).not.toHaveBeenCalled();
 });
});
