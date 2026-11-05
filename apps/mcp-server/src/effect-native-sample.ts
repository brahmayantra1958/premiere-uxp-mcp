/** Native samples prove only the correlated project/sequence/clip/effect instance and time. A time-only mapping is not proof of an omitted effect value; ambiguous duplicates remain unverified. */
import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';
import {currentRequestEditTarget} from "./active-edit-target.js";
import {z} from 'zod/v4';
import {effectChainProofWorkSchema} from './effect-chain-proof.js';
import {decodeSdkColor,type EffectNativeSampleWork} from '@premiere-uxp/contracts/effect-native-sample';
import {nativeEvaluatedRead} from './native-evaluated-read.js';
import {sampleExactEffectTimes} from './effect-time-sampling.js';

const ticks=z.string().regex(/^\d{1,18}$/);
const color=z.object({red:z.number().finite(),green:z.number().finite(),blue:z.number().finite(),alpha:z.number().finite()}).strict();
export const effectNativeSampleWorkSchema=effectChainProofWorkSchema.safeExtend({
  mediaPath:z.string().min(1).max(4096),inTicks:ticks,outTicks:ticks,sequenceTicks:ticks,nativeTicks:ticks,
  componentIndex:z.number().int().min(0).max(63),componentMatchName:z.string().regex(/^[\x20-\x7e]{1,200}$/),
  paramIndex:z.number().int().min(0).max(4095),parameterCount:z.number().int().min(1).max(4096),
  references:z.array(z.object({sequenceTicks:ticks,nativeTicks:ticks,value:color}).strict()).max(8).optional(),
  purpose:z.literal('time_mapping').optional(),exactMapping:z.literal(true).optional(),reversed:z.boolean().optional(),speed:z.number().finite().positive().max(1000).optional(),originTicks:ticks.optional(),sampleTimes:z.array(ticks).min(1).max(64).optional(),keyNativeTimes:z.array(ticks).max(64).optional(),
}).refine(w=>w.components.length===1&&w.components[0]!.componentIndex===w.componentIndex&&w.components[0]!.componentMatchName===w.componentMatchName
  &&w.components[0]!.parameterNames.length===w.parameterCount&&w.paramIndex<w.parameterCount
  &&(w.purpose==='time_mapping'?typeof w.reversed==='boolean'&&w.nativeTicks==='0'&&!!w.sampleTimes&&!w.references&&!w.originTicks
    &&w.sampleTimes.every(t=>BigInt(t)>=BigInt(w.startTicks)&&BigInt(t)<BigInt(w.endTicks)):!w.sampleTimes&&!w.keyNativeTimes&&(!w.reversed&&(w.speed??1)===1||w.originTicks!==undefined))
  &&(w.references??[]).every(r=>BigInt(r.sequenceTicks)>=BigInt(w.startTicks)&&BigInt(r.sequenceTicks)<BigInt(w.endTicks)
    &&(w.exactMapping||(w.speed??1)!==1||BigInt(r.nativeTicks)===(w.reversed?BigInt(w.originTicks!)-(BigInt(r.sequenceTicks)-BigInt(w.startTicks)):BigInt(r.sequenceTicks)-BigInt(w.startTicks)+BigInt(w.inTicks)))),'Exact full parameter definition and in-clip references required');
const sdkTicks=z.string().regex(/^-?\d{1,18}$/);
const nodeSchema=z.object({path:z.string().regex(/^root(?:\/[io]\d+)*$/),type:z.string().max(128),localTicks:sdkTicks,mappedTicks:sdkTicks,inputOffsetTicks:sdkTicks,
  properties:z.record(z.string().max(100),z.string().max(4096)),timeRate:z.number().finite().optional(),
  frameHoldClockProtocol:z.literal(1).optional(),effectTicks:sdkTicks.optional(),mediaTicks:sdkTicks.optional(),effectTimeRate:z.number().finite().optional(),
  parameterCount:z.number().int().optional(),parameterIndex:z.number().int().optional(),parameter:z.object({type:z.number().int(),value:z.unknown().optional(),status:z.literal('unsupported').optional()}).refine(p=>p.status==='unsupported'?p.value===undefined:p.value!==undefined,'A supported native value and an unsupported status are mutually exclusive').optional()});
