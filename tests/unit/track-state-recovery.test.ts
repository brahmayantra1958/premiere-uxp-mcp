import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {freshTestDirectory} from '../helpers/workspace.js';
import {AuditLog,ReceiptStore} from '../../apps/mcp-server/src/audit.js';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {assessRejectedTrackStateRecovery} from '../../apps/mcp-server/src/track-state-recovery.js';
import {canonicalizeOperationValue,createOperationFingerprint} from '../../apps/mcp-server/src/operation-identity.js';

const args={edits:[{mediaType:'audio',trackIndex:0,muted:true}]};
const baseline={commandId:'prior',projectId:'p',sequenceId:'s',sequenceName:'Sound',tracks:[{mediaType:'audio',index:0,id:2,name:'Audio',muted:false,itemCount:2,transitionCount:0}]};
const current={...baseline,status:'pass'};
describe('terminal track scope rejection recovery',()=>{
  it('proves unchanged state, without claiming the failed command was never dispatched',()=>{
    expect(assessRejectedTrackStateRecovery(args,baseline,current)).toMatchObject({status:'pass',contentReplayed:false,outcome:'verified_track_state_unchanged_after_terminal_error'});
  });
  it.each(['partial-mute','rename','different-track-id','missing-track','different-sequence','different-project','unsupported-caption'] as const)('fails closed for %s',fault=>{
    const observed=structuredClone(current),input:any=structuredClone(args);
    if(fault==='partial-mute')observed.tracks[0]!.muted=true;
    if(fault==='rename')input.edits[0].name='Other';
    if(fault==='different-track-id')observed.tracks[0]!.id=3;
    if(fault==='missing-track')observed.tracks=[];
    if(fault==='different-sequence')observed.sequenceId='other';
    if(fault==='different-project')observed.projectId='other';
    if(fault==='unsupported-caption')input.edits[0].mediaType='caption';
    expect(()=>assessRejectedTrackStateRecovery(input,baseline,observed)).toThrow('RECOVERY_');
  });
  it.each(['unchanged','changed','missing-baseline','wrong-error'] as const)('reconciles only exact terminal evidence with durable baseline: %s',async fault=>{
    const dir=await freshTestDirectory('track-scope-recovery'),audit=new AuditLog(path.join(dir,'audit.jsonl')),store=new ReceiptStore(path.join(dir,'receipts.json'));
    if(fault!=='missing-baseline'){
      await audit.append({kind:'plan',commandId:'prior',plan:{baseProjectId:'p',baseSequenceId:'s',workingSequenceName:'Sound',operations:[{command:'set_track_state',args}]}});
      await audit.append({kind:'mutation',request:{id:'prior',command:'set_track_state',args},receipt:{commandId:'prior',status:'pass',completedAt:'2000-01-01T00:00:00.000Z',after:{id:'s',name:'Sound',tracks:baseline.tracks}}});
    }
    const response={version:1,id:'failed',ok:false,error:{code:fault==='wrong-error'?'UNKNOWN_ERROR':'DESIGNATED_SEQUENCE_MISMATCH',message:'scope'},durationMs:1};
    const ledger={status:'pass',protocol:1,sessionId:'session',active:[],commands:[{id:'failed',state:'complete',command:'set_track_state',fingerprint:JSON.stringify(['set_track_state',canonicalizeOperationValue(args)]),response}]};
    const receipt={commandId:'failed',command:'set_track_state',requestFingerprint:createOperationFingerprint('set_track_state',args),status:'unverified' as const,changedFiles:[],errors:['scope'],startedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
    await store.runExclusive('failed',async()=>{await store.intent('failed','set_track_state',args,'host');await store.dispatched('failed');await store.set(receipt);});
    const calls:string[]=[];
    const bridge={async call(request:any){calls.push(request.command);if(!['inspect_command_execution','inspect_designated_track_state'].includes(request.command))throw Error('Mutation or unrelated read forbidden');return {version:1,id:request.id,ok:true,durationMs:1,result:request.command==='inspect_command_execution'?ledger:fault==='changed'?{...current,tracks:[{...baseline.tracks[0],muted:true}]}:current};}};
    const host=new HostExecutor(bridge as any,audit,store,1000),proof=await host.reconcileMutation('failed');
    expect(proof.quarantineReleased).toBe(fault==='unchanged');
    expect(await store.get('failed')).toEqual(receipt);
    expect(calls.every(c=>c.startsWith('inspect_'))).toBe(true);
    expect(Boolean(await store.inspectRecovery())).toBe(fault!=='unchanged');
  });
});
