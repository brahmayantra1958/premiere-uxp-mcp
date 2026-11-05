import {describe,it,expect} from 'vitest';
import {effectNativeSampleScopeMatches,decodeSdkColor,type EffectNativeSampleWork} from '../../packages/contracts/src/effect-native-sample.js';
import {effectNativeSampleWorkSchema,correlateNativeColor,correlateNativeEffectTime,nativeTimeDeltasAgree,sdkSchema} from '../../apps/mcp-server/src/effect-native-sample.js';
import {effectTime,nativeToSequenceTime} from '../../apps/uxp-plugin/src/effect-time.js';
const work:EffectNativeSampleWork={projectId:'p',sequenceId:'s',sequenceName:'WORKING__sample',trackItemId:'video:0:2540160000000:source',projectItemId:'source',clipName:'clip.mp4',mediaType:'video',trackIndex:0,
  startTicks:'2540160000000',endTicks:'5080320000000',inTicks:'762048000000',outTicks:'3302208000000',sequenceTicks:'2794176000000',nativeTicks:'1016064000000',mediaPath:'C:\\media\\clip.mp4',
  componentMatchNames:['Opacity','Motion','Tint'],components:[{componentIndex:2,componentMatchName:'Tint',parameterNames:['Black','White','Amount']}],componentIndex:2,componentMatchName:'Tint',paramIndex:0,parameterCount:3};
