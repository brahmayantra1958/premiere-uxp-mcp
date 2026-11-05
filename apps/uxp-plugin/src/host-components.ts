import { text, asTickTime, type AnyRecord } from "./host-foundation.js";
import { ppro, activeSequence } from "./host-context.js";
import { trackItems, type ItemEntry } from "./host-items.js";
import { decodeNativeColor,snapshotHostValue, snapshotKeyframeValue } from "./host-value.js";
import { boundedRead } from "./bounded-read.js";
import { readNativeObject } from "./native-object-read.js";
import { describeEffectParameter } from "./effect-parameter-contract.js";
import { isTransientHostObjectInvalidation } from "./component-write.js";
import {observeHostAwait,observeHostSync,type HostCommandProgress} from './host-command-progress.js';

let componentReadTail: Promise<void> = Promise.resolve();
export type ComponentReadProjection = { componentIndex: number; paramIndex?: number };
/** A completed read found an incomplete/replaced graph. This is never a value
 * default and never authorizes replaying a write or abandoning a pending read. */
export class GraphicObjectUnavailableError extends Error {
  readonly code = "GRAPHIC_OBJECT_NOT_READY";
  constructor(reason: string) { super(`GRAPHIC_OBJECT_NOT_READY: ${reason}`); this.name = "GraphicObjectUnavailableError"; }
}
export function isGraphicObjectUnavailable(error: unknown): error is GraphicObjectUnavailableError {
  return error instanceof GraphicObjectUnavailableError;
}
function requireNativeObject<T>(value: T, reason: string): NonNullable<T> {
  if (value == null) throw new GraphicObjectUnavailableError(reason);
  return value;
}
function mustPropagateReadError(error: unknown): boolean {
  return isTransientHostObjectInvalidation(error) || isGraphicObjectUnavailable(error);
}
/** Hold one component-chain owner until all its value reads settle. This applies
 * even to older callers that request several snapshots with Promise.all. A
 * rejected snapshot releases the lane, but cannot leave leaf reads in flight. */
export function componentSnapshot(item: any, strict = false, _parallel = false, sampleTime?: any, projection?: ComponentReadProjection, progress?:HostCommandProgress, reacquireItem?:()=>Promise<any>): Promise<AnyRecord[]> {
  void _parallel;
  const plainSampleTime = reacquireItem ? asTickTime(sampleTime ?? ppro.TickTime.TIME_ZERO) : undefined;
  const result = componentReadTail.then(async () => {
    // Resolve the exact target inside the owner lane and again for every retry.
    // A caller's old item wrapper must never be the graphic-route fallback.
    const read=()=>readComponentSnapshot(item,strict,plainSampleTime??sampleTime??ppro.TickTime.TIME_ZERO,projection,progress,reacquireItem);
    try{return await read();}catch(error){
      // Native UI reconstruction invalidates component proxies. Reacquire the
      // whole read-only chain once after its read window drains; never replay an
      // edit, use cached values, or retry an unrelated readback error.
      if(!isTransientHostObjectInvalidation(error))throw error;
      return read();
    }
  });
  componentReadTail = result.then(() => {}, () => {});
  return result;
}

