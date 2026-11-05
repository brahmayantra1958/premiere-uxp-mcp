import { describe, expect, it, vi } from 'vitest';
import { readEffectProperty, writeEffectProperty } from '../../apps/uxp-plugin/src/effect-property-lifecycle.js';

describe('native effect property owner lifetime', () => {
  it('reacquires after commit and settling instead of reading an invalid owner', async () => {
    let generation=0, value=false;
    const acquire=vi.fn(async()=>{
      const born=generation;
      return {project:{},properties:{getValue:()=>{if(born!==generation)throw Error('invalid owner');return value;}}};
    });
    const commit=vi.fn(()=>{value=true;generation++;return true;});
    const settle=vi.fn(async()=>{generation++;});
    expect(await writeEffectProperty(acquire,'expanded',true,commit,settle)).toEqual({accepted:true,actual:true});
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(await readEffectProperty(acquire,'expanded')).toBe(true);
  });

  it('propagates an ambiguous commit failure without replay or false readback', async () => {
    const acquire=vi.fn(async()=>({project:{},properties:{getValue:()=>true}}));
    const commit=vi.fn(()=>{throw Error('dispatched but failed');});
    const settle=vi.fn(async()=>{});
    await expect(writeEffectProperty(acquire,'expanded',true,commit,settle)).rejects.toThrow('dispatched but failed');
    expect(acquire).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not reacquire or finish while settling is unresolved', async () => {
    let release!:()=>void, finished=false;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    const acquire=vi.fn(async()=>({project:{},properties:{getValue:()=>true}}));
    const result=writeEffectProperty(acquire,'expanded',true,()=>true,()=>pending).then(r=>{finished=true;return r;});
    await Promise.resolve();await Promise.resolve();
    expect(finished).toBe(false);expect(acquire).toHaveBeenCalledTimes(1);
    release();expect(await result).toEqual({accepted:true,actual:true});
    expect(acquire).toHaveBeenCalledTimes(2);
  });
});
