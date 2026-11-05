import {describe,it,expect} from 'vitest';
import {placementIntervalsOverlap} from '../../apps/uxp-plugin/src/placement-interval.js';
import {timelineExtentSeconds} from '../../apps/uxp-plugin/src/timeline-extent.js';
import {planClipSplit} from '../../apps/uxp-plugin/src/clip-split.js';
import {preflightValue} from '../../apps/uxp-plugin/src/bridge-client.js';
import {hostResponseReceipt} from '../../apps/mcp-server/src/host-operation-receipt.js';
import {parameterWrites} from '../../apps/uxp-plugin/src/effect-parameter-contract.js';

describe('production boundary regressions',()=>{
  it('admits adjacent decimal intervals but rejects a real one-tick overlap',()=>{
    expect(placementIntervalsOverlap(.1,.2,.3,.1)).toBe(false);
    expect(placementIntervalsOverlap(0,1,1-1/254016000000,1)).toBe(true);
  });
  it('places staging beyond hidden/disabled content outside the reported sequence end',async()=>{
    const seq={getEndTime:()=>({seconds:260.69}),getVideoTrackCount:()=>3,getAudioTrackCount:()=>0,
      getVideoTrack:(index:number)=>({isMuted:()=>index===2,getTrackItems:()=>index===2?[{isDisabled:()=>true,getEndTime:()=>({seconds:268.27})}]:[]})};
    const end=await timelineExtentSeconds(seq,1);
    const item:any={id:'target',projectItemId:'media',mediaType:'video',trackIndex:0,start:{seconds:1},end:{seconds:5}};
    expect(planClipSplit([item],'target',3,end,30).stagingStartSeconds).toBeGreaterThan(268.27);
  });
  it('only explicit preflight proof releases a refusal; identical unproven errors stay uncertain',()=>{
    let caught:any;
    try{preflightValue(()=>{throw Error('PARAMETER_ANIMATED: test');});}catch(e){caught=e;}
    const response:any={version:1,id:'x',ok:false,error:{code:caught.code,message:caught.message,details:caught.details},durationMs:0};
    const context={commandId:'x',command:'set_effect_values',startedAt:new Date().toISOString(),completedAt:new Date().toISOString()};
    expect(hostResponseReceipt(response,{},context)).toMatchObject({status:'fail',retryable:false,errorClassification:'preflight',hostResult:{contentDispatched:false}});
    delete response.error.details;
    expect(hostResponseReceipt(response,{},context)).toMatchObject({status:'unverified',retryable:false,errorClassification:'postcondition'});
  });
  it('rejects numeric name keys with the exact indexed alternative',()=>{
    expect(()=>parameterWrites({'1':10},undefined)).toThrow('initialParameters');
    expect(parameterWrites(undefined,[{paramIndex:1,expectedDisplayName:'Precision',value:10}])).toHaveLength(1);
  });
});