async function readComponentSnapshot(item: any, strict: boolean, sampleTime: any, projection?: ComponentReadProjection,progress?:HostCommandProgress,reacquireItem?:()=>Promise<any>): Promise<AnyRecord[]> {
  const acquireChain = async () => {
    const current = requireNativeObject(reacquireItem ? await reacquireItem() : item, "track item unavailable");
    return requireNativeObject(await readNativeObject(async () => observeHostAwait(progress,'getComponentChain',()=>current.getComponentChain())), "component chain unavailable");
  };
  const chain = await acquireChain();
  const components: AnyRecord[] = [];
  const componentCount = Number(observeHostSync(progress,'getComponentCount',()=>chain.getComponentCount()));
  if(reacquireItem&&(!Number.isInteger(componentCount)||componentCount<0))throw new GraphicObjectUnavailableError("component count unreadable");
  if(projection && (!Number.isInteger(projection.componentIndex)||projection.componentIndex<0||projection.componentIndex>=componentCount))throw Error("COMPONENT_PROJECTION_OUT_OF_RANGE");
  for (let index = 0; index < componentCount; index += 1) {
    if(projection && index!==projection.componentIndex)continue;
    // Only the legacy route retains its original proxies. The graphic route
    // carries plain indices/counts/names across awaits and rebinds each leaf.
    const bindComponent = async (expectedCount?: number) => {
      const currentChain = reacquireItem ? await acquireChain() : chain;
      if(reacquireItem&&Number(observeHostSync(progress,'getComponentCount',()=>currentChain.getComponentCount()))!==componentCount)throw new GraphicObjectUnavailableError("component count changed");
      const current = requireNativeObject(observeHostSync(progress,'getComponentAtIndex',()=>currentChain.getComponentAtIndex(index),{componentIndex:index}),`component ${index} unavailable`);
      if(expectedCount!==undefined&&Number(observeHostSync(progress,'getParamCount',()=>current.getParamCount?.()??0,{componentIndex:index}))!==expectedCount)throw new GraphicObjectUnavailableError(`component ${index} parameter count changed`);
      return current;
    };
    const component = reacquireItem ? await bindComponent() : requireNativeObject(observeHostSync(progress,'getComponentAtIndex',()=>chain.getComponentAtIndex(index),{componentIndex:index}),`component ${index} unavailable`);
    const count = Number(observeHostSync(progress,'getParamCount',()=>component.getParamCount?.() ?? 0,{componentIndex:index}));
    if(reacquireItem&&(!Number.isInteger(count)||count<0))throw new GraphicObjectUnavailableError(`component ${index} parameter count unreadable`);
    if(projection?.paramIndex!==undefined&&(!Number.isInteger(projection.paramIndex)||projection.paramIndex<0||projection.paramIndex>=count))throw Error("PARAMETER_PROJECTION_OUT_OF_RANGE");
    const readNames = async () => {
      const displayComponent = reacquireItem ? await bindComponent(count) : component;
      const displayName = text(await observeHostAwait(progress,'getDisplayName',()=>displayComponent.getDisplayName(),{componentIndex:index}));
      const matchComponent = reacquireItem ? await bindComponent(count) : component;
      const matchName = text(await observeHostAwait(progress,'getMatchName',()=>matchComponent.getMatchName(),{componentIndex:index}));
      return [displayName, matchName] as const;
    };
    // Component names are themselves asynchronous APIs. Read them on separate
    // fresh bindings before/after the parameter pass, not on a wrapper retained
    // across the name promise. This detects drift, not atomic native lifetime.
    const namesBefore = reacquireItem ? await readNames() : undefined;
    const readParam = async (paramIndex: number): Promise<AnyRecord> => {
      const indices={componentIndex:index,paramIndex};
      const param = reacquireItem ? undefined : requireNativeObject(observeHostSync(progress,'getParam',()=>component.getParam(paramIndex),indices),`parameter ${index}:${paramIndex} unavailable`);
      let parameterName: string | undefined;
      const withParam = async <T>(read: (current: any)=>T|PromiseLike<T>): Promise<T> => {
        if(!reacquireItem)return read(param);
        const currentComponent = await bindComponent(count);
        const current = requireNativeObject(observeHostSync(progress,'getParam',()=>currentComponent.getParam(paramIndex),indices),`parameter ${index}:${paramIndex} unavailable`);
        const name = text(observeHostSync(progress,'displayName',()=>current.displayName,indices));
        if(parameterName!==undefined&&name!==parameterName)throw new GraphicObjectUnavailableError(`parameter ${index}:${paramIndex} name changed`);
        parameterName=name;
        return read(current);
      };
      const nativeSampleTime=()=>reacquireItem?ppro.TickTime.createWithTicks(sampleTime.ticks):sampleTime;
      let value: unknown;
      let opaqueValue = false;
      let nativeValueType:string|null=null,unsupportedSample=false;
      const readErrors: string[] = [];
      // A plain-looking result does not establish that Adobe's promise resolver
      // is independent of ScriptObject ownership. The 2026-09-17 heap-corruption
      // dump names ProcessPromise despite outer command/item serialization.
      // Complete each native parameter (including synchronous wrapper access)
      // before acquiring the next; copy values immediately and retain all proof.
      let valueReadMethod = "getValueAtTime";
      try {
        try { value = await withParam(async current=>snapshotHostValue(await observeHostAwait(progress,'getValueAtTime',()=>current.getValueAtTime(nativeSampleTime()),indices))); }
        catch(error) {
          if (!/not supported for these value types/i.test(String(error))) throw error;
          // Adobe's Color value error explicitly points to keyframe access.
          // An evaluated keyframe is preferred; a start value is valid ONLY
          // after both static mode and an empty readable key list are proved.
          const startValue=await withParam(current=>readNativeObject(async()=>snapshotKeyframeValue(await observeHostAwait(progress,'getStartValue',()=>current.getStartValue(),indices))));
          if(startValue && typeof startValue==="object" && ["red","green","blue","alpha"].every(k=>typeof (startValue as AnyRecord)[k]==="number"))nativeValueType="color";
          try { value=await withParam(current=>snapshotKeyframeValue(observeHostSync(progress,'getKeyframePtr',()=>current.getKeyframePtr(nativeSampleTime()),indices))); if(value==null) throw Error("No evaluated keyframe value"); if(nativeValueType==="color")value=decodeNativeColor(value);valueReadMethod="getKeyframePtr_exact"; }
          catch (keyError) {
            if(mustPropagateReadError(keyError))throw keyError;
            if(await withParam(current=>Boolean(observeHostSync(progress,'isTimeVarying',()=>current.isTimeVarying(),indices) || observeHostSync(progress,'getKeyframeListAsTickTimes',()=>current.getKeyframeListAsTickTimes(),indices).length))) {
              if(nativeValueType!=="color")throw error;
              unsupportedSample=true;valueReadMethod="native_color_exact_keys_only";
              readErrors.push("NATIVE_COLOR_SAMPLE_UNSUPPORTED: key values are available; Premiere does not evaluate Color between exact key ticks");
            } else {
              value=startValue; valueReadMethod="getStartValue_verified_static";
              if(value==null) { opaqueValue=true; readErrors.push("NATIVE_OPAQUE_VALUE: Premiere exposes no scalar/Point/Color value for this control"); }
            }
          }
        }
      } catch (error) { if (strict||mustPropagateReadError(error)) throw error; readErrors.push(`value: ${String(error)}`); }
      if (strict && value == null && !opaqueValue && !unsupportedSample) throw Error(`Component value is unreadable: ${index}:${paramIndex}`);
      let timeVarying: boolean | null = null, supportsKeyframes: boolean | null = null;
      let freshKeyframeList: { times: AnyRecord[] } | { error: unknown } | undefined;
      const readKeyframeTimes = (current: any) => {
        if (typeof current.getKeyframeListAsTickTimes !== "function") throw Error("Keyframe list API unavailable");
        const times=observeHostSync(progress,'getKeyframeListAsTickTimes',()=>current.getKeyframeListAsTickTimes(),indices);
        return reacquireItem ? times.map(asTickTime) : times;
      };
      if(reacquireItem){
        await withParam(async current=>{
          // These two APIs are synchronous. Copy their values (including every
          // native TickTime field) on this binding before the support promise;
          // neither current nor its keyframe-list wrappers may be used afterward.
          try { timeVarying=Boolean(observeHostSync(progress,'isTimeVarying',()=>current.isTimeVarying(),indices)); } catch(error) { if(strict||mustPropagateReadError(error))throw error; readErrors.push(`animation state: ${String(error)}`); }
          try { freshKeyframeList={times:readKeyframeTimes(current)}; } catch(error) { if(mustPropagateReadError(error))throw error; freshKeyframeList={error}; }
          try { supportsKeyframes=Boolean(await observeHostAwait(progress,'areKeyframesSupported',()=>current.areKeyframesSupported(),indices)); } catch(error) { if(mustPropagateReadError(error))throw error; /* metadata remains unknown; never infer unsupported */ }
        });
      }else{
        try { timeVarying = await withParam(current=>Boolean(observeHostSync(progress,'isTimeVarying',()=>current.isTimeVarying(),indices))); } catch (error) { if (strict||mustPropagateReadError(error)) throw error; readErrors.push(`animation state: ${String(error)}`); }
        try { supportsKeyframes = await withParam(async current=>Boolean(await observeHostAwait(progress,'areKeyframesSupported',()=>current.areKeyframesSupported(),indices))); } catch { /* metadata remains unknown; never infer unsupported */ }
      }
      let keyframes: AnyRecord[] = [];
      const keyframeDetails: AnyRecord[] = [];
      let animationRead = "pass";
      try {
        if(freshKeyframeList&&'error' in freshKeyframeList)throw freshKeyframeList.error;
        const keyframeTimes = freshKeyframeList ? freshKeyframeList.times : await withParam(readKeyframeTimes);
        keyframes = keyframeTimes.map(asTickTime);
        let keyframeIndex=-1;
        for (const keyframeTime of keyframeTimes) {
          keyframeIndex++;
          try {
            const detail=await withParam(async current=>{
              const time=reacquireItem?ppro.TickTime.createWithTicks(keyframeTime.ticks):keyframeTime;
              const keyframe = requireNativeObject(observeHostSync(progress,'getKeyframePtr',()=>current.getKeyframePtr(time),{...indices,keyframeIndex}),`keyframe ${index}:${paramIndex}:${keyframeIndex} unavailable`);
              const keyValue=nativeValueType==="color" ? decodeNativeColor(snapshotKeyframeValue(keyframe)) : snapshotKeyframeValue(keyframe);
              const plainTime=asTickTime(time);
              if(typeof keyframe.getTemporalInterpolationMode!=="function"&&keyValue&&typeof keyValue==="object"&&('x' in keyValue||Array.isArray(keyValue)&&keyValue.length===2))return {time:plainTime,value:keyValue,mode:null};
              const mode = Number(await observeHostAwait(progress,'getTemporalInterpolationMode',()=>keyframe.getTemporalInterpolationMode(),{...indices,keyframeIndex}));
              return {time:plainTime,value:keyValue,mode};
            });
            if(detail.mode===null){
              animationRead="unverified";readErrors.push("POINT_INTERPOLATION_REQUIRES_SAVED_NATIVE_READBACK");
              keyframeDetails.push({time:detail.time,value:detail.value,interpolationMode:null,interpolation:"unknown"});continue;
            }
            if(detail.value==null || !Number.isFinite(detail.mode))throw Error("Native keyframe value/interpolation is unreadable");
            keyframeDetails.push({
              time: detail.time,
              value: detail.value,
              interpolationMode: detail.mode,
              interpolation: interpolationName(detail.mode),
            });
          } catch (error) { if (strict||mustPropagateReadError(error)) throw error; animationRead = "unverified"; readErrors.push(`keyframe: ${String(error)}`); }
        }
      } catch (error) { if (strict||mustPropagateReadError(error)) throw error; animationRead = "unverified"; readErrors.push(`keyframe list: ${String(error)}`); }
      if (timeVarying === null || keyframes.length !== keyframeDetails.length) animationRead = "unverified";
      if (strict && animationRead !== "pass") throw Error(`Incomplete keyframe readback: ${index}:${paramIndex}`);
      const valueKind = opaqueValue ? "opaque" : unsupportedSample ? "color" : value == null ? "unreadable" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : typeof value;
      return { paramIndex, displayName: reacquireItem ? parameterName : text(observeHostSync(progress,'displayName',()=>param.displayName,indices)), value, valueKind, nativeValueType,valueReadMethod, keyframes, keyframeDetails, timeVarying, supportsKeyframes,
        sampledAt: asTickTime(sampleTime), sampleTimeBasis: "native_component",
        readStatus: { value: opaqueValue || unsupportedSample ? "unsupported" : value == null ? "unverified" : "pass", animation: animationRead }, readErrors };
    };
    // No overlapping native leaves or name getters. The legacy parallel flag
    // remains call-compatible but cannot opt out of this host safety boundary.
    const indices=projection?.paramIndex===undefined?Array.from({length:count},(_,i)=>i):[projection.paramIndex];
    const params = await boundedRead(indices, readParam, 1);
    const names = await readNames();
    if(namesBefore&&(namesBefore[0]!==names[0]||namesBefore[1]!==names[1]))throw new GraphicObjectUnavailableError(`component ${index} identity changed`);
    components.push({ componentIndex: index, displayName: names[0], matchName: names[1], params: params.map((param: AnyRecord) => ({ ...param, descriptor: describeEffectParameter(names[1], param) })),
      readbackCoverage: { opaqueParameterIndices: params.filter((p: AnyRecord)=>p.valueKind==="opaque").map((p:AnyRecord)=>p.paramIndex),
        unverifiedParameterIndices:params.filter((p:AnyRecord)=>p.readStatus.value==="unverified" || p.readStatus.animation!=="pass").map((p:AnyRecord)=>p.paramIndex) } });
  }
  return components;
}

