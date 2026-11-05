import { describe, expect, it, vi } from 'vitest';
import { canBatchOneTrackClones, tryCloneOneTrackBatch, type CloneBatchPlan, type CloneTrackBatchHost } from '../../apps/uxp-plugin/src/host-clone-batch.js';

const time=(seconds:number)=>({seconds,ticks:String(Math.round(seconds*254016000000))});
function fixture(fault='') {
  const make=(name:string,start:number)=>({id:`audio:0:${time(start).ticks}:${name}`,name,mediaType:'audio',projectItemId:name,trackIndex:0,start:time(start),end:time(start+1),
    inPoint:time(0),outPoint:time(1),disabled:false,speed:1,reversed:false,adjustmentLayer:false});
  const originals=[make('original-a',0),make('original-b',10)],data=structuredClone(originals);
  const events:string[]=[],actionCounts:number[]=[],acquiredIds:string[][]=[];
  let epoch=0,commits=0,reads=0,quietNeeded=false,lastReadEpoch=0,locked=false;
  const snapshot=()=>({id:'s',name:'Sequence',width:1920,height:1080,frameRate:24,duration:time(Math.max(...data.map(item=>item.end.seconds))),videoTracks:0,audioTracks:2,captionTracks:0,
    captionTrackStates:[],transitions:[],itemsTruncated:false,items:structuredClone(data),tracks:[0,1].map(index=>({mediaType:'audio',index,id:index+1,name:`A${index+1}`,muted:false,itemCount:data.filter(item=>item.trackIndex===index).length,transitionCount:0}))});
  const before=snapshot();
  // Even the first off-source destination must use the protected path because
  // a later destination in this SAME command grows the original source track.
  const plans:CloneBatchPlan[]=[
    {source:before.items[0]!,destinationTrack:1,timeOffset:2},
    {source:before.items[0]!,destinationTrack:0,timeOffset:3},
    {source:before.items[1]!,destinationTrack:0,timeOffset:4},
    {source:before.items[0]!,destinationTrack:1,timeOffset:4},
  ].map(plan=>({...plan,clone:{trackItemId:plan.source.id,mode:'overwrite'},videoOffset:0,audioOffset:plan.destinationTrack-plan.source.trackIndex}));
  const host:CloneTrackBatchHost={
    acquireSources:vi.fn(async ids=>{
      expect(quietNeeded).toBe(false);expect(lastReadEpoch).toBe(epoch);
      acquiredIds.push([...ids]);events.push(`acquire:${epoch}`);
      if(fault==='source-before-second'&&commits===1)data[0]!.outPoint=time(2);
      const generation=epoch,bindings=new Map(ids.map(id=>[id,data.find(item=>item.id===id)!]));
      return {snapshots:ids.map(id=>structuredClone(bindings.get(id)!)),
        createAction(plan){
          expect(locked).toBe(true);expect(generation).toBe(epoch);events.push(`action:${epoch}`);
          const raw=bindings.get(plan.source.id)!;
          return ()=>{
            // A source collection rebuilt by the previous action invalidates
            // all handles from that acquisition, including repeated sources.
            if(generation!==epoch)throw Error('source collection was replaced');
            const clone={...structuredClone(raw),trackIndex:plan.destinationTrack,start:time(raw.start.seconds+plan.timeOffset),end:time(raw.end.seconds+plan.timeOffset)};
            clone.id=`audio:${clone.trackIndex}:${clone.start.ticks}:${clone.projectItemId}`;
            if(fault!=='no-op')data.push(clone);
            if(fault==='original-drift')data[0]!.disabled=true;
            if(fault==='earlier-clone-drift'&&commits===1)data[2]!.outPoint=time(3);
            epoch++;quietNeeded=true;
          };
        },
        executeTransaction(_label,factory,observe){
          expect(locked).toBe(false);locked=true;events.push(`transaction:${epoch}`);
          observe?.({phase:'locked_enter'});observe?.({phase:'execute_enter'});observe?.({phase:'callback_enter'});
          try{
            const actions=factory();actionCounts.push(actions.length);
            actions.forEach((_action,index)=>{observe?.({phase:'add_action_enter',ordinal:index+1});observe?.({phase:'add_action_exit',ordinal:index+1});});
            observe?.({phase:'callback_exit'});
            for(const action of actions)(action as()=>void)();
            commits++;events.push(`commit:${epoch}`);
            if(fault==='throw-after-apply')throw Error('native completion unknown');
            observe?.({phase:'execute_exit',count:actions.length});observe?.({phase:'locked_exit'});
            return fault!=='false-after-apply';
          }catch(error){observe?.({phase:'execute_throw'});observe?.({phase:'locked_throw'});throw error;}
          finally{locked=false;}
        },
      };
    }),
    waitForQuiet:vi.fn(async()=>{expect(locked).toBe(false);events.push(`quiet:${epoch}`);quietNeeded=false;}),
    targetSequenceSnapshot:vi.fn(async()=>{
      expect(quietNeeded).toBe(false);events.push(`read:${epoch}`);reads++;lastReadEpoch=epoch;
      if(fault==='read-throw')throw Error('native readback unavailable');
      const result=snapshot();
      if(fault==='track-drift')result.tracks[1]!.name='changed';
      if(fault==='truncated')result.itemsTruncated=true;
      if(fault==='settings-drift')result.width=1080;
      return result;
    }),
  };
  return {before,plans,host,data,events,actionCounts,acquiredIds,snapshot,stats:()=>({epoch,commits,reads})};
}

