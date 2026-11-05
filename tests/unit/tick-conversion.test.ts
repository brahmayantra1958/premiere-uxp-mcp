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
import {frameTicksFromRate,snapTicksToFrameGrid} from '../../apps/uxp-plugin/src/tick-conversion.js';
describe('source frame grid',()=>{
  it.each([[30,'8467200000'],[25,'10160640000'],[24,'10584000000'],[60,'4233600000'],[30000/1001,'8475667200'],[29.97,'8475667200'],[24000/1001,'10594584000'],[23.976,'10594584000'],[60000/1001,'4237833600']])('maps %s fps to exact frame ticks',(fps,ticks)=>{
    expect(frameTicksFromRate(fps)).toBe(ticks);
  });
  it.each([0,-1,NaN,Infinity,12.3456,undefined,'30'])('returns no grid for %s',value=>expect(frameTicksFromRate(value)).toBeUndefined());
  it('snaps float noise to the nearest frame and refuses between-frame times',()=>{
    const frame='8467200000';
    expect(snapTicksToFrameGrid(exactTicksFromSeconds(5.333333),frame)).toEqual({ticks:String(160n*8467200000n),frame:'160',snapped:true});
    expect(snapTicksToFrameGrid(String(159n*8467200000n),frame)).toEqual({ticks:String(159n*8467200000n),frame:'159',snapped:false});
    expect(snapTicksToFrameGrid(exactTicksFromSeconds(5.35),frame)).toBeNull();
  });
});
