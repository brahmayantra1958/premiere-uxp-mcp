import {describe,it,expect} from 'vitest';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {freshTestDirectory} from '../helpers/workspace.js';
import {ExecutionEvidenceStore} from '../../apps/mcp-server/src/execution-evidence.js';
import type {BridgeRequest} from '@premiere-uxp/contracts';
async function fixture(maximum=1000){
 const directory=await freshTestDirectory('durable-terminal'),file=path.join(directory,'idempotency.json'),store=new ExecutionEvidenceStore(file,maximum);
 const request:BridgeRequest={version:1,id:'step',command:'set_effect_values',args:{b:2,a:1},timeoutMs:100};
 const lease={version:1,commandId:'root',operations:[{kind:'host',commandId:'step',command:request.command,args:request.args,dispatched:true}]};
 await writeFile(file+'.mutation-lock',JSON.stringify(lease));return {directory,file,store,request,lease};
}
describe('durable terminal evidence (never an execution queue)',()=>{
 it('survives runtime recreation without requiring a ledger query or rotating audit',async()=>{
  const f=await fixture(),identity=await f.store.prepare(f.request);expect(identity).toBeDefined();
  const response={version:1 as const,id:'step',ok:true,result:{status:'pass',after:{value:2}},durationMs:9};
  await f.store.complete(identity!,response);
  const [row]=await new ExecutionEvidenceStore(f.file).find(['step']);expect(row).toMatchObject({state:'complete',rootOperationId:'root',response});
  expect(JSON.parse(await readFile(row!.evidenceSource,'utf8')).response).toEqual(response);
 });
 it('does not fabricate evidence for absent/uncompleted commands or mismatched intent',async()=>{
  const f=await fixture();expect(await f.store.find(['step'])).toEqual([]);
  expect(await f.store.prepare({...f.request,id:'unrelated'})).toBeUndefined();
  await expect(f.store.prepare({...f.request,args:{a:9}})).rejects.toThrow('INTENT_MISMATCH');
  const identity=await f.store.prepare(f.request);
  await expect(f.store.complete(identity!,{version:1,id:'other',ok:true,durationMs:0})).rejects.toThrow('RESPONSE_MISMATCH');
  expect(await f.store.find(['step'])).toEqual([]);
 });
 it('retains active root evidence beyond ordinary history retention, and preserves failed/unknown status',async()=>{
  const f=await fixture(1),identity=(await f.store.prepare(f.request))!;
  await f.store.complete(identity,{version:1,id:'step',ok:true,result:{status:'unverified'},durationMs:0});
  for(let i=0;i<33;i++)await f.store.complete({...identity,id:'other-'+i,rootOperationId:'finished'},{version:1,id:'other-'+i,ok:true,result:{status:'pass'},durationMs:0});
  const [row]=await f.store.find(['step']);expect(row?.response.result.status).toBe('unverified');
  expect((await readdir(f.store.directory)).length).toBeLessThanOrEqual(3);
 });
 it('supports write-ahead recovery actions and rejects corrupted evidence',async()=>{
  const f=await fixture(),request={...f.request,id:'reopen',command:'open_working_project'};
  await writeFile(f.file+'.mutation-lock.recovery-actions.json',JSON.stringify({actions:[{commandId:request.id,command:request.command,args:request.args,kind:'host',dispatched:true}]}));
  const identity=(await f.store.prepare(request))!;expect(identity.rootOperationId).toBe('root');
  await f.store.complete(identity,{version:1,id:request.id,ok:false,error:{code:'HOST_ERROR',message:'Failed'},durationMs:0});
  const [row]=await f.store.find([request.id]);await writeFile(row!.evidenceSource,JSON.stringify({...row,id:'wrong'}));
  await expect(f.store.find([request.id])).rejects.toThrow('CORRUPT');
 });
});
