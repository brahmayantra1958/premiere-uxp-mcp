import {describe,expect,it} from 'vitest';
import {planCaptionImportTiming,verifyCaptionImportTiming} from '../../apps/mcp-server/src/caption-import-timing.js';
import {result} from '../../apps/mcp-server/src/tool-values.js';

const ntsc24='10594584000',ntsc30='8475667200';
const cue=(start:string|bigint,end:string|bigint)=>({startTicks:String(start),endTicks:String(end)});
const ms=(value:number)=>String(BigInt(value)*254016000n);
const native=(frameTicks:string,items:ReturnType<typeof cue>[])=>({status:'partial',frameTicks,items:items.map((item,index)=>({index,...item}))});

describe('caption import timing verification',()=>{
  it('detects the observed 23.976 one-frame-early placement, including an exact 1.001-second source boundary',()=>{
    const frame=BigInt(ntsc24),source=[cue(ms(52),ms(94)),cue(ms(1001),ms(5005))];
    const plan=planCaptionImportTiming(source,ntsc24);
    expect(plan.expectedCues).toEqual([cue(frame,2n*frame),cue(24n*frame,120n*frame)]);
    const proof=verifyCaptionImportTiming(plan,native(ntsc24,[cue(0n,frame),cue(23n*frame,119n*frame)]));
    expect(proof).toMatchObject({status:'unverified',summary:{checkedCueCount:2,mismatchedCueCount:2,startFrameDeltaCounts:{'-1':2},endFrameDeltaCounts:{'-1':2}}});
    expect(proof.cues[1]).toMatchObject({sourceStartTicks:ms(1001),expectedStartTicks:String(24n*frame),actualStartTicks:String(23n*frame),startFrameDelta:'-1'});
  });
  it('rounds exact half-frame ties later using integer arithmetic and keeps just-below ties earlier',()=>{
    const frame=BigInt(ntsc24),half=frame/2n;
    expect(planCaptionImportTiming([cue(half,3n*half)],ntsc24).expectedCues).toEqual([cue(frame,2n*frame)]);
    expect(planCaptionImportTiming([cue(half-1n,3n*half-1n)],ntsc24).expectedCues).toEqual([cue(0n,frame)]);
    expect(planCaptionImportTiming([cue('2','7')],'5').expectedCues).toEqual([cue('0','5')]);
    expect(planCaptionImportTiming([cue('3','8')],'5').expectedCues).toEqual([cue('5','10')]);
  });
  it('preserves exact rounding beyond the safe Number integer range',()=>{
    const frame=BigInt(ntsc24),n=9007199254740993n,start=n*frame+frame/2n-1n;
    expect(planCaptionImportTiming([cue(start,start+frame)],ntsc24).expectedCues).toEqual([cue(n*frame,(n+1n)*frame)]);
  });
  it('accepts partial native caption readback with complete timing while leaving text outside the proof',()=>{
    const source=[cue(ms(1001),ms(2002))],plan=planCaptionImportTiming(source,ntsc30);
    const proof=verifyCaptionImportTiming(plan,native(ntsc30,plan.expectedCues));
    expect(proof.status).toBe('pass');expect(proof.summary.matchedCueCount).toBe(1);
    expect(proof).not.toHaveProperty('textVerified');
  });
  it('reports 29.97 fractional-grid differences exactly instead of hiding subframe offsets',()=>{
    const frame=BigInt(ntsc30),plan=planCaptionImportTiming([cue(frame,2n*frame)],ntsc30);
    const proof=verifyCaptionImportTiming(plan,native(ntsc30,[cue(frame-1n,2n*frame+1n)]));
    expect(proof.status).toBe('unverified');expect(proof.summary.offFrameGridEndpoints).toBe(2);
    expect(proof.cues[0]).toMatchObject({startFrameDelta:'-1/8475667200',endFrameDelta:'1/8475667200'});
  });
  it('uses an explicit plan as a verification expectation without changing the SRT timing',()=>{
    const frame=BigInt(ntsc24),source=Object.freeze([Object.freeze(cue(ms(52),ms(94)))]);
    const explicit={frameTicks:ntsc24,cues:[cue(0n,frame)]};
    const plan=planCaptionImportTiming(source,ntsc24,explicit);
    expect(plan.policy).toBe('explicit_expected_tick_plan');expect(plan.sourceCues).toEqual(source);
    expect(plan.expectedCues).toEqual(explicit.cues);expect(verifyCaptionImportTiming(plan,native(ntsc24,explicit.cues)).status).toBe('pass');
    expect(source[0]).toEqual(cue(ms(52),ms(94)));
  });
  it.each([
    {frameTicks:ntsc30,cues:[cue('0',ntsc24)]},
    {frameTicks:ntsc24,cues:[]},
    {frameTicks:ntsc24,cues:[cue('1',ntsc24)]},
    {frameTicks:ntsc24,cues:[cue('0','0')]},
  ])('refuses an invalid explicit expectation before placement: %j',explicit=>{
    expect(()=>planCaptionImportTiming([cue('0',ntsc24)],ntsc24,explicit)).toThrow(/CAPTION_/);
  });
  it('refuses a source interval that becomes empty on the declared frame grid',()=>{
    expect(()=>planCaptionImportTiming([cue(ms(1),ms(2))],ntsc24)).toThrow('CAPTION_TIMING_DURATION_INVALID:rounded:0');
  });
  it.each(['01','-1','NaN','1'.repeat(31)])('rejects noncanonical or unbounded source ticks %s',value=>{
    expect(()=>planCaptionImportTiming([cue(value,'9'.repeat(30))],ntsc24)).toThrow('CAPTION_TIMING_TICKS_INVALID');
  });
  it('keeps missing, invalid, reordered and changed-timebase readback unverified',()=>{
    const plan=planCaptionImportTiming([cue('0',ntsc24),cue(ntsc24,String(2n*BigInt(ntsc24)))],ntsc24);
    expect(verifyCaptionImportTiming(plan,native(ntsc24,plan.expectedCues.slice(0,1)))).toMatchObject({status:'unverified',summary:{unverifiedCueCount:1}});
    const actual=native(ntsc30,plan.expectedCues);actual.items[0]!.index=1;actual.items[1]!.startTicks='9'.repeat(31);
    const proof=verifyCaptionImportTiming(plan,actual);
    expect(proof.status).toBe('unverified');expect(proof.errors).toContain('CAPTION_TIMING_TIMEBASE_CHANGED');expect(proof.summary.unverifiedCueCount).toBe(2);
    expect(proof.cues[1]!.actualStartTicks).toBeNull();
  });
  it('checks all 10,000 cues while bounding actual text plus structuredContent payload and detecting late mismatches',()=>{
    const frame=BigInt(ntsc24),origin=9000000000000000000n*frame;
    const source=Array.from({length:10000},(_,index)=>cue(origin+BigInt(index)*frame,origin+BigInt(index+1)*frame));
    const plan=planCaptionImportTiming(source,ntsc24),actual=native(ntsc24,source);
    actual.items[9999]!.endTicks=String(BigInt(actual.items[9999]!.endTicks)-1n);
    const proof=verifyCaptionImportTiming(plan,actual);
    expect(proof.status).toBe('unverified');expect(proof.summary).toMatchObject({checkedCueCount:10000,matchedCueCount:9999,mismatchedCueCount:1,mismatchIndexSample:[9999]});
    expect(proof.details).toMatchObject({returnedCueCount:250,totalCueCount:10000,truncated:true});
    expect(Buffer.byteLength(JSON.stringify(result({status:'unverified',hostResult:{timingVerification:proof}})))).toBeLessThan(1024*1024);
    const good=verifyCaptionImportTiming(plan,native(ntsc24,source));
    expect(good).toMatchObject({status:'pass',summary:{checkedCueCount:10000,matchedCueCount:10000},details:{truncated:true}});
  });
  it('keeps every detail for the observed 22-cue-sized import',()=>{
    const frame=BigInt(ntsc24),source=Array.from({length:22},(_,index)=>cue(BigInt(index)*frame,BigInt(index+1)*frame));
    const proof=verifyCaptionImportTiming(planCaptionImportTiming(source,ntsc24),native(ntsc24,source));
    expect(proof.details).toMatchObject({returnedCueCount:22,totalCueCount:22,truncated:false});
  });
});
