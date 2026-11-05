import {describe,it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

describe('exact sequence project item',()=>{
  function fixture(){
    const sequence:any={guid:'clone-id'};
    const item={name:'same display name',createSetNameAction:vi.fn(),isSequence:async()=>true,getSequence:async()=>sequence};
    sequence.getProjectItem=vi.fn(async()=>item);
    const resolve=uxpModules({ClipProjectItem:{cast:(raw:any)=>raw}})('apps/uxp-plugin/src/sequence-project-item.ts').sequenceProjectItem;
    return {sequence,item,resolve};
  }
  it('uses the direct association even when the clone lies beyond a bounded inventory',async()=>{
    const f=fixture(),inventory=Array.from({length:501},(_,i)=>({id:String(i),name:f.item.name}));
    inventory.push(f.item as any);
    expect(inventory.slice(0,500)).not.toContain(f.item);
    expect(await f.resolve(f.sequence)).toBe(f.item);
    expect(f.sequence.getProjectItem).toHaveBeenCalledOnce();
    expect(f.item.createSetNameAction).not.toHaveBeenCalled();
  });
  it('rejects a stale association instead of renaming a same-named sequence',async()=>{
    const f=fixture();f.item.getSequence=async()=>({guid:'different-id',name:f.item.name});
    await expect(f.resolve(f.sequence)).rejects.toThrow('exact sequence');
    expect(f.item.createSetNameAction).not.toHaveBeenCalled();
  });
  it('rejects missing public APIs before creating any name action',async()=>{
    const f=fixture();delete f.sequence.getProjectItem;
    await expect(f.resolve(f.sequence)).rejects.toThrow('Sequence.getProjectItem');
    expect(f.item.createSetNameAction).not.toHaveBeenCalled();
  });
});
