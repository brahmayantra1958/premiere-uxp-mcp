import { beforeEach, describe, expect, it, vi } from "vitest";
const shared = vi.hoisted(() => ({ f: null as any }));
const time = (seconds: number) => ({ seconds, ticks: String(Math.round(seconds * 254016000000)) });
vi.mock("../../apps/uxp-plugin/src/host-context.js", () => ({
  ppro: { ClipProjectItem:{cast:async(value:any)=>value}, TickTime: { createWithSeconds:(s:number)=>time(s), TIME_ZERO: { seconds: 0, ticks: "0" }, createWithTicks:(ticks: string)=>({ticks,seconds:Number(ticks)/254016000000,...(shared.f?.requireFreshTemps?{createdLocked:shared.f.state.locked}:{})}) }, PointF: (x: number, y: number) => ({ x, y }), Color: (red: number, green: number, blue: number, alpha: number) => ({ red, green, blue, alpha }),
    Keyframe: { INTERPOLATION_MODE_LINEAR: 0, INTERPOLATION_MODE_HOLD: 4, INTERPOLATION_MODE_BEZIER: 5 },
    AudioFilterFactory: { getDisplayNames: async () => ["Pitch"], createComponentByDisplayName: async () => {
      if(shared.f.unsupportedLayout)throw Error('No audio filter found for the given display name and channel layout');
      return shared.f.makeComponent({name:"Pitch",params:shared.f.newParams??[]});
    } },
    VideoFilterFactory: { getMatchNames: async () => ["New effect"], createComponent: async (name: string) => shared.f.makeComponent({ name,params:shared.f.newParams??[] }) } },
  mutationContext: async () => ({ project: shared.f.project, sequence: shared.f.sequence }), sequenceId: async (s: any) => s.guid,
  tickFromSeconds: (s: number) => ({ seconds: s, ticks: String(Math.round(s * 254016000000)) }),
  assertMethod: (o: any, n: string) => { if (typeof o[n] !== "function") throw Error(`Missing ${n}`); },
}));
vi.mock("../../apps/uxp-plugin/src/host-foundation.js", () => ({ text: (v: any) => String(v ?? ""), asTickTime: (t: any) => t, LOCAL_SCRATCH_ROOT: "C:\\scratch", TRACK_ITEM_LIMIT: 1000 }));
vi.mock("../../apps/uxp-plugin/src/host-items.js", () => ({ findTrackItemEntry: async (...args:any[]) => shared.f.acquireEntry?.(...args) ?? shared.f.entry, findTrackItem: async () => shared.f.entry.raw }));
import { PremiereHost } from "../../apps/uxp-plugin/src/premiere-host.js";
import {withMutationPhase} from '../../apps/uxp-plugin/src/host-mutation-phase.js';
import {noteGraphicMutation} from '../../apps/uxp-plugin/src/graphic-lifecycle.js';
import {withEffectTargetLookup,effectTargetLookupHint} from '../../apps/uxp-plugin/src/effect-target-lookup.js';
import * as hostContext from '../../apps/uxp-plugin/src/host-context.js';

function fixture(specs: any[], options: any = {}) {
  const state = { transactions: 0, locked: false, transactionActive: false, afterTransaction: false, components: [] as any[] };
  const makeParameter = (spec: any) => ({
    displayName: spec.name, value: spec.value, keys: spec.keys ?? [], timeVarying: Boolean(spec.timeVarying ?? spec.keys?.length),
    async getValueAtTime(t: any) { return { value: this.keys.find((k: any) => k.seconds === t.seconds)?.value ?? this.value }; },
    isTimeVarying() { return this.timeVarying; }, async areKeyframesSupported() { return true; },
    getKeyframeListAsTickTimes() { if (spec.listThrows) throw Error("Keyframe list failed"); return this.keys.map((k: any) => time(k.seconds)); },
    getKeyframePtr(t: any) { if (options.failDetailsAfter && state.afterTransaction) throw Error("Keyframe read failed"); const key = this.keys.find((k: any) => k.seconds === t.seconds); if (!key) throw Error("Missing key"); return { value: { value: key.value }, getTemporalInterpolationMode: async () => key.mode }; },
    createKeyframe(value: any) { return { value, position: time(0), mode: 0,createdLocked:state.locked, async getTemporalInterpolationMode(){return this.mode;},async setTemporalInterpolationMode(m: number) { this.mode = m; return true; } }; },
    createSetTimeVaryingAction(value: boolean) { expect(state.locked).toBe(true); expect(state.transactionActive).toBe(true); return () => { this.timeVarying = value; if (!value) this.keys = []; }; },
    createSetValueAction(key: any) { expect(state.locked).toBe(true);expect(state.transactionActive).toBe(true);if(options.requireFreshTemps)expect(key.createdLocked).toBe(true); return () => { this.value = spec.pointArray ? [key.value.x, key.value.y] : key.value; }; },
    createAddKeyframeAction(key: any) { expect(state.locked).toBe(true);if(options.requireFreshTemps){expect(key.createdLocked).toBe(true);expect(key.position.createdLocked).toBe(true);} return () => this.keys.push({ seconds: key.position.seconds, value: key.value, mode: key.mode }); },
    createRemoveKeyframeAction(t: any) { expect(state.locked).toBe(true);if(options.requireFreshTemps)expect(t.createdLocked).toBe(true); return () => { if (!options.ignoreRemoveKey) this.keys = this.keys.filter((k: any) => k.seconds !== t.seconds); }; },
  });
  const makeComponent = (spec: any) => ({ name: spec.name, match: spec.match ?? spec.name, params: (spec.params ?? []).map(makeParameter),
    async getDisplayName() { return this.name; }, async getMatchName() { return this.match; }, getParamCount() { return this.params.length; }, getParam(i: number) { return this.params[i]; } });
  state.components = specs.map(makeComponent);
  const chain = { getComponentCount: () => state.components.length, getComponentAtIndex: (i: number) => state.components[i],
    createAppendComponentAction: (c: any) => () => state.components.push(c), createInsertComponentAction: (c: any, i: number) => () => options.wrongInsert ? state.components.push(c) : state.components.splice(i, 0, c),
    createRemoveComponentAction: (c: any) => () => state.components.splice(options.wrongRemove ? 0 : state.components.indexOf(c), 1) };
  const raw = { getComponentChain: async () => chain };
  const entry = { raw, snapshot: { id: "video:0:2540160000000:source", projectItemId: "source", mediaType: "video", trackIndex: 0, start: time(10), end: time(20), inPoint: time(3),outPoint:time(13),speed:1,reversed:false } };
  let selectionItems:any[]=[];
  const selection={addItem:(item:any)=>{selectionItems.push(item);return true;},getTrackItems:async()=>selectionItems};
  const sequence = { guid: "sequence", name: "WORKING__audit", getFrameSize: async () => ({ width: 1920, height: 1080 }),clearSelection:async()=>{selectionItems=[];},getSelection:async()=>selection,setSelection:async()=>{options.onSelection?.(state);return true;} };
  const project = { guid: "project", lockedAccess: (f: any) => { state.locked = true; try { return f(); } finally { state.locked = false; } }, executeTransaction(f: any) { const actions: any[] = []; state.transactionActive=true;try{f({ addAction: (a: any) => actions.push(a) }); actions.forEach(a => a()); state.transactions++; state.afterTransaction = true; return true;}finally{state.transactionActive=false;} } };
  const target = { expectedProjectId: "project", expectedSequenceId: "sequence", expectedSequenceName: "WORKING__audit", trackItemId: entry.snapshot.id, expectedProjectItemId: "source", expectedMediaType: "video", expectedTrackIndex: 0, expectedStartSeconds: 10, expectedEndSeconds: 20, componentIndex: 0 };
  const host = new PremiereHost() as any;
  // This fixture isolates transactions below the outer SDK preflight. Supply
  // explicit exact samples for its known linear fake clock, never host evidence.
  const fakeProof=(args:any)=>{
    const s=entry.snapshot,start=BigInt(s.start.ticks),end=BigInt(s.end.ticks);
    const ticks=new Set([s.start.ticks,...(args.keyframes??args.operations??[args]).filter((r:any)=>r.timeTicks!==undefined||r.timeSeconds!==undefined).map((r:any)=>r.timeTicks??time(r.timeSeconds).ticks)]);
    return {status:'pass',exactOnly:true,startTicks:s.start.ticks,endTicks:s.end.ticks,inTicks:s.inPoint.ticks,outTicks:s.outPoint.ticks,speed:s.speed,reversed:s.reversed,originTicks:s.inPoint.ticks,samples:[...ticks].filter(t=>/^\d+$/.test(t)&&BigInt(t)>=start&&BigInt(t)<end).map(t=>({sequenceTicks:t,nativeTicks:String(BigInt(t)-start+BigInt(s.inPoint.ticks)),rate:1}))};
  };
  const f = { state, entry, project, sequence, makeComponent, target, fakeProof,host,requireFreshTemps:options.requireFreshTemps, call: (command: string, args: any) => host.dispatchCommand({ command, args: { ...target,...(entry.snapshot.speed===1&&!entry.snapshot.reversed?{__nativeEffectTimeProof:fakeProof(args)}:{}), ...args } }) };
  shared.f = f; return f;
}
beforeEach(() => { shared.f = null; });

