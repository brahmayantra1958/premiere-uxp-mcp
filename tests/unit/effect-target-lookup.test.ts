import { describe, expect, it, vi } from 'vitest';
import { effectTargetLookupHint, withEffectTargetLookup } from '../../apps/uxp-plugin/src/effect-target-lookup.js';
import { uxpModules } from '../helpers/uxp-modules.js';

const target=()=>({expectedProjectId:'project',expectedSequenceId:'sequence',expectedSequenceName:'Sequence',trackItemId:'audio:0:900:source-19',expectedProjectItemId:'source-19',expectedClipName:'Clip 19',expectedMediaType:'audio',expectedTrackIndex:0,expectedStartSeconds:9,expectedEndSeconds:10});

describe('command-local inherited effect lookup hints',()=>{
  it('shares only the numeric search hint with same-target derived values and cleans both scopes',async()=>{
    const parent=target(),derived={...parent,componentIndex:2,parameters:[{paramIndex:0,value:7}]};
    await withEffectTargetLookup(parent,async()=>{
      const hint=effectTargetLookupHint(parent)!;Object.assign(hint,{id:parent.trackItemId,index:19});
      await withEffectTargetLookup(derived,async()=>{
        expect(effectTargetLookupHint(derived)).toBe(hint);
        expect(Object.keys(hint).sort()).toEqual(['id','index']);
        hint.index=2;await Promise.resolve();expect(effectTargetLookupHint(parent)?.index).toBe(2);
      },parent);
      expect(effectTargetLookupHint(derived)).toBeUndefined();expect(effectTargetLookupHint(parent)).toBe(hint);
    });
    expect(effectTargetLookupHint(parent)).toBeUndefined();expect(effectTargetLookupHint(derived)).toBeUndefined();
  });
  it.each(Object.keys(target()))('rejects a changed %s before running the nested operation',async key=>{
    const parent=target(),derived:any={...parent,[key]:'changed'},work=vi.fn(async()=>{});
    await withEffectTargetLookup(parent,async()=>{
      await expect(withEffectTargetLookup(derived,work,parent)).rejects.toMatchObject({code:'EFFECT_TARGET_LOOKUP_SCOPE_MISMATCH'});
      expect(effectTargetLookupHint(derived)).toBeUndefined();
    });
    expect(work).not.toHaveBeenCalled();
  });
  it('restores an existing nested scope after rejection without clearing the parent',async()=>{
    const parent=target(),derived={...parent},failure=Error('read failed');
    await withEffectTargetLookup(parent,async()=>withEffectTargetLookup(derived,async()=>{
      const outer=effectTargetLookupHint(derived),parentHint=effectTargetLookupHint(parent);
      await expect(withEffectTargetLookup(derived,async()=>{
        expect(effectTargetLookupHint(derived)).toBe(parentHint);throw failure;
      },parent)).rejects.toBe(failure);
      expect(effectTargetLookupHint(derived)).toBe(outer);expect(effectTargetLookupHint(parent)).toBe(parentHint);
    }));
    expect(effectTargetLookupHint(parent)).toBeUndefined();expect(effectTargetLookupHint(derived)).toBeUndefined();
  });
  it('keeps the inherited scope owned until a pending read settles',async()=>{
    const parent=target(),derived={...parent};let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const pending=withEffectTargetLookup(parent,async()=>withEffectTargetLookup(derived,()=>held,parent));
    try{
      await Promise.resolve();expect(effectTargetLookupHint(derived)).toBe(effectTargetLookupHint(parent));
      expect(effectTargetLookupHint(derived)).toBeDefined();
    }finally{release();await pending;}
    expect(effectTargetLookupHint(parent)).toBeUndefined();expect(effectTargetLookupHint(derived)).toBeUndefined();
  });
});

