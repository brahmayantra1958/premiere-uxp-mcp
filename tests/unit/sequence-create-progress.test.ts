import { afterEach, describe, expect, it, vi } from 'vitest';
import { uxpModules } from '../helpers/uxp-modules.js';

type Stage = 'dispatchContext' | 'followContext' | 'mutationContext' | 'beforeSequences' | 'createPreset' | 'createDefault' | 'activate' | 'afterSequences' | 'activeSequence' | 'snapshot';
const stages: [Stage,string,string][] = [
  ['dispatchContext','sequence.dispatch_preflight','inspectHostContext'],
  ['followContext','sequence.follow_preflight','inspectHostContext'],
  ['mutationContext','sequence.preflight','mutationContext'],
  ['beforeSequences','sequence.preflight','getSequences'],
  ['createPreset','sequence.create','createSequenceWithPresetPath'],
  ['createDefault','sequence.create','createSequence'],
  ['activate','sequence.activate','setActiveSequence'],
  ['afterSequences','sequence.readback','getSequences'],
  ['activeSequence','sequence.readback','activeSequence'],
  ['snapshot','sequence.readback','sequenceSnapshot'],
];
function deferred() {
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}

function fixture(options: {block?:Stage;fault?:Stage;trace?:boolean;nullCreate?:boolean;defaultPreset?:boolean}={}) {
  const entered=deferred(),held=deferred(),calls:string[]=[];
  let created=false,active=false,projectReads=0,sequenceReads=0,sequenceLists=0;
  const leaf=async(stage:Stage)=>{
    calls.push(stage);
    if(stage===options.block){entered.resolve();await held.promise;}
    if(stage===options.fault)throw Error('NATIVE_STAGE_FAILED:'+stage);
  };
  const original={guid:'source-sequence',name:'Source'};
  const sequence={guid:'new-sequence',name:'Requested sequence',
    getSettings:async()=>{await leaf('snapshot');return {getVideoFrameRect:async()=>({width:1920,height:1080}),getVideoFrameRate:async()=>({value:24})};},
    getEndTime:async()=>({ticks:'0',seconds:0}),getVideoTrackCount:async()=>0,getAudioTrackCount:async()=>0,getCaptionTrackCount:async()=>0,
  };
  const create=async(stage:'createPreset'|'createDefault')=>{await leaf(stage);created=!options.nullCreate;return created?sequence:null;};
  const project={guid:'project',path:'C:/test.prproj',name:'Project',
    getActiveSequence:async()=>{sequenceReads++;if(sequenceReads===4)await leaf('activeSequence');return active?sequence:original;},
    getSequences:async()=>{sequenceLists++;await leaf(sequenceLists===1?'beforeSequences':'afterSequences');return created?[original,sequence]:[original];},
    createSequenceWithPresetPath:async()=>create('createPreset'),createSequence:async()=>create('createDefault'),
    setActiveSequence:async()=>{await leaf('activate');active=true;return true;},
  };
  const getActiveProject=vi.fn(async()=>{
    projectReads++;
    if(projectReads<=3)await leaf(projectReads===1?'dispatchContext':projectReads===2?'followContext':'mutationContext');
    return project;
  });
  const load=uxpModules({Project:{getActiveProject}},{Date,setTimeout,clearTimeout});
  const host=new (load('apps/uxp-plugin/src/premiere-host.ts').PremiereHost)();
  load('apps/uxp-plugin/src/work-follow.ts').workFollow.enabled=false;
  const ledger=new (load('apps/uxp-plugin/src/command-execution-ledger.ts').CommandExecutionLedger)();
  const request={version:1,id:'sequence-operation',command:'create_sequence',timeoutMs:15000,
    args:{expectedProjectId:'project',expectedSequenceId:'source-sequence',expectedSequenceName:'Source',name:sequence.name,...(options.defaultPreset?{}:{presetPath:'C:/preset.sqpreset'})}};
  const start=()=>{
    if(options.trace!==false)ledger.begin(request);
    return host.dispatch(request).then((result:any)=>{
      const response={version:1,id:request.id,ok:true,result,durationMs:0};
      if(options.trace!==false)ledger.complete(response);return response;
    },(error:any)=>{
      const response={version:1,id:request.id,ok:false,error:{code:error.code,message:error.message,...(error.details?{details:error.details}:{})},durationMs:0};
      if(options.trace!==false)ledger.complete(response);return response;
    });
  };
  const inspect=()=>ledger.inspect([request.id]).commands[0];
  return {start,entered,held,inspect,calls,host,request,getActiveProject};
}