it('rejects unsupported generated-graphic disclosure before hydrating any effect values',async()=>{
  const f:any=fixture([{name:'Volume',params:[{name:'Level',value:1}]}]);
  f.entry.raw.getProjectItem=async()=>null;
  f.entry.raw.getComponentChain=vi.fn(async()=>{throw Error('unsupported follow must not hydrate a chain');});
  const result=await f.host.revealEffect({id:'no-media',command:'apply_video_effect',args:f.target});
  expect(result).toEqual({status:'unsupported',reason:'Media-backed clip required for disclosure identity'});
  expect(f.entry.raw.getComponentChain).not.toHaveBeenCalled();
});

it.each([false,true])('reads saved parameter metadata only when a parameter row is requested: %s',async requested=>{
  const f:any=fixture([{name:'Volume',params:[{name:'Level',value:1}]}]);
  f.entry.raw.getProjectItem=async()=>({getMediaFilePath:async()=> 'C:/source.wav'});
  f.project.save=vi.fn(async()=>true);
  f.host.effectDisclosure=vi.fn(async(_id:string,phase:string)=>phase==='metadata'
    ?{status:'unverified'}:{status:'unsupported',available:false});
  const args={...f.target,...(requested?{parameters:[{paramIndex:0,expectedDisplayName:'Level',value:2}]}:{initialParameters:[{paramIndex:0,expectedDisplayName:'Level',value:2}]})};
  await f.host.revealEffect({id:'metadata-scope',command:requested?'set_effect_values':'apply_audio_effect',args});
  expect(f.project.save).toHaveBeenCalledTimes(requested?1:0);
  expect(f.host.effectDisclosure.mock.calls.filter((call:any[])=>call[1]==='metadata')).toHaveLength(requested?1:0);
});

it('inherits the exact numeric lookup hint through audio insertion and initial-value readback without changing content proof',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  let pending:Promise<any>|undefined;
  try{
    const f:any=fixture([{name:'Volume',params:[{name:'Level',value:1}]}]);
    Object.assign(f.entry.snapshot,{id:'audio:0:2540160000000:source',mediaType:'audio'});
    Object.assign(f.target,{trackItemId:f.entry.snapshot.id,expectedMediaType:'audio'});
    f.newParams=[{name:'Precision',value:5}];
    const args={...f.target,displayName:'Pitch',initialParameters:[{paramIndex:0,expectedDisplayName:'Precision',expectedValue:5,value:9}]};
    const observed:any[]=[];
    f.acquireEntry=(_sequence:any,id:string,hint:any)=>{
      observed.push(hint);if(hint)Object.assign(hint,{id,index:37});return f.entry;
    };
    let owned:any;
    pending=withEffectTargetLookup(args,async()=>{
      owned=effectTargetLookupHint(args);
      return f.host.dispatchCommand({command:'apply_audio_effect',args});
    });
    void pending!.catch(()=>{});await vi.runAllTimersAsync();
    const result=await pending;
    expect(result.status).toBe('pass');expect(result.errors).toEqual([]);
    expect(result.before[0].params[0].value).toBe(1);
    expect(result.after.map((c:any)=>c.params.map((p:any)=>p.value))).toEqual([[1],[9]]);
    expect(result.hostResult.initialization).toMatchObject({readback:{mismatched:[],missing:[]}});
    const phases=result.hostResult.effectPhaseTimingsMs;
    expect(phases).toMatchObject({initialTarget:expect.any(Number),beforeSnapshot:expect.any(Number),insertAction:expect.any(Number),postInsertRead:expect.any(Number),initializedRead:expect.any(Number),initialValueWrite:expect.any(Number),finalContract:expect.any(Number),total:expect.any(Number)});
    expect(Object.values(phases).every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)).toBe(true);
    expect(phases.total).toBeGreaterThanOrEqual(phases.initialValueWrite);
    expect(phases.initialValueWrite).toBeGreaterThanOrEqual(result.hostResult.initialization.timingsMs.total);
    expect(phases.rollback).toBeUndefined();
    expect(f.state.transactions).toBe(2);expect(observed.length).toBeGreaterThan(20);
    expect(observed.every(hint=>hint===owned)).toBe(true);expect(owned).toEqual({id:args.trackItemId,index:37});
    expect(effectTargetLookupHint(args)).toBeUndefined();
  }finally{
    await vi.runAllTimersAsync();await pending?.catch(()=>{});noteGraphicMutation(Number.NEGATIVE_INFINITY);vi.useRealTimers();
  }
});