// Adobe prPluginID is the 37-byte UUID text buffer, encoded losslessly as hex.
export const sdkSchema=z.object({protocol:z.literal(1),nativeTimeProtocol:z.literal(2).optional(),graphHash:z.string().regex(/^[a-f0-9]{74}$/).optional(),id:z.string().uuid(),premierePid:z.number().int().positive(),at:z.number().int(),status:z.literal('partial'),correlation:z.literal('required'),sequenceTicks:ticks,rootTimeBasis:z.literal('acquired_range_offset'),nodes:z.array(nodeSchema).min(1).max(128)});
const normalizedPath=(value:string)=>normalizeLocalPath(value);
function sourceBoundMatches(uxp:string,native:string|undefined,speed:number):boolean {
  if(!native||!/^\d+$/.test(native))return false;
  if(speed===1)return uxp===native;
  // Retimed UXP in/out are normalized by speed and quantized to integer ticks.
  // SDK media in/out retain the original source range. Bound only that integer
  // conversion error and floating point ULPs; never use it as an edit time.
  const expected=Number(uxp)*speed;
  return Math.abs(Number(native)-expected)<=Math.max(2*speed,Math.abs(expected)*Number.EPSILON*4);
}

/** L2 correlation theorem: exactly one media-backed rendered clip agrees with
 * the UXP bounds/source/time/whole effect multiset. Never infer a track index
 * from SDK TrackID or an effect occurrence from its render-graph position. */
