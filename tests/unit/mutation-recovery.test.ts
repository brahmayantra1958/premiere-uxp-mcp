import {describe,it,expect,vi} from 'vitest';
import path from 'node:path';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {freshTestDirectory} from '../helpers/workspace.js';
import {AuditLog,ReceiptStore} from '../../apps/mcp-server/src/audit.js';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {CommandExecutionLedger} from '../../apps/uxp-plugin/src/command-execution-ledger.js';
import {recoveryExecutionProof} from '../../apps/mcp-server/src/mutation-recovery.js';
import type {BridgeRequest,BridgeResponse} from '@premiere-uxp/contracts';
import {createOperationFingerprint} from '../../apps/mcp-server/src/operation-identity.js';

const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'WORKING__s'};
async function fixture(){
 const directory=await freshTestDirectory('recovery'),file=path.join(directory,'receipts.json'),store=new ReceiptStore(file);
 let ledger=new CommandExecutionLedger(),fault='drop',context={projectId:'p',sequenceId:'s'},pending:BridgeRequest|undefined;
 const edits:BridgeRequest[]=[];
 const done=(request:BridgeRequest)=>({version:1 as const,id:request.id,ok:true,result:{status:'pass',after:{verified:true}},durationMs:1});
 const bridge={getStatus:()=>({}),async call(request:BridgeRequest):Promise<BridgeResponse>{
  if(request.command==='inspect_command_execution')return {...done(request),result:ledger.inspect(request.args.commandIds)};
  if(request.command==='inspect_host_context')return {...done(request),result:context};
  ledger.begin(request);edits.push(request);
  if(fault==='running'){pending=request;throw Error('timed out after dispatch');}
  const response=fault==='safe_fail'?{...done(request),result:{status:'fail',hostResult:{contentDispatched:false},errors:['VIEW_UNVERIFIED']}}:done(request);
  ledger.complete(response);
  if(fault==='drop')throw Error('disconnected while a command was running');
  return response;
 }};
 const host=new HostExecutor(bridge as any,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
 return {host,store,file,edits,setFault:(s:string)=>{fault=s;},changeContext:()=>{context={projectId:'other',sequenceId:'s'};},reload:()=>{ledger=new CommandExecutionLedger();},finish:()=>{if(pending)ledger.complete(done(pending));}};
}
describe('uncertain mutation recovery (fault-injected protocol, not live proof)',()=>{
 it.each(['same','changed_context','different_error','content_command'])('reconciles only terminal pre-navigation missing-clip rejection: %s',async fault=>{
  const directory=await freshTestDirectory('navigation-rejection'),file=path.join(directory,'receipts.json'),store=new ReceiptStore(file),command=fault==='content_command'?'remove_clip':'focus_timeline';
  const navArgs={expectedProjectId:'p',sequenceId:'s',trackItemIds:['gone']},id='navigation-rejected';
  const request:BridgeRequest={version:1,id,command,args:navArgs,timeoutMs:1000},ledger=new CommandExecutionLedger();
  ledger.begin(request);ledger.complete({version:1,id,ok:false,error:{code:fault==='different_error'?'HOST_ERROR':'TRACK_ITEM_NOT_FOUND',message:'missing'},durationMs:1});
  const original={commandId:id,command,requestFingerprint:createOperationFingerprint(command,navArgs),status:'unverified' as const,changedFiles:[],errors:['missing'],startedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
  await store.runExclusive(id,async()=>{await store.intent(id,command,navArgs,'host');await store.dispatched(id);await store.set(original);});
  const bridge={call:vi.fn(async(r:BridgeRequest)=>({version:1,id:r.id,ok:true,result:r.command==='inspect_command_execution'?ledger.inspect(r.args.commandIds):{projectId:fault==='changed_context'?'other':'p',sequenceId:'s'},durationMs:1}))};
  const host=new HostExecutor(bridge as any,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
  expect(await host.reconcileMutation(id)).toMatchObject({status:fault==='same'?'pass':'unverified',quarantineReleased:fault==='same'});
  expect(await store.get(id)).toEqual(original);expect(bridge.call.mock.calls.every(([r])=>['inspect_command_execution','inspect_host_context'].includes(r.command))).toBe(true);
 });

 it.each(['Premiere runtime POST /call failed: Premiere UXP panel is not connected','Premiere runtime POST /call failed: Premiere panel disconnected while a command was running','fetch failed'])('distinguishes a proven pre-send rejection from unknown transport failure: %s',async message=>{
  const directory=await freshTestDirectory('predispatch-rejection'),file=path.join(directory,'receipts.json'),store=new ReceiptStore(file);
  const bridge={async call(){throw Error(message);}},host=new HostExecutor(bridge as any,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
  const receipt=await host.mutate('open_working_project',{projectPath:'C:/scratch/test.prproj'},'open',{lifecycleWithoutActiveProject:true});
  const safe=message.endsWith('panel is not connected');expect(receipt.status).toBe(safe?'fail':'unverified');
  expect(Boolean(await store.inspectRecovery())).toBe(!safe);
 });
 it('migrates only the exact persisted legacy pre-send rejection without host dispatch or changing its receipt',async()=>{
  const directory=await freshTestDirectory('legacy-predispatch'),file=path.join(directory,'receipts.json'),store=new ReceiptStore(file),command='open_working_project',openArgs={projectPath:'C:/scratch/test.prproj'};
  const receipt={commandId:'open',command,requestFingerprint:createOperationFingerprint(command,openArgs),status:'unverified' as const,changedFiles:[],errors:['Premiere runtime POST /call failed: Premiere UXP panel is not connected'],startedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
  await store.runExclusive('open',async()=>{await store.intent('open',command,openArgs,'host');await store.dispatched('open');await store.set(receipt);});
  const call=vi.fn(),host=new HostExecutor({call} as any,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
  expect(await host.reconcileMutation('open')).toMatchObject({status:'pass',quarantineReleased:true,contentDispatched:false});
  expect(call).not.toHaveBeenCalled();expect(await store.get('open')).toEqual(receipt);
 });
 it.each(['pass','running','lost','bad_step'] as const)('holds an accepted track job lease until exact terminal proof: %s',async state=>{
  const directory=await freshTestDirectory('track-job-lease'),file=path.join(directory,'receipts.json'),store=new ReceiptStore(file),ledger=new CommandExecutionLedger();
  const plan={...args,steps:[{clipRef:'voice',destinationTrackIndex:0}]};let mutations=0;
  const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{let result:any;
   if(request.command==='inspect_project')result={projectId:'p',projectName:'test',projectPath:'C:/scratch/test.prproj',capturedAt:'2026-09-17T00:00:00.000Z',activeSequence:null,sequences:[],projectItems:[],projectItemLimit:500,projectItemsTruncated:false,offlineMediaIds:[],proxyAttachments:[],markers:[],mogrtItems:[],effects:[],audioState:[],unsupportedFields:[]};
   else if(request.command==='inspect_command_execution')result=ledger.inspect(request.args.commandIds);
   else if(request.command==='inspect_host_context')result={projectId:'p',sequenceId:'s'};
   else if(request.command==='get_track_command_sequence_status')result={protocolVersion:1,jobId:'job',state:state==='lost'?'unverified':state==='running'?'running':'pass',completedSteps:1,totalSteps:1,preservation:{expectedState:'pass',errors:[]},results:[{index:0,status:'pass',clipRef:state==='bad_step'?'other':'voice',destinationTrackIndex:0}],nextCursor:1,hasMore:false};
   else{mutations++;ledger.begin(request);result={status:'partial',hostResult:{jobId:'job'}};}
   const response={version:1 as const,id:request.id,ok:true,durationMs:1,result};if(request.command==='submit_track_command_sequence')ledger.complete(response);return response;}};
  const host=new HostExecutor(bridge as any,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
  const receipt=await host.mutate('submit_track_command_sequence',plan,'job');expect(receipt.status).toBe('partial');
  await expect(new ReceiptStore(file).runExclusive('other',async()=>1)).rejects.toThrow('MUTATION_IN_PROGRESS_OR_UNVERIFIED');
  const status=await host.trackSequenceStatus({jobId:'job',cursor:0});
  if(state==='pass'){expect(status.mutationRecovery).toMatchObject({status:'pass',quarantineReleased:true});expect(await store.inspectRecovery()).toBeUndefined();}
  else expect(await store.inspectRecovery()).toBeDefined();
  expect(await store.get('job')).toEqual(receipt);expect(mutations).toBe(1);
 });
 it('blocks another client and operation ID, then reconciles a late terminal response without replay',async()=>{
  const f=await fixture(),receipt=await f.host.mutate('save_working_project',args,'original');
  expect(receipt.status).toBe('unverified');
  await expect(new ReceiptStore(f.file).runExclusive('other',async()=>1)).rejects.toThrow('MUTATION_IN_PROGRESS_OR_UNVERIFIED');
  await expect(f.host.mutate('save_working_project',args,'new-id')).rejects.toThrow('MUTATION_IN_PROGRESS_OR_UNVERIFIED');
  expect(await f.host.mutate('save_working_project',args,'original')).toEqual(receipt);
  const proof=await f.host.reconcileMutation('original');expect(proof).toMatchObject({status:'pass',quarantineReleased:true,originalReceiptUnchanged:true});
  expect(await f.store.get('original')).toEqual(receipt);expect(f.edits).toHaveLength(1);
  expect(JSON.parse(await readFile(proof.evidence,'utf8')).proof.outcome).toBe('late_verified_completion');
  f.setFault('none');expect((await f.host.mutate('save_working_project',args,'next')).status).toBe('pass');
 });
 it.each(['running','reload','changed_context'] as const)('retains quarantine when evidence cannot prove completion: %s',async fault=>{
  const f=await fixture();if(fault==='running')f.setFault('running');
  await f.host.mutate('save_working_project',args,'uncertain');
  if(fault==='reload')f.reload();if(fault==='changed_context')f.changeContext();
  expect(await f.host.reconcileMutation('uncertain')).toMatchObject({status:'unverified',quarantineReleased:false});
  expect(await f.store.inspectRecovery()).toBeDefined();expect(f.edits).toHaveLength(1);
  if(fault==='running'){f.finish();expect((await f.host.reconcileMutation('uncertain')).status).toBe('pass');}
 });
 it('allows a fresh command after an explicitly proven pre-content visibility rejection',async()=>{
  const f=await fixture();f.setFault('safe_fail');expect((await f.host.mutate('save_working_project',args,'view-failed')).status).toBe('fail');
  expect(await f.store.inspectRecovery()).toBeUndefined();f.setFault('none');expect((await f.host.mutate('save_working_project',args,'retry')).status).toBe('pass');
 });
 it('preserves previously witnessed completion across panel recreation while still requiring current quiescence',async()=>{
  const f=await fixture();await f.host.mutate('save_working_project',args,'uncertain');
  await f.host.inspectMutationRecovery();f.reload();
  expect(await f.host.reconcileMutation('uncertain')).toMatchObject({status:'pass',quarantineReleased:true});expect(f.edits).toHaveLength(1);
 });
 it('recovers from a durable runtime witness after ledger loss without a prior inspection',async()=>{
  const f=await fixture();await f.host.mutate('save_working_project',args,'durable');
  const request=f.edits[0]!,evidence=f.store.executionEvidence,identity=await evidence.prepare(request);
  await evidence.complete(identity!,{version:1,id:request.id,ok:true,result:{status:'pass',after:{verified:true}},durationMs:1});
  f.reload();expect(await f.host.reconcileMutation('durable')).toMatchObject({status:'pass',quarantineReleased:true});expect(f.edits).toHaveLength(1);
 });
 it('quarantines returned UNVERIFIED as well as thrown local exceptions, including nested continuation',async()=>{
  for(const throws of [false,true]){
   const f=await fixture(),next=vi.fn();
   const receipt=await f.host.mutateLocal('archive',args,async()=>{
    if(throws)throw Error('open dispatched but response lost');return {status:'unverified',result:{}};
   },'archive');expect(receipt.status).toBe('unverified');
   await expect(f.host.mutateLocal('next',args,next,'next')).rejects.toThrow('MUTATION_IN_PROGRESS_OR_UNVERIFIED');expect(next).not.toHaveBeenCalled();
  }
  const f=await fixture();await f.store.runExclusive('composed',async()=>{
   await f.store.intent('composed','archive',args,'local');await f.store.quarantine('uncertain nested step');
   await expect(f.store.runExclusive('nested',async()=>1)).rejects.toThrow('MUTATION_IN_PROGRESS_OR_UNVERIFIED');
  });
 });
 it('persists recovery action intent before invoking the verifier and never clears failed proof',async()=>{
  const f=await fixture();await f.host.mutate('save_working_project',args,'uncertain');
  await f.store.reconcile('uncertain',async(_,recovery)=>{
   await recovery.record({commandId:'reopen',command:'open_working_project',args:{projectPath:'C:\\scoped.prproj'},kind:'host',state:'dispatched',dispatched:true});
   expect(JSON.parse(await readFile(f.file+'.mutation-lock.recovery-actions.json','utf8')).actions[0].commandId).toBe('reopen');
   return {status:'unverified'};
  });
  expect(await f.store.inspectRecovery()).toBeDefined();
 });
 it.skipIf(process.platform!=='win32')('recovers a dead verifier guard without clearing the uncertain mutation or executing it',async()=>{
  const f=await fixture();await f.host.mutate('save_working_project',args,'uncertain');
  await writeFile(f.file+'.mutation-lock.recovery',JSON.stringify({processId:2147483647,commandId:'uncertain'}));
  expect((await f.host.reconcileMutation('uncertain')).status).toBe('pass');expect(f.edits).toHaveLength(1);
  expect((await readdir(path.dirname(f.file))).some(n=>n.includes('.recovery.abandoned-'))).toBe(true);
 });
});
describe('panel execution evidence',()=>{
 const request:BridgeRequest={version:1,id:'one',command:'save',args:{b:2,a:1},timeoutMs:1000};
 const response:BridgeResponse={version:1,id:'one',ok:true,result:{status:'pass'},durationMs:1};
 it('rejects in-flight duplicates and changed arguments, preserves completed identity, and forgets on reload',()=>{
  const ledger=new CommandExecutionLedger();ledger.begin(request);
  expect(()=>ledger.begin(request)).toThrow('HOST_COMMAND_IN_FLIGHT');expect(()=>ledger.begin({...request,args:{a:2}})).toThrow('IDEMPOTENCY_CONFLICT');
  expect(ledger.inspect(['one']).commands[0]?.state).toBe('running');ledger.complete(response);
  expect(ledger.begin({...request,args:{a:1,b:2}})).toEqual(response);
  expect(new CommandExecutionLedger().inspect(['one']).commands[0]?.state).toBe('unknown');
 });
 it.each(['args','command','id','duplicate','active'])('rejects unrelated terminal evidence: %s',fault=>{
  const ledger=new CommandExecutionLedger();ledger.begin(request);ledger.complete(response);const observed:any=ledger.inspect(['one']);
  if(fault==='args')observed.commands[0].fingerprint='wrong';if(fault==='command')observed.commands[0].command='other';if(fault==='id')observed.commands[0].response={...response,id:'other'};
  if(fault==='duplicate')observed.commands.push(observed.commands[0]);if(fault==='active')observed.active.push({id:'busy'});
  expect(()=>recoveryExecutionProof({version:1,commandId:'one',processId:1,startedAt:'now',operations:[{commandId:'one',command:'save',args:request.args,kind:'host',state:'dispatched',dispatched:true}]},observed)).toThrow('RECOVERY_');
 });
});