describe('protected native effect query source binding',()=>{
  it.each(['graphic','audio','video'])('waits before target hydration for protected effects after mutation (%s)',async kind=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
    const contextRead=vi.spyOn(hostContext,'mutationContext');
    let read:Promise<any>|undefined;
    try{
      const f:any=fixture([{name:'Effect',params:[{name:'Amount',value:7}]}]);
      if(kind==='graphic'){
        Object.assign(f.entry.snapshot,{id:'video:0:2540160000000:',projectItemId:''});
        Object.assign(f.target,{trackItemId:f.entry.snapshot.id,expectedProjectItemId:''});
      }
      if(kind==='audio'){
        Object.assign(f.entry.snapshot,{id:'audio:0:2540160000000:source',mediaType:'audio'});
        Object.assign(f.target,{trackItemId:f.entry.snapshot.id,expectedMediaType:'audio'});
      }
      const hydrate=vi.fn(()=>f.entry);f.acquireEntry=hydrate;
      const chain=vi.spyOn(f.entry.raw,'getComponentChain');
      const value=vi.spyOn(f.state.components[0].params[0],'getValueAtTime');
      noteGraphicMutation();const started=Date.now();
      read=f.call('get_effect_values',{detail:'parameter',paramIndex:0,expectedDisplayName:'Amount',componentMatchName:'Effect'});
      void read!.catch(()=>{});
      if(kind!=='video'){
        await vi.advanceTimersByTimeAsync(249);
        expect(contextRead).not.toHaveBeenCalled();expect(hydrate).not.toHaveBeenCalled();
        expect(chain).not.toHaveBeenCalled();expect(value).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(Date.now()-started).toBe(250);
        expect(contextRead).toHaveBeenCalled();expect(hydrate).toHaveBeenCalled();
        expect(chain).toHaveBeenCalled();
        await vi.runAllTimersAsync();
      }else{
        await vi.advanceTimersByTimeAsync(0);
        expect(Date.now()-started).toBe(0);
        expect(contextRead).toHaveBeenCalled();expect(hydrate).toHaveBeenCalled();
        expect(chain).toHaveBeenCalled();expect(value).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      }
      expect(await read).toMatchObject({status:'pass'});
      expect(f.state.transactions).toBe(0);
    }finally{
      // Drain the actual operation before restoring clocks/fixtures; never leave
      // a native owner promise pending or a fake timestamp in module state.
      await vi.runAllTimersAsync();await read?.catch(()=>{});
      noteGraphicMutation(Number.NEGATIVE_INFINITY);
      contextRead.mockRestore();vi.useRealTimers();
    }
  });

  it.each(['parameter','chain'].flatMap(detail=>['graphic','audio'].map(kind=>({detail,kind}))))('rejects source inPoint drift before the first native $detail read ($kind) with unchanged timeline bounds',async({detail,kind})=>{
    const f:any=fixture([{name:'Graphic effect',params:[{name:'Amount',value:7}]}]);
    const original={...f.entry.snapshot,id:kind==='audio'?'audio:0:2540160000000:source':'video:0:2540160000000:',mediaType:kind==='audio'?'audio':'video',projectItemId:kind==='audio'?'source':''};
    f.entry.snapshot=original;
    Object.assign(f.target,{trackItemId:original.id,expectedMediaType:original.mediaType,expectedProjectItemId:original.projectItemId});
    const fresh={...original,inPoint:time(4)};
    const acquire=vi.fn().mockReturnValueOnce({...f.entry,snapshot:original}).mockReturnValue({...f.entry,snapshot:fresh});
    f.acquireEntry=acquire;
    const nativeChain=vi.spyOn(f.entry.raw,'getComponentChain');
    const valueRead=vi.spyOn(f.state.components[0].params[0],'getValueAtTime');
    await expect(f.call('get_effect_values',{
      detail,componentMatchName:'Graphic effect',
      ...(detail==='parameter'?{paramIndex:0,expectedDisplayName:'Amount'}:{}),
    })).rejects.toMatchObject({code:'TRACK_ITEM_PRECONDITION_FAILED'});
    expect(fresh.start).toEqual(original.start);expect(fresh.end).toEqual(original.end);
    expect(fresh.inPoint.ticks).not.toBe(original.inPoint.ticks);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(nativeChain).not.toHaveBeenCalled();expect(valueRead).not.toHaveBeenCalled();
    expect(f.state.transactions).toBe(0);
  });

  it.each(['parameter','chain'])('rebinds the audio effect graph after every completed native promise for %s reads',async detail=>{
    const f:any=fixture([{name:'Volume',match:'Internal Volume Stereo',params:[{name:'Level',value:.125}]}]);
    Object.assign(f.entry.snapshot,{id:'audio:0:2540160000000:source',mediaType:'audio'});
    Object.assign(f.target,{trackItemId:f.entry.snapshot.id,expectedMediaType:'audio'});
    let epoch=0,pending=0,peak=0,valueReads=0;
    const check=(born:number)=>{expect(pending).toBe(0);if(born!==epoch)throw Error('The script object is no longer valid.');};
    const complete=async()=>{pending++;peak=Math.max(peak,pending);await Promise.resolve();pending--;epoch++;};
    const component=()=>{
      const born=epoch;
      return {getParamCount:()=>{check(born);return 1;},
        getDisplayName:async()=>{check(born);await complete();return 'Volume';},
        getMatchName:async()=>{check(born);await complete();return 'Internal Volume Stereo';},
        getParam:()=>{check(born);const paramEpoch=epoch;return {
          get displayName(){check(paramEpoch);return 'Level';},
          getValueAtTime:async()=>{check(paramEpoch);valueReads++;await complete();return {value:.125};},
          isTimeVarying:()=>{check(paramEpoch);return false;},
          areKeyframesSupported:async()=>{check(paramEpoch);await complete();return true;},
          getKeyframeListAsTickTimes:()=>{check(paramEpoch);return [];},
        };},
      };
    };
    f.acquireEntry=vi.fn(()=>{
      const born=epoch;
      return {...f.entry,raw:{getComponentChain:async()=>{check(born);await complete();const chainEpoch=epoch;return {
        getComponentCount:()=>{check(chainEpoch);return 1;},getComponentAtIndex:()=>{check(chainEpoch);return component();},
      };}}};
    });
    const result=await f.call('get_effect_values',{detail,componentMatchName:'Internal Volume Stereo',...(detail==='parameter'?{paramIndex:0,expectedDisplayName:'Level'}:{})});
    expect(result).toMatchObject({status:'pass',component:{matchName:'Internal Volume Stereo',params:[{displayName:'Level',value:.125,readStatus:{value:'pass',animation:'pass'}}]}});
    expect(peak).toBe(1);expect(pending).toBe(0);expect(valueReads).toBe(1);
    expect(f.acquireEntry.mock.calls.length).toBeGreaterThan(2);expect(f.state.transactions).toBe(0);
  });
});

