import {it,expect} from 'vitest';
import {planRippleGaps,type RippleItem} from '../../apps/uxp-plugin/src/ripple-plan.js';
const frame=8475667200n,t=(n:number)=>String(frame*BigInt(n));
const gaps=[{atTicks:t(3888),frames:2},{atTicks:t(4398),frames:1},{atTicks:t(4548),frames:2}];
it('partitions crossing AV and shifts all later tracks by exactly 2+1+2 frames',()=>{
  const item=(id:string,mediaType:RippleItem['mediaType'],start:number,end:number):RippleItem=>({id,mediaType,trackIndex:2,startTicks:t(start),endTicks:t(end)});
  const result=planRippleGaps(String(frame),gaps,[item('a3','audio',59,4548),item('a3-existing-right','audio',4548,6784),item('v','video',4600,4610),item('caption','caption',4380,4400),item('ending-caption','caption',3880,3888)]);
  expect(result.totalAddedFrames).toBe(5);expect(result.totalAddedTicks).toBe('42378336000');
  expect(result.boundariesDescending.map(c=>c.atTicks)).toEqual([t(4548),t(4398),t(3888)]);
  expect(result.changes[0]!.splitAtTicks).toEqual([t(3888),t(4398)]);
  expect(result.changes[0]!.pieces).toEqual([
    {originalStartTicks:t(59),originalEndTicks:t(3888),startTicks:t(59),endTicks:t(3888)},
    {originalStartTicks:t(3888),originalEndTicks:t(4398),startTicks:t(3890),endTicks:t(4400)},
    {originalStartTicks:t(4398),originalEndTicks:t(4548),startTicks:t(4401),endTicks:t(4551)}]);
  expect(result.changes[1]!.pieces[0]).toMatchObject({startTicks:t(4553),endTicks:t(6789)});
  expect(result.changes[2]!.pieces[0]).toMatchObject({startTicks:t(4605),endTicks:t(4615)});
  expect(result.changes[3]).toMatchObject({splitAtTicks:[],pieces:[{startTicks:t(4382),endTicks:t(4403)}]});
  expect(result.changes.map(c=>c.id)).not.toContain('ending-caption');
  const covered=result.changes[0]!.pieces.reduce((n,p)=>n+BigInt(p.originalEndTicks)-BigInt(p.originalStartTicks),0n);
  expect(covered).toBe(frame*4489n);
});
it('rejects subframe, duplicate and negative insertions before any host work',()=>{
  for(const bad of [[{atTicks:'1',frames:1}],[gaps[0]!,gaps[0]!],[{atTicks:t(10),frames:-1}]])expect(()=>planRippleGaps(String(frame),bad,[])).toThrow(/RIPPLE_BOUNDARY/);
});
it('does not create a subframe split from native clock rounding at an existing boundary',()=>{
  const result=planRippleGaps(String(frame),gaps,[{id:'a3',mediaType:'audio',trackIndex:2,startTicks:t(59),endTicks:String(BigInt(t(4548))+1n)}]);
  expect(result.changes[0]!.splitAtTicks).toEqual([t(3888),t(4398)]);
});
