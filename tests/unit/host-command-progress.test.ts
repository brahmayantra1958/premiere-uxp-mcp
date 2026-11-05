import {describe,it,expect,vi} from 'vitest';
import path from 'node:path';
import {freshTestDirectory} from '../helpers/workspace.js';
import {AuditLog,ReceiptStore} from '../../apps/mcp-server/src/audit.js';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {createOperationFingerprint} from '../../apps/mcp-server/src/operation-identity.js';
import type {BridgeRequest} from '../../apps/uxp-plugin/src/wire.js';
import {BridgeClient} from '../../apps/uxp-plugin/src/bridge-client.js';
import {CommandExecutionLedger} from '../../apps/uxp-plugin/src/command-execution-ledger.js';
import {HostCommandQueue} from '../../apps/uxp-plugin/src/host-command-queue.js';
import {bindHostCommandProgress,hostCommandProgress,HostProgressRecorder,observeHostAwait,observeHostSync} from '../../apps/uxp-plugin/src/host-command-progress.js';

vi.mock('../../apps/uxp-plugin/src/host-context.js',()=>({ppro:{TickTime:{TIME_ZERO:{ticks:'0',seconds:0}},Keyframe:{INTERPOLATION_MODE_LINEAR:1,INTERPOLATION_MODE_HOLD:2,INTERPOLATION_MODE_BEZIER:3}},activeSequence:vi.fn()}));
vi.mock('../../apps/uxp-plugin/src/host-items.js',()=>({trackItems:vi.fn()}));
import {componentSnapshot} from '../../apps/uxp-plugin/src/host-components.js';

const request=(id:string,command='insert_mogrt_caption'):BridgeRequest=>({version:1,id,command,args:{},timeoutMs:1000});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

