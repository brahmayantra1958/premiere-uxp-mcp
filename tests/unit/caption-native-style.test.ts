import {describe,it,expect,vi} from 'vitest';
import {assertCaptionStyleTarget,setSelectedCaptionFontStyle} from '../../apps/mcp-server/src/caption-native-style.js';
const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'arbitrary sequence',trackIndex:2,expectedTrackId:'91',expectedTrackName:'arbitrary captions',itemIndex:0,expectedStartTicks:'100',expectedEndTicks:'200',expectedFontFamily:'Noto Serif KR',expectedFontStyle:'Bold',fontStyle:'SemiBold',dryRun:false};
function fixture(){
  const snapshot={projectId:'p',sequenceId:'s',sequenceName:args.expectedSequenceName,track:{index:2,id:'91',name:args.expectedTrackName},items:[{selected:true,startTicks:'100',endTicks:'200'}],selection:{selectedCaptions:1,selectedOtherItems:0}};
  let style='Bold';
  const native=vi.fn(async(r:any)=>{if(r.operation==='set_font_style')style=r.fontStyle;return {status:'pass',contentDispatched:r.operation==='set_font_style',after:{fontFamily:'Noto Serif KR',fontStyle:style,fontStyleChoices:['Bold','SemiBold']}};});
  const host={read:vi.fn(async()=>structuredClone(snapshot)),mutateLocal:vi.fn(async(_c:any,_a:any,action:any)=>action())} as any;
  return {snapshot,native,host};
}
describe('selected caption native font face',()=>{
  it('binds arbitrary project/sequence/track IDs and changes only one face without save or selection',async()=>{
    const {host,native}=fixture();const r=await setSelectedCaptionFontStyle(host,args,'once',native);
    expect(r.status).toBe('pass');expect(r.result).toMatchObject({before:{fontStyle:'Bold'},after:{fontStyle:'SemiBold'},projectSaved:false});
    expect(host.mutateLocal).toHaveBeenCalledWith('set_selected_caption_font_style',args,expect.any(Function),'once');
    expect(native.mock.calls.filter(([r])=>r.operation==='set_font_style')).toHaveLength(1);
    expect(host.read.mock.calls.every(([c]:any[])=>c==='inspect_caption_track')).toBe(true);
  });
  it('previews without native write or lease',async()=>{
    const {host,native}=fixture();const r=await setSelectedCaptionFontStyle(host,{...args,dryRun:true},undefined,native);
    expect(r.status).toBe('pass');expect(host.mutateLocal).not.toHaveBeenCalled();expect(native.mock.calls.every(([r])=>r.operation==='read')).toBe(true);
  });
  it('rejects missing live selection, other selected cues and changed clocks before native write',()=>{
    const {snapshot}=fixture();
    expect(()=>assertCaptionStyleTarget({...snapshot,selection:undefined},args)).toThrow('EXACT_SELECTION');
    expect(()=>assertCaptionStyleTarget({...snapshot,selection:{selectedCaptions:2,selectedOtherItems:0}},args)).toThrow('EXACT_SELECTION');
    expect(()=>assertCaptionStyleTarget(snapshot,{...args,expectedStartTicks:'101'})).toThrow('EXACT_SELECTION');
    expect(()=>assertCaptionStyleTarget(snapshot,{...args,expectedSequenceId:'different'})).toThrow('TARGET_CHANGED');
  });
  it('refuses stale expected fonts and unknown options',async()=>{
    const {host,native}=fixture();
    expect((await setSelectedCaptionFontStyle(host,{...args,expectedFontStyle:'Regular'},undefined,native)).status).toBe('fail');
    expect((await setSelectedCaptionFontStyle(host,{...args,fontStyle:'Missing'},undefined,native)).status).toBe('fail');
    expect(native.mock.calls.every(([r])=>r.operation==='read')).toBe(true);
  });
  it('keeps timeout and post-write target changes unverified, with no replay or restoration',async()=>{
    const {host,native,snapshot}=fixture();native.mockImplementation(async(r:any)=>r.operation==='read'?{status:'pass',after:{fontFamily:args.expectedFontFamily,fontStyle:'Bold',fontStyleChoices:['SemiBold']}}:{status:'unverified',contentDispatched:true,reason:'timeout'} as any);
    const r=await setSelectedCaptionFontStyle(host,args,undefined,native);expect(r.status).toBe('unverified');expect(native.mock.calls.filter(([r])=>r.operation==='set_font_style')).toHaveLength(1);
    const second=fixture();second.host.read.mockImplementation(async()=>second.native.mock.calls.some(([r])=>r.operation==='set_font_style')?{...snapshot,sequenceId:'user moved'}:snapshot);
    expect((await setSelectedCaptionFontStyle(second.host,args,undefined,second.native)).status).toBe('unverified');
  });
});