describe('fresh transactions when any clone writes into its source track',()=>{
  it('reacquires exact originals after every invalidating commit and proves the full prefix before continuing',async()=>{
    const f=fixture();expect(canBatchOneTrackClones(f.before,f.plans)).toBe(true);
    const result=await tryCloneOneTrackBatch(f.before,f.plans,f.host);
    expect(result?.status).toBe('pass');expect(result?.hostResult).toMatchObject({batchMode:'fresh_source_transactions',completedClones:4,originalsPreserved:true,attemptedTransactions:4,verifiedTransactions:4});
    expect(f.actionCounts).toEqual([1,1,1,1]);expect(f.acquiredIds).toEqual(f.plans.map(plan=>[plan.source.id]));
    expect(f.host.waitForQuiet).toHaveBeenCalledTimes(4);expect(f.host.targetSequenceSnapshot).toHaveBeenCalledTimes(4);
    expect(f.events).toEqual(Array.from({length:4},(_,index)=>[`acquire:${index}`,`transaction:${index}`,`action:${index}`,`commit:${index+1}`,`quiet:${index+1}`,`read:${index+1}`]).flat());
    expect(result?.hostResult.steps.map((step:any)=>[step.index,step.verified,step.hostResult])).toEqual([[0,true,true],[1,true,true],[2,true,true],[3,true,true]]);
    expect(result?.after?.items.slice(0,2)).toEqual(f.before.items);
  });

  it('rejects source changes between verified prefix and next acquisition without a second transaction',async()=>{
    const f=fixture('source-before-second'),result=await tryCloneOneTrackBatch(f.before,f.plans,f.host);
    expect(result?.status).toBe('unverified');expect(result?.after).toBeUndefined();
    expect(result?.hostResult).toMatchObject({batchMode:'fresh_source_transactions',attemptedTransactions:1,verifiedTransactions:1,lastVerifiedPrefixClones:1,failedStepIndex:1,failurePhase:'source_reacquisition'});
    expect(f.actionCounts).toEqual([1]);expect(f.acquiredIds).toHaveLength(2);expect(f.stats().reads).toBe(1);
    expect(result?.errors?.join(' ')).toContain('clone sources changed');
  });

  it.each(['original-drift','track-drift','settings-drift','truncated','no-op'])('halts after the first %s proof failure without acquiring the next source',async fault=>{
    const f=fixture(fault),result=await tryCloneOneTrackBatch(f.before,f.plans,f.host);
    expect(result?.status).toBe('fail');expect(result?.hostResult.batchMode).toBe('fresh_source_transactions');
    expect(f.actionCounts).toEqual([1]);expect(f.acquiredIds).toHaveLength(1);expect(f.stats().reads).toBe(1);
  });

  it('detects a prior clone changed by the next commit using the whole original+prefix proof',async()=>{
    const f=fixture('earlier-clone-drift'),result=await tryCloneOneTrackBatch(f.before,f.plans,f.host);
    expect(result?.status).toBe('fail');expect(f.actionCounts).toEqual([1,1]);expect(f.acquiredIds).toHaveLength(2);
    expect(result?.hostResult.steps.map((step:any)=>step.verified)).toEqual([false,true]);
    expect(result?.errors).toContain('Clone 1 did not read back uniquely with its original duration/source range');
  });

  it.each([['false-after-apply','fail'],['throw-after-apply','unverified']] as const)('never continues or replays after %s, even when the current clone reads back',async(fault,status)=>{
    const f=fixture(fault),result=await tryCloneOneTrackBatch(f.before,f.plans,f.host);
    expect(result?.status).toBe(status);expect(result?.hostResult).toMatchObject({accepted:false,completedClones:1,attemptedTransactions:1,verifiedTransactions:0});
    expect(f.actionCounts).toEqual([1]);expect(f.acquiredIds).toHaveLength(1);expect(f.stats().reads).toBe(1);
  });

  it('stops with unknown readback and does not expose a stale snapshot as current after',async()=>{
    const f=fixture('read-throw'),result=await tryCloneOneTrackBatch(f.before,f.plans,f.host);
    expect(result?.status).toBe('unverified');expect(result?.after).toBeUndefined();
    expect(result?.hostResult).toMatchObject({attemptedTransactions:1,verifiedTransactions:0,lastVerifiedPrefixClones:0});
    expect(result?.hostResult.completedClones).toBeUndefined();expect(f.actionCounts).toEqual([1]);expect(f.acquiredIds).toHaveLength(1);
  });

  it('retains the pending read lane with no next acquisition, timeout or parallel mutation',async()=>{
    vi.useFakeTimers();
    const f=fixture(),read=f.host.targetSequenceSnapshot;let release!:(value:any)=>void,complete=false;
    const blocked=new Promise<any>(resolve=>{release=resolve;});let first=true;
    const host={...f.host,targetSequenceSnapshot:vi.fn(()=>{if(first){first=false;return blocked;}return read();})};
    try{
      const pending=tryCloneOneTrackBatch(f.before,f.plans,host).then(value=>{complete=true;return value;});
      await vi.advanceTimersByTimeAsync(100_000);expect(complete).toBe(false);expect(f.actionCounts).toEqual([1]);expect(f.acquiredIds).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
      release(await read());expect((await pending)?.status).toBe('pass');expect(f.actionCounts).toEqual([1,1,1,1]);
    }finally{vi.useRealTimers();}
  });
});