describe('generated graphic effect placement',()=>{
  const graphic=()=>[
    {name:'Opacity',match:'AE.ADBE Opacity',params:[{name:'Opacity',value:100}]},
    {name:'Motion',match:'AE.ADBE Motion'},
    {name:'그래픽 그룹',match:'AE.ADBE Graphic Group'},
    {name:'텍스트',match:'AE.ADBE Text',params:[{name:'Text',value:'Premiere UXP MCP'}]},
  ];
  it('inserts sequential default effects before the group while preserving every original component',async()=>{
    const f=fixture(graphic()),original=f.state.components.slice();
    const first=await f.call('apply_video_effect',{matchName:'New effect'});
    expect(first).toMatchObject({status:'pass',hostResult:{componentIndex:2,insertionPolicy:'before_graphic_group',graphicGroupIndex:2}});
    const firstAdded=f.state.components[2];
    const second=await f.call('apply_video_effect',{matchName:'New effect'});
    expect(second).toMatchObject({status:'pass',hostResult:{componentIndex:3,insertionPolicy:'before_graphic_group',graphicGroupIndex:3}});
    expect(f.state.components[2]).toBe(firstAdded);
    expect(f.state.components.filter(c=>c.name!=='New effect')).toEqual(original);
    expect(f.state.components.map(c=>c.match)).toEqual(['AE.ADBE Opacity','AE.ADBE Motion','New effect','New effect','AE.ADBE Graphic Group','AE.ADBE Text']);
    expect(f.state.transactions).toBe(2);
  });
  it('honors an explicit pre-group index exactly',async()=>{
    const f=fixture(graphic());
    expect(await f.call('apply_video_effect',{matchName:'New effect',insertionIndex:1})).toMatchObject({status:'pass',hostResult:{componentIndex:1,insertionPolicy:'explicit'}});
    expect(f.state.components[1].name).toBe('New effect');
  });
  it.each([3,4])('rejects graphic index %s before native insertion',async insertionIndex=>{
    const f=fixture(graphic()),original=f.state.components.slice();
    await expect(withMutationPhase('apply_video_effect',()=>f.call('apply_video_effect',{matchName:'New effect',insertionIndex})))
      .rejects.toMatchObject({code:'GRAPHIC_EFFECT_INSERTION_AFTER_GROUP',details:{contentDispatched:false,errorClassification:'preflight'}});
    expect(f.state.components).toEqual(original);expect(f.state.transactions).toBe(0);
  });
  it('rejects automatic duplicate-group placement before dispatch',async()=>{
    const f=fixture([...graphic(),{name:'Other group',match:'AE.ADBE Graphic Group'}]);
    await expect(withMutationPhase('apply_video_effect',()=>f.call('apply_video_effect',{matchName:'New effect'})))
      .rejects.toMatchObject({code:'GRAPHIC_EFFECT_INSERTION_AMBIGUOUS',details:{contentDispatched:false}});
    expect(f.state.transactions).toBe(0);
  });
  it('rolls back only the inserted pre-group instance after failed initialization',async()=>{
    const f:any=fixture(graphic()),original=f.state.components.slice();
    f.newParams=[{name:'Amount',value:1}];
    const result=await f.call('apply_video_effect',{matchName:'New effect',initialParameters:[{paramIndex:0,expectedDisplayName:'Wrong name',value:9}]});
    expect(result).toMatchObject({status:'fail',hostResult:{rollback:{attempted:true,verified:true}}});
    expect(f.state.components).toEqual(original);expect(f.state.transactions).toBe(2);
  });
  it('keeps an incorrect native append unverified instead of accepting a correct count',async()=>{
    const f=fixture(graphic(),{wrongInsert:true});
    expect(await f.call('apply_video_effect',{matchName:'New effect'})).toMatchObject({status:'unverified',hostResult:{rollback:{verified:false}}});
    expect(f.state.transactions).toBe(1);
  });
  it('retains ordinary video append behavior',async()=>{
    const f=fixture([{name:'Existing'}]);
    expect(await f.call('apply_video_effect',{matchName:'New effect'})).toMatchObject({status:'pass',hostResult:{componentIndex:1,insertionPolicy:'append'}});
    expect(f.state.components.map(c=>c.name)).toEqual(['Existing','New effect']);
  });
});

