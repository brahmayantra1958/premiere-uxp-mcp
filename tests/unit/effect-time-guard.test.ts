import {describe,it,expect} from 'vitest';
import {effectTime,nativeToSequenceTime} from '../../apps/uxp-plugin/src/effect-time.js';
const clip={mediaType:'video',start:{ticks:'100'},end:{ticks:'200'},inPoint:{ticks:'10'},outPoint:{ticks:'110'},speed:1,reversed:false};
const proof={status:'pass',exactOnly:true,startTicks:'100',endTicks:'200',inTicks:'10',outTicks:'110',speed:1,reversed:false,originTicks:'10',samples:[{sequenceTicks:'100',nativeTicks:'10',rate:1},{sequenceTicks:'150',nativeTicks:'35',rate:.5}]} as const;
describe('exact SDK clocks are mandatory even when a ramp reports speed 1',()=>{
 it('uses the measured nonlinear tick, never the linear speed field',()=>{expect(effectTime(clip,{timeTicks:'150'},structuredClone(proof) as any).nativeTicks).toBe('35');});
 it.each(['missing','stale','duplicate','outside','origin','nonfinite','approximate','absent_tick'] as const)('rejects %s evidence before a key can be placed',fault=>{
  const p:any=structuredClone(proof);if(fault==='stale')p.outTicks='111';if(fault==='duplicate')p.samples.push(p.samples[1]);if(fault==='outside')p.samples[1].sequenceTicks='200';if(fault==='origin')p.originTicks='11';if(fault==='nonfinite')p.samples[1].rate=NaN;if(fault==='approximate')p.exactOnly=false;
  expect(()=>effectTime(clip,{timeTicks:fault==='absent_tick'?'149':'150'},fault==='missing'?undefined:p)).toThrow('EFFECT_TIME_MAPPING_UNSUPPORTED');
 });
 it('never chooses an inverse branch for repeated source frames or a hold',()=>{
  const p:any=structuredClone(proof);p.samples.push({sequenceTicks:'160',nativeTicks:'35',rate:-.5});expect(nativeToSequenceTime(clip,'35',p)).toBeNull();
  p.samples.pop();p.samples[1].rate=0;expect(nativeToSequenceTime(clip,'35',p)).toBeNull();expect(nativeToSequenceTime(clip,'36',proof as any)).toBeNull();
 });
 it('keeps unretimed audio mapping available',()=>{expect(effectTime({...clip,mediaType:'audio'},{timeTicks:'150'}).nativeTicks).toBe('60');});
});