function timelineFixture(){
  let epoch=0,pending=0,startReads=0,collections=0;
  const metadata:Record<string,number>={};
  const state={order:Array.from({length:20},(_,i)=>i),speed:1};
  const time=(n:number)=>({ticks:String(n*100),seconds:n});
  const read=async(generation:number,field:string,value:any)=>{
    if(generation!==epoch)throw Error('The script object is no longer valid.');
    expect(pending).toBe(0);pending++;metadata[field]=(metadata[field]??0)+1;
    await Promise.resolve();pending--;return value;
  };
  const sequence={getAudioTrackCount:()=>1,getAudioTrack:()=>({getTrackItems:()=>{
    expect(pending).toBe(0);collections++;const generation=++epoch;
    return state.order.map(i=>({
      getProjectItem:()=>read(generation,'projectItem',{getId:()=>read(generation,'sourceId',`source-${i}`)}),
      getStartTime:()=>{startReads++;return read(generation,'start',time(Math.floor(i/2)));},
      getEndTime:()=>read(generation,'end',time(Math.floor(i/2)+1)),getName:()=>read(generation,'name',`Clip ${i}`),
      getInPoint:()=>read(generation,'in',time(i)),getOutPoint:()=>read(generation,'out',time(i+1)),
      isDisabled:()=>read(generation,'disabled',false),getSpeed:()=>read(generation,'speed',state.speed),
      isSpeedReversed:()=>read(generation,'reversed',false),isAdjustmentLayer:()=>read(generation,'adjustmentLayer',false),
    }));
  }})};
  const host=uxpModules({Constants:{TrackItemType:{CLIP:1}}})('apps/uxp-plugin/src/host-items.ts');
  return {host,sequence,state,metadata,stats:()=>({startReads,collections,pending})};
}

describe('inherited hints with actual track-item acquisition',()=>{
  it('avoids repeated candidate scans while rereading all metadata and returning fresh wrappers',async()=>{
    const f=timelineFixture(),parent=target(),derived={...parent,componentIndex:2};
    await withEffectTargetLookup(parent,async()=>{
      const before=await f.host.findTrackItemEntry(f.sequence,parent.trackItemId,effectTargetLookupHint(parent));
      const baseline=f.stats(),metadataBefore={...f.metadata};
      await withEffectTargetLookup(derived,async()=>{
        for(let i=0;i<5;i++){
          const fresh=await f.host.findTrackItemEntry(f.sequence,derived.trackItemId,effectTargetLookupHint(derived));
          expect(fresh.snapshot).toEqual(before.snapshot);expect(fresh.raw).not.toBe(before.raw);
        }
      },parent);
      expect(f.stats().startReads-baseline.startReads).toBe(5);expect(f.stats().collections-baseline.collections).toBe(5);
      for(const field of ['projectItem','sourceId','start','end','name','in','out','disabled','speed','reversed','adjustmentLayer'])expect(f.metadata[field]!-metadataBefore[field]!).toBe(5);
      const withoutHint=f.stats().startReads;
      for(let i=0;i<5;i++){
        const fresh=await f.host.findTrackItemEntry(f.sequence,derived.trackItemId,effectTargetLookupHint(derived));
        expect(fresh.snapshot).toEqual(before.snapshot);
      }
      // Same collection and target: losing the derived scope scans 20 starts
      // and hydrates two same-time identities per read, instead of one hit.
      expect(f.stats().startReads-withoutHint).toBe(110);
      f.state.speed=2;
      const changed=await withEffectTargetLookup(derived,()=>f.host.findTrackItemEntry(f.sequence,derived.trackItemId,effectTargetLookupHint(derived)),parent);
      expect(changed.snapshot.speed).toBe(2);expect(before.snapshot.speed).toBe(1);
      await expect(before.raw.getSpeed()).rejects.toThrow('no longer valid');
    });
    expect(f.stats().pending).toBe(0);
  });
  it('falls back after wrong-source, reordered-index or wrong-ID hints and never substitutes a missing source',async()=>{
    const f=timelineFixture(),parent=target(),derived={...parent};
    await withEffectTargetLookup(parent,async()=>{
      const hint=effectTargetLookupHint(parent)!;Object.assign(hint,{id:parent.trackItemId,index:18});
      await withEffectTargetLookup(derived,async()=>{
        const acquire=()=>f.host.findTrackItemEntry(f.sequence,derived.trackItemId,effectTargetLookupHint(derived));
        expect((await acquire()).snapshot.id).toBe(parent.trackItemId);expect(hint.index).toBe(19);
        f.state.order.reverse();expect((await acquire()).snapshot.id).toBe(parent.trackItemId);expect(hint.index).toBe(0);
        hint.id='audio:0:900:wrong';hint.index=1;
        expect((await acquire()).snapshot.id).toBe(parent.trackItemId);expect(hint).toEqual({id:parent.trackItemId,index:0});
        f.state.order=f.state.order.filter(i=>i!==19);
        await expect(acquire()).rejects.toThrow('Track item not found');
      },parent);
    });
    expect(f.stats().pending).toBe(0);
  });
});
