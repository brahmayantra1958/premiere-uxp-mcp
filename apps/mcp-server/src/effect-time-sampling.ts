export type ExactTimeSample={sequenceTicks:string;nativeTicks:string;rate:number;evidence:Record<string,unknown>};
type TimeRequest={startTicks:string;endTicks:string;speed:number;reversed:boolean;requested:string[];keys:string[]};

/** An inverse candidate is a proposal, never a time proof. Native equality is
 * mandatory even when the instantaneous derivative predicts an exact answer. */
export function inverseTimeCandidate(target:bigint,at:ExactTimeSample,start:bigint,end:bigint):bigint|null {
 if(!Number.isFinite(at.rate)||Math.abs(at.rate)<1e-12)return null;
 const delta=Math.round(Number(target-BigInt(at.nativeTicks))/at.rate);
 if(!Number.isSafeInteger(delta))return null;
 const guess=BigInt(at.sequenceTicks)+BigInt(delta);
 return guess<start?start:guess>=end?end-1n:guess;
}

/** Effect boundary: the caller owns authenticated SDK reads, graph identity and
 * time budget. Non-linear/hold/reverse mappings use actual samples; no formula
 * synthesizes a native edit tick. Inversion reports observed aliases explicitly. */
export async function sampleExactEffectTimes(request:TimeRequest,read:(ticks:string)=>Promise<ExactTimeSample>) {
 const start=BigInt(request.startTicks),end=BigInt(request.endTicks);
 if(start>=end)throw Error('SDK_TIME_RANGE_INVALID');
 const cache=new Map<string,ExactTimeSample>();
 const sample=async(tick:bigint)=>{
  if(tick<start||tick>=end)throw Error('SDK_TIME_OUTSIDE_CLIP');
  const key=String(tick),old=cache.get(key);if(old)return old;
  if(cache.size>=192)throw Error('SDK_TIME_SAMPLE_LIMIT');
  const value=await read(key);if(value.sequenceTicks!==key||!/^\d+$/.test(value.nativeTicks)||!Number.isFinite(value.rate))throw Error('SDK_TIME_SAMPLE_INVALID');
  cache.set(key,value);return value;
 };
 const origin=await sample(start);
 for(const tick of request.requested)await sample(BigInt(tick));
 // Extra boundary reads are inversion seeds, not necessary for a directly
 // requested source-time sample. Avoid three needless callbacks on keyless
 // reads at clip start; every published time still comes from the SDK.
 if(request.keys.some(key=>![...cache.values()].some(s=>s.nativeTicks===key))){await sample((start+end)/2n);await sample(end-1n);}
 const inverses=[];
 for(const key of [...new Set(request.keys)]){
  const target=BigInt(key);
  if(![...cache.values()].some(s=>s.nativeTicks===key)){
   // Premiere can report a zero derivative at the last subframe of a retimed
   // clip, even when an interior inverse exists. A nearby held/end sample is
   // not a usable Newton seed. Prefer the nearest invertible native witness.
   const candidates=[...cache.values()].filter(s=>inverseTimeCandidate(target,s,start,end)!==null);
   let current=candidates.length?candidates.reduce((a,b)=>Math.abs(Number(BigInt(a.nativeTicks)-target))<=Math.abs(Number(BigInt(b.nativeTicks)-target))?a:b):undefined;
   const visited=new Set<string>();
   for(let iteration=0;current&&iteration<12;iteration++){
    const next=inverseTimeCandidate(target,current,start,end);if(next===null||visited.has(String(next)))break;
    visited.add(String(next));current=await sample(next);
    if(current.nativeTicks===key)break;
    // Quantization near a root may skip an integer tick in the derivative step.
    if(BigInt(current.nativeTicks)-target<4n&&target-BigInt(current.nativeTicks)<4n){
     for(const delta of [-1n,1n,-2n,2n]){if(next+delta>=start&&next+delta<end){const neighbour=await sample(next+delta);if(neighbour.nativeTicks===key){current=neighbour;break;}}}
     if(current.nativeTicks===key)break;
    }
   }
  }
  const observed=[...cache.values()].filter(s=>s.nativeTicks===key).map(s=>s.sequenceTicks);
  inverses.push({nativeTicks:key,status:observed.length?'pass':'unverified',sequenceTicks:observed,coverage:'observed_occurrences_only',reason:observed.length>1?'multiple_sequence_positions':observed.length?'exact_sdk_equality':'no_exact_inverse_observed'});
 }
 return {originTicks:origin.nativeTicks,samples:[...cache.values()],inverses,exactOnly:true as const,coverage:'requested_ticks_only' as const};
}
