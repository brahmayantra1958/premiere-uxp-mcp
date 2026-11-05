import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {WebSocket} from 'ws';
import {UxpBridgeServer} from '../../apps/mcp-server/src/bridge.js';
import {maximumAuthenticationBytes,maximumPanelMessageBytes} from '../../apps/mcp-server/src/bridge-transport.js';
import {RuntimeControlServer} from '../../apps/mcp-server/src/runtime-control.js';
import {RemoteBridge} from '../../apps/mcp-server/src/remote-bridge.js';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {AuditLog,ReceiptStore} from '../../apps/mcp-server/src/audit.js';
import {freshTestDirectory} from '../helpers/workspace.js';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(name:string){
 const directory=await freshTestDirectory(name),server=createServer();
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('No test port');
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 const tokenPath=path.join(directory,'token.txt'),bridge=new UxpBridgeServer('127.0.0.1',address.port,tokenPath,path.join(directory,'credentials.json'));
 await bridge.start();cleanup.push(()=>bridge.stop());
 const token=await readFile(tokenPath,'utf8'),control=new RuntimeControlServer({host:'127.0.0.1',port:0,token,bridge,onShutdown(){}});
 const url=`http://127.0.0.1:${await control.start()}`;cleanup.push(()=>control.stop());
 async function peer(authenticate=true){
  const socket=new WebSocket(`ws://127.0.0.1:${address!.port}/`);
  cleanup.push(async()=>{socket.terminate();});
  await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  if(authenticate){
   const ack=new Promise<any>(resolve=>socket.once('message',data=>resolve(JSON.parse(data.toString()))));
   socket.send(JSON.stringify({version:1,type:'authenticate',method:'pairing_token',token,projectId:'test-project',client:'premiere-uxp-panel'}));
   expect(await ack).toMatchObject({type:'authenticated',ok:true});
  }
  return socket;
 }
 return {directory,bridge,peer,url,remote:new RemoteBridge(url,tokenPath,async()=>undefined,1000)};
}

describe('bounded panel transport (synthetic protocol proof, not live Premiere)',()=>{
 it.each([{clips:200,bytes:10_699_089},{clips:1000,bytes:56_606_637}])('roundtrips the observed-shape $clips-clip byte model above the old 8 MiB limit',async({clips,bytes})=>{
  const f=await fixture('transport-model-'+clips),socket=await f.peer();
  // Sizes model the observed 154-clip detailed snapshot, without retaining any
  // user media, paths or content. The 1,000 case uses the larger all-MOGRT model.
  const result={activeSequence:{items:Array.from({length:clips},(_,i)=>({id:'clip-'+i}))},effects:Array.from({length:clips},(_,i)=>({trackItemId:'clip-'+i,value:'x'.repeat(Math.floor((bytes-100_000)/clips))}))};
  const request={version:1 as const,id:randomUUID(),command:'inspect_project',args:{},timeoutMs:15_000};
  const wire=JSON.stringify({version:1,id:request.id,ok:true,result,durationMs:1});
  expect(Buffer.byteLength(wire)).toBeGreaterThan(8*1024*1024);expect(Buffer.byteLength(wire)).toBeLessThan(maximumPanelMessageBytes);
  socket.once('message',()=>socket.send(wire));
  const response=await f.remote.call(request);
  expect((response.result as typeof result).activeSequence.items).toHaveLength(clips);
  expect((response.result as typeof result).effects.at(-1)).toEqual(result.effects.at(-1));
 },30_000);

 it('survives a frame beyond the cap, quarantines dispatched content, and accepts a new authenticated panel without replay',async()=>{
  const f=await fixture('transport-overflow'),socket=await f.peer(),store=new ReceiptStore(path.join(f.directory,'idempotency.json'));
  const host=new HostExecutor(f.remote,new AuditLog(path.join(f.directory,'audit.jsonl')),store,15_000);let calls=0;
  socket.once('message',()=>{calls++;socket.send(Buffer.alloc(maximumPanelMessageBytes+1,0x61),{binary:false},()=>undefined);});
  const receipt=await host.mutate('save_working_project',{},'overflow-write');
  expect(receipt).toMatchObject({status:'unverified',errorClassification:'postcondition',hostResult:{transport:{code:'PANEL_MESSAGE_TOO_LARGE',dispatchState:'unknown'}}});
  expect((receipt.hostResult as any)?.contentDispatched).not.toBe(false);
  expect(await store.inspectRecovery()).toBeDefined();
  expect(await host.mutate('save_working_project',{},'overflow-write')).toEqual(receipt);
  await expect(host.mutate('save_working_project',{},'new-write')).rejects.toThrow('MUTATION_IN_PROGRESS_OR_UNVERIFIED');
  expect(await fetch(f.url+'/health').then(r=>r.json())).toMatchObject({ready:true,processId:process.pid});
  const replacement=await f.peer();replacement.once('message',raw=>{const request=JSON.parse(raw.toString());replacement.send(JSON.stringify({version:1,id:request.id,ok:true,result:{alive:true},durationMs:1}));});
  expect(await f.remote.call({version:1,id:randomUUID(),command:'premiere_ping',args:{},timeoutMs:1000})).toMatchObject({ok:true,result:{alive:true}});
  expect(await store.get('overflow-write')).toEqual(receipt);expect(calls).toBe(1);
 },30_000);

 it('retains the separate durable-write budget and never acknowledges an oversized mutation proof as PASS',async()=>{
  const f=await fixture('transport-proof-budget'),socket=await f.peer(),store=new ReceiptStore(path.join(f.directory,'idempotency.json'));
  const host=new HostExecutor(f.remote,new AuditLog(path.join(f.directory,'audit.jsonl')),store,15_000);
  socket.once('message',raw=>socket.send(JSON.stringify({version:1,id:JSON.parse(raw.toString()).id,ok:true,result:{status:'pass',after:{proof:'x'.repeat(9*1024*1024)}},durationMs:1})));
  const receipt=await host.mutate('save_working_project',{},'large-proof');
  expect(receipt.status).toBe('unverified');expect(receipt.errors.join(' ')).toContain('EXECUTION_EVIDENCE_NOT_DURABLE');
  expect(await store.inspectRecovery()).toBeDefined();expect(await store.executionEvidence.find(['large-proof'])).toEqual([]);
  expect(f.bridge.status().connected).toBe(true);
 });

 it.each(['invalid-utf8','large-auth'] as const)('contains unauthenticated %s without disconnecting the owner',async fault=>{
  const f=await fixture('transport-auth-'+fault),owner=await f.peer(),peer=await f.peer(false);
  const closed=new Promise<number>(resolve=>peer.once('close',resolve));
  if(fault==='invalid-utf8')peer.send(Buffer.from([0xff]),{binary:false});
  else peer.send('a'.repeat(maximumAuthenticationBytes+1));
  expect(await closed).toBe(fault==='large-auth'?1009:1007);
  expect(f.bridge.status().connected).toBe(true);
  owner.once('message',raw=>owner.send(JSON.stringify({version:1,id:JSON.parse(raw.toString()).id,ok:true,result:{alive:true},durationMs:1})));
  expect(await f.remote.call({version:1,id:randomUUID(),command:'premiere_ping',args:{},timeoutMs:1000})).toMatchObject({ok:true});
 });
});
