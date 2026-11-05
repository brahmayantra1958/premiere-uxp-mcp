import {describe,it,expect,vi} from 'vitest';
import {exactTicksFromSeconds} from '../../apps/uxp-plugin/src/tick-conversion.js';
import {uxpModules} from '../helpers/uxp-modules.js';

describe('exact source boundary ticks',()=>{
  it('keeps a decimal boundary on frame 30 instead of frame 29',()=>{
    const frame=8475667200n;
    expect(BigInt(Math.trunc(1.001*254016000000))/frame).toBe(29n);
    expect(BigInt(exactTicksFromSeconds(1.001))/frame).toBe(30n);
  });
  it.each([[0,'0'],[13.9139,'3534353222400'],[20.02,'5085400320000'],[1e-7,'25402'],[86400,'21946982400000000']])('rounds %s seconds without unsafe integer loss', (seconds,ticks)=>{
    expect(exactTicksFromSeconds(Number(seconds))).toBe(ticks);
  });
  it.each([-1,NaN,Infinity,-Infinity])('rejects invalid seconds %s',value=>expect(()=>exactTicksFromSeconds(value)).toThrow('INVALID_TIME'));
  it('uses and verifies the native string-tick factory',()=>{
    const createWithSeconds=vi.fn(()=>{throw Error('float factory must not run');});
    const createWithTicks=vi.fn((ticks:string)=>({ticks,seconds:Number(ticks)/254016000000}));
    const context=uxpModules({TickTime:{createWithTicks,createWithSeconds}})('apps/uxp-plugin/src/host-context.ts');
    expect(context.exactTickFromSeconds(1.001).ticks).toBe('254270016000');
    expect(createWithTicks).toHaveBeenCalledExactlyOnceWith('254270016000');expect(createWithSeconds).not.toHaveBeenCalled();
    createWithTicks.mockImplementationOnce(()=>({ticks:'254270015999',seconds:1.001}));
    expect(()=>context.exactTickFromSeconds(1.001)).toThrow('exact source-boundary ticks');
  });
});
