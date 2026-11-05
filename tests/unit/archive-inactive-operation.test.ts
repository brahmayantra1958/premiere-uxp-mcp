import {describe,it,expect,vi} from 'vitest';
import path from 'node:path';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {freshTestDirectory} from '../helpers/workspace.js';
import {ReceiptStore,AuditLog} from '../../apps/mcp-server/src/audit.js';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {prepareHostMutation} from '../../apps/mcp-server/src/host-mutation-plan.js';
import {createOperationFingerprint} from '../../apps/mcp-server/src/operation-identity.js';

async function fixture(fault='') {
  const dir=await freshTestDirectory('archive-inactive'),file=path.join(dir,'receipts.json'),store=new ReceiptStore(file,1);
  const args={expectedProjectId:'p',expectedSequenceId:'s',placements:[]};
  const original={commandId:'old',command:'place_clips',requestFingerprint:createOperationFingerprint('place_clips',args),status:'unverified' as const,changedFiles:[],errors:['lost connection'],startedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
  await store.runExclusive('old',async()=>{await store.intent('old','place_clips',args,'host');await store.dispatched('old');await store.set(original);});
  let reads=0;
  const call=vi.fn(async(r:any)=>({version:1,id:r.id,ok:true,durationMs:0,result:r.command==='inspect_command_execution'
    ?{status:'pass',protocol:1,sessionId:fault==='session'?String(++reads):'new-session',active:fault==='active'?[{id:'other'}]:[],commands:r.args.commandIds.map((id:string)=>({id,state:fault==='running'?'running':'unknown'}))}
    :{status:'pass',protocol:1,commands:fault==='queued'?[{id:'waiting',state:'queued'}]:[],activeJobId:fault==='job'?'job':null}}));
  return {file,store,original,args,call,host:new HostExecutor({call} as any,new AuditLog(path.join(dir,'audit.jsonl')),store,1000)};
}
describe('inactive operation retirement is administrative, not content recovery',()=>{
  it('preserves unknown receipt, archives lease, allows new writes and deduplicates old requests after pruning',async()=>{
    const f=await fixture(),receiptFile=(await readdir(f.file+'.d')).find(n=>/^[a-f0-9]{64}\.json$/.test(n))!;
    const bytes=await readFile(path.join(f.file+'.d',receiptFile),'utf8');
    const result=await f.host.archiveInactiveMutation('old');
    expect(result).toMatchObject({status:'pass',disposition:'archived_unverified',leaseReleased:true,originalReceiptStatus:'unverified',contentReplayed:false,contentRestored:false});
    expect(await readFile(path.join(f.file+'.d',receiptFile),'utf8')).toBe(bytes);
    expect(await f.store.inspectRecovery()).toBeUndefined();
    expect(f.call.mock.calls.map(([r])=>r.command)).toEqual(['inspect_command_execution','inspect_host_activity','inspect_command_execution','inspect_host_activity']);
    await f.store.runExclusive('new',async()=>{await f.store.set({...f.original,commandId:'new',status:'pass'});});
    expect(await f.store.get('old')).toEqual(f.original);
    expect(await f.host.mutate('place_clips',f.args,'old')).toEqual(f.original);
    expect(f.call).toHaveBeenCalledTimes(4);
  });
  it.each(['active','running','queued','job','session'])('refuses an unsafe or changing live execution state: %s',async fault=>{
    const f=await fixture(fault);await expect(f.host.archiveInactiveMutation('old')).rejects.toThrow(/ARCHIVE_HOST_/);
    expect((await f.store.inspectRecovery())?.commandId).toBe('old');expect(await f.store.get('old')).toEqual(f.original);
  });
  it('refuses a still running owner and a different operation',async()=>{
    const f=await fixture(),lease=await f.store.inspectRecovery();delete lease!.finishedAt;
    await writeFile(f.file+'.mutation-lock',JSON.stringify(lease));
    await expect(f.host.archiveInactiveMutation('other')).rejects.toThrow('ARCHIVE_OPERATION_CHANGED');
    await expect(f.host.archiveInactiveMutation('old')).rejects.toThrow('ARCHIVE_OWNER_STILL_RUNNING');
    expect(f.call).not.toHaveBeenCalled();
  });
  it('keeps active writes mutually exclusive after retirement',async()=>{
    const f=await fixture();await f.host.archiveInactiveMutation('old');
    const otherClient=new ReceiptStore(f.file);
    await f.store.runExclusive('new',async()=>{await expect(otherClient.runExclusive('concurrent',async()=>true)).rejects.toThrow('MUTATION_IN_PROGRESS');});
  });
  it.each(['import_media','place_clips'])('plans %s without a whole project read and rejects missing identity',async command=>{
    const read=vi.fn(),audit={append:vi.fn()} as any;
    expect(await prepareHostMutation(command,{expectedProjectId:'p',expectedSequenceId:'s'},'new',false,read,audit)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    await expect(prepareHostMutation(command,{},'new',false,read,audit)).rejects.toThrow('EXACT_EDIT_TARGET_REQUIRED');
  });
});