export function correlateNativeEffectTime(work:EffectNativeSampleWork,raw:unknown) {
  const sdk=sdkSchema.parse(raw);
  if(sdk.sequenceTicks!==work.sequenceTicks||new Set(sdk.nodes.map(n=>n.path)).size!==sdk.nodes.length)throw Error('SDK_SAMPLE_TIME_OR_GRAPH_CHANGED');
  const clips=sdk.nodes.filter(n=>n.type==='RenderableNodeClipImpl'
    &&n.properties['ClipNode::TrackItemStartAsTicks']===work.startTicks&&n.properties['ClipNode::TrackItemEndAsTicks']===work.endTicks
    &&n.properties['EffectNode::ClipName']===work.clipName);
  const matches=clips.filter(c=>sdk.nodes.some(n=>n.path===c.path+'/i0'&&n.type==='RenderableNodeMediaImpl'
    &&normalizedPath(n.properties['MediaNode::MediaInstanceString']??'')===normalizedPath(work.mediaPath)
    &&sourceBoundMatches(work.inTicks,n.properties['MediaNode::InPointMediaTimeAsTicks'],work.speed??1)&&sourceBoundMatches(work.outTicks,n.properties['MediaNode::OutPointMediaTimeAsTicks'],work.speed??1)));
  if(matches.length!==1)throw Error('SDK_CLIP_IDENTITY_AMBIGUOUS');
  const clip=matches[0]!;
  if(Number(clip.properties['ClipNode::ClipSpeed'])!==(work.speed??1)||clip.properties['ClipNode::ClipBackwards']!==(work.reversed?'1':'0'))throw Error('SDK_TIME_MAPPING_UNVERIFIED');
  const hold=clip.properties['ClipNode::FrameHoldAtTime'],filters=clip.properties['ClipNode::FrameHoldFilters'];
  let nativeTicks=clip.mappedTicks,rate=clip.timeRate;
  if(hold!==undefined||filters==='1'){
    // Older readers traverse operators with the unheld TransformNodeTime even
    // when Hold Filters is enabled. Reject that plausible but wrong clock.
    if(clip.frameHoldClockProtocol!==1)throw Error('SDK_FRAME_HOLD_READER_UPDATE_REQUIRED');
    if(hold===undefined||!sdkTicks.safeParse(hold).success||filters!==undefined&&filters!=='0'&&filters!=='1'
      ||clip.mediaTicks!==hold||clip.effectTicks!==(filters==='1'?hold:clip.mappedTicks)
      ||clip.effectTimeRate!==(filters==='1'?0:clip.timeRate))throw Error('SDK_FRAME_HOLD_CLOCK_UNVERIFIED');
    nativeTicks=clip.effectTicks;rate=clip.effectTimeRate;
  }else if(clip.frameHoldClockProtocol!==undefined||clip.effectTicks!==undefined||clip.mediaTicks!==undefined||clip.effectTimeRate!==undefined)throw Error('SDK_FRAME_HOLD_CLOCK_UNVERIFIED');
  const clockEvidence={basis:hold===undefined?'TransformNodeTime':'FrameHoldAtTime',holdFilters:filters==='1',rawMappedTicks:clip.mappedTicks,rawRate:clip.timeRate,mediaTicks:clip.mediaTicks};
  const effects=sdk.nodes.filter(n=>n.path.startsWith(clip.path+'/o')&&n.path.slice(clip.path.length+1).match(/^o\d+$/));
  if(work.purpose==='time_mapping'){
    // Clip time and evaluated parameter identity are distinct proof obligations.
    // The render graph can omit public components (observed with Auto Reframe).
    // For time only, exact unique source/bounds/rate identity above plus the
    // actual Clip TransformNodeTime is sufficient. Every rendered operator
    // must still belong to the public multiset and use that same clip clock.
    // This branch cannot publish GetParam values or a missing effect identity.
    const remaining=[...work.componentMatchNames];
    for(const effect of effects){
      const i=remaining.indexOf(effect.properties['EffectNode::FilterMatchName']!);
      if(i<0)throw Error('SDK_EFFECT_CHAIN_CHANGED');remaining.splice(i,1);
      if(effect.localTicks!==nativeTicks||effect.mappedTicks!==nativeTicks)throw Error('SDK_EFFECT_TIME_UNVERIFIED');
    }
    return {sdk,clip,selected:[],nativeTicks,rate,clockEvidence,effectCorrelation:{scope:'clip_time_only',notRenderedMatchNames:remaining}};
  }
  if(JSON.stringify(effects.map(n=>n.properties['EffectNode::FilterMatchName']).sort())!==JSON.stringify([...work.componentMatchNames].sort()))throw Error('SDK_EFFECT_CHAIN_CHANGED');
  const selected=effects.filter(n=>n.properties['EffectNode::FilterMatchName']===work.componentMatchName);
  if(!selected.length||new Set(selected.map(n=>n.properties['EffectNode::RuntimeInstanceID'])).size!==selected.length)throw Error('SDK_EFFECT_INSTANCE_AMBIGUOUS');
  if(selected.some(e=>e.localTicks!==nativeTicks||e.mappedTicks!==nativeTicks||e.parameterCount!==work.parameterCount||e.parameterIndex!==work.paramIndex))throw Error('SDK_EFFECT_TIME_UNVERIFIED');
  return {sdk,clip,selected,nativeTicks,rate,clockEvidence};
}
export function nativeColorCandidates(work:EffectNativeSampleWork,raw:unknown) {
  const {sdk,clip,selected,nativeTicks}=correlateNativeEffectTime(work,raw);
  if(nativeTicks!==work.nativeTicks||!work.exactMapping&&!work.reversed&&(work.speed??1)===1&&clip.localTicks!==work.nativeTicks)throw Error('SDK_TIME_MAPPING_UNVERIFIED');
  return selected.map(effect=>{
    const instanceId=effect.properties['EffectNode::RuntimeInstanceID'];
    if(!instanceId||effect.localTicks!==work.nativeTicks||effect.mappedTicks!==work.nativeTicks||effect.parameterCount!==work.parameterCount||effect.parameterIndex!==work.paramIndex||effect.parameter?.type!==4||typeof effect.parameter.value!=='string')throw Error('SDK_COLOR_PARAMETER_UNVERIFIED');
    return {value:decodeSdkColor(effect.parameter.value),nativeTicks:work.nativeTicks,sequenceTicks:work.sequenceTicks,
      evidence:{route:'adobe_sdk_GetParam',id:sdk.id,premierePid:sdk.premierePid,at:sdk.at,clipPath:clip.path,effectPath:effect.path,instanceId,clipIdentity:'bounds_source_path_in_out',timeMapping:work.exactMapping?'sdk_exact_samples':(work.speed??1)!==1?'sdk_constant_rate':work.reversed?'sdk_reverse_1x':'sdk_and_uxp_forward_1x'}};
  });
}
const colorEqual=(a:Record<string,number>,b:Record<string,number>)=>['red','green','blue','alpha'].every(k=>Math.abs(a[k]!-b[k]!)<1e-9);
export function nativeTimeDeltasAgree(sequenceDelta:bigint,nativeDelta:bigint,speed:number,reversed:boolean):boolean {
  const direction=reversed?-1:1;
  if(speed===1)return nativeDelta===sequenceDelta*BigInt(direction);
  const expected=Number(sequenceDelta)*speed*direction;
  return Math.abs(expected-Number(nativeDelta))<=Math.max(2,Math.abs(expected)*Number.EPSILON*4);
}
export function correlateNativeColor(work:EffectNativeSampleWork,raw:unknown,instanceIds?:string[]) {
  const candidates=nativeColorCandidates(work,raw).filter(c=>!instanceIds||instanceIds.includes(c.evidence.instanceId));
  if(!candidates.length||!candidates.every(c=>colorEqual(c.value,candidates[0]!.value)))throw Error('SDK_EFFECT_INSTANCE_AMBIGUOUS');
  return {...candidates[0]!,status:'pass',evidence:{...candidates[0]!.evidence,instanceId:candidates.length===1?candidates[0]!.evidence.instanceId:null,effectPath:candidates.length===1?candidates[0]!.evidence.effectPath:null,
    instanceIds:candidates.map(c=>c.evidence.instanceId),instanceProof:candidates.length===1?'unique_native_instance':'all_matching_instances_value_agreement'}};
}