it('proves missing effect lookup is preflight before any native transaction',async()=>{
  const f=fixture([{name:'Effect',params:[{name:'Value',value:1}]}]);
  await expect(withMutationPhase('set_effect_values',()=>f.call('set_effect_values',{
    componentIndex:99,parameters:[{paramIndex:0,expectedDisplayName:'Value',value:2}],
  }))).rejects.toMatchObject({code:'COMPONENT_NOT_FOUND_OR_AMBIGUOUS',details:{contentDispatched:false,errorClassification:'preflight'}});
  expect(f.state.transactions).toBe(0);
});
it('rejects numeric initialValues keys before inserting an effect (G a69e66a2)',async()=>{
  const f:any=fixture([]);f.entry.snapshot.mediaType='audio';f.target.expectedMediaType='audio';
  f.newParams=[{name:'Precision',value:1}];
  await expect(withMutationPhase('apply_audio_effect',()=>f.call('apply_audio_effect',{
    displayName:'Pitch',initialValues:{'1':9},
  }))).rejects.toMatchObject({details:{contentDispatched:false,errorClassification:'preflight'}});
  expect(f.state.transactions).toBe(0);expect(f.state.components).toHaveLength(0);
});
it('retains the channel-layout guard as a no-write refusal (C 7a161002)',async()=>{
  const f:any=fixture([{name:'Volume',match:'Internal Volume Stereo'}]);f.entry.snapshot.mediaType='audio';f.target.expectedMediaType='audio';f.unsupportedLayout=true;
  await expect(withMutationPhase('apply_audio_effect',()=>f.call('apply_audio_effect',{displayName:'Pitch'})))
    .rejects.toMatchObject({code:'AUDIO_EFFECT_CHANNEL_LAYOUT_UNSUPPORTED',details:{contentDispatched:false}});
  expect(f.state.transactions).toBe(0);
});
it('retains an observed parameter-name guard and bounded rollback for a blank caller identity (G 572f0faf)',async()=>{
  const f:any=fixture([{name:'Volume',match:'Internal Volume Stereo'}]);f.entry.snapshot.mediaType='audio';f.target.expectedMediaType='audio';f.newParams=[{name:'Precision',value:1}];
  const result=await f.call('apply_audio_effect',{displayName:'Pitch',initialParameters:[{paramIndex:0,expectedDisplayName:'',value:9}]});
  expect(result).toMatchObject({status:'fail',hostResult:{rollback:{verified:true}}});
  expect(result.errors.join(' ')).toContain('PARAMETER_IDENTITY_CHANGED');expect(f.state.components.map((c:any)=>c.match)).toEqual(['Internal Volume Stereo']);
});
it('reacquires audio clip proxies after each insertion/animation transaction across successive clips',async()=>{
  vi.useFakeTimers();let pending:Promise<any>|undefined;
  try{
  for(let clip=0;clip<3;clip++) {
    const f:any=fixture([{name:'Volume',match:'Internal Volume Stereo'}]);
    f.entry.snapshot.mediaType='audio';f.entry.snapshot.projectItemId='voice-'+clip;
    f.target.expectedMediaType='audio';f.target.expectedProjectItemId='voice-'+clip;
    f.newParams=[{name:'Precision',value:1,timeVarying:true}];
    const stableRaw=f.entry.raw;
    f.acquireEntry=()=>{
      const generation=f.state.transactions;
      return {...f.entry,raw:{...stableRaw,getComponentChain:async()=>{
        if(generation!==f.state.transactions)throw Error('The script object is no longer valid');
        return stableRaw.getComponentChain();
      }}};
    };
    pending=f.call('apply_audio_effect',{displayName:'Pitch',initialParameters:[{paramIndex:0,expectedDisplayName:'Precision',value:9}]});
    void pending!.catch(()=>{});await vi.runAllTimersAsync();
    const receipt=await pending;
    expect(receipt.status).toBe('pass');expect(receipt.hostResult.componentIndex).toBe(1);
    expect(f.state.components[1].params[0].value).toBe(9);
    expect(f.state.transactions).toBe(3);
  }
  }finally{await vi.runAllTimersAsync();await pending?.catch(()=>{});noteGraphicMutation(Number.NEGATIVE_INFINITY);vi.useRealTimers();}
});
describe("effect mutation audit regressions", () => {
  it('writes explicit Point links in one native transaction and preserves untouched values',async()=>{
    const f=fixture([{name:'Linked',params:[{name:'Input',value:[.5,.5],pointArray:true},{name:'Output',value:[0,0],pointArray:true},{name:'Other',value:123}]}]);
    const dependencies={mode:'apply',componentMatchName:'Linked',parameterNames:['Input','Output','Other'],rules:[{id:'offset',outputParamIndex:1,nodes:[{op:'add',args:[{paramIndex:0,field:'x'},.1]},{op:'subtract',args:[{paramIndex:0,field:'y'},.1]},{op:'point',args:[{nodeIndex:0},{nodeIndex:1}]}]}]};
    const args={dependencies,parameters:[{paramIndex:0,expectedDisplayName:'Input',expectedValue:[.5,.5],value:{kind:'point',x:.5,y:.5}}]};
    const r=await f.call('set_effect_values',args);expect(r.status).toBe('pass');expect(f.state.transactions).toBe(1);
    expect(r.hostResult.derivedValues).toMatchObject({writeDispatched:true,linkedParameters:[1]});expect(f.state.components[0].params.map((p:any)=>p.value)).toEqual([[.5,.5],[.6,.4],123]);
    expect((await f.call('set_effect_values',args)).hostResult.idempotentNoOp).toBe(true);expect(f.state.transactions).toBe(1);
  });
  it.each([false,true])('disables animation only after native removal is independently verified (ignored removal %s)',async ignoreRemoveKey=>{
    const f=fixture([{name:'Effect',params:[{name:'Value',value:100,keys:[{seconds:5,value:60,mode:0}]}]}],{ignoreRemoveKey});
    const result=await f.call('edit_effect_keyframes',{disableAnimationWhenEmpty:true,operations:[{paramIndex:0,expectedDisplayName:'Value',action:'remove',timeSeconds:12,expectedValue:60,expectedInterpolation:'linear'}]});
    expect(result.status).toBe(ignoreRemoveKey?'unverified':'pass');expect(f.state.transactions).toBe(ignoreRemoveKey?1:2);
    expect(f.state.components[0].params[0].timeVarying).toBe(ignoreRemoveKey);expect(result.hostResult.disableAnimationTransaction).toBe(!ignoreRemoveKey);
  });
  it('acquires a reverse map before reads and rejects clip changes during the native callback',async()=>{
    const f=fixture([{name:'Effect',params:[{name:'Value',value:100}]}]);
    Object.assign(f.entry.snapshot,{name:'clip.mp4',reversed:true,outPoint:time(13)});
    Object.assign(f.entry.raw,{getProjectItem:async()=>({getMediaFilePath:async()=>'C:\\clip.mp4'})});
    Object.assign(f.sequence,{getPlayerPosition:async()=>time(11)});Object.assign(f.project,{openSequence:async()=>true});
    const proof={status:'pass',exactOnly:true,startTicks:f.entry.snapshot.start.ticks,endTicks:f.entry.snapshot.end.ticks,inTicks:f.entry.snapshot.inPoint.ticks,outTicks:time(13).ticks,speed:1,reversed:true,originTicks:time(12.96).ticks,samples:[{sequenceTicks:f.entry.snapshot.start.ticks,nativeTicks:time(12.96).ticks,rate:-1},{sequenceTicks:time(11).ticks,nativeTicks:time(11.96).ticks,rate:-1}]};
    const native=vi.fn(async()=>proof),host=new PremiereHost(undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,native) as any;
    const request={id:'reverse',command:'get_effect_values',args:{...f.target,componentMatchName:'Effect',timeSeconds:11}};
    await host.prepareNativeEffectTime(request);expect(native.mock.calls[0]?.[1]).toMatchObject({purpose:'time_mapping',sampleTimes:[time(11).ticks]});
    const read=await host.dispatchCommand(request);expect(read.nativeTimeProof).toEqual(proof);expect(read.component.params[0].sampledSequenceTime.seconds).toBe(11);
    native.mockImplementationOnce(async()=>{f.entry.snapshot={...f.entry.snapshot,speed:2};return proof;});
    await expect(host.prepareNativeEffectTime(request)).rejects.toThrow('CONTEXT_CHANGED');expect(f.state.transactions).toBe(0);
  });
  it('hydrates a correlated SDK Color only after a second full UXP preservation read',async()=>{
    const color={red:.2,green:.4,blue:.8,alpha:0},sample={red:.3,green:.3,blue:.7,alpha:0};
    const f=fixture([{name:'Tint',params:[{name:'Black',value:color,keys:[{seconds:3,value:color,mode:0},{seconds:5,value:color,mode:0}]},{name:'Other',value:100}]}]);
    const param=f.state.components[0].params[0];param.getValueAtTime=async()=>{throw Error('not supported for these value types');};param.getStartValue=async()=>color;
    Object.assign(f.entry.snapshot,{name:'clip.mp4',outPoint:time(13)});
    Object.assign(f.entry.raw,{getProjectItem:async()=>({getMediaFilePath:async()=>'C:\\clip.mp4'})});
    Object.assign(f.sequence,{getPlayerPosition:async()=>time(11),getTimebase:async()=>'8467200000'});const focus=vi.fn(async()=>true);Object.assign(f.project,{openSequence:focus});
    const native=vi.fn(async()=>({status:'pass',value:sample,nativeTicks:time(4).ticks,sequenceTicks:time(11).ticks}));
    const host=new PremiereHost(undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,native) as any;
    const request={id:'test',command:'get_effect_values',args:{...f.target,componentMatchName:'Tint',detail:'parameter',paramIndex:0,expectedDisplayName:'Black',timeSeconds:11,__nativeEffectTimeProof:f.fakeProof({timeSeconds:11})}};
    await host.prepareNativeColorSamples(request);expect(focus).toHaveBeenCalledOnce();expect(native).toHaveBeenCalledOnce();
    const result=await host.dispatchCommand(request);expect(result.component.params[0]).toMatchObject({value:sample,valueReadMethod:'adobe_sdk_GetParam',readStatus:{value:'pass'}});
    f.state.components[0].params[1].value=101;
    await expect(host.dispatchCommand(request)).rejects.toThrow('NATIVE_SAMPLE_CONTENT_CHANGED');expect(f.state.transactions).toBe(0);
  });
  it('recreates transient time/keyframe objects inside the mutation window for add, replace and clear',async()=>{
    const f=fixture([{name:'Effect',params:[{name:'Value',value:100}]}],{requireFreshTemps:true});
    expect((await f.call('set_effect_keyframes',{keyframes:[{paramIndex:0,expectedDisplayName:'Value',timeSeconds:12,value:50,interpolation:'hold'}]})).status).toBe('pass');
    expect((await f.call('edit_effect_keyframes',{operations:[{paramIndex:0,expectedDisplayName:'Value',action:'replace',timeSeconds:12,expectedValue:50,expectedInterpolation:'hold',value:60,interpolation:'linear'}]})).status).toBe('pass');
    expect((await f.call('edit_effect_keyframes',{disableAnimationWhenEmpty:true,operations:[{paramIndex:0,expectedDisplayName:'Value',action:'remove',timeSeconds:12,expectedValue:60,expectedInterpolation:'linear'}]})).status).toBe('pass');
    expect(f.state.components[0].params[0].keys).toEqual([]);
  });
  it('also recreates static native value proxies inside the locked action window',async()=>{
    const f=fixture([{name:'Effect',params:[{name:'Value',value:100},{name:'Second',value:10}]}],{requireFreshTemps:true});
    expect((await f.call('set_effect_values',{parameters:[{paramIndex:0,expectedDisplayName:'Value',expectedValue:100,value:95},{paramIndex:1,expectedDisplayName:'Second',expectedValue:10,value:9}]})).status).toBe('pass');
    expect(f.state.transactions).toBe(1);
  });
  it('automatically proves Auto Reframe output while still rejecting unrelated value or animation drift',async()=>{
    const setup=(wrong=false,animate=false)=>{
      const names:Record<number,string>={3:'Scale (Merged)',11:'Reframe Scale',12:'Scale (Auto Generated)'};
      const f=fixture([{name:'Auto Reframe',match:'AE.ADBE AEFilterAutoFramer',params:Array.from({length:14},(_,i)=>({name:names[i]??String(i),value:i===11?100:150}))}]);
      const ps=f.state.components[0].params;
      ps[11].createSetValueAction=(key:any)=>()=>{ps[11].value=key.value;ps[3].value=ps[12].value*key.value/100;if(wrong)ps[6].value++;if(animate)ps[3].timeVarying=true;};
      ps[3].createSetValueAction=()=>{throw Error('Native derived output must not be written');};return f;
    };
    const args={parameters:[{paramIndex:11,expectedDisplayName:'Reframe Scale',expectedValue:100,value:95}]};
    const f=setup(),result=await f.call('set_effect_values',args);
    expect(result.status).toBe('pass');expect(result.hostResult.derivedValues).toMatchObject({rules:['adobe_auto_reframe_static_scale_v1'],verified:true,writeDispatched:false});
    expect(f.state.transactions).toBe(1);
    expect((await setup(true).call('set_effect_values',args)).status).toBe('unverified');
    expect((await setup(false,true).call('set_effect_values',args)).status).toBe('unverified');
  });
  it("updates an explicitly empty animated base value while preserving mode and rejecting any existing keys",async()=>{
    const f=fixture([{name:"Native audio",params:[{name:"Control",value:.5}]}]),param=f.state.components[0].params[0];param.timeVarying=true;
    const args={parameters:[{paramIndex:0,expectedDisplayName:"Control",expectedValue:.5,value:.6}],preserveEmptyAnimation:true};
    expect((await f.call("set_effect_values",args)).status).toBe("pass");expect(param.timeVarying).toBe(true);expect(param.keys).toEqual([]);expect(param.value).toBe(.6);
    param.keys=[{seconds:5,value:.6,mode:0}];await expect(f.call("set_effect_values",{...args,parameters:[{...args.parameters[0],expectedValue:.6,value:.7}]})).rejects.toThrow("PARAMETER_ANIMATED");expect(f.state.transactions).toBe(1);
    const changed=fixture([{name:"Native audio",params:[{name:"Control",value:.5}]}]),p=changed.state.components[0].params[0];p.timeVarying=true;
    p.createSetValueAction=(key:any)=>()=>{p.value=key.value;p.timeVarying=false;};
    expect((await changed.call("set_effect_values",args)).status).toBe("unverified");
  });
  it("verifies explicitly declared native derived values without writing them or permitting hidden animation changes",async()=>{
    const setup=(computed=142.5,animate=false)=>{
      const f=fixture([{name:"Coupled",params:[{name:"Scale",value:100},{name:"Output",value:150},{name:"Untouched",value:1}]}]);
      const [scale,output]=f.state.components[0].params;
      scale.createSetValueAction=(key:any)=>()=>{scale.value=key.value;output.value=computed;if(animate)output.timeVarying=true;};
      output.createSetValueAction=()=>{throw Error("Computed output must not be written");};return f;
    };
    const args={parameters:[{paramIndex:0,expectedDisplayName:"Scale",expectedValue:100,value:95}],expectedDerivedParameters:[{paramIndex:1,expectedDisplayName:"Output",expectedValue:150,value:142.5}]};
    const f=setup(),r=await f.call("set_effect_values",args);expect(r.status).toBe("pass");expect(r.hostResult.derivedValues).toMatchObject({verified:true,writeDispatched:false});expect(f.state.transactions).toBe(1);
    expect((await setup(141).call("set_effect_values",args)).status).toBe("unverified");
    expect((await setup(142.5,true).call("set_effect_values",args)).status).toBe("unverified");
    expect((await setup().call("set_effect_values",{parameters:args.parameters})).status).toBe("unverified");
    const guarded=setup();await expect(guarded.call("set_effect_values",{...args,expectedDerivedParameters:[{...args.expectedDerivedParameters[0],expectedValue:99}]})).rejects.toThrow("PARAMETER_VALUE_CHANGED");expect(guarded.state.transactions).toBe(0);
    await expect(setup().call("set_effect_values",{...args,expectedDerivedParameters:args.parameters})).rejects.toThrow("OVERLAP");
    const noop=setup();expect((await noop.call("set_effect_values",{...args,parameters:[{...args.parameters[0],value:100}]})).status).toBe("unverified");expect(noop.state.transactions).toBe(0);
  });
  it("can delete an unreadable target but blocks unreadable survivors before dispatch",async()=>{
    const specs=[{name:"Good",params:[{name:"Value",value:10}]},{name:"Broken",params:[{name:"Custom",value:1,listThrows:true}]}];
    const f=fixture(specs);
    expect((await f.call("remove_effect",{componentIndex:1,componentMatchName:"Broken"})).status).toBe("pass");
    const other=fixture(specs);
    await expect(other.call("remove_effect",{componentIndex:0,componentMatchName:"Good"})).rejects.toThrow("unrelated effect");
    expect(other.state.transactions).toBe(0);
  });
  it("initializes from native values without replacing the user selection",async()=>{
    const onSelection=vi.fn(),f=fixture([{name:"Motion"}],{onSelection}) as any;
    const other={id:'user-selection'};(await f.sequence.getSelection()).addItem(other);
    f.newParams=[{name:"Size",value:15}];
    const result=await f.call("apply_video_effect",{matchName:"New effect",initialParameters:[{paramIndex:0,expectedDisplayName:"Size",expectedValue:15,value:9}]});
    expect(result.status).toBe("pass");expect(result.after[1].params[0].value).toBe(9);
    expect(onSelection).not.toHaveBeenCalled();
    expect(await (await f.sequence.getSelection()).getTrackItems()).toEqual([other]);
  });
  it("rolls back only its new effect if any initializer fails preflight",async()=>{
    const f=fixture([{name:"Motion"}]) as any;f.newParams=[{name:"Value",value:10}];
    const result=await f.call("apply_video_effect",{matchName:"New effect",initialParameters:[{paramIndex:0,expectedDisplayName:"Value",value:9},{paramIndex:4,expectedDisplayName:"Missing",value:1}]});
    expect(result.status).toBe("fail");expect(result.hostResult.rollback.verified).toBe(true);expect(f.state.components.map((c:any)=>c.name)).toEqual(["Motion"]);
  });
  it("keeps all effect transaction exceptions unverified without a second dispatch",async()=>{
    const cases:[string,any][]=[
      ["apply_video_effect",{matchName:"New effect"}],
      ["remove_effect",{componentMatchName:"Effect"}],
      ["set_effect_keyframes",{keyframes:[{parameterName:"Value",timeSeconds:14,value:70,interpolation:"hold"}]}],
      ["edit_effect_keyframes",{operations:[{parameterName:"Value",action:"remove",timeSeconds:12,expectedValue:50,expectedInterpolation:"linear"}]}],
    ];
    for(const [command,args] of cases){const f=fixture([{name:"Effect",params:[{name:"Value",value:100,keys:[{seconds:5,value:50,mode:0}]}]}]);let dispatches=0;f.project.executeTransaction=()=>{dispatches++;throw Error("Native action failed after dispatch");};expect((await f.call(command,args)).status).toBe("unverified");expect(dispatches).toBe(1);}
  });
  it("blocks Point keys before dispatch when their required native archive path is absent",async()=>{
    const f=fixture([{name:"Motion",match:"AE.ADBE Motion",params:[{name:"Position",value:[.5,.5]}]}]);
    f.state.components[0].params[0].createKeyframe=(value:any)=>({value,position:time(0)});
    await expect(f.call("set_effect_keyframes",{keyframes:[{paramIndex:0,expectedDisplayName:"Position",timeSeconds:12,value:{kind:"point",x:.6,y:.4},interpolation:"hold"}]})).rejects.toMatchObject({code:"POINT_ANIMATION_WORK_TARGET_REQUIRED"});
    expect(f.state.transactions).toBe(0);
  });
  it("returns UNVERIFIED without retry after a throwing transaction",async()=>{
    const f=fixture([{name:"Opacity",params:[{name:"Opacity",value:100}]}]);
    let calls=0;f.project.executeTransaction=()=>{calls++;throw Error("Object is invalid");};
    const r=await f.call("set_effect_values",{values:{Opacity:90}});
    expect(r.status).toBe("unverified");expect(calls).toBe(1);
  });
  describe("completed value-dispatch exception adjudication", () => {
    const parameters = [
      { paramIndex: 0, expectedDisplayName: "First", expectedValue: 1, value: 10 },
      { paramIndex: 1, expectedDisplayName: "Second", expectedValue: 2, value: 20 },
    ];
    const setup = () => fixture([
      { name: "Effect", params: [{ name: "First", value: 1 }, { name: "Second", value: 2 }, { name: "Untouched", value: 3 }] },
      { name: "Other effect", params: [{ name: "Animated", value: 4, keys: [{ seconds: 5, value: 6, mode: 4 }] }] },
    ]);
    const throwAfterActions = (f: ReturnType<typeof fixture>, after: () => void = () => {}, partial = false, message = "The script object is no longer valid.") => {
      const dispatch = vi.fn((collect: any) => {
        const actions: Array<() => void> = [];
        f.state.transactionActive=true;
        try {
          collect({ addAction: (action: () => void) => actions.push(action) });
          (partial ? actions.slice(0, 1) : actions).forEach(action => action());
          f.state.transactions++; f.state.afterTransaction = true;
          after();
          throw Error(message);
        } finally { f.state.transactionActive=false; }
      });
      f.project.executeTransaction = dispatch;
      return dispatch;
    };

    it.each(["The script object is no longer valid.", "Native action failed after dispatch"])("accepts a fully applied write only from complete readback after %s", async message => {
      const f = setup(), dispatch = throwAfterActions(f, undefined, false, message);
      const result = await f.call("set_effect_values", { parameters });
      expect(result).toMatchObject({ status: "pass", errors: [], hostResult: { dispatchAdjudication: { readbackOnly: true, verified: true }, readback: { missing: [], mismatched: [] } } });
      expect(result.after[0].params.map((p: any) => p.value)).toEqual([10, 20, 3]);
      expect(result.after[1]).toEqual(result.before[1]);
      expect(result.hostResult.staleObjectRetryCount).toBeUndefined();
      expect(dispatch).toHaveBeenCalledTimes(1); expect(f.state.transactions).toBe(1);
    });

    it.each(["partial write", "untouched value drift", "other effect drift", "target animation drift"])("keeps %s unverified without replaying an applied subset", async failure => {
      const f = setup();
      const dispatch = throwAfterActions(f, () => {
        if (failure === "untouched value drift") f.state.components[0].params[2].value = 99;
        if (failure === "other effect drift") f.state.components[1].params[0].keys[0].mode = 5;
        if (failure === "target animation drift") {
          const param = f.state.components[0].params[0];
          param.timeVarying = true; param.keys = [{ seconds: 5, value: 10, mode: 4 }];
        }
      }, failure === "partial write");
      const result = await f.call("set_effect_values", { parameters });
      expect(result).toMatchObject({ status: "unverified", hostResult: { dispatchAdjudication: { readbackOnly: true, verified: false } } });
      expect(result.errors.join(" ")).toContain(failure === "partial write" ? "Effect value mismatch" : failure === "target animation drift" ? "Static/base-value write changed animation" : "Unrequested component/parameter state changed");
      expect(result.hostResult.staleObjectRetryCount).toBeUndefined();
      expect(dispatch).toHaveBeenCalledTimes(1); expect(f.state.transactions).toBe(1);
      expect(f.state.components[0].params[0].value).toBe(10);
      expect(f.state.components[0].params[1].value).toBe(failure === "partial write" ? 2 : 20);
    });

    it.each(["exact", "wrong value", "hidden animation"])("requires %s derived-value readback after the dispatch exception", async mode => {
      const f = fixture([{ name: "Coupled", params: [{ name: "Scale", value: 100 }, { name: "Output", value: 150 }, { name: "Untouched", value: 1 }] }]);
      const [scale, output] = f.state.components[0].params;
      scale.createSetValueAction = (key: any) => () => { scale.value = key.value; output.value = mode === "wrong value" ? 141 : 142.5; if (mode === "hidden animation") output.timeVarying = true; };
      const outputWrite = vi.fn(() => { throw Error("Computed output must not be written"); });
      output.createSetValueAction = outputWrite;
      const dispatch = throwAfterActions(f);
      const result = await f.call("set_effect_values", {
        parameters: [{ paramIndex: 0, expectedDisplayName: "Scale", expectedValue: 100, value: 95 }],
        expectedDerivedParameters: [{ paramIndex: 1, expectedDisplayName: "Output", expectedValue: 150, value: 142.5 }],
      });
      expect(result).toMatchObject({ status: mode === "exact" ? "pass" : "unverified", hostResult: { dispatchAdjudication: { readbackOnly: true, verified: mode === "exact" }, derivedValues: { writeDispatched: false } } });
      if (mode === "wrong value") expect(result.errors.join(" ")).toContain("Native derived value did not verify");
      if (mode === "hidden animation") expect(result.errors.join(" ")).toContain("Unrequested component/parameter state changed");
      expect(dispatch).toHaveBeenCalledTimes(1); expect(outputWrite).not.toHaveBeenCalled();
    });

    it("does not replay action-construction invalidation inside the native transaction callback", async () => {
      const f = setup();
      const create = vi.fn(() => { throw Error("The script object is no longer valid."); });
      f.state.components[0].params[0].createSetValueAction = create;
      const dispatch = vi.spyOn(f.project, "executeTransaction");
      const result = await f.call("set_effect_values", { parameters });
      expect(result).toMatchObject({ status: "unverified", hostResult: { dispatchAdjudication: { readbackOnly: true, verified: false } } });
      expect(result.after).toEqual(result.before);
      expect(result.hostResult.staleObjectRetryCount).toBeUndefined();
      expect(create).toHaveBeenCalledTimes(1); expect(dispatch).toHaveBeenCalledTimes(1); expect(f.state.transactions).toBe(0);
    });
  });
  it("accepts applied PointF array readback and then performs an idempotent no-op", async () => {
    const f = fixture([{ name: "Motion", match:"AE.ADBE Motion", params: [{ name: "Position", value: [.5, .5], pointArray: true }] }]);
    const args = { values: { Position: { kind: "point", x: .25, y: .75 } } };
    expect((await f.call("set_effect_values", args)).status).toBe("pass");
    expect((await f.call("set_effect_values", args)).hostResult.idempotentNoOp).toBe(true);
    expect(f.state.transactions).toBe(1);
  });
  it("rejects unreadable animation before any action or loss of existing keys", async () => {
    const f = fixture([{ name: "Opacity", params: [{ name: "Opacity", value: 100, listThrows: true, keys: [{ seconds: 5, value: 50, mode: 0 }] }] }]);
    await expect(f.call("set_effect_values", { values: { Opacity: 82 } })).rejects.toThrow("PARAMETER_READ_UNVERIFIED");
    expect(f.state.transactions).toBe(0); expect(f.state.components[0].params[0].keys).toHaveLength(1);
  });
  it("refuses static writes to time-varying parameters even when they currently have no keys", async () => {
    const f = fixture([{ name: "Opacity", params: [{ name: "Opacity", value: 100 }] }]);
    f.state.components[0].params[0].timeVarying = true;
    await expect(f.call("set_effect_values", { values: { Opacity: 82 } })).rejects.toThrow("PARAMETER_ANIMATED");
    expect(f.state.transactions).toBe(0);
  });
  it("never considers failed keyframe-detail reads proof of deletion", async () => {
    const f = fixture([{ name: "Opacity", params: [{ name: "Opacity", value: 100, keys: [{ seconds: 5, value: 50, mode: 0 }] }] }], { failDetailsAfter: true, ignoreRemoveKey: true });
    const r = await f.call("edit_effect_keyframes", { operations: [{ action: "remove", parameterName: "Opacity", timeSeconds: 12, expectedValue: 50, expectedInterpolation: "linear" }] });
    expect(r.status).toBe("unverified"); expect(f.state.components[0].params[0].keys).toHaveLength(1);
  });
  it("supports exact indexed deletion and explicitly disabling an empty animation", async () => {
    const f = fixture([{ name: "Opacity", params: [{ name: "Opacity", value: 100, keys: [{ seconds: 5, value: 50, mode: 0 }] }] }]);
    const r = await f.call("edit_effect_keyframes", { disableAnimationWhenEmpty: true, operations: [{ action: "remove", paramIndex: 0, expectedDisplayName: "Opacity", timeSeconds: 12, expectedValue: 50, expectedInterpolation: "linear" }] });
    expect(r.status).toBe("pass"); expect(f.state.components[0].params[0].timeVarying).toBe(false);
  });
  it("rejects disabling animation when an unrequested key would be lost", async () => {
    const f = fixture([{ name: "Opacity", params: [{ name: "Opacity", value: 100, keys: [{ seconds: 5, value: 50, mode: 0 }, { seconds: 7, value: 70, mode: 0 }] }] }]);
    await expect(f.call("edit_effect_keyframes", { disableAnimationWhenEmpty: true, operations: [{ action: "remove", parameterName: "Opacity", timeSeconds: 12, expectedValue: 50, expectedInterpolation: "linear" }] })).rejects.toThrow("Explicit animation disable");
    expect(f.state.transactions).toBe(0);
  });
  it("rejects ambiguous display names and can write the second guarded index", async () => {
    const f = fixture([{ name: "Opacity", params: [{ name: "Blend Mode", value: 18 }, { name: "Blend Mode", value: 0 }] }]);
    await expect(f.call("set_effect_values", { values: { "Blend Mode": 7 } })).rejects.toThrow("PARAMETER_AMBIGUOUS");
    const r = await f.call("set_effect_values", { parameters: [{ paramIndex: 1, expectedDisplayName: "Blend Mode", expectedValue: 0, value: 7 }] });
    expect(r.status).toBe("pass"); expect(f.state.components[0].params.map((p: any) => p.value)).toEqual([18, 7]);
  });
  it("preflights every convenience parameter before changing a valid subset", async () => {
    const f = fixture([{ name: "Motion", params: [{ name: "Scale", value: 100 }] }]);
    await expect(f.call("set_transform", { values: { Scale: 150, Missing: 1 } })).rejects.toThrow();
    expect(f.state.transactions).toBe(0);
  });
  it("rejects stale exact clip bounds before adding an effect", async () => {
    const f = fixture([{ name: "Motion" }]);
    await expect(f.call("apply_video_effect", { expectedEndSeconds: 20.02, matchName: "New effect" })).rejects.toThrow("Effect target changed");
    expect(f.state.transactions).toBe(0);
  });
  it("detects wrong insertion order even when the effect count is correct", async () => {
    const f = fixture([{ name: "Motion" }, { name: "Old effect" }], { wrongInsert: true });
    expect((await f.call("apply_video_effect", { matchName: "New effect", insertionIndex: 1 })).status).toBe("unverified");
  });
  it("detects removal of a different effect even when chain length is correct", async () => {
    const f = fixture([{ name: "Effect A" }, { name: "Effect B" }], { wrongRemove: true });
    expect((await f.call("remove_effect", { componentIndex: 1, componentMatchName: "Effect B" })).status).toBe("unverified");
  });
});
