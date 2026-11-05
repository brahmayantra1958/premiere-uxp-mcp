import {it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

// Native objects are invalidated by a transaction in this fixture. This proves
// wrapper lifetime and stop/readback behavior, not the cause of an Adobe crash.
function fixture(fault='',rate=24,kind:'graphic'|'audio'|'video'='graphic') {
  const time=(seconds:number)=>({seconds,ticks:String(Math.round(seconds*254016000000))});
  const mediaType=kind==='audio'?'audio':'video',sourceId=kind==='graphic'?'':'source';
  const events:Array<{type:string;at:number;epoch:number}>=[];
  const items=[{track:4,start:0,end:1/rate,input:3600,output:3600+1/rate}];
  if(fault==='truncated')for(let i=0;i<1000;i++)items.push({...items[0]!,start:10+i,end:10+i+1/rate});
  if(fault==='later-source')items.push({...items[0]!,track:2,start:2,end:2+1/rate});
  if(fault.startsWith('same-track'))items.push({...items[0]!,track:4,start:2,end:2+1/rate});
  let epoch=0,created=0,transactions=0,lastInsert=false;
  let locked=false,executingTransaction=false;
  const transactionActionCounts:number[]=[];
  const record=(type:string)=>events.push({type,at:Date.now(),epoch});
  const wrapper=(item:typeof items[number])=>({epoch,item,getProjectItem:()=>sourceId?{getId:()=>sourceId}:null,getName:()=> 'Graphic',getStartTime:()=>time(item.start),getEndTime:()=>time(item.end),getInPoint:()=>time(item.input),getOutPoint:()=>time(item.output),isDisabled:()=>false,getSpeed:()=>1,isSpeedReversed:()=>false,isAdjustmentLayer:()=>false});
  const track=(index:number)=>({id:index,name:`${mediaType}${index+1}`,getTrackItems:(type:number)=>{record('collection');return type===1?items.filter(i=>i.track===index).map(wrapper):[];}});
  const sequence={guid:'s',name:'S',getTimebase:()=>String(Math.round(254016000000/rate)),getSettings:()=>{record('snapshot');return {getVideoFrameRect:()=>({width:1920,height:1080}),getVideoFrameRate:()=>({value:rate})};},
    getVideoTrackCount:()=>mediaType==='video'?5:0,getAudioTrackCount:()=>mediaType==='audio'?5:0,getCaptionTrackCount:()=>0,getEndTime:()=>time(10),
    getVideoTrack:track,getAudioTrack:track};
  const project={guid:'p',path:'C:/scratch.prproj',getActiveSequence:()=>{record('context');return sequence;},lockedAccess:(f:any)=>{locked=true;try{return f();}finally{locked=false;}},executeTransaction:(f:any)=>{
    expect(locked).toBe(true);executingTransaction=true;
    try{const actions:any[]=[];f({addAction:(a:any)=>{expect(executingTransaction).toBe(true);if(fault==='add-32'&&created===32)throw Error('Illegal Parameter type');actions.push(a);}});transactionActionCounts.push(actions.length);record('dispatch');transactions++;
      try{for(const [index,action] of actions.entries()){action();if(fault==='same-track-partial'&&index===0||fault==='apply-32'&&transactions===32)throw Error('native partial transaction');}}finally{epoch++;}return true;}
    finally{executingTransaction=false;}
  }};
  const editor={createCloneTrackItemAction:(raw:ReturnType<typeof wrapper>,offset:any,video:number,audio:number,_align:boolean,insert:boolean)=>{
    expect(locked).toBe(true);expect(executingTransaction).toBe(true);
    if(fault==='create-32'&&created===31)throw Error('Illegal Parameter type');
    lastInsert=insert;
    expect(raw.epoch).toBe(epoch);record('action');const actionIndex=created++;const value={...raw.item,track:raw.item.track+(mediaType==='audio'?audio:video),start:raw.item.start+offset.seconds,end:raw.item.end+offset.seconds};
    return ()=>{if(fault==='range')value.output+=1;if(fault==='no-op-second'&&actionIndex===1)return;if(fault==='erase-earlier'&&actionIndex===1)items.splice(1,1);items.push(value);if(fault==='source-change'&&actionIndex===0)raw.item.end+=1;};
  }};
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1,TRANSITION:2}},SequenceEditor:{getEditor:()=>{if(fault==='editor-32'&&executingTransaction&&created===31)throw Error('native editor invalid');return editor;}},TickTime:{createWithSeconds:(seconds:number)=>{if(fault==='time-32'&&executingTransaction&&created===31)throw Error('native time invalid');return time(seconds);},
    // Production builds native times from exact tick strings (never the flooring seconds factory).
    createWithTicks:(ticks:string)=>{if(fault==='time-32'&&executingTransaction&&created===31)throw Error('native time invalid');return {ticks,seconds:Number(ticks)/254016000000};}}},{Date});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  const itemHost=load('apps/uxp-plugin/src/host-items.ts'),acquire=itemHost.findTrackItemEntriesFromOneTrack;
  const batchAcquisitions:Array<{ids:string[];collections:number}>=[];
  itemHost.findTrackItemEntriesFromOneTrack=async(sequence:any,ids:string[])=>{const before=events.filter(event=>event.type==='collection').length;const result=await acquire(sequence,ids);batchAcquisitions.push({ids:[...ids],collections:events.filter(event=>event.type==='collection').length-before});return result;};
  if(fault==='observer-throws') {
    const batch=load('apps/uxp-plugin/src/host-clone-batch.ts'),run=batch.tryCloneOneTrackBatch;
    batch.tryCloneOneTrackBatch=(before:any,plans:any,host:any)=>run(before,plans,{...host,acquireSources:async(ids:string[])=>{
      const source=await host.acquireSources(ids);
      return {...source,executeTransaction:(label:string,factory:any,observe:any)=>source.executeTransaction(label,factory,(event:any)=>{observe(event);throw Error('diagnostic observer failed');}),
        createAction:(plan:any,observe:any)=>source.createAction(plan,(phase:any)=>{observe(phase);throw Error('action observer failed');})};
    }});
  }
  const runClones=(clones:any[])=>new PremiereHost().dispatchCommand({command:'clone_clips',args:{expectedProjectId:'p',expectedSequenceId:'s',clones}});
  const run=(offsets=[2,3])=>runClones(offsets.map(timeOffsetSeconds=>({trackItemId:`${mediaType}:4:0:${sourceId}`,timeOffsetSeconds,videoTrackOffset:-2,audioTrackOffset:-2,mode:'overwrite'})));
  return {run,runClones,items,events,transactionActionCounts,batchAcquisitions,noteMutation:load('apps/uxp-plugin/src/graphic-lifecycle.ts').noteGraphicMutation,get created(){return created;},get transactions(){return transactions;},get lastInsert(){return lastInsert;}};
}
async function timedGraphicRun(fault='') {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  const f=fixture(fault);let pending:Promise<any>|undefined;
  try{pending=f.run(Array.from({length:100},(_,index)=>index+2));void pending.catch(()=>{});await vi.runAllTimersAsync();return {f,result:await pending};}
  finally{await vi.runAllTimersAsync();await pending?.catch(()=>{});f.noteMutation(Number.NEGATIVE_INFINITY);vi.useRealTimers();}
}
it('creates each same-source graphic action on a fresh epoch and proves its entire prefix before the next dispatch',async()=>{
  const f=fixture(),result=await f.run();expect(result.status).toBe('pass');expect(result.hostResult.completedClones).toBe(2);expect(f.transactions).toBe(2);expect(f.transactionActionCounts).toEqual([1,1]);expect(f.items.map(i=>[i.track,i.start])).toEqual([[4,0],[2,2],[2,3]]);
  expect(f.events.filter(e=>['action','dispatch'].includes(e.type)).map(e=>[e.type,e.epoch])).toEqual([['action',0],['dispatch',0],['action',1],['dispatch',1]]);
  expect(result.hostResult.transaction).toEqual({plannedActions:1,uniqueSources:1,actionCreationOrdinal:1,createdActions:1,addActionOrdinal:1,addedActions:1,factoryCompleted:true,callbackCompleted:true,executeReturned:true,lastPhase:'locked_exit',lastActionPhase:'create_clone_action_exit',failurePhase:null,failureOrdinal:null});
  expect(result.hostResult).toMatchObject({batchMode:'fresh_source_transactions',attemptedTransactions:2,verifiedTransactions:2});
  expect(f.batchAcquisitions).toEqual(Array.from({length:2},()=>({ids:['video:4:0:'],collections:1})));
});
it('completes the full100 graphic plans without a compound transaction, action cap or stale source reuse',async()=>{
  const {f,result}=await timedGraphicRun();
  expect(result.status).toBe('pass');expect(result.hostResult).toMatchObject({completedClones:100,originalsPreserved:true,attemptedTransactions:100,verifiedTransactions:100});
  expect(f.transactionActionCounts).toEqual(Array(100).fill(1));expect(f.items).toHaveLength(101);
  expect(f.events.filter(event=>event.type==='action').map(event=>event.epoch)).toEqual(Array.from({length:100},(_,index)=>index));
  expect(f.batchAcquisitions).toEqual(Array.from({length:100},()=>({ids:['video:4:0:'],collections:1})));
  expect(f.events.filter(event=>event.type==='snapshot')).toHaveLength(101);
  expect(result.hostResult.steps.every((step:any)=>step.verified&&step.hostResult)).toBe(true);
});
it.each([['editor-32','get_editor_enter'],['time-32','create_tick_time_enter'],['create-32','create_clone_action_enter']] as const)('distinguishes native %s construction failure at step32 while preserving the31 verified commits without replay',async(fault,lastActionPhase)=>{
  const {f,result}=await timedGraphicRun(fault);
  expect(result.status).toBe('unverified');expect(result.hostResult.completedClones).toBe(31);
  expect(result.hostResult.transaction).toMatchObject({plannedActions:1,actionCreationOrdinal:1,createdActions:0,addActionOrdinal:0,addedActions:0,factoryCompleted:false,callbackCompleted:false,executeReturned:false,failurePhase:'create_action_enter',failureOrdinal:1,lastActionPhase});
  expect(result.hostResult).toMatchObject({attemptedTransactions:32,verifiedTransactions:31});expect(result.hostResult.transactions[31]).toMatchObject({index:31,status:'unverified'});
  expect(f.created).toBe(31);expect(f.transactions).toBe(31);expect(f.items).toHaveLength(32);expect(f.batchAcquisitions).toHaveLength(32);
  expect(f.transactionActionCounts).toEqual(Array(31).fill(1));
});
it('distinguishes step32 addAction failure from action creation and reports only the31 completed additions',async()=>{
  const {f,result}=await timedGraphicRun('add-32');
  expect(result.status).toBe('unverified');expect(result.hostResult.completedClones).toBe(31);expect(result.hostResult.originalsPreserved).toBe(true);
  expect(result.hostResult.transaction).toMatchObject({plannedActions:1,actionCreationOrdinal:1,createdActions:1,addActionOrdinal:1,addedActions:0,factoryCompleted:true,callbackCompleted:false,executeReturned:false,failurePhase:'add_action_enter',failureOrdinal:1});
  expect(result.hostResult).toMatchObject({attemptedTransactions:32,verifiedTransactions:31});expect(result.hostResult.transactions[31]).toMatchObject({index:31,status:'unverified'});
  expect(f.created).toBe(32);expect(f.items).toHaveLength(32);expect(f.batchAcquisitions).toHaveLength(32);expect(f.transactionActionCounts).toEqual(Array(31).fill(1));
});
it('distinguishes native apply failure after a complete callback without guessing its internal failing ordinal',async()=>{
  const {f,result}=await timedGraphicRun('apply-32');
  expect(result.status).toBe('unverified');expect(result.hostResult.completedClones).toBe(32);
  expect(result.hostResult.transaction).toMatchObject({plannedActions:1,createdActions:1,addActionOrdinal:1,addedActions:1,factoryCompleted:true,callbackCompleted:true,executeReturned:false,failurePhase:'callback_exit',failureOrdinal:null});
  expect(result.hostResult).toMatchObject({attemptedTransactions:32,verifiedTransactions:31});expect(result.hostResult.transactions[31]).toMatchObject({index:31,status:'unverified'});
  expect(f.transactions).toBe(32);expect(f.transactionActionCounts).toEqual(Array(32).fill(1));expect(f.batchAcquisitions).toHaveLength(32);
});
it('isolates exceptions from both optional observers without changing native order or proof',async()=>{
  const f=fixture('observer-throws'),result=await f.run();
  expect(result.status).toBe('pass');expect(result.hostResult.completedClones).toBe(2);expect(f.transactions).toBe(2);expect(f.transactionActionCounts).toEqual([1,1]);
  expect(result.hostResult.transaction).toMatchObject({createdActions:1,addedActions:1,callbackCompleted:true,executeReturned:true,failurePhase:null});
  expect(f.events.filter(event=>['action','dispatch'].includes(event.type)).map(event=>event.type)).toEqual(['action','dispatch','action','dispatch']);
});
it('settles each audio transaction before readback and reacquisition, with no metadata calls during either quiet boundary',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  const f=fixture('',24,'audio'),started=Date.now();let pending:Promise<any>|undefined;
  try{
    pending=f.run();void pending!.catch(()=>{});
    await vi.advanceTimersByTimeAsync(0);
    expect(f.transactions).toBe(1);expect(f.transactionActionCounts).toEqual([1]);expect(f.events.filter(e=>e.type==='snapshot')).toHaveLength(1);
    const firstBoundary=f.events.length;
    await vi.advanceTimersByTimeAsync(249);
    expect(f.events).toHaveLength(firstBoundary);expect(f.transactions).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.transactions).toBe(2);expect(f.transactionActionCounts).toEqual([1,1]);
    const secondBoundary=f.events.length;
    await vi.advanceTimersByTimeAsync(249);expect(f.events).toHaveLength(secondBoundary);
    await vi.advanceTimersByTimeAsync(1);
    const result=await pending;
    expect(result.status).toBe('pass');expect(result.hostResult.completedClones).toBe(2);
    expect(f.transactions).toBe(2);expect(f.events.filter(e=>e.type==='snapshot').map(e=>e.at-started)).toEqual([0,250,500]);
    expect(f.events.filter(e=>e.type==='action').map(e=>[e.at-started,e.epoch])).toEqual([[0,0],[250,1]]);
    expect(f.items.map(i=>[i.track,i.start])).toEqual([[4,0],[2,2],[2,3]]);
  }finally{
    await vi.runAllTimersAsync();await pending?.catch(()=>{});f.noteMutation(Number.NEGATIVE_INFINITY);vi.useRealTimers();
  }
});
it('uses the real host adapter to reacquire each original source only after a one-action commit, quiet and prefix readback',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  const f=fixture('same-track',24,'audio'),ids=['audio:4:0:source','audio:4:508032000000:source'];let pending:Promise<any>|undefined;
  try{
    pending=f.runClones([
      {trackItemId:ids[0],timeOffsetSeconds:4,audioTrackOffset:-2,mode:'overwrite'},
      {trackItemId:ids[1],timeOffsetSeconds:4,audioTrackOffset:0,mode:'overwrite'},
      {trackItemId:ids[0],timeOffsetSeconds:5,audioTrackOffset:0,mode:'overwrite'},
    ]);void pending.catch(()=>{});
    await vi.advanceTimersByTimeAsync(0);expect(f.transactionActionCounts).toEqual([1]);
    const boundary=f.events.length;
    await vi.advanceTimersByTimeAsync(249);expect(f.events).toHaveLength(boundary);expect(f.batchAcquisitions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);expect(f.transactionActionCounts).toEqual([1,1]);expect(f.batchAcquisitions).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    const result=await pending;expect(result.status).toBe('pass');expect(result.hostResult).toMatchObject({batchMode:'fresh_source_transactions',completedClones:3,originalsPreserved:true});
    expect(f.transactionActionCounts).toEqual([1,1,1]);
    expect(f.batchAcquisitions).toEqual([{ids:[ids[0]],collections:1},{ids:[ids[1]],collections:1},{ids:[ids[0]],collections:1}]);
    expect(f.events.filter(event=>event.type==='action').map(event=>event.epoch)).toEqual([0,1,2]);
    expect(f.events.filter(event=>event.type==='snapshot')).toHaveLength(4);
  }finally{await vi.runAllTimersAsync();await pending?.catch(()=>{});f.noteMutation(Number.NEGATIVE_INFINITY);vi.useRealTimers();}
});
it.each(['audio','video'] as const)('waits before audio clone preflight after a recent mutation, preserving ordinary video behavior (%s)',async kind=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T00:00:00Z'));
  const f=fixture('',24,kind),started=Date.now();let pending:Promise<any>|undefined;
  try{
    f.noteMutation();pending=f.run([2]);void pending!.catch(()=>{});
    if(kind==='audio'){
      await vi.advanceTimersByTimeAsync(249);
      expect(f.events).toEqual([]);expect(f.created).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.events[0]).toMatchObject({type:'context',at:started+250});
      expect(f.transactions).toBe(1);expect(f.events.filter(e=>e.type==='snapshot')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(250);
      expect(f.events.filter(e=>e.type==='snapshot').map(e=>e.at-started)).toEqual([250,500]);
    }else{
      await vi.advanceTimersByTimeAsync(0);
      expect(f.events[0]).toMatchObject({type:'context',at:started});expect(vi.getTimerCount()).toBe(0);
    }
    expect((await pending).status).toBe('pass');expect(f.created).toBe(1);expect(f.transactions).toBe(1);
  }finally{
    await vi.runAllTimersAsync();await pending?.catch(()=>{});f.noteMutation(Number.NEGATIVE_INFINITY);vi.useRealTimers();
  }
});
it('stops after the first clone when its source range is wrong, without replay',async()=>{
  const f=fixture('range'),result=await f.run();expect(result.status).toBe('fail');expect(result.hostResult.completedClones).toBe(0);expect(f.created).toBe(1);expect(f.transactionActionCounts).toEqual([1]);
});
it('stops on original preservation failure when an action changes its source, reporting only observed clones',async()=>{
  const f=fixture('source-change'),result=await f.run();expect(result.status).toBe('fail');expect(result.hostResult.originalsPreserved).toBe(false);expect(result.hostResult.completedClones).toBe(1);expect(f.created).toBe(1);expect(f.transactionActionCounts).toEqual([1]);
});
it('distinguishes adjacent single-frame clones instead of treating them as duplicate matches',async()=>{
  const f=fixture(),result=await f.run([2,2+1/24,2+2/24]);
  expect(result.status).toBe('pass');expect(result.hostResult.completedClones).toBe(3);
});
it('does not use the preceding one-frame clone as proof of an accepted no-op',async()=>{
  const f=fixture('no-op-second'),result=await f.run([2,2+1/24]);
  expect(result.status).toBe('fail');expect(result.hostResult.completedClones).toBe(1);expect(f.transactions).toBe(2);expect(f.transactionActionCounts).toEqual([1,1]);
});
it('detects an earlier clone erased by the next transaction and does not dispatch the third plan',async()=>{
  const f=fixture('erase-earlier'),result=await f.run([2,3,4]);
  expect(result.status).toBe('fail');expect(result.errors).toContain('Clone 1 did not read back uniquely with its original duration/source range');
  expect(result.hostResult.completedClones).toBe(1);expect(f.transactions).toBe(2);expect(f.transactionActionCounts).toEqual([1,1]);
});
it('keeps distinct-source fallback sequential with fresh native epochs and per-action readback',async()=>{
  const f=fixture('later-source'),result=await f.runClones([
    {trackItemId:'video:4:0:',timeOffsetSeconds:4,videoTrackOffset:-2,mode:'overwrite'},
    {trackItemId:'video:2:508032000000:',timeOffsetSeconds:4,videoTrackOffset:-2,mode:'overwrite'},
  ]);
  expect(result.status).toBe('pass');expect(result.hostResult.completedClones).toBe(2);expect(f.transactionActionCounts).toEqual([1,1]);
  expect(f.events.filter(e=>e.type==='action').map(e=>e.epoch)).toEqual([0,1]);expect(f.events.filter(e=>e.type==='snapshot')).toHaveLength(3);
});
it.each(['same-track','same-track-partial'])('routes multiple exact same-track sources through fresh single-action public-handler transactions (%s)',async fault=>{
  const f=fixture(fault),ids=['video:4:0:','video:4:508032000000:'];
  const result=await f.runClones(ids.map(trackItemId=>({trackItemId,timeOffsetSeconds:4,videoTrackOffset:-2,mode:'overwrite'})));
  const completed=fault==='same-track'?2:1;
  expect(f.batchAcquisitions).toEqual(ids.slice(0,completed).map(id=>({ids:[id],collections:1})));expect(f.transactionActionCounts).toEqual(Array(completed).fill(1));
  expect(f.events.filter(event=>event.type==='action').map(event=>event.epoch)).toEqual(Array.from({length:completed},(_,index)=>index));
  expect(f.events.filter(event=>event.type==='snapshot')).toHaveLength(completed+1);
  expect(result.status).toBe(fault==='same-track'?'pass':'unverified');
  expect(result.hostResult.completedClones).toBe(completed);expect(f.transactions).toBe(completed);
});
it('preflights every destination and refuses overlapping requested clones before dispatch',async()=>{
  const f=fixture();await expect(f.run([2,2])).rejects.toThrow('destinations overlap');expect(f.created).toBe(0);
  await expect(f.runClones([
    {trackItemId:'video:4:0:',timeOffsetSeconds:2,videoTrackOffset:-2},
    {trackItemId:'video:4:0:',timeOffsetSeconds:3,videoTrackOffset:1},
  ])).rejects.toThrow('does not exist');expect(f.created).toBe(0);
});
it('rejects an irrelevant-media offset that would clone over the unchanged source',async()=>{
  const f=fixture();await expect(f.runClones([{trackItemId:'video:4:0:',timeOffsetSeconds:0,videoTrackOffset:0,audioTrackOffset:1}])).rejects.toThrow("media type's destination track");expect(f.created).toBe(0);
});
it('keeps single insert semantics and refuses undefined ripple semantics across a batch',async()=>{
  const f=fixture(),clone={trackItemId:'video:4:0:',timeOffsetSeconds:2,videoTrackOffset:-2,mode:'insert'};
  await expect(f.runClones([clone,{...clone,timeOffsetSeconds:3,mode:'overwrite'}])).rejects.toThrow('one clone per command');expect(f.created).toBe(0);
  const result=await f.runClones([clone]);expect(result.status).toBe('pass');expect(f.lastInsert).toBe(true);expect(f.created).toBe(1);
});
it('refuses non-frame-aligned offsets before dispatch and accepts exact native NTSC frames',async()=>{
  const rate=24000/1001,f=fixture('',rate);
  await expect(f.run([1])).rejects.toThrow('nearest frame');expect(f.created).toBe(0);
  const result=await f.run([24/rate,25/rate]);expect(result.status).toBe('pass');expect(result.hostResult.completedClones).toBe(2);
});
it('does not start from an incomplete timeline or overwrite a later batch source',async()=>{
  const incomplete=fixture('truncated');await expect(incomplete.run()).rejects.toThrow('complete timeline snapshot');expect(incomplete.created).toBe(0);
  const f=fixture('later-source');await expect(f.runClones([
    {trackItemId:'video:4:0:',timeOffsetSeconds:2,videoTrackOffset:-2},
    {trackItemId:'video:2:508032000000:',timeOffsetSeconds:3,videoTrackOffset:-2},
  ])).rejects.toThrow('overwrite a later source');expect(f.created).toBe(0);
});
