import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {describe,expect,it,vi} from 'vitest';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {AuditLog,ReceiptStore} from '../../apps/mcp-server/src/audit.js';
import {BridgeTransportError} from '../../apps/mcp-server/src/bridge-transport.js';
import {freshTestDirectory} from '../helpers/workspace.js';
import type {BridgeRequest} from '@premiere-uxp/contracts';

async function fixture(name:string,call:(request:BridgeRequest)=>Promise<any>){
 const directory=await freshTestDirectory(name),store=new ReceiptStore(path.join(directory,'receipts.json')),auditPath=path.join(directory,'audit.jsonl');
 return {store,auditPath,host:new HostExecutor({call} as any,new AuditLog(auditPath),store,1000)};
}
describe('mutation dispatch boundary transport classification',()=>{
 it.each(['PANEL_MESSAGE_TOO_LARGE','PANEL_COMMAND_TIMEOUT','RUNTIME_REQUEST_FAILED'] as const)('a planning read failure is host_transient with no root content dispatch: %s',async code=>{
  const calls:string[]=[],f=await fixture('planning-'+code,async request=>{calls.push(request.command);throw new BridgeTransportError('disconnected while a command was running',{code,dispatchState:'unknown'});});
  const receipt=await f.host.mutate('set_timeline_selection',{expectedProjectId:'p',expectedSequenceId:'s'},'planned');
  expect(calls).toEqual(['inspect_project']);expect(receipt).toMatchObject({status:'fail',errorClassification:'host_transient',hostResult:{contentDispatched:false,dispatchRejection:'planning_transport_failure'}});
  expect(await f.store.inspectRecovery()).toBeUndefined();
 });
 it.each(['not_sent','unknown'] as const)('only an explicit root not_sent proof permits a safe failure: %s',async dispatchState=>{
  const call=vi.fn(async()=>{throw new BridgeTransportError('fetch failed',{code:'RUNTIME_REQUEST_FAILED',dispatchState});}),f=await fixture('root-'+dispatchState,call);
  const receipt=await f.host.mutate('save_working_project',{},'root');
  expect(receipt.status).toBe(dispatchState==='not_sent'?'fail':'unverified');expect(Boolean(await f.store.inspectRecovery())).toBe(dispatchState==='unknown');expect(call).toHaveBeenCalledTimes(1);
 });
 it('exact trim delegates its preflight once to the host and retains returned before/after preservation proof',async()=>{
  const proof={status:'pass',before:{items:[{id:'clip'}]},after:{items:[{id:'clip',end:2}]},hostResult:{componentsPreserved:true,transitionsUnchanged:true,trackCountsUnchanged:true},errors:[]};
  const call=vi.fn(async(request:BridgeRequest)=>({version:1,id:request.id,ok:true,result:proof,durationMs:1})),f=await fixture('trim-planning',call);
  const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'Sequence',trim:{trackItemId:'clip'}};
  expect(await f.host.mutate('trim_clip_exact',args,'trim')).toMatchObject(proof);
  expect(call.mock.calls.map(([r])=>r.command)).toEqual(['trim_clip_exact']);
  expect((await readFile(f.auditPath,'utf8')).split('\n').filter(Boolean).map(s=>JSON.parse(s).kind)).toContain('host-preflight-plan');
 });
 it.each(['expectedProjectId','expectedSequenceId','expectedSequenceName','trim'])('rejects incomplete exact trim pins before dispatch: %s',async key=>{
  const call=vi.fn(),f=await fixture('trim-missing-'+key,call),args:Record<string,unknown>={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'Sequence',trim:{trackItemId:'clip'}};delete args[key];
  expect(await f.host.mutate('trim_clip_exact',args,'trim')).toMatchObject({status:'fail',errorClassification:'preflight',hostResult:{contentDispatched:false}});expect(call).not.toHaveBeenCalled();
 });
});
