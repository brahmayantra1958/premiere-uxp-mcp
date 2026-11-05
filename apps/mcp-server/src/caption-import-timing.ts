export type CaptionCueTiming={startTicks:string;endTicks:string};
export type ExpectedCaptionTimingPlan={frameTicks:string;cues:CaptionCueTiming[]};
export type CaptionImportTimingPlan={
  policy:'nearest_frame_half_up'|'explicit_expected_tick_plan';
  frameTicks:string;
  sourceCues:CaptionCueTiming[];
  expectedCues:CaptionCueTiming[];
};

function ticks(value:unknown,label:string):bigint {
  // Thirty decimal digits comfortably exceed any supported Premiere timeline
  // while bounding BigInt work and native/error response fields.
  if(typeof value!=='string'||value.length>30||!/^(0|[1-9]\d*)$/.test(value))throw Error(`CAPTION_TIMING_TICKS_INVALID:${label}`);
  return BigInt(value);
}
export function captionFrameTicks(value:unknown):string {
  const frame=ticks(value,'frameTicks');
  if(frame<=0n)throw Error('CAPTION_TIMING_FRAME_TICKS_INVALID');
  return frame.toString();
}
function interval(cue:CaptionCueTiming,index:number,label:string):CaptionCueTiming {
  const start=ticks(cue?.startTicks,`${label}:${index}:start`),end=ticks(cue?.endTicks,`${label}:${index}:end`);
  if(end<=start)throw Error(`CAPTION_TIMING_DURATION_INVALID:${label}:${index}`);
  return {startTicks:start.toString(),endTicks:end.toString()};
}

/** This is the tool's declared expectation, not a claim about Adobe's SRT
 * quantization. Non-negative ticks round to the nearest sequence frame; exact
 * half-frame ties go to the later frame. No floating-point fps or compensation.
 * Explicit plans only replace the expected result; source bytes never change.
 * Adobe's own SRT quantization differs by frame rate (observed: 23.976 one frame
 * early, 30 truncated, 29.97 another pattern), so verification classifies an
 * on-grid difference of at most one frame from this default plan separately. */
export function planCaptionImportTiming(source:readonly CaptionCueTiming[],frameTicks:string,explicit?:ExpectedCaptionTimingPlan):CaptionImportTimingPlan {
  const frame=BigInt(captionFrameTicks(frameTicks));
  if(!Array.isArray(source)||!source.length||source.length>10000)throw Error('CAPTION_TIMING_SOURCE_COUNT_INVALID');
  const sourceCues=source.map((cue,index)=>interval(cue,index,'source'));
  if(explicit){
    if(captionFrameTicks(explicit.frameTicks)!==frameTicks)throw Error('CAPTION_EXPECTED_TIMING_FRAME_MISMATCH');
    if(!Array.isArray(explicit.cues)||explicit.cues.length!==sourceCues.length)throw Error('CAPTION_EXPECTED_TIMING_COUNT_MISMATCH');
  }
  const round=(value:string)=>((2n*BigInt(value)+frame)/(2n*frame)*frame).toString();
  const expectedCues=explicit?explicit.cues.map((cue,index)=>interval(cue,index,'expected')):
    sourceCues.map((cue,index)=>interval({startTicks:round(cue.startTicks),endTicks:round(cue.endTicks)},index,'rounded'));
  if(expectedCues.some(cue=>BigInt(cue.startTicks)%frame!==0n||BigInt(cue.endTicks)%frame!==0n))throw Error('CAPTION_EXPECTED_TIMING_NOT_FRAME_ALIGNED');
  return {policy:explicit?'explicit_expected_tick_plan':'nearest_frame_half_up',frameTicks,sourceCues,expectedCues};
}

/** Exact signed rational in sequence frames. Fractional tick/grid differences
 * are preserved (e.g. "-1/1000"), never rounded to zero or allowed as tolerance. */
function frameDelta(delta:bigint,frame:bigint):string {
  let a=delta<0n?-delta:delta,b=frame;
  while(b){const remainder=a%b;a=b;b=remainder;}
  const divisor=a||frame,numerator=delta/divisor,denominator=frame/divisor;
  return denominator===1n?numerator.toString():`${numerator}/${denominator}`;
}
function observedTicks(value:unknown):string|null {
  try{return ticks(value,'actual').toString();}catch{return null;}
}
type CueTimingResult={index:number;sourceStartTicks:string|null;sourceEndTicks:string|null;expectedStartTicks:string|null;expectedEndTicks:string|null;
  actualStartTicks:string|null;actualEndTicks:string|null;startFrameDelta:string|null;endFrameDelta:string|null};
const detailLimit=250,detailJsonBytes=128*1024,deltaKindLimit=32;
/** Whole-frame, on-grid differences Adobe's SRT importer is known to produce.
 * Fractional (off-grid) deltas are never included. Explicit plans stay exact. */
const importerQuantizationDeltas=new Set(['-1','0','1']);

