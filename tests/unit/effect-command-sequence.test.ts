import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {EffectCommandSequences,planEffectSequence} from '../../apps/mcp-server/src/effect-command-sequence.js';
import {RuntimeEvents} from '../../apps/mcp-server/src/runtime-events.js';
import {effectStateProjection} from '../../packages/contracts/src/effect-state.js';
import recordedKeys from '../fixtures/effect-state-20261103.json';
import {readFile,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {AtomicJsonFileWriter} from '../../apps/mcp-server/src/atomic-json-file.js';
import {EffectJobStore} from '../../apps/mcp-server/src/effect-job-store.js';
import {freshTestDirectory} from '../helpers/workspace.js';

const clip={ref:'clip',expectedProjectId:'project',expectedSequenceId:'sequence',expectedSequenceName:'WORKING__test',trackItemId:'clip-id',expectedProjectItemId:'source',expectedMediaType:'video',expectedTrackIndex:0,expectedStartSeconds:1,expectedEndSeconds:4};
const plan=(steps:any[])=>({protocolVersion:1,clips:[clip],effects:[{ref:'motion',clipRef:'clip',componentIndex:0,componentMatchName:'Motion'}],steps});
const component=(name:string,value=10)=>({componentIndex:0,matchName:name,displayName:name,params:[{paramIndex:0,displayName:'Value',value,readStatus:{value:'pass',animation:'pass'},keyframeDetails:[],sampledAt:{ticks:'0',seconds:0}}]});
function fixture(options:{invisible?:boolean;lost?:boolean;changeBounds?:boolean;unreadable?:boolean;point?:boolean;nativeDrift?:boolean;graphic?:boolean;audio?:boolean}={}){
  const chain=[component('Motion')];let queries=0;
  if(options.graphic){chain.push(component('Opacity'),component('AE.ADBE Graphic Group'));chain.forEach((c,i)=>c.componentIndex=i);}
  if(options.point)Object.assign(chain[0].params[0],{value:[0.5,0.5],descriptor:{inputKind:'point'},keyframes:[{ticks:'0',seconds:0}],keyframeDetails:[{time:{ticks:'0',seconds:0},value:[0.5,0.5],interpolation:'bezier',interpolationMode:5,nativePointFields:[5,0,0,1]}]});
  const records=new Map<string,any>(),calls:any[]=[],events=new RuntimeEvents();
  const item=()=>({id:'clip-id',projectItemId:'source',mediaType:options.audio?'audio':'video',trackIndex:0,start:{seconds:1},end:{seconds:4},inPoint:{seconds:options.changeBounds&&queries>1?1:0}});
  const execute=async(command:string,args:any,_id?:string,_read?:boolean,readPurpose?:'job_preservation')=>{
    calls.push({command,args,readPurpose});
    if(command==='query_timeline'){
      queries++;const components:any[]=structuredClone(chain);
      if(options.point)for(const key of components[0].params[0].keyframeDetails){delete key.interpolation;delete key.interpolationMode;delete key.nativePointFields;}
      return {items:[{...item(),components}],page:{hasMore:false}};
    }
    if(command==='get_effect_values'&&args.detail==='chain'){
      const components:any[]=structuredClone(chain);if(options.nativeDrift&&queries>1)components[0].params[0].keyframeDetails[0].nativePointFields[3]=2;
      return {status:'pass',item:item(),components,visibility:{effectExpansion:{status:'pass'}}};
    }
    if(options.lost)throw Error('Panel disconnected after dispatch');
    expect(args.expectedEffectState).toEqual(effectStateProjection(chain));
    const before=structuredClone(chain);let at=args.componentIndex;
    if(command==='apply_video_effect'){at=args.insertionIndex??(options.graphic?chain.findIndex(c=>c.matchName==='AE.ADBE Graphic Group'):chain.length);chain.splice(at,0,component(args.matchName));}
    else if(command==='remove_effect')chain.splice(at,1);
    else if(command==='set_effect_values')chain[at].params[0].value=args.parameters[0].value;
    chain.forEach((c,i)=>c.componentIndex=i);
    const visibility={effectExpansion:{status:options.invisible?'unverified':'pass'},parameterScroll:{status:'pass',scope:'exact_parameter'}};
    const read=structuredClone(chain[at]);if(options.unreadable)read.params[0].readStatus.value='unverified';
    return {status:'pass',before,after:structuredClone(chain),component:read,hostResult:{componentIndex:at,visibility},visibility};
  };
  const services={execute,persist:async(job:any)=>{records.set(job.id,structuredClone(job));},load:async(id:string)=>records.get(id),events};
  return {jobs:new EffectCommandSequences(services),services,calls,records,chain:()=>chain};
}
const finished=async(f:ReturnType<typeof fixture>,id:string)=>{await vi.waitFor(()=>expect(f.jobs.busy).toBe(false));return f.jobs.status(id);};
describe('effect command sequence contracts',()=>{
  it('marks only baseline/final snapshots as verification while explicit reads and native Point proof keep follow',async()=>{
    const f=fixture({point:true}),id=randomUUID();
    await f.jobs.submit(id,plan([{op:'read',effectRef:'motion'}]));
    expect(await finished(f,id)).toMatchObject({state:'pass',completedSteps:1,preservation:{expectedState:'pass'}});
    const snapshots=f.calls.filter(c=>c.command==='query_timeline');
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every(c=>c.readPurpose==='job_preservation'&&c.args.includeEffects===true&&c.args.effectSampleTimeSeconds===0)).toBe(true);
    expect(snapshots.every(c=>c.args.readPurpose===undefined)).toBe(true);
    const nativeAndExplicit=f.calls.filter(c=>c.command==='get_effect_values');
    expect(nativeAndExplicit.filter(c=>c.args.detail==='chain')).toHaveLength(2);
    expect(nativeAndExplicit.filter(c=>c.args.detail==='effect')).toHaveLength(1);
    expect(nativeAndExplicit.every(c=>c.readPurpose===undefined)).toBe(true);
  });
  it.each(['set_values','add_audio'] as const)('keeps disconnected %s value proof unverified, stops further reads, and never replays',async op=>{
    const f=fixture({audio:true}),id=randomUUID(),execute=f.services.execute;
    const command=op==='set_values'?'set_effect_values':'apply_audio_effect';
    f.services.execute=async(name,args)=>{
      if(name==='query_timeline')return execute(name,args);
      f.calls.push({command:name,args});
      return {status:'unverified',errors:['Premiere panel disconnected while a command was running'],errorCode:'PANEL_DISCONNECTED'} as any;
    };
    const failedStep=op==='set_values'
      ?{op,effectRef:'motion',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]}
      :{op,clipRef:'clip',effectRef:'pitch',displayName:'Pitch Shifter'};
    const request={...plan([failedStep,{op:'read',effectRef:'motion'}]),clips:[{...clip,expectedMediaType:'audio'}]};
    await f.jobs.submit(id,request);const result=await finished(f,id);
    expect(result).toMatchObject({state:'unverified',completedSteps:0,preservation:{expectedState:'unverified'},results:[{op,status:'unverified',valueProof:'unverified'}]});
    expect(f.calls.map(call=>call.command)).toEqual(['query_timeline',command]);
    const saved=structuredClone(f.records.get(id));
    await f.jobs.submit(id,request);
    expect(await new EffectCommandSequences(f.services).submit(id,request)).toMatchObject({state:'unverified',completedSteps:0});
    expect(f.calls.map(call=>call.command)).toEqual(['query_timeline',command]);
    expect(f.records.get(id)).toEqual(saved);
  });
  it.each(['fail','unverified'])('never promotes a %s mutation even when an after array is present',async status=>{
    const f=fixture(),id=randomUUID(),execute=f.services.execute;
    f.services.execute=async(command,args)=>{const result=await execute(command,args);return command==='set_effect_values'?{...result,status}:result;};
    await f.jobs.submit(id,plan([{op:'set_values',effectRef:'motion',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]}]));
    expect(await finished(f,id)).toMatchObject({state:status,completedSteps:0,results:[{status,valueProof:'unverified'}],preservation:{expectedState:'unverified'}});
    expect(f.calls.filter(call=>call.command==='query_timeline')).toHaveLength(1);
  });
  it.each(['missing after','missing inserted component'])('requires actual add-audio after evidence despite a pass status: %s',async fault=>{
    const f=fixture({audio:true}),id=randomUUID(),execute=f.services.execute;
    f.services.execute=async(command,args)=>{
      if(command==='query_timeline')return execute(command,args);
      f.calls.push({command,args});
      return {status:'pass',...(fault==='missing after'?{}:{after:[]}),hostResult:{componentIndex:2}} as any;
    };
    await f.jobs.submit(id,{...plan([{op:'add_audio',clipRef:'clip',effectRef:'pitch',displayName:'Pitch Shifter'}]),clips:[{...clip,expectedMediaType:'audio'}]});
    expect(await finished(f,id)).toMatchObject({state:'unverified',completedSteps:0,results:[{status:'pass',valueProof:'unverified'}]});
    expect(f.calls.map(call=>call.command)).toEqual(['query_timeline','apply_audio_effect']);
  });
  it.each(['missing after','missing target','changed target'])('requires the bound effect in value-write after evidence: %s',async fault=>{
    const f=fixture(),id=randomUUID(),execute=f.services.execute;
    f.services.execute=async(command,args)=>{
      if(command==='query_timeline')return execute(command,args);
      f.calls.push({command,args});
      return {status:'pass',...(fault==='missing after'?{}:{after:fault==='missing target'?[]:[component('Other effect')]})} as any;
    };
    await f.jobs.submit(id,plan([{op:'set_values',effectRef:'motion',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]}]));
    expect(await finished(f,id)).toMatchObject({state:'unverified',completedSteps:0,results:[{status:'pass',valueProof:'unverified'}]});
    expect(f.calls.map(call=>call.command)).toEqual(['query_timeline','set_effect_values']);
  });
  it('uses host-selected graphic insertion indices and shifts existing effect bindings after each insert',async()=>{
    const f=fixture({graphic:true}),id=randomUUID();
    const request=plan([{op:'add_video',clipRef:'clip',effectRef:'one',matchName:'Tint'},{op:'add_video',clipRef:'clip',effectRef:'two',matchName:'Blur'},{op:'read',effectRef:'graphic'}]);
    request.effects.push({ref:'graphic',clipRef:'clip',componentIndex:2,componentMatchName:'AE.ADBE Graphic Group'});
    await f.jobs.submit(id,request);const result=await finished(f,id);
    expect(result).toMatchObject({state:'pass',completedSteps:3,preservation:{expectedState:'pass'}});
    expect(result.results.slice(0,2).map((r:any)=>r.componentIndex)).toEqual([2,3]);
    expect(f.calls.filter(c=>c.command==='apply_video_effect').every(c=>c.args.insertionIndex===undefined)).toBe(true);
    expect(f.calls.find(c=>c.command==='get_effect_values')?.args.componentIndex).toBe(4);
    expect(f.chain().map(c=>c.matchName)).toEqual(['Motion','Opacity','Tint','Blur','AE.ADBE Graphic Group']);
  });
  it('recovers a transient main-file rename without repeating any host step',async()=>{
    const f=fixture(),directory=await freshTestDirectory('effect-job-transient'),id=randomUUID();let renames=0;
    const store=new EffectJobStore(directory,new AtomicJsonFileWriter({platform:'win32',delay:async()=>{},rename:async(from,to)=>{if(++renames===1)throw Object.assign(Error('sharing'),{code:'EPERM'});await rename(from,to);}}));
    Object.assign(f.services,{persist:store.persist.bind(store),load:store.load.bind(store),recordPersistenceFailure:store.recordFailure.bind(store)});
    const request=plan([{op:'read',effectRef:'motion'},{op:'read',effectRef:'motion'}]);await f.jobs.submit(id,request);
    expect(await finished(f,id)).toMatchObject({state:'pass',completedSteps:2});expect(f.calls.filter(c=>c.command==='get_effect_values')).toHaveLength(2);
    expect((await store.load(id)) as any).toMatchObject({state:'pass',completedSteps:2});expect(await readdir(directory)).toEqual([id+'.json']);
  });
  it.each(['step_result','step_intent'] as const)('keeps proven results and a durable failure witness when main replacement permanently fails at %s',async phase=>{
    const f=fixture(),directory=await freshTestDirectory('effect-job-permanent-'+phase),id=randomUUID();let failures=0;
    const store=new EffectJobStore(directory,new AtomicJsonFileWriter({platform:'win32',delay:async()=>{},rename:async(from,to)=>{
      const record=JSON.parse(await readFile(from,'utf8'));
      const fail=String(to)===path.join(directory,id+'.json')&&(phase==='step_result'?record.completedSteps>=1:record.pendingStep?.index===1);
      if(fail){failures++;throw Object.assign(Error('sharing remains'),{code:'EPERM'});}await rename(from,to);
    }}));
    Object.assign(f.services,{persist:store.persist.bind(store),load:store.load.bind(store),recordPersistenceFailure:store.recordFailure.bind(store)});
    const request=plan([{op:'set_values',effectRef:'motion',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]},{op:'remove',effectRef:'motion'}]);
    await f.jobs.submit(id,request);const result=await finished(f,id);
    expect(result).toMatchObject({state:'unverified',completedSteps:1,persistenceFailure:{phase,completedSteps:1,durableCompletedSteps:phase==='step_result'?0:1,journal:'recorded',mainRecord:'failed',pendingDispatch:phase==='step_result'?'none':'not_sent'}});
    expect(result.results).toHaveLength(1);expect(result.results[0].status).toBe('pass');expect(f.calls.filter(c=>c.command==='set_effect_values')).toHaveLength(1);expect(f.calls.some(c=>c.command==='remove_effect')).toBe(false);
    if(phase==='step_intent')expect(result.pendingStep).toMatchObject({index:1,dispatchState:'not_sent'});else expect(result.pendingStep).toBeUndefined();
    expect(failures).toBe(14);expect((await readdir(directory)).some(name=>name.endsWith('.tmp'))).toBe(false);
    const before=f.calls.length,restarted=new EffectCommandSequences(f.services);
    expect(await restarted.submit(id,request)).toMatchObject({state:'unverified',completedSteps:1,persistenceFailure:{journal:'recorded'}});expect(f.calls).toHaveLength(before);expect(restarted.busy).toBe(false);
  });
  it.each(['admission','running'] as const)('does not dispatch host work when %s cannot be persisted',async phase=>{
    const f=fixture(),id=randomUUID(),witnesses=new Map<string,any>();
    f.services.persist=async job=>{if(phase==='admission'||job.state==='running')throw Error('disk unavailable');f.records.set(job.id,structuredClone(job));};
    Object.assign(f.services,{recordPersistenceFailure:async(job:any)=>witnesses.set(job.id,{...structuredClone(job),persistenceFailure:{...job.persistenceFailure,journal:'recorded'}}),load:async(key:string)=>witnesses.get(key)??f.records.get(key)});
    const request=plan([{op:'remove',effectRef:'motion'}]);
    if(phase==='admission')await expect(f.jobs.submit(id,request)).rejects.toThrow('disk unavailable');else{await f.jobs.submit(id,request);await finished(f,id);}
    expect(f.calls).toHaveLength(0);expect(f.jobs.status(id)).toMatchObject({state:'unverified',completedSteps:0,persistenceFailure:{phase,journal:'recorded',pendingDispatch:'none'}});
    expect(await new EffectCommandSequences(f.services).submit(id,request)).toMatchObject({state:'unverified'});expect(f.calls).toHaveLength(0);
  });
  it('keeps all completed host proofs but refuses a durable PASS when the final checkpoint fails',async()=>{
    const f=fixture(),directory=await freshTestDirectory('effect-job-final-failure'),id=randomUUID();
    const store=new EffectJobStore(directory,new AtomicJsonFileWriter({platform:'win32',delay:async()=>{},rename:async(from,to)=>{
      const record=JSON.parse(await readFile(from,'utf8'));if(String(to)===path.join(directory,id+'.json')&&record.state==='pass')throw Object.assign(Error('final target locked'),{code:'EPERM'});await rename(from,to);
    }}));
    Object.assign(f.services,{persist:store.persist.bind(store),load:store.load.bind(store),recordPersistenceFailure:store.recordFailure.bind(store)});
    const request=plan([{op:'set_values',effectRef:'motion',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]}]);await f.jobs.submit(id,request);
    expect(await finished(f,id)).toMatchObject({state:'unverified',completedSteps:1,preservation:{expectedState:'pass'},persistenceFailure:{phase:'final',completedSteps:1,durableCompletedSteps:1,journal:'recorded',mainRecord:'failed'}});
    const calls=f.calls.length;expect(await new EffectCommandSequences(f.services).submit(id,request)).toMatchObject({state:'unverified',completedSteps:1});expect(f.calls).toHaveLength(calls);
  });
  it('reports memory-only failure and blocks new admissions if both main and failure journal writes fail',async()=>{
    const f=fixture(),id=randomUUID();f.services.persist=async()=>{throw Error('main disk failed');};Object.assign(f.services,{recordPersistenceFailure:async()=>{throw Error('journal disk failed');}});
    const request=plan([{op:'remove',effectRef:'motion'}]);await expect(f.jobs.submit(id,request)).rejects.toThrow('main disk failed');
    expect(f.jobs.status(id)).toMatchObject({state:'unverified',persistenceFailure:{phase:'admission',mainRecord:'failed',journal:'failed',journalError:'Error: journal disk failed'}});
    await expect(f.jobs.submit(randomUUID(),request)).rejects.toThrow('JOB_PERSISTENCE_UNVERIFIED');expect(f.calls).toHaveLength(0);
    expect(await f.jobs.submit(id,request)).toMatchObject({state:'unverified'});
  });
  it('admits an add-audio job on an already animated chain without treating query coordinate labels as external edits', async () => {
    const target={...clip,expectedMediaType:'audio'};
    let chain:any[]=structuredClone(recordedKeys.afterKeys);
    const jobs=new EffectCommandSequences({events:new RuntimeEvents(),persist:async()=>{},execute:async(command,args)=>{
      if(command==='query_timeline')return {items:[{id:target.trackItemId,projectItemId:target.expectedProjectItemId,mediaType:'audio',trackIndex:0,start:{seconds:1},end:{seconds:4},components:chain.map(c=>({...c,params:c.params.map((p:any)=>({...p,keyframeDetails:p.keyframeDetails.map((k:any)=>({...k,clipTime:k.time,timeBasis:'native_source',sequenceTime:k.time}))}))}))}],page:{hasMore:false}};
      expect(command).toBe('apply_audio_effect');
      // Mirrors the host's pre-dispatch assertEffectSequenceState on its raw
      // native snapshot, before constructing any Bass insertion action.
      expect(args.expectedEffectState).toEqual(effectStateProjection(chain));
      chain=[...chain,{...component('Bass',29/48),componentIndex:3}];
      return {status:'pass',after:structuredClone(chain),hostResult:{componentIndex:3}};
    }});
    const id=randomUUID();await jobs.submit(id,{protocolVersion:1,clips:[target],steps:[{op:'add_audio',clipRef:'clip',effectRef:'bass',displayName:'저음',initialParameters:[{paramIndex:1,expectedDisplayName:'증폭',value:29/48}]}]});
    await vi.waitFor(()=>expect(jobs.busy).toBe(false));
    expect(jobs.status(id)).toMatchObject({state:'pass',completedSteps:1,preservation:{expectedState:'pass'}});
  });
  it.each(['same', 'changed key', 'changed sample'])('checks recorded Balance + Volume job content across enriched final readback: %s', async fault => {
    const target={...clip,expectedMediaType:'audio',expectedStartSeconds:23.2,expectedEndSeconds:25.4};
    let chain=structuredClone(recordedKeys.before),reads=0;
    const calls:string[]=[],events=new RuntimeEvents();
    const jobs=new EffectCommandSequences({events,persist:async()=>{},execute:async(command,args)=>{
      calls.push(command);
      if(command==='query_timeline'){
        reads++;
        const components=reads===1?structuredClone(chain):structuredClone(recordedKeys.queried);
        if(reads>1&&fault==='changed key')components[0].params[1].keyframeDetails[1].value=0.5;
        if(reads>1&&fault==='changed sample')components[0].params[1].value=0.5;
        return {items:[{id:target.trackItemId,projectItemId:target.expectedProjectItemId,mediaType:'audio',trackIndex:0,start:{seconds:23.2},end:{seconds:25.4},components}],page:{hasMore:false}};
      }
      expect(args.expectedEffectState).toEqual(effectStateProjection(chain));
      chain=structuredClone(command==='set_effect_values'?recordedKeys.afterValues:recordedKeys.afterKeys);
      return {status:'pass',after:structuredClone(chain)};
    }});
    const id=randomUUID();
    const request={protocolVersion:1,clips:[target],effects:[{ref:'pan',clipRef:'clip',componentIndex:2,componentMatchName:'Internal Balance'},{ref:'volume',clipRef:'clip',componentIndex:0,componentMatchName:'Internal Volume Stereo'}],steps:[{op:'set_values',effectRef:'pan',parameters:recordedKeys.parameters,preserveEmptyAnimation:true},{op:'set_keys',effectRef:'volume',keyframes:recordedKeys.keyframes}]};
    // Use the recorded host identity; localized display names are parameter guards.
    request.effects[0].componentMatchName=recordedKeys.before[2].matchName;
    await jobs.submit(id,request);await vi.waitFor(()=>expect(jobs.busy).toBe(false));
    expect(jobs.status(id)).toMatchObject({state:fault==='same'?'pass':'unverified',completedSteps:2,preservation:{expectedState:fault==='same'?'pass':'unverified'}});
    const count=calls.length;await jobs.submit(id,request);expect(calls).toHaveLength(count);
  });
  it('retains the host-verified derived outputs in compact step receipts',async()=>{
    const f=fixture(),execute=f.services.execute;
    const derivedValues={rules:['fixed-rule'],verified:true,writeDispatched:false,expected:[{paramIndex:1,expectedValue:15,value:30}]};
    f.services.execute=async(command,args)=>{const result=await execute(command,args);if(command==='set_effect_values')result.hostResult={...result.hostResult,derivedValues};return result;};
    const id=randomUUID();await f.jobs.submit(id,plan([{op:'set_values',effectRef:'motion',parameters:[{paramIndex:0,expectedDisplayName:'Value',expectedValue:10,value:20}]}]));
    const result=await finished(f,id);expect(result.state).toBe('pass');expect(result.results[0].derivedValues).toEqual(derivedValues);
  });
  it('preflights references, media kind and removed identity before any host work',()=>{
    expect(()=>planEffectSequence(plan([{op:'remove',effectRef:'absent'}]))).toThrow('UNKNOWN');
    expect(()=>planEffectSequence(plan([{op:'remove',effectRef:'motion'},{op:'add_video',clipRef:'clip',effectRef:'motion',matchName:'x'}]))).toThrow('INVALID_CREATED');
    expect(()=>planEffectSequence(plan([{op:'add_audio',clipRef:'clip',effectRef:'x',displayName:'x'}]))).toThrow('MEDIA_TYPE');
  });
  it('tracks two identical inserted instances across index shifts and preserves final state',async()=>{
    const f=fixture(),id=randomUUID();
    await f.jobs.submit(id,plan([{op:'add_video',clipRef:'clip',effectRef:'one',matchName:'Tint',insertionIndex:0},{op:'add_video',clipRef:'clip',effectRef:'two',matchName:'Tint',insertionIndex:0},{op:'set_values',effectRef:'one',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]},{op:'remove',effectRef:'two'},{op:'remove',effectRef:'one'},{op:'read',effectRef:'motion'}]));
    expect(await finished(f,id)).toMatchObject({state:'pass',completedSteps:6,preservation:{expectedState:'pass'}});
    expect(f.calls.find(c=>c.command==='set_effect_values').args.componentIndex).toBe(1);
    expect(f.chain()).toEqual([component('Motion')]);
    const count=f.calls.length;await f.jobs.submit(id,plan([{op:'add_video',clipRef:'clip',effectRef:'one',matchName:'Tint',insertionIndex:0},{op:'add_video',clipRef:'clip',effectRef:'two',matchName:'Tint',insertionIndex:0},{op:'set_values',effectRef:'one',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]},{op:'remove',effectRef:'two'},{op:'remove',effectRef:'one'},{op:'read',effectRef:'motion'}]));expect(f.calls.length).toBe(count);
  });
  it.each([{lost:true},{changeBounds:true},{unreadable:true}])('cannot promote missing values, lost response or altered source bounds: %j',async options=>{
    const f=fixture(options),id=randomUUID();await f.jobs.submit(id,plan([{op:'read',effectRef:'motion'},{op:'read',effectRef:'motion'}]));
    expect((await finished(f,id)).state).toBe('unverified');
    if(!options.changeBounds)expect(f.calls.filter(c=>c.command==='get_effect_values')).toHaveLength(1);
  });
  it('reserves admission across clients, cancels between steps, and does not resume a crashed job',async()=>{
    const f=fixture(),id=randomUUID();let release!:()=>void;
    f.services.execute=async()=>{await new Promise<void>(r=>release=r);throw Error('lost');};
    await f.jobs.submit(id,plan([{op:'read',effectRef:'motion'}]));
    await expect(f.jobs.submit(randomUUID(),plan([{op:'read',effectRef:'motion'}]))).rejects.toThrow('BUSY');
    f.jobs.cancel(id);release();await finished(f,id);
    const record=f.records.get(id);record.state='running';f.records.set(id,record);
    const restarted=new EffectCommandSequences(f.services);
    expect(await restarted.submit(id,record.plan)).toMatchObject({state:'unverified'});expect(restarted.busy).toBe(false);
    await expect(restarted.submit(id,plan([{op:'remove',effectRef:'motion'}]))).rejects.toThrow('ID_REUSED');
  });
  it('continues proven content steps when ordinary automatic follow cannot be verified',async()=>{
    const f=fixture({invisible:true}),id=randomUUID();
    await f.jobs.submit(id,plan([{op:'set_values',effectRef:'motion',parameters:[{paramIndex:0,expectedDisplayName:'Value',value:20}]},{op:'remove',effectRef:'motion'}]));
    expect(await finished(f,id)).toMatchObject({state:'pass',completedSteps:2,preservation:{expectedState:'pass'},results:[{visibilityStatus:'unverified'},{visibilityStatus:'unverified'}]});
    expect(f.chain()).toEqual([]);
    expect(f.calls.some(c=>c.command==='remove_effect')).toBe(true);
  });
  it('keeps ordinary read value proof independent of automatic disclosure',async()=>{
    const f=fixture({invisible:true}),id=randomUUID();
    await f.jobs.submit(id,plan([{op:'read',effectRef:'motion'},{op:'read',effectRef:'motion'}]));
    expect(await finished(f,id)).toMatchObject({state:'pass',completedSteps:2});
  });
  it('stops an explicit disclosure without native proof before the next mutation',async()=>{
    const f=fixture({invisible:true}),id=randomUUID();
    await f.jobs.submit(id,plan([{op:'disclosure',effectRef:'motion',expanded:false},{op:'remove',effectRef:'motion'}]));
    expect(await finished(f,id)).toMatchObject({state:'unverified',completedSteps:0,error:'Explicit disclosure lacks native proof; not replayed'});
    expect(f.calls.some(c=>c.command==='remove_effect')).toBe(false);
  });
  it('accepts explicit collapse expansion proof without requiring a parameter scroll',async()=>{
    const f=fixture(),id=randomUUID(),execute=f.services.execute;
    f.services.execute=async(command,args)=>{const result=await execute(command,args);if(command==='set_effect_disclosure')delete result.hostResult.visibility.parameterScroll;return result;};
    await f.jobs.submit(id,plan([{op:'disclosure',effectRef:'motion',expanded:false}]));
    expect(await finished(f,id)).toMatchObject({state:'pass',completedSteps:1});
  });
  it('accepts typed Point key sequences and hydrates fresh whole-chain proof at both boundaries',async()=>{
    expect(()=>planEffectSequence(plan([{op:'set_keys',effectRef:'motion',keyframes:[{paramIndex:0,expectedDisplayName:'Value',timeSeconds:1,value:{kind:'point',x:.5,y:.5},interpolation:'bezier'}]}]))).not.toThrow();
    const f=fixture({point:true}),id=randomUUID();await f.jobs.submit(id,plan([{op:'read',effectRef:'motion'}]));
    expect(await finished(f,id)).toMatchObject({state:'pass',preservation:{expectedState:'pass'}});
    expect(f.calls.filter(c=>c.args.detail==='chain')).toHaveLength(2);
    expect(f.calls.find(c=>c.command==='get_effect_values'&&c.args.detail!=='chain').args.expectedEffectState).toEqual(effectStateProjection(f.chain()));
  });
  it('cannot hide a changed native Point tangent behind identical public values and key modes',async()=>{
    const f=fixture({point:true,nativeDrift:true}),id=randomUUID();await f.jobs.submit(id,plan([{op:'read',effectRef:'motion'}]));
    expect(await finished(f,id)).toMatchObject({state:'unverified',preservation:{expectedState:'unverified'}});
  });
  it('rejects damaged durable identity/proof without starting or replaying host work',async()=>{
    const f=fixture(),id=randomUUID();await f.jobs.submit(id,plan([{op:'read',effectRef:'motion'}]));await finished(f,id);
    const record=f.records.get(id),calls=f.calls.length;
    f.records.set(id,{...record,fingerprint:'changed'});
    await expect(new EffectCommandSequences(f.services).submit(id,record.plan)).rejects.toThrow('IDENTITY');
    f.records.set(id,{...record,completedSteps:0});
    await expect(new EffectCommandSequences(f.services).inspect(id)).rejects.toThrow('PROOF');
    expect(f.calls.length).toBe(calls);
  });
  it('does not overwrite an admitted job when two same-ID durable loads race',async()=>{
    const f=fixture(),id=randomUUID();const releases:Array<(value:undefined)=>void>=[];
    f.services.load=async()=>new Promise<any>(resolve=>releases.push(resolve));
    const one=f.jobs.submit(id,plan([{op:'read',effectRef:'motion'}]));
    const two=f.jobs.submit(id,plan([{op:'read',effectRef:'motion'}]));
    releases[0](undefined);await one;releases[1](undefined);await two;await finished(f,id);
    expect(f.calls.filter(c=>c.command==='get_effect_values')).toHaveLength(1);
  });
});