export async function inspectEffectCatalog(): Promise<AnyRecord> {
  const [videoMatchNames, videoDisplayNames, audioDisplayNames, videoTransitionMatchNames] = await Promise.all([
    ppro.VideoFilterFactory.getMatchNames(), ppro.VideoFilterFactory.getDisplayNames(), ppro.AudioFilterFactory.getDisplayNames(), ppro.TransitionFactory.getVideoTransitionMatchNames(),
  ]);
  return {
    videoEffects: videoMatchNames.map((matchName: string, index: number) => ({ matchName, displayName: text(videoDisplayNames[index]) })),
    audioEffects: audioDisplayNames.map((displayName: string) => ({ displayName })),
    videoTransitions: videoTransitionMatchNames.map((matchName: string) => ({ matchName })),
  };
}

export async function inspectEffects(entries?: ItemEntry[]): Promise<AnyRecord[]> {
  const items = entries ?? await trackItems(await activeSequence());
  return Promise.all(items.map(async (item) => ({ trackItemId: item.snapshot.id, name: item.snapshot.name, mediaType: item.snapshot.mediaType, components: await componentSnapshot(item.raw) })));
}

export function interpolationName(mode: number): "linear" | "hold" | "bezier" | "unknown" {
  if (mode === Number(ppro.Keyframe.INTERPOLATION_MODE_LINEAR)) return "linear";
  if (mode === Number(ppro.Keyframe.INTERPOLATION_MODE_HOLD)) return "hold";
  if (mode === Number(ppro.Keyframe.INTERPOLATION_MODE_BEZIER)) return "bezier";
  return "unknown";
}