export async function requestEffectNativeSample(input:unknown) {
  const work=effectNativeSampleWorkSchema.parse(input);
  const pin=currentRequestEditTarget();
  if(work.projectId!==pin.projectId||work.sequenceId!==pin.sequenceId||work.sequenceName!==pin.sequenceName)throw Error('NATIVE_SAMPLE_PIN_CHANGED');
  if(work.purpose==='time_mapping'){
    if(work.exactMapping){
      const started=Date.now();let graphHash:string|undefined,pid:number|undefined;
      const proof=await sampleExactEffectTimes({startTicks:work.startTicks,endTicks:work.endTicks,speed:work.speed??1,reversed:!!work.reversed,requested:work.sampleTimes!,keys:work.keyNativeTimes??[]},async sequenceTicks=>{
        if(Date.now()-started>20000)throw Error('SDK_TIME_PROOF_BUDGET');
        const read=await nativeEvaluatedRead({ticks:sequenceTicks,matchName:work.componentMatchName,paramIndex:work.paramIndex});
        const result=correlateNativeEffectTime({...work,sequenceTicks},read.sdk);
        if(result.sdk.nativeTimeProtocol!==2||!result.sdk.graphHash||result.rate===undefined)throw Error('SDK_EXACT_TIME_READER_UPDATE_REQUIRED');
        if(graphHash!==undefined&&(result.sdk.graphHash!==graphHash||result.sdk.premierePid!==pid))throw Error('SDK_TIME_GRAPH_CHANGED');
        graphHash=result.sdk.graphHash;pid=result.sdk.premierePid;
        return {sequenceTicks,nativeTicks:result.nativeTicks,rate:result.rate,evidence:{id:result.sdk.id,premierePid:pid,graphHash,clipPath:result.clip.path,effectCorrelation:result.effectCorrelation,clock:result.clockEvidence}};
      });
      return {status:'pass',startTicks:work.startTicks,endTicks:work.endTicks,inTicks:work.inTicks,outTicks:work.outTicks,speed:work.speed??1,reversed:!!work.reversed,...proof,graphHash,premierePid:pid,elapsedMs:Date.now()-started};
    }
    // Exact requested times are all sampled. The midpoint additionally detects
    // a changed/non-affine map; no retimed mutation uses an extrapolated tick.
    const times=[...new Set([work.startTicks,String((BigInt(work.startTicks)+BigInt(work.endTicks))/2n),...work.sampleTimes!])],samples:Array<{sequenceTicks:string;nativeTicks:string;evidence:{id:string;premierePid:number;at:number;clipPath:string}}>=[];
    const speed=work.speed??1,direction=work.reversed?-1:1;
    let origin:string|undefined,pid:number|undefined;const started=Date.now();
    const sample=async(sequenceTicks:string)=>{
      const cached=samples.find(s=>s.sequenceTicks===sequenceTicks);if(cached)return cached;
      if(Date.now()-started>12000)throw Error('SDK_TIME_PROOF_BUDGET');
      const read=await nativeEvaluatedRead({ticks:sequenceTicks,matchName:work.componentMatchName,paramIndex:work.paramIndex});
      const result=correlateNativeEffectTime({...work,sequenceTicks},read.sdk);
      if(origin!==undefined){
        if(!nativeTimeDeltasAgree(BigInt(sequenceTicks)-BigInt(work.startTicks),BigInt(result.nativeTicks)-BigInt(origin),speed,!!work.reversed))throw Error('SDK_NONLINEAR_TIME_MAP_UNVERIFIED');
      }
      if(pid!==undefined&&pid!==result.sdk.premierePid)throw Error('SDK_TIME_MAP_PROCESS_CHANGED');
      origin??=result.nativeTicks;pid=result.sdk.premierePid;
      const entry={sequenceTicks,nativeTicks:result.nativeTicks,evidence:{id:result.sdk.id,premierePid:pid,at:result.sdk.at,clipPath:result.clip.path}};samples.push(entry);return entry;
    };
    for(const time of times)await sample(time);
    // Inversion of rounded retimed ticks is not assumed. Probe the nearest
    // candidate and neighbours, retaining only actual SDK equalities. An
    // unreachable/out-of-range key remains native-only in the response.
    for(const key of speed===1?[]:work.keyNativeTimes??[]){
      if(samples.some(s=>s.nativeTicks===key))continue;
      const guess=BigInt(work.startTicks)+BigInt(Math.round(Number(BigInt(key)-BigInt(origin!))/(speed*direction)));
      for(const delta of [0n,-1n,1n,-2n,2n]){
        const time=guess+delta;if(time<BigInt(work.startTicks)||time>=BigInt(work.endTicks))continue;
        if((await sample(String(time))).nativeTicks===key)break;
      }
    }
    return {status:'pass',startTicks:work.startTicks,endTicks:work.endTicks,inTicks:work.inTicks,outTicks:work.outTicks,speed,reversed:!!work.reversed,originTicks:origin,samples,elapsedMs:Date.now()-started};
  }
  const native=await nativeEvaluatedRead({ticks:work.sequenceTicks,matchName:work.componentMatchName,paramIndex:work.paramIndex});
  let candidates=nativeColorCandidates(work,native.sdk),elapsedMs=native.elapsedMs;
  const references=[];
  for(const ref of work.references??[]){
    if(candidates.length<=1||candidates.every(c=>colorEqual(c.value,candidates[0]!.value)))break;
    const sample=await nativeEvaluatedRead({ticks:ref.sequenceTicks,matchName:work.componentMatchName,paramIndex:work.paramIndex});elapsedMs+=sample.elapsedMs;
    if(sample.sdk.premierePid!==native.sdk.premierePid)throw Error('SDK_INSTANCE_PROCESS_CHANGED');
    const proof=nativeColorCandidates({...work,...ref},sample.sdk).filter(c=>colorEqual(c.value,ref.value));
    candidates=candidates.filter(c=>proof.some(p=>p.evidence.instanceId===c.evidence.instanceId));
    references.push({sequenceTicks:ref.sequenceTicks,nativeTicks:ref.nativeTicks,expectedValue:ref.value,evidence:proof.map(p=>p.evidence)});
    if(!candidates.length)throw Error('SDK_EXACT_KEY_REFERENCE_CHANGED');
  }
  return {...correlateNativeColor(work,native.sdk,candidates.map(c=>c.evidence.instanceId)),references,elapsedMs};
}
