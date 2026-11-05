export type RippleBoundary={atTicks:string;frames:number};
export type RippleItem={id:string;mediaType:'video'|'audio'|'caption';trackIndex:number;startTicks:string;endTicks:string};

export function normalizeRippleBoundaries(frameTicks:string,boundaries:readonly {atSeconds:number;frames:number}[]):RippleBoundary[] {
  const frame=Number(frameTicks);
  if(!Number.isSafeInteger(frame)||frame<=0)throw Error('RIPPLE_TIMEBASE_INVALID');
  return boundaries.map(b=>{
    const frameIndex=Math.round(b.atSeconds*254016000000/frame);
    if(!Number.isSafeInteger(frameIndex)||frameIndex<0||Math.abs(frameIndex*frame/254016000000-b.atSeconds)>0.000001)throw Error('RIPPLE_BOUNDARY_NOT_FRAME_ALIGNED');
    return {atTicks:String(BigInt(frameIndex)*BigInt(frameTicks)),frames:b.frames};
  });
}

/** Positive gap insertion in the original coordinate system. AV crossings
 * are partitioned without dropping source; caption crossings retain one cue
 * and extend its end. Execute boundaries descending to avoid shifting anchors. */
export function planRippleGaps(frameTicks:string,boundaries:readonly RippleBoundary[],items:readonly RippleItem[]) {
  const frame=BigInt(frameTicks);
  if(frame<=0n||!boundaries.length||boundaries.length>32)throw Error('RIPPLE_BOUNDARIES_INVALID');
  const cuts=boundaries.map(b=>{
    const at=BigInt(b.atTicks);
    if(at<0n||at%frame!==0n||!Number.isSafeInteger(b.frames)||b.frames<=0||b.frames>3000)throw Error('RIPPLE_BOUNDARY_NOT_FRAME_ALIGNED');
    return {at,delta:frame*BigInt(b.frames),frames:b.frames};
  }).sort((a,b)=>a.at<b.at?-1:1);
  if(cuts.some((c,i)=>i>0&&cuts[i-1]!.at===c.at))throw Error('RIPPLE_BOUNDARY_DUPLICATE');
  if(new Set(items.map(i=>i.id)).size!==items.length)throw Error('RIPPLE_ITEM_DUPLICATE');
  const shift=(time:bigint,inclusive:boolean)=>cuts.reduce((sum,c)=>sum+((inclusive?c.at<=time:c.at<time)?c.delta:0n),0n);
  const changes=items.flatMap(item=>{
    const snap=(ticks:string)=>{const value=BigInt(ticks);return cuts.find(c=>{const d=c.at-value;return (d<0n?-d:d)<=254016n;})?.at??value;};
    const start=snap(item.startTicks),end=snap(item.endTicks);
    if(start<0n||end<=start)throw Error('RIPPLE_ITEM_BOUNDS_INVALID');
    const inside=cuts.filter(c=>c.at>start&&c.at<end);
    if(!shift(start,true)&&!inside.length)return [];
    const edges=item.mediaType==='caption'?[start,end]:[start,...inside.map(c=>c.at),end];
    const pieces=edges.slice(0,-1).map((left,index)=>{
      const right=edges[index+1]!;
      return {originalStartTicks:String(left),originalEndTicks:String(right),startTicks:String(left+shift(left,true)),endTicks:String(right+shift(right,false))};
    });
    return [{...item,splitAtTicks:item.mediaType==='caption'?[]:inside.map(c=>String(c.at)),pieces}];
  });
  return {frameTicks,boundariesDescending:[...cuts].reverse().map(c=>({atTicks:String(c.at),frames:c.frames,deltaTicks:String(c.delta)})),
    totalAddedFrames:cuts.reduce((n,c)=>n+c.frames,0),totalAddedTicks:String(cuts.reduce((n,c)=>n+c.delta,0n)),changes,
    captionCrossingPolicy:'extend_existing_cue_preserving_text_and_style' as const};
}
