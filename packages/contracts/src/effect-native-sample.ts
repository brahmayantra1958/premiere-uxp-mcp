import {effectChainProofScopeMatches,type EffectChainProofWork} from './effect-chain-proof.js';

/** Evaluated Color and exact reverse-time reads. Media paths are identity evidence, never file I/O
 * targets. Native handles, menu IDs, scripts and writable values are absent. */
export type EffectNativeSampleWork=EffectChainProofWork & {
  mediaPath:string;inTicks:string;outTicks:string;sequenceTicks:string;nativeTicks:string;
  componentIndex:number;componentMatchName:string;paramIndex:number;parameterCount:number;
  references?:Array<{sequenceTicks:string;nativeTicks:string;value:{red:number;green:number;blue:number;alpha:number}}>|undefined;
  purpose?:'time_mapping'|undefined;
  reversed?:boolean|undefined;
  speed?:number|undefined;
  originTicks?:string|undefined;
  sampleTimes?:string[]|undefined;
  keyNativeTimes?:string[]|undefined;
  exactMapping?:true|undefined;
};

export type NativeEffectTimeProof={status:'pass';startTicks:string;endTicks:string;inTicks:string;outTicks:string;speed:number;reversed:boolean;originTicks:string;exactOnly?:true;samples:Array<{sequenceTicks:string;nativeTicks:string;rate?:number}>};

export function requestedEffectTimes(command:string,args:Record<string,any>,startTicks:string):string[] {
  const requests=command==='set_effect_keyframes'?args.keyframes:command==='edit_effect_keyframes'?args.operations:command==='get_effect_values'?[{timeSeconds:args.timeSeconds,timeTicks:args.timeSeconds===undefined?startTicks:undefined}]:[];
  if(!Array.isArray(requests))return [];
  return [...new Set(requests.map((r:any)=>r.timeTicks!==undefined?String(r.timeTicks):String(Math.round(r.timeSeconds*254016000000))))];
}

export function effectNativeSampleScopeMatches(command:string,args:Record<string,any>,work:EffectNativeSampleWork):boolean {
  if(args.detail==='chain'||!effectChainProofScopeMatches(command,args,work))return false;
  if(work.mediaType!=='video'||work.componentIndex!==args.componentIndex||args.componentMatchName!==undefined&&work.componentMatchName!==args.componentMatchName)return false;
  if(work.purpose==='time_mapping')return ['get_effect_values','set_effect_keyframes','edit_effect_keyframes'].includes(command)
    &&work.sequenceTicks===work.startTicks&&work.nativeTicks==='0'&&typeof work.reversed==='boolean'
    &&(command==='get_effect_values'||work.keyNativeTimes===undefined)
    &&JSON.stringify(work.sampleTimes)===JSON.stringify(requestedEffectTimes(command,args,work.startTicks));
  if(command!=='get_effect_values')return false;
  if(args.detail==='parameter'&&(work.paramIndex!==args.paramIndex||work.components[0]?.parameterNames[work.paramIndex]!==args.expectedDisplayName))return false;
  const ticks=BigInt(work.sequenceTicks),start=BigInt(work.startTicks),end=BigInt(work.endTicks);
  return ticks>=start&&ticks<end&&(work.exactMapping||((work.speed??1)!==1?work.originTicks!==undefined:BigInt(work.nativeTicks)===(work.reversed?BigInt(work.originTicks!)-(ticks-start):ticks-start+BigInt(work.inTicks))))
    &&(args.timeSeconds===undefined?ticks===start:Math.abs(Number(ticks)/254016000000-args.timeSeconds)<1e-10);
}

/** SDK Int64 keeps all bits in decimal text (JS Number would lose alpha bits).
 * This is Adobe's packed 16-bit ARGB representation, not a computed sample. */
export function decodeSdkColor(packed:string):{red:number;green:number;blue:number;alpha:number} {
  if(!/^-?\d{1,20}$/.test(packed))throw Error('SDK_COLOR_INVALID_INT64');
  const signed=BigInt(packed);
  if(signed<-(1n<<63n)||signed>(1n<<63n)-1n)throw Error('SDK_COLOR_INVALID_INT64');
  const bits=BigInt.asUintN(64,signed);
  return {red:Number((bits>>32n)&65535n)/65280,green:Number((bits>>16n)&65535n)/65280,blue:Number(bits&65535n)/65280,alpha:Number((bits>>48n)&65535n)/65280};
}
