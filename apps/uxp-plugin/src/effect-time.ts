/** Sequence and native source clocks are distinct. Preserve exact string ticks and [start,end) membership; nonlinear/reversed mappings require correlated SDK samples, not public speed arithmetic. */
import type {NativeEffectTimeProof} from '@premiere-uxp/contracts/effect-native-sample';
type ClipTime = { mediaType?:string; start: { ticks: string }; end: { ticks: string }; inPoint: { ticks: string }; outPoint?:{ticks:string}; speed?: number; reversed?: boolean };
export const EFFECT_TICKS_PER_SECOND = 254016000000;

function validSdkProof(clip:ClipTime,proof?:NativeEffectTimeProof):proof is NativeEffectTimeProof {
  if(!(Number.isFinite(clip.speed)&&(clip.speed??0)>0&&proof?.status==='pass'&&proof.exactOnly===true&&proof.speed===clip.speed&&proof.reversed===clip.reversed
    &&proof.startTicks===clip.start.ticks&&proof.endTicks===clip.end.ticks&&proof.inTicks===clip.inPoint.ticks&&proof.outTicks===clip.outPoint?.ticks))return false;
  const tick=(s:unknown):s is string=>typeof s==='string'&&/^(0|[1-9]\d{0,23})$/.test(s);
  if(![proof.startTicks,proof.endTicks,proof.inTicks,proof.outTicks,proof.originTicks].every(tick)||!Array.isArray(proof.samples)||!proof.samples.length||proof.samples.length>192)return false;
  const start=BigInt(proof.startTicks),end=BigInt(proof.endTicks),seen=new Set<string>();
  if(start>=end)return false;
  for(const sample of proof.samples){
    if(!tick(sample.sequenceTicks)||!tick(sample.nativeTicks)||!Number.isFinite(sample.rate)||seen.has(sample.sequenceTicks))return false;
    const sequence=BigInt(sample.sequenceTicks);if(sequence<start||sequence>=end)return false;seen.add(sample.sequenceTicks);
  }
  return proof.samples.some(s=>s.sequenceTicks===proof.startTicks&&s.nativeTicks===proof.originTicks);
}
function assertMapping(clip: ClipTime,proof?:NativeEffectTimeProof): void {
  // A ramp/hold can report public speed 1. A supplied but stale proof must never
  // silently fall back to a linear formula, even on a nominally ordinary clip.
  if ((clip.mediaType==='video'||proof!==undefined||!(clip.speed===1&&clip.reversed===false))&&!validSdkProof(clip,proof)) throw Error("EFFECT_TIME_MAPPING_UNSUPPORTED: video/retimed clips require a current, exact SDK time proof");
}

/** Premiere component keys are SOURCE ticks, not sequence or clip-relative time.
 * Keep inspected ticks as integers: seconds -> ticks -> seconds loses a tick on
 * real 29.97fps clips. This mapping is proved by native exports at nonzero in/start. */
export function effectTime(clip: ClipTime, request: { timeSeconds?: number; timeTicks?: string },proof?:NativeEffectTimeProof): { sequenceTicks: string; nativeTicks: string } {
  assertMapping(clip,proof);
  if ((request.timeTicks === undefined) === (request.timeSeconds === undefined)) throw Error("Supply exactly one sequence timeSeconds or timeTicks");
  if (request.timeSeconds !== undefined && (!Number.isFinite(request.timeSeconds) || request.timeSeconds < 0)) throw Error("Invalid sequence time");
  if (request.timeTicks !== undefined && !/^\d+$/.test(request.timeTicks)) throw Error("Invalid sequence ticks");
  const ticks = request.timeTicks === undefined ? BigInt(Math.round(request.timeSeconds! * EFFECT_TICKS_PER_SECOND)) : BigInt(request.timeTicks);
  if (ticks < BigInt(clip.start.ticks) || ticks >= BigInt(clip.end.ticks)) throw Error("KEYFRAME_OUTSIDE_CLIP: use exact sequence timeTicks from inspection; start is inclusive, end is exclusive [start,end). Decimal boundary snapping is not enabled. Put the last key before end (for example end minus one frame). keyframeDetails.clipTime/time are native source time; compare sequenceTime");
  if(validSdkProof(clip,proof)){
    const exact=proof!.samples.find(s=>s.sequenceTicks===String(ticks));
    if(!exact)throw Error('EFFECT_TIME_MAPPING_UNSUPPORTED: no SDK sample for this exact requested tick');
    return {sequenceTicks:String(ticks),nativeTicks:exact.nativeTicks};
  }
  return { sequenceTicks: String(ticks), nativeTicks: String(ticks - BigInt(clip.start.ticks) + BigInt(clip.inPoint.ticks)) };
}

export function nativeToSequenceTime(clip: ClipTime, nativeTicks: string,proof?:NativeEffectTimeProof): { ticks: string; seconds: number } | null {
  if(validSdkProof(clip,proof)){
    const matches=proof.samples.filter(s=>s.nativeTicks===nativeTicks);
    // A hold or repeated branch can map several sequence positions to one key.
    // Never choose an arbitrary occurrence or extrapolate a non-linear map.
    if(new Set(matches.map(s=>s.sequenceTicks)).size!==1||matches.some(s=>s.rate===0))return null;
    const exact=matches[0];
    if(!exact)return null;
    const ticks=BigInt(exact.sequenceTicks);
    return {ticks:String(ticks),seconds:Number(ticks)/EFFECT_TICKS_PER_SECOND};
  }
  if (clip.mediaType==='video'||proof!==undefined||clip.speed !== 1 || clip.reversed !== false) return null;
  const ticks = BigInt(nativeTicks) + BigInt(clip.start.ticks) - BigInt(clip.inPoint.ticks);
  return { ticks: String(ticks), seconds: Number(ticks) / EFFECT_TICKS_PER_SECOND };
}
