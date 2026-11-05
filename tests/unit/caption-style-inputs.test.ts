import {describe,expect,it} from 'vitest';
import {nativeCaptionStyle} from '../../apps/mcp-server/src/tool-inputs.js';

const track={trackUid:'00000000-0000-4000-8000-000000000001',expectedTrackId:2,expectedTrackName:'Captions',expectedItemCount:22};
const cue={itemIndex:1,expectedStartTicks:'21189168000',expectedEndTicks:'31783752000',fontPostScriptName:'NotoSansKR-Medium',fontSize:60,fillColor:{r:10,g:128,b:255}};

describe('caption style request boundaries',()=>{
  it('retains the existing track-wide font and size request',()=>{
    const request={...track,fontPostScriptName:'NotoSansKR-Medium',fontSize:52};
    expect(nativeCaptionStyle.parse(request)).toEqual(request);
  });
  it('preserves exact tick strings and independent per-cue fields',()=>{
    const request={...track,items:[cue,{itemIndex:2,expectedStartTicks:'31783752000',expectedEndTicks:'42378336000',fillColor:{r:255,g:0,b:0}}]};
    expect(nativeCaptionStyle.parse(request)).toEqual(request);
  });
  it('rejects a mixed track-wide and per-cue request rather than ignoring either',()=>{
    expect(nativeCaptionStyle.safeParse({...track,fontPostScriptName:'NotoSansKR-Medium',fontSize:52,items:[cue]}).success).toBe(false);
  });
  it('rejects duplicate indices and indices outside the guarded track',()=>{
    expect(nativeCaptionStyle.safeParse({...track,items:[cue,cue]}).success).toBe(false);
    expect(nativeCaptionStyle.safeParse({...track,items:[{...cue,itemIndex:22}]}).success).toBe(false);
  });
  it.each([
    {expectedEndTicks:'21189168000'},
    {expectedEndTicks:'1'},
    {expectedStartTicks:'-1'},
    {expectedStartTicks:'1.0'},
    {expectedStartTicks:'021189168000'},
    {fillColor:{r:0.5,g:0,b:0}},
    {fillColor:{r:256,g:0,b:0}},
    {fillColor:{r:0,g:0,b:0,alpha:0}},
    {fontSize:0},
    {fontSize:Infinity},
    {unknownStyle:'ignored'},
  ])('rejects invalid cue input %#',override=>{
    expect(nativeCaptionStyle.safeParse({...track,items:[{...cue,...override}]}).success).toBe(false);
  });
  it('rejects empty style edits and incomplete legacy requests',()=>{
    expect(nativeCaptionStyle.safeParse({...track,items:[]}).success).toBe(false);
    expect(nativeCaptionStyle.safeParse({...track,items:[{itemIndex:1,expectedStartTicks:'1',expectedEndTicks:'2'}]}).success).toBe(false);
    expect(nativeCaptionStyle.safeParse({...track,fontSize:52}).success).toBe(false);
  });
});