afterEach(()=>vi.useRealTimers());

describe('sequence creation memory-only stage observations',()=>{
  it.each(stages)('shows a nonsettling %s and preserves its owned native lane',async(stage,phase,method)=>{
    vi.useFakeTimers();
    const f=fixture({block:stage,defaultPreset:stage==='createDefault'}),running=f.start();
    await f.entered.promise;
    const before=f.inspect();
    expect(before).toMatchObject({state:'running',queueState:'running',diagnostics:{current:{phase,method,startedAt:expect.any(Number)},activeCalls:[expect.objectContaining({phase,method})]}});
    expect(before.diagnostics.current.finishedAt).toBeUndefined();
    const calls=[...f.calls],nativeReads=f.getActiveProject.mock.calls.length;
    const ping=f.host.dispatch({version:1,id:'queued-ping',command:'premiere_ping',args:{},timeoutMs:300000});
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.inspect().diagnostics).toEqual(before.diagnostics);
    expect(f.calls).toEqual(calls);expect(f.getActiveProject).toHaveBeenCalledTimes(nativeReads);
    f.held.resolve();
    expect(await running).toMatchObject({ok:true,result:{status:'pass',hostResult:true,after:{active:{id:'new-sequence',name:'Requested sequence'}}}});
    await ping;
    const after=f.inspect();
    expect(after).toMatchObject({state:'complete',queueState:'settled',diagnostics:{activeCalls:[]}});
    const completed=after.diagnostics.recentCalls.find((row:any)=>row.phase===phase&&row.method===method);
    expect(completed).toMatchObject({outcome:'returned',finishedAt:expect.any(Number)});
    expect(completed.finishedAt-completed.startedAt).toBe(60000);
  });

  it.each(['createPreset','activate','snapshot'] as const)('records a throwing %s without changing the native error or replaying writes',async fault=>{
    const traced=fixture({fault}),plain=fixture({fault,trace:false});
    const actual=await traced.start(),expected=await plain.start();
    expect(actual).toEqual(expected);expect(actual).toMatchObject({ok:false,error:{message:expect.stringContaining('NATIVE_STAGE_FAILED:'+fault)}});
    expect(traced.calls).toEqual(plain.calls);
    expect(traced.calls.filter(value=>value==='createPreset')).toHaveLength(1);
    const [stage,phase,method]=stages.find(([stage])=>stage===fault)!;void stage;
    expect(traced.inspect().diagnostics).toMatchObject({activeCalls:[],lastCall:{phase,method,outcome:'threw',finishedAt:expect.any(Number)}});
  });

  it.each([false,true])('preserves the complete content result and native call order (null create: %s)',async nullCreate=>{
    const traced=fixture({nullCreate}),plain=fixture({nullCreate,trace:false});
    const actual=await traced.start(),expected=await plain.start();
    expect(actual).toEqual(expected);expect(actual.result.status).toBe(nullCreate?'fail':'pass');
    expect(traced.calls).toEqual(plain.calls);
    const diagnostics=traced.inspect().diagnostics;
    expect(diagnostics.activeCalls).toEqual([]);
    expect(diagnostics.recentCalls.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(diagnostics)).not.toMatch(/test\.prproj|preset\.sqpreset|Requested sequence|NATIVE_STAGE/);
    expect(diagnostics.recentCalls.map((row:any)=>[row.phase,row.method])).toEqual(nullCreate?[
      ['sequence.dispatch_preflight','inspectHostContext'],['sequence.follow_preflight','inspectHostContext'],['sequence.preflight','mutationContext'],
      ['sequence.preflight','getSequences'],['sequence.create','createSequenceWithPresetPath'],['sequence.readback','getSequences'],
    ]:stages.filter(([stage])=>stage!=='createDefault').map(([,phase,method])=>[phase,method]));
  });
});
