import {verifyParameterPreservation} from './effect-parameter-contract.js';
type Snapshot=Record<string,any>[];
/** Defaults retain full public state checks at every UI boundary. A caller may
 * supply fresh target/topology checks instead, making content preservation a
 * whole-UI-operation proof. Its finish must still run after UI work, including
 * dispatched partial/error paths, or preservation remains unverified.
 * Final public/native values, keys and Point modes/tangents are never omitted. */
export function effectVisibilityPreservation(rawBefore:Snapshot,nativeBefore:Snapshot,discardable:Array<{componentIndex:number;paramIndex:number}>,readRaw:()=>Promise<Snapshot>,proveNative:(raw:Snapshot)=>Promise<Snapshot>,readBoundary?:()=>Promise<void>){
  const assertEqual=(before:Snapshot,after:Snapshot)=>{
    if(verifyParameterPreservation(before,after,discardable).length)throw Error('EFFECT_DISCLOSURE_CONTEXT_CHANGED: Effect content changed during UI work');
  };
  const check=async()=>{const raw=await readRaw();assertEqual(rawBefore,raw);return raw;};
  return {check:readBoundary??(async()=>{await check();}),finish:async()=>{const raw=await check();assertEqual(nativeBefore,await proveNative(raw));}};
}