export function verifyCaptionImportTiming(plan:CaptionImportTimingPlan,readback:{frameTicks?:unknown;items?:unknown;status?:unknown}) {
  const frame=BigInt(plan.frameTicks),errors:string[]=[];
  let actualFrameTicks:string|null=null;
  try{actualFrameTicks=captionFrameTicks(readback.frameTicks);}catch{errors.push('CAPTION_TIMING_TIMEBASE_UNVERIFIED');}
  if(actualFrameTicks!==null&&actualFrameTicks!==plan.frameTicks)errors.push('CAPTION_TIMING_TIMEBASE_CHANGED');
  if(readback.status!=='partial'&&readback.status!=='pass')errors.push('CAPTION_TIMING_READBACK_STATUS_UNVERIFIED');
  const actual=Array.isArray(readback.items)?readback.items:[];
  if(!Array.isArray(readback.items)||actual.length>10000)errors.push('CAPTION_TIMING_ITEMS_UNVERIFIED');
  if(actual.length!==plan.expectedCues.length)errors.push('CAPTION_TIMING_COUNT_MISMATCH');
  const startFrameDeltaCounts:Record<string,number>={},endFrameDeltaCounts:Record<string,number>={};
  let matched=0,quantized=0,mismatched=0,unverified=0,offFrameGridEndpoints=0,detailBytes=0,startFrameDeltaCountsOmitted=0,endFrameDeltaCountsOmitted=0;
  const cues:CueTimingResult[]=[],mismatchIndexSample:number[]=[],unverifiedIndexSample:number[]=[],quantizedIndexSample:number[]=[];
  const importerQuantized=(delta:string|null)=>plan.policy==='nearest_frame_half_up'&&delta!==null&&importerQuantizationDeltas.has(delta);
  const checkedCueCount=Math.min(10000,Math.max(plan.expectedCues.length,actual.length));
  const countDelta=(counts:Record<string,number>,value:string)=>{
    if(value.length>96||counts[value]===undefined&&Object.keys(counts).length>=deltaKindLimit)return false;
    counts[value]=(counts[value]??0)+1;return true;
  };
  for(let index=0;index<checkedCueCount;index++){
    const source=plan.sourceCues[index],expected=plan.expectedCues[index],item=actual[index];
    const actualStartTicks=observedTicks(item?.startTicks),actualEndTicks=observedTicks(item?.endTicks);
    const valid=item?.index===index&&actualStartTicks!==null&&actualEndTicks!==null&&BigInt(actualEndTicks)>BigInt(actualStartTicks)&&Boolean(expected);
    const startFrameDelta=expected&&actualStartTicks!==null?frameDelta(BigInt(actualStartTicks)-BigInt(expected.startTicks),frame):null;
    const endFrameDelta=expected&&actualEndTicks!==null?frameDelta(BigInt(actualEndTicks)-BigInt(expected.endTicks),frame):null;
    if(startFrameDelta!==null&&!countDelta(startFrameDeltaCounts,startFrameDelta))startFrameDeltaCountsOmitted++;
    if(endFrameDelta!==null&&!countDelta(endFrameDeltaCounts,endFrameDelta))endFrameDeltaCountsOmitted++;
    if(actualStartTicks!==null&&BigInt(actualStartTicks)%frame!==0n)offFrameGridEndpoints++;
    if(actualEndTicks!==null&&BigInt(actualEndTicks)%frame!==0n)offFrameGridEndpoints++;
    if(!valid){unverified++;if(unverifiedIndexSample.length<32)unverifiedIndexSample.push(index);}
    else if(startFrameDelta==='0'&&endFrameDelta==='0')matched++;
    else if(importerQuantized(startFrameDelta)&&importerQuantized(endFrameDelta)){quantized++;if(quantizedIndexSample.length<32)quantizedIndexSample.push(index);}
    else{mismatched++;if(mismatchIndexSample.length<32)mismatchIndexSample.push(index);}
    const row={index,sourceStartTicks:source?.startTicks??null,sourceEndTicks:source?.endTicks??null,
      expectedStartTicks:expected?.startTicks??null,expectedEndTicks:expected?.endTicks??null,
      actualStartTicks,actualEndTicks,startFrameDelta,endFrameDelta};
    // Only numeric ASCII strings occur in rows, so string length is UTF-8
    // length. Verification above still runs for every cue, including omitted
    // details; do not let the 10k source limit recreate oversized MCP receipts.
    const rowBytes=JSON.stringify(row).length;
    if(cues.length<detailLimit&&detailBytes+rowBytes<=detailJsonBytes){cues.push(row);detailBytes+=rowBytes;}
  }
  if(unverified)errors.push('CAPTION_TIMING_CUE_READBACK_UNVERIFIED');
  if(mismatched)errors.push('CAPTION_TIMING_MISMATCH');
  const warnings=quantized?['CAPTION_TIMING_IMPORTER_QUANTIZED']:[];
  return {status:errors.length?'unverified' as const:'pass' as const,policy:plan.policy,verificationOnly:true,
    frameTicks:plan.frameTicks,actualFrameTicks,frameDeltaUnit:'exact signed rational sequence frames; actual minus expected',
    importerQuantization:{rule:'default plan only: every endpoint on the frame grid and at most one whole frame from the nearest-frame plan',
      appliesToExplicitPlan:false,quantizedCueCount:quantized},
    summary:{expectedCueCount:plan.expectedCues.length,actualCueCount:actual.length,checkedCueCount,matchedCueCount:matched,quantizedCueCount:quantized,mismatchedCueCount:mismatched,unverifiedCueCount:unverified,
      offFrameGridEndpoints,startFrameDeltaCounts,endFrameDeltaCounts,startFrameDeltaCountsOmitted,endFrameDeltaCountsOmitted,mismatchIndexSample,quantizedIndexSample,unverifiedIndexSample},
    details:{returnedCueCount:cues.length,totalCueCount:Math.max(plan.expectedCues.length,actual.length),limit:detailLimit,maxJsonBytes:detailJsonBytes,truncated:cues.length<Math.max(plan.expectedCues.length,actual.length)},cues,errors,warnings};
}