describe('memory-only native command diagnostics',()=>{
  it('exposes a stuck native getter through mutation recovery while keeping the command, read lane and queued commands active',async()=>{
    const directory=await freshTestDirectory('native-progress'),store=new ReceiptStore(path.join(directory,'receipts.json'));
    const pending=deferred<{value:number}>(),entered=deferred<void>(),queue=new HostCommandQueue(),sent=new Map<string,any>();
    let nextCommandRan=false,secondChainRead=false;
    const item={getComponentChain:async()=>({getComponentCount:()=>1,getComponentAtIndex:()=>({
      getParamCount:()=>1,getParam:()=>({displayName:'private parameter',getValueAtTime:()=>{entered.resolve();return pending.promise;},isTimeVarying:()=>false,areKeyframesSupported:async()=>false,getKeyframeListAsTickTimes:()=>[]}),
      getDisplayName:async()=>'private effect',getMatchName:async()=>'private match',
    })})};
    const client=new BridgeClient(r=>queue.run(r,async()=>{
      if(r.command!=='insert_mogrt_caption'){nextCommandRan=true;return {status:'pass'};}
      const trace=hostCommandProgress(r)?.at('graphic.components.readiness',{attempt:1});
      const components=await observeHostAwait(trace,'componentSnapshot',()=>componentSnapshot(item,true,false,undefined,undefined,trace));
      return {status:'pass',components};
    }),()=>{},()=>{},()=>{},()=>{}) as any;
    Object.assign(client,{authenticated:true,socket:{send:(text:string)=>{const response=JSON.parse(text);sent.set(response.id,response);}}});
    const graphic=request('stuck-native');
    const insertion=client.onMessage(JSON.stringify(graphic));await entered.promise;
    const queued=client.onMessage(JSON.stringify(request('queued-ping','premiere_ping')));
    const laterRead=componentSnapshot({getComponentChain:async()=>{secondChainRead=true;return {getComponentCount:()=>0};}},true);
    const original={commandId:graphic.id,command:graphic.command,requestFingerprint:createOperationFingerprint(graphic.command,graphic.args),status:'unverified' as const,changedFiles:[],errors:['transport timeout'],startedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
    await store.runExclusive(graphic.id,async()=>{await store.intent(graphic.id,graphic.command,graphic.args,'host');await store.dispatched(graphic.id);await store.set(original);});
    const bridge={async call(r:BridgeRequest){await client.onMessage(JSON.stringify(r));return sent.get(r.id);}};
    const host=new HostExecutor(bridge as any,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
    try {
      const recovery:any=await host.inspectMutationRecovery(),command=recovery.execution.commands[0];
      expect(recovery.quarantined).toBe(true);expect(command.state).toBe('running');expect(command.queueState).toBe('running');
      expect(command.diagnostics.current).toMatchObject({phase:'graphic.components.readiness',method:'getValueAtTime',attempt:1,componentIndex:0,paramIndex:0,startedAt:expect.any(Number)});
      expect(command.diagnostics.current.finishedAt).toBeUndefined();expect(command.diagnostics.activeCalls.map((c:any)=>c.method)).toEqual(['componentSnapshot','getValueAtTime']);
      expect(recovery.execution.active.find((c:any)=>c.id==='queued-ping')).toMatchObject({queueState:'queued'});
      expect(recovery.execution.active.find((c:any)=>c.id==='queued-ping').diagnostics).toBeUndefined();
      expect(nextCommandRan).toBe(false);expect(secondChainRead).toBe(false);
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(60_000);
      const again:any=await host.inspectMutationRecovery();expect(again.execution.commands[0].diagnostics).toEqual(command.diagnostics);
      expect(again.execution.commands[0].state).toBe('running');expect(nextCommandRan).toBe(false);expect(secondChainRead).toBe(false);
      vi.useRealTimers();
      expect(await store.get(graphic.id)).toEqual(original);
    } finally {vi.useRealTimers();pending.resolve({value:17});await insertion;await queued;await laterRead;}
    expect(nextCommandRan).toBe(true);expect(secondChainRead).toBe(true);
    const completed:any=await host.inspectMutationRecovery();expect(completed.execution.commands[0]).toMatchObject({state:'complete',queueState:'settled',diagnostics:{activeCalls:[]}});
    expect(await store.get(graphic.id)).toEqual(original);
  });

  it('keeps observer failures out of native returns, errors and queue expiration',async()=>{
    const r=request('observer-error'),queue=new HostCommandQueue(),fail=()=>{throw Error('observer only');};
    bindHostCommandProgress(r,{queue:fail,call:fail});
    const trace=hostCommandProgress(r),value={native:true},nativeError={nativeError:true};
    expect(await queue.run(r,async()=>observeHostSync(trace,'getParam',()=>value))).toBe(value);
    await expect(observeHostAwait(trace,'getValueAtTime',async()=>{throw nativeError;})).rejects.toBe(nativeError);
    expect(()=>observeHostSync(trace,'getParam',()=>{throw nativeError;})).toThrow();
    const busy=request('busy'),expires={...request('expired','premiere_ping'),timeoutMs:0},hold=deferred<void>();
    bindHostCommandProgress(busy,{queue:fail});bindHostCommandProgress(expires,{queue:fail});
    const active=queue.run(busy,()=>hold.promise),action=vi.fn(async()=>true),waiting=queue.run(expires,action);
    const expired=expect(waiting).rejects.toThrow('Request expired');
    hold.resolve();await active;await expired;expect(action).not.toHaveBeenCalled();expect(queue.inspect()).toEqual([]);
  });

  it('bounds observations, strips unexpected fields and leaves unrelated command diagnostics disabled',async()=>{
    const ledger=new CommandExecutionLedger(),r=request('bounded');ledger.begin(r);
    const trace=hostCommandProgress(r)!;
    for(let index=0;index<100;index++)await observeHostAwait(trace.at('graphic.components.final',{attempt:index}),'getValueAtTime',async()=>({token:'private value',path:'C:/private/file'}),{componentIndex:1,paramIndex:2,secret:'private extra'} as any);
    const diagnostic:any=ledger.inspect([r.id]).commands[0]!.diagnostics;
    expect(diagnostic.recentCalls).toHaveLength(12);expect(diagnostic.activeCalls).toEqual([]);expect(diagnostic.lastStartedAt).toEqual(expect.any(Number));
    expect(JSON.stringify(diagnostic)).not.toMatch(/private|token|secret|C:\//);
    diagnostic.recentCalls[0].method='changed';expect(JSON.stringify(ledger.inspect([r.id]).commands[0]!.diagnostics)).not.toContain('changed');
    const recorder=new HostProgressRecorder();recorder.record({phase:'C:/private/phase',method:'getValueAtTime',callId:1,startedAt:1} as any);
    recorder.record({phase:'graphic.components.final',method:'getValueAtTime',callId:2,startedAt:1,finishedAt:2,outcome:'private secret'} as any);expect(recorder.inspect().recentCalls).toEqual([]);
    const normal=request('normal','get_agent_context');ledger.begin(normal);expect(hostCommandProgress(normal)).toBeUndefined();expect(ledger.inspect(['normal']).commands[0]!.diagnostics).toBeUndefined();
  });
});
