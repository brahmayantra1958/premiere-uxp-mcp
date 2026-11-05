import {describe,it,expect} from 'vitest';
import {sampleExactEffectTimes,inverseTimeCandidate} from '../../apps/mcp-server/src/effect-time-sampling.js';
import {effectTime,nativeToSequenceTime} from '../../apps/uxp-plugin/src/effect-time.js';
const bounds={startTicks:'0',endTicks:'1000000',speed:1,reversed:false,requested:['250000','750000'],keys:['62500']};
describe('exact non-linear host time mapping',()=>{
 it('uses an interior rate when the nearest clip-end witness has a zero derivative',async()=>{
  const r=await sampleExactEffectTimes({...bounds,requested:['0'],keys:['1800000']},async sequenceTicks=>({sequenceTicks,nativeTicks:String(BigInt(sequenceTicks)*2n),rate:sequenceTicks==='999999'?0:2,evidence:{}}));
  expect(r.inverses[0]).toMatchObject({status:'pass',sequenceTicks:['900000']});
 });
 it('uses one actual callback for a keyless clip-start sample and rejects a single observed hold inverse',async()=>{
  let calls=0;const result=await sampleExactEffectTimes({...bounds,requested:['0'],keys:[]},async sequenceTicks=>{calls++;return {sequenceTicks,nativeTicks:'100',rate:0,evidence:{}};});
  expect(calls).toBe(1);
  const clip={start:{ticks:'0'},end:{ticks:'1000000'},inPoint:{ticks:'0'},outPoint:{ticks:'1000000'},speed:1,reversed:false};
  const proof={status:'pass' as const,...bounds,inTicks:'0',outTicks:'1000000',...result};
  expect(effectTime(clip,{timeTicks:'0'},proof).nativeTicks).toBe('100');expect(nativeToSequenceTime(clip,'100',proof)).toBeNull();
 });
 it('samples a quadratic ramp even when public speed is 1 and proves an inverse by exact host equality',async()=>{
  const calls:string[]=[];
  const result=await sampleExactEffectTimes(bounds,async sequenceTicks=>{calls.push(sequenceTicks);const x=BigInt(sequenceTicks);return {sequenceTicks,nativeTicks:String(x*x/1000000n),rate:Number(x)*2/1000000,evidence:{}};});
  expect(result.samples.find(s=>s.sequenceTicks==='750000')?.nativeTicks).toBe('562500');
  expect(result.inverses[0]).toMatchObject({status:'pass',nativeTicks:'62500',sequenceTicks:['250000']});
  expect(new Set(calls).size).toBe(calls.length);
 });
 it('finds a key not already in the requested samples without using an approximated edit time',async()=>{
  const result=await sampleExactEffectTimes({...bounds,keys:['160000']},async sequenceTicks=>{const x=BigInt(sequenceTicks);return {sequenceTicks,nativeTicks:String(x*x/1000000n),rate:Number(x)*2/1000000,evidence:{}};});
  expect(result.inverses[0]?.status).toBe('pass');
  for(const at of result.inverses[0]!.sequenceTicks)expect(BigInt(at)*BigInt(at)/1000000n).toBe(160000n);
 });
 it('preserves hold aliases, rejects missing sample times and refuses to select an arbitrary inverse occurrence',async()=>{
  const result=await sampleExactEffectTimes({...bounds,keys:['100']},async sequenceTicks=>({sequenceTicks,nativeTicks:'100',rate:0,evidence:{}}));
  expect(result.inverses[0]).toMatchObject({status:'pass',reason:'multiple_sequence_positions'});
  const clip={start:{ticks:'0'},end:{ticks:'1000000'},inPoint:{ticks:'0'},outPoint:{ticks:'1000000'},speed:1,reversed:false};
  const proof={status:'pass' as const,...bounds,inTicks:'0',outTicks:'1000000',...result};
  expect(effectTime(clip,{timeTicks:'250000'},proof).nativeTicks).toBe('100');
  expect(()=>effectTime(clip,{timeTicks:'250001'},proof)).toThrow('exact requested tick');
  expect(nativeToSequenceTime(clip,'100',proof)).toBeNull();
  expect(nativeToSequenceTime(clip,'101',proof)).toBeNull();
  expect(inverseTimeCandidate(101n,result.samples[0]!,0n,1000000n)).toBeNull();
 });
 it('reports unreachable keys as unverified and never claims a nearby tick',async()=>{
  const result=await sampleExactEffectTimes({...bounds,keys:['3']},async sequenceTicks=>({sequenceTicks,nativeTicks:String(BigInt(sequenceTicks)*2n),rate:2,evidence:{}}));
  expect(result.inverses[0]).toMatchObject({status:'unverified',sequenceTicks:[]});
 });
});