const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:work.sequenceName,trackItemId:work.trackItemId,expectedProjectItemId:'source',expectedMediaType:'video',expectedTrackIndex:0,expectedStartSeconds:10,expectedEndSeconds:20,componentIndex:2,componentMatchName:'Tint',detail:'parameter',paramIndex:0,expectedDisplayName:'Black',timeSeconds:11};
function fixture(){
  const node=(p:string,type:string,properties:Record<string,string>)=>({path:p,type,localTicks:work.nativeTicks,mappedTicks:work.nativeTicks,inputOffsetTicks:'0',properties});
  return {protocol:1,id:'00000000-0000-4000-8000-000000000001',premierePid:123,at:1,status:'partial',correlation:'required',sequenceTicks:work.sequenceTicks,rootTimeBasis:'acquired_range_offset',nodes:[
    node('root','RenderableNodeCompositorImpl',{}),
    node('root/i0','RenderableNodeClipImpl',{'ClipNode::TrackItemStartAsTicks':work.startTicks,'ClipNode::TrackItemEndAsTicks':work.endTicks,'EffectNode::ClipName':work.clipName,'ClipNode::ClipSpeed':'1','ClipNode::ClipBackwards':'0'}),
    {...node('root/i0/o0','RenderableNodeEffectImpl',{'EffectNode::FilterMatchName':'Tint','EffectNode::RuntimeInstanceID':'1234'}),parameterCount:3,parameterIndex:0,parameter:{type:4,value:'84113923027584'}},
    node('root/i0/o1','RenderableNodeEffectImpl',{'EffectNode::FilterMatchName':'Motion'}),node('root/i0/o2','RenderableNodeEffectImpl',{'EffectNode::FilterMatchName':'Opacity'}),
    node('root/i0/i0','RenderableNodeMediaImpl',{'MediaNode::MediaInstanceString':work.mediaPath,'MediaNode::InPointMediaTimeAsTicks':work.inTicks,'MediaNode::OutPointMediaTimeAsTicks':work.outTicks}),
  ]};
}
describe('bounded evaluated Color proof',()=>{
  it('rejects old frame-hold readers and distinguishes frozen media from frozen effect clocks',()=>{
    const sdk:any=fixture(),clip=sdk.nodes[1];clip.timeRate=.72;
    clip.properties['ClipNode::FrameHoldAtTime']='6127881983';clip.properties['ClipNode::FrameHoldFilters']='1';
    const mapping={...work,purpose:'time_mapping' as const};
    expect(()=>correlateNativeEffectTime(mapping,sdk)).toThrow('FRAME_HOLD_READER_UPDATE_REQUIRED');
    Object.assign(clip,{frameHoldClockProtocol:1,effectTicks:'6127881983',mediaTicks:'6127881983',effectTimeRate:0});
    expect(()=>correlateNativeEffectTime(mapping,sdk)).toThrow('EFFECT_TIME_UNVERIFIED');
    for(const effect of sdk.nodes.filter((n:any)=>n.type==='RenderableNodeEffectImpl'))effect.localTicks=effect.mappedTicks='6127881983';
    const held=correlateNativeEffectTime(mapping,sdk);expect(held.nativeTicks).toBe('6127881983');expect(held.rate).toBe(0);
    expect(correlateNativeColor({...work,exactMapping:true,nativeTicks:'6127881983'},sdk).status).toBe('pass');
    clip.effectTimeRate=.72;expect(()=>correlateNativeEffectTime(mapping,sdk)).toThrow('HOLD_CLOCK_UNVERIFIED');clip.effectTimeRate=0;
    clip.properties['ClipNode::FrameHoldFilters']='0';clip.effectTicks=work.nativeTicks;clip.effectTimeRate=.72;
    for(const effect of sdk.nodes.filter((n:any)=>n.type==='RenderableNodeEffectImpl'))effect.localTicks=effect.mappedTicks=work.nativeTicks;
    const mediaOnly=correlateNativeEffectTime(mapping,sdk);expect(mediaOnly.nativeTicks).toBe(work.nativeTicks);expect(mediaOnly.rate).toBe(.72);
    clip.mediaTicks='1';expect(()=>correlateNativeEffectTime(mapping,sdk)).toThrow('HOLD_CLOCK_UNVERIFIED');
  });
  it('proves clip time for non-rendered public effects without inventing their evaluated values',()=>{
    const sdk=fixture();sdk.nodes.splice(2,1);
    const mapping={...work,purpose:'time_mapping' as const};
    const r=correlateNativeEffectTime(mapping,sdk);expect(r.nativeTicks).toBe(work.nativeTicks);expect(r.selected).toEqual([]);
    expect(r.effectCorrelation).toEqual({scope:'clip_time_only',notRenderedMatchNames:['Tint']});
    expect(()=>correlateNativeColor(work,sdk)).toThrow('CHAIN_CHANGED');
    sdk.nodes[2]!.properties['EffectNode::FilterMatchName']='unexpected';expect(()=>correlateNativeEffectTime(mapping,sdk)).toThrow('CHAIN_CHANGED');
    sdk.nodes[2]!.properties['EffectNode::FilterMatchName']='Motion';sdk.nodes[2]!.mappedTicks='1';expect(()=>correlateNativeEffectTime(mapping,sdk)).toThrow('TIME_UNVERIFIED');
  });
  it('keeps reverse 1x coherence tick-exact beyond Number precision and rejects nonlinear retiming',()=>{
    const large=100000000000000001n;
    expect(nativeTimeDeltasAgree(large,-large,1,true)).toBe(true);
    expect(nativeTimeDeltasAgree(large,-large+1n,1,true)).toBe(false);
    expect(nativeTimeDeltasAgree(254016000000n,505635622642n,1.990566037735849,false)).toBe(true);
    expect(nativeTimeDeltasAgree(254016000000n,506635622642n,1.990566037735849,false)).toBe(false);
  });
  it('scopes reverse time proof to the parent requested ticks and guards stale clip metadata',()=>{
    const mapping={...work,purpose:'time_mapping' as const,reversed:true as const,sequenceTicks:work.startTicks,nativeTicks:'0',sampleTimes:[work.sequenceTicks]};
    expect(effectNativeSampleWorkSchema.safeParse(mapping).success).toBe(true);
    expect(effectNativeSampleScopeMatches('get_effect_values',args,mapping)).toBe(true);
    expect(effectNativeSampleScopeMatches('set_effect_keyframes',{...args,keyframes:[{timeSeconds:11}]},mapping)).toBe(true);
    expect(effectNativeSampleScopeMatches('set_effect_keyframes',{...args,keyframes:[{timeSeconds:12}]},mapping)).toBe(false);
    expect(effectNativeSampleScopeMatches('set_effect_values',args,mapping)).toBe(false);
    expect(effectNativeSampleWorkSchema.safeParse({...mapping,sampleTimes:['0']}).success).toBe(false);
    const clip={start:{ticks:work.startTicks},end:{ticks:work.endTicks},inPoint:{ticks:work.inTicks},outPoint:{ticks:work.outTicks},speed:1,reversed:true};
    const proof={status:'pass' as const,exactOnly:true as const,startTicks:work.startTicks,endTicks:work.endTicks,inTicks:work.inTicks,outTicks:work.outTicks,speed:1 as const,reversed:true as const,originTicks:'3293732332800',samples:[{sequenceTicks:work.startTicks,nativeTicks:'3293732332800',rate:-1},{sequenceTicks:work.sequenceTicks,nativeTicks:'3039716332800',rate:-1}]};
    expect(effectTime(clip,{timeSeconds:11},proof).nativeTicks).toBe('3039716332800');
    expect(nativeToSequenceTime(clip,'3039716332800',proof)?.seconds).toBe(11);
    expect(()=>effectTime(clip,{timeSeconds:12},proof)).toThrow('exact requested tick');
    expect(()=>effectTime({...clip,speed:2},{timeSeconds:11},proof)).toThrow('MAPPING_UNSUPPORTED');
    expect(()=>effectTime({...clip,outPoint:{ticks:'1'}},{timeSeconds:11},proof)).toThrow('MAPPING_UNSUPPORTED');
  });
  it('validates reverse Color against actual SDK mapped time, not forward clip-local time',()=>{
    const sdk=fixture();sdk.nodes[1]!.properties['ClipNode::ClipBackwards']='1';sdk.nodes[1]!.localTicks='254016000000';
    const reversed={...work,reversed:true as const,originTicks:String(BigInt(work.nativeTicks)+254016000000n)};
    expect(correlateNativeColor(reversed,sdk).evidence.timeMapping).toBe('sdk_reverse_1x');
    sdk.nodes[1]!.mappedTicks='1';expect(()=>correlateNativeColor(reversed,sdk)).toThrow('TIME_UNVERIFIED');
  });
  it('correlates retimed UXP normalized bounds against native source bounds and keeps inverse times native-only without proof',()=>{
    const sdk=fixture();sdk.nodes[1]!.properties['ClipNode::ClipSpeed']='2';sdk.nodes[1]!.localTicks=String(BigInt(work.nativeTicks)/2n);
    const retimed={...work,speed:2,reversed:false,originTicks:String(BigInt(work.nativeTicks)-508032000000n),inTicks:String(BigInt(work.inTicks)/2n),outTicks:String(BigInt(work.outTicks)/2n)};
    expect(correlateNativeColor(retimed,sdk).evidence.timeMapping).toBe('sdk_constant_rate');
    sdk.nodes[5]!.properties['MediaNode::InPointMediaTimeAsTicks']='1';expect(()=>correlateNativeColor(retimed,sdk)).toThrow('IDENTITY');
    const clip={start:{ticks:work.startTicks},end:{ticks:work.endTicks},inPoint:{ticks:retimed.inTicks},outPoint:{ticks:retimed.outTicks},speed:2,reversed:false};
    const proof={status:'pass' as const,exactOnly:true as const,startTicks:work.startTicks,endTicks:work.endTicks,inTicks:retimed.inTicks,outTicks:retimed.outTicks,speed:2,reversed:false,originTicks:retimed.originTicks,samples:[{sequenceTicks:work.startTicks,nativeTicks:retimed.originTicks,rate:2},{sequenceTicks:work.sequenceTicks,nativeTicks:work.nativeTicks,rate:2}]};
    expect(effectTime(clip,{timeSeconds:11},proof).nativeTicks).toBe(work.nativeTicks);
    expect(nativeToSequenceTime(clip,work.nativeTicks,proof)?.seconds).toBe(11);
    expect(nativeToSequenceTime(clip,String(BigInt(work.nativeTicks)+1n),proof)).toBeNull();
    expect(()=>effectTime(clip,{timeSeconds:12},proof)).toThrow('exact requested tick');
  });
  it('accepts the SDK 37-byte text UUID hash and exact non-linear samples without a 1x assumption',()=>{
    const sdk:any=fixture();sdk.nativeTimeProtocol=2;sdk.graphHash=Buffer.from('847a263c-6dd7-33da-5251-0764000010b8\0').toString('hex');
    sdk.nodes[1].localTicks=String(BigInt(work.nativeTicks)+100n);
    expect(correlateNativeColor({...work,exactMapping:true},sdk).evidence.timeMapping).toBe('sdk_exact_samples');
    sdk.graphHash='a'.repeat(32);expect(()=>correlateNativeColor({...work,exactMapping:true},sdk)).toThrow();
  });
  it('retains time evidence when the selected parameter has opaque data instead of a numeric value',()=>{
    const sdk:any=fixture();sdk.nodes[2].parameter={type:10,status:'unsupported'};
    expect(sdkSchema.parse(sdk).nodes[2]?.parameter).toEqual({type:10,status:'unsupported'});
    sdk.nodes[2].parameter={type:4,status:'unsupported',value:'0'};expect(sdkSchema.safeParse(sdk).success).toBe(false);
    sdk.nodes[2].parameter={type:10};expect(sdkSchema.safeParse(sdk).success).toBe(false);
  });
  it('binds the sample to parent command, actual parameter, target and time',()=>{
    expect(effectNativeSampleWorkSchema.parse(work)).toEqual(work);
    expect(effectNativeSampleScopeMatches('get_effect_values',args,work)).toBe(true);
    for(const changed of [{expectedProjectId:'other'},{timeSeconds:12},{paramIndex:1},{expectedDisplayName:'Wrong'},{detail:'chain'},{componentIndex:1}])expect(effectNativeSampleScopeMatches('get_effect_values',{...args,...changed},work)).toBe(false);
    expect(effectNativeSampleScopeMatches('set_effect_values',args,work)).toBe(false);
    expect(effectNativeSampleWorkSchema.safeParse({...work,script:'run()'}).success).toBe(false);
    expect(effectNativeSampleWorkSchema.safeParse({...work,parameterCount:4}).success).toBe(false);
  });
  it('correlates source identity and packed SDK sample despite intrinsic display ordering',()=>{
    const result=correlateNativeColor(work,fixture());expect(result.status).toBe('pass');expect(result.value).toEqual({red:.3,green:.3,blue:.7,alpha:0});
  });
  it('preserves high alpha bits without Number conversion',()=>{
    const packed=BigInt.asIntN(64,(65280n<<48n)|(13056n<<32n)|(26112n<<16n)|52224n).toString();
    expect(decodeSdkColor(packed)).toEqual({red:.2,green:.4,blue:.8,alpha:1});
    expect(()=>decodeSdkColor('18446744073709551615')).toThrow('INT64');
  });
  it('binds duplicates by runtime identity, never by operator index; equal values need no guessed identity',()=>{
    const sdk:any=fixture(),duplicate=structuredClone(sdk.nodes[2]);duplicate.path='root/i0/o3';duplicate.properties['EffectNode::RuntimeInstanceID']='5678';duplicate.parameter.value='56076804344832';sdk.nodes.push(duplicate);
    const repeated={...work,componentMatchNames:['Opacity','Tint','Motion','Tint'],components:[{...work.components[0]!,componentIndex:3}],componentIndex:3};
    expect(()=>correlateNativeColor(repeated,sdk)).toThrow('AMBIGUOUS');
    expect(correlateNativeColor(repeated,sdk,['5678']).value).toEqual({red:.2,green:.4,blue:.8,alpha:0});
    duplicate.parameter.value=sdk.nodes[2].parameter.value;
    expect(correlateNativeColor(repeated,sdk).evidence.instanceProof).toBe('all_matching_instances_value_agreement');
    expect(correlateNativeColor(repeated,sdk).evidence.instanceId).toBeNull();
    expect(()=>correlateNativeColor(repeated,sdk,['unobserved'])).toThrow('AMBIGUOUS');
    expect(effectNativeSampleWorkSchema.safeParse({...work,references:[{sequenceTicks:'1',nativeTicks:'1',value:{red:0,green:0,blue:0,alpha:0}}]}).success).toBe(false);
  });
  it.each(['source','bounds','time','reverse','chain','count','type','duplicate','graph'])('rejects %s drift instead of guessing a sample',kind=>{
    const sdk:any=fixture();
    if(kind==='source')sdk.nodes[5].properties['MediaNode::MediaInstanceString']='C:\\other\\clip.mp4';
    if(kind==='bounds')sdk.nodes[1].properties['ClipNode::TrackItemEndAsTicks']='5080320000001';
    if(kind==='time')sdk.nodes[2].localTicks='1';
    if(kind==='reverse')sdk.nodes[1].properties['ClipNode::ClipBackwards']='1';
    if(kind==='chain')sdk.nodes[4].properties['EffectNode::FilterMatchName']='Changed';
    if(kind==='count')sdk.nodes[2].parameterCount=4;
    if(kind==='type')sdk.nodes[2].parameter.type=5;
    if(kind==='duplicate')sdk.nodes.push(...sdk.nodes.filter((n:any)=>n.path.startsWith('root/i0')).map((n:any)=>({...structuredClone(n),path:n.path.replace('root/i0','root/i1')})));
    if(kind==='graph')sdk.nodes.push(sdk.nodes[2]);
    expect(()=>correlateNativeColor(work,sdk)).toThrow();
  });
});
