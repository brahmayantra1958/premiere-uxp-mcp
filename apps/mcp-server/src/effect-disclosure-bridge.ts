import {currentRequestEditTarget} from "./active-edit-target.js";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {z} from "zod/v4";
import {deriveParameterOrdinal,parameterObservationProves,parameterVisibleProves,deriveEffectHeaderBinding,resolveEffectObservation,effectInitialRowsHeight,effectLayout,effectOccurrenceCount,effectNativeObservationProves,effectSectionProves,effectDisclosureProves,type EffectDisclosurePhase,type EffectHeaderBinding} from "@premiere-uxp/contracts/effect-disclosure";
import {runtimePaths} from "./config.js";
import {runNativeEffectAdapter} from "./native-effect-worker.js";
import {readEffectParameterSchema} from "./native-archive-readers.js";

export const effectDisclosureWorkSchema=z.object({
  expanded:z.boolean().optional(),
  schemaTarget:z.object({projectItemId:z.string().min(1).max(200),parameterNames:z.array(z.string().max(512)).max(4096)}).strict().optional(),
  parameter:z.object({paramIndex:z.number().int().min(0).max(4095),name:z.string().max(512),expanded:z.boolean(),disclosureKey:z.enum(["ECP.Slider.Expanded","ECP.Angle.Expanded","ECP.PointParameter.Expanded","ECP.Group.Expanded","ECP.Custom.Expanded"]),inlineColor:z.object({indices:z.array(z.number().int().min(0).max(4095)).min(1).max(64),timeVarying:z.boolean()}).strict().optional()}).strict().optional(),
  trackItemId:z.string().min(1).max(500).optional(),
  sequenceName:z.string().min(1).max(500),componentMatchNames:z.array(z.string().min(1).max(200)).max(64),
  target:z.object({mediaType:z.enum(["video","audio"]),trackIndex:z.number().int().min(0).max(99),startTicks:z.string().regex(/^\d{1,24}$/),endTicks:z.string().regex(/^\d{1,24}$/),clipName:z.string().min(1).max(512),mediaPath:z.string().min(1).max(4096),componentMatchName:z.string().min(1).max(200),componentIndex:z.number().int().min(0).max(63).optional(),parameterCount:z.number().int().min(0).max(4096).optional(),disclosureScope:z.enum(["component","match_name"]).optional()}).strict(),
}).strict();
export type EffectDisclosureSession={baseline?:Record<string,any>;binding?:EffectHeaderBinding|undefined;parameterBaseline?:Record<string,any>;parameterOrdinal?:number|undefined;parameterHints?:Record<string,any>};
const bindings=new Map<string,EffectHeaderBinding>();
const bindingWindows=new Map<string,number>();
const parameterBindings=new Map<string,number>();
const parameterNodeHints=new Map<string,number[]>();
/** Chain mutation can recreate native owners even when match-name arrays return
 * to the same values. Never reuse a prior lifetime's causal identity. */
export function invalidateEffectDisclosureBindings():void{bindings.clear();bindingWindows.clear();parameterBindings.clear();parameterNodeHints.clear();}
const observationHints=new Map<string,unknown>();
export async function readNativeEffectState(pid:number,tab:string,expectedHeaders?:number):Promise<Record<string,any>>{
  const key=`${pid}:${tab}:${expectedHeaders??"discovery"}`,hint=observationHints.get(key),args=[String(pid),Buffer.from(tab).toString("base64"),...(hint?[Buffer.from(JSON.stringify(hint)).toString("base64")]:[])];
  let result=await runNativeEffectAdapter("state",args,16000);
  // Reacquire only a finished, read-only tree scan invalidated by native panel
  // reconstruction. No disclosure, scroll or timed-out action is replayed.
  if(result.reason==='EFFECT_TREE_CHANGED_DURING_OBSERVATION')result=await runNativeEffectAdapter('state',args,16000);
  if(result.premierePid!==pid)return {status:"unverified",reason:"NATIVE_EFFECT_OBSERVATION_UNAVAILABLE",nativeReason:result.reason};
  if(result.hints&&result.headers?.length>0&&result.selectedClipTab===tab&&(expectedHeaders===undefined||result.headers?.length===expectedHeaders)){
    if(observationHints.size>=16)observationHints.clear();observationHints.set(key,result.hints);
  }else if(!(result.status==="pass"&&(result.selectedClipTab===tab||result.selectedClipTab===null)&&result.headers?.length===0))observationHints.delete(key);
  // Keep the last valid indices across an empty reconstruction frame. The next
  // native call still validates every index and reads its state afresh.
  return result;
}
/** Fixed operation and preference prefix. No executable input, menu ID or preference key. */
export async function requestEffectDisclosure(phase:EffectDisclosurePhase,input:unknown,session:EffectDisclosureSession={}):Promise<Record<string,any>>{
  const work=effectDisclosureWorkSchema.parse(input);
  const scope=currentRequestEditTarget();
  if(phase==="metadata"||phase==="keyframes_readback"){
    const pin=currentRequestEditTarget();
    if(!work.schemaTarget||work.target.componentIndex===undefined||work.sequenceName!==pin.sequenceName||work.trackItemId!==`${work.target.mediaType}:${work.target.trackIndex}:${work.target.startTicks}:${work.schemaTarget.projectItemId}`)return {status:"unverified",reason:"PARAMETER_SCHEMA_SCOPE_CHANGED"};
    return readEffectParameterSchema(pin.projectPath,{sequenceId:pin.sequenceId,trackIndex:work.target.trackIndex,startTicks:work.target.startTicks,endTicks:work.target.endTicks,projectItemId:work.schemaTarget.projectItemId,clipName:work.target.clipName,mediaType:work.target.mediaType,componentIndex:work.target.componentIndex,componentMatchName:work.target.componentMatchName,componentMatchNames:work.componentMatchNames,parameterNames:work.schemaTarget.parameterNames},phase==="keyframes_readback");
  }
  let config;
  try{config=z.object({port:z.literal(8096),token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(JSON.parse(await readFile(path.join(runtimePaths.runtimeDirectory,"effect-disclosure-connection.json"),"utf8")));}
  catch{config=undefined;}

  if(phase==="write"||phase==="calibrate_write"){
    if(work.target.disclosureScope==="component")return {status:"pass",uiVerified:false,route:"uxp_component_properties_pending_native_proof"};
    if(!config)return {status:"unsupported",available:false,reason:"Effect-disclosure helper is not installed/configured"};
    try{
      const {parameterCount:_count,disclosureScope:_scope,...target}=work.target;void _count;void _scope;
      const response=await fetch(`http://127.0.0.1:${config.port}/disclosure`,{method:"POST",headers:{authorization:`Bearer ${config.token}`,"content-type":"application/json"},signal:AbortSignal.timeout(12500),body:JSON.stringify({version:1,id:randomUUID(),operation:"set_effect_disclosure",expiresAt:Date.now()+15000,projectPath:currentRequestEditTarget().projectPath,sequenceId:currentRequestEditTarget().sequenceId,sequenceName:currentRequestEditTarget().sequenceName,target,expanded:phase==="calibrate_write"?work.expanded===false:work.expanded!==false})});
      if(!response.ok)throw Error(`DISCLOSURE_HTTP_${response.status}`);
      return z.object({status:z.enum(["pass","fail","unverified"]),uiVerified:z.literal(false).optional()}).passthrough().parse(await response.json());
    }catch(error){return {status:"unverified",reason:String(error)};}
  }
  const instance=z.object({connected:z.literal(true),premierePid:z.number().int().positive()}).parse(JSON.parse(await readFile(path.join(runtimePaths.runtimeDirectory,"native-visual-instance.json"),"utf8")));
  const tab=`${work.sequenceName} • ${work.target.clipName}`;
  if(phase.startsWith("parameter_")&&phase!=="parameter_clear_verify"){
    if(!work.parameter)return {status:"unverified",reason:"PARAMETER_TARGET_REQUIRED"};
    let state:Record<string,any>={},bound:ReturnType<typeof resolveEffectObservation>;
    const deadline=Date.now()+6000;
    // The immediately preceding header observation supplies indices only. The
    // parameter adapter independently rechecks process/window/tab/tree, every
    // header role, target expansion and actual row/viewport before returning.
    // Never carry this hint across parent commands or use it as current state.
    const hinted=phase==='parameter_inspect'&&session.parameterHints?.premierePid===instance.premierePid
      &&effectDisclosureProves(work,session.parameterHints,true);
    if(hinted){state=session.parameterHints!;bound=resolveEffectObservation(work,state);}
    else do{
      state={...await readNativeEffectState(instance.premierePid,tab),binding:session.binding};bound=resolveEffectObservation(work,state);
      if(bound&&effectDisclosureProves(work,state,true))break;
      if(Date.now()>=deadline)break;await delay(10);
    }while(Date.now()<deadline);
    if(!bound||!effectDisclosureProves(work,state,true))return {status:"unverified",reason:"PARAMETER_EFFECT_BINDING_CHANGED",readback:state};
    const key=JSON.stringify([scope.projectPath,scope.projectId,scope.sequenceId,instance.premierePid,state.panelHandle,tab,work.trackItemId,effectLayout(work),work.parameter.paramIndex,work.parameter.name,work.parameter.disclosureKey]);
    if(phase==="parameter_inspect")session.parameterOrdinal=parameterBindings.get(key);
    if(work.parameter.inlineColor)session.parameterOrdinal=work.parameter.paramIndex;
    const hintKey=JSON.stringify([key,state.panelHandle,state.hints?.count,state.hints?.headers,bound.index]);
    // The full native effect scan already enumerates every disclosure name.
    // Reuse that exact tree's candidates within this causally bound effect;
    // the parameter adapter freshly checks every index/name/role and tree count.
    const scopeStart=state.hints?.headers?.[bound.index],scopeEnd=state.hints?.headers?.[bound.index+1]??state.hints?.count;
    const discovered=Array.isArray(state.hints?.parameters)?state.hints.parameters.filter((i:number)=>i>scopeStart&&i<scopeEnd):undefined;
    const payload={pid:instance.premierePid,tab,hints:state.hints,headerIndex:bound.index,indices:parameterNodeHints.get(hintKey)??discovered,pointValueControls:work.parameter.disclosureKey==='ECP.PointParameter.Expanded',customGraph:work.parameter.disclosureKey==='ECP.Custom.Expanded',...(work.parameter.inlineColor?{colorRow:true,parameterCount:work.target.parameterCount,colorIndices:work.parameter.inlineColor.indices,timeVarying:work.parameter.inlineColor.timeVarying}:{}),...(session.parameterOrdinal!==undefined?{ordinal:session.parameterOrdinal}:{}),...(phase==="parameter_scroll"?{scroll:true}:{})};
    if(phase==="parameter_scroll"&&session.parameterOrdinal===undefined)return {status:"unverified",reason:"PARAMETER_BINDING_REQUIRED"};
    const observation=await runNativeEffectAdapter("parameter",[Buffer.from(JSON.stringify(payload)).toString("base64")],18000);
    if(hinted&&observation.status!=='pass'&&observation.dispatchAccepted===false&&['PARAMETER_LAYOUT_CHANGED','PARAMETER_EFFECT_CHANGED','PARAMETER_CLIP_CHANGED','PARAMETER_WINDOW_CHANGED','PARAMETER_HINTS_CHANGED','PARAMETER_LAYOUT_CHANGED_AT_RETURN'].includes(observation.reason)){
      delete session.parameterHints;
      return requestEffectDisclosure(phase,input,session);
    }
    if(parameterObservationProves(work,observation)){if(parameterNodeHints.size>=512)parameterNodeHints.clear();parameterNodeHints.set(hintKey,observation.rows.map((r:any)=>r.index));}
    if(phase==="parameter_baseline")session.parameterBaseline=observation;
    if(phase==="parameter_verify"){
      session.parameterOrdinal=deriveParameterOrdinal(work,session.parameterBaseline,observation);
      if(session.parameterOrdinal!==undefined){if(parameterBindings.size>=512)parameterBindings.clear();parameterBindings.set(key,session.parameterOrdinal);}
    }
    return {status:parameterObservationProves(work,observation)?"pass":"unverified",ordinal:session.parameterOrdinal,readback:observation,visible:parameterVisibleProves(work,observation,session.parameterOrdinal)};
  }
  if(phase!=="inspect"&&phase!=="clear_verify"&&phase!=="parameter_clear_verify"&&phase!=="calibrate_verify"&&phase!=="verify"&&phase!=="scroll")return {status:"fail",reason:"INVALID_DISCLOSURE_PHASE"};
  if(phase==="clear_verify"||phase==="parameter_clear_verify"){
    let empty:Record<string,any>={};
    for(let attempt=0;attempt<8;attempt++){
      empty=await readNativeEffectState(instance.premierePid,tab);
      // Premiere retains the clip-tab label while removing its effect widgets.
      // UXP separately proved zero selected items; the native 12-node shell is
      // the corresponding clear state, not an absent/stale label requirement.
      if(empty.status==="pass"&&(empty.selectedClipTab===null||empty.selectedClipTab===tab)&&empty.headers?.length===0&&empty.hints?.count<=12)return {status:"pass",empty:true,readback:empty};
      if(empty.status!=="pass")break;await delay(10);
    }
    return {status:"unverified",reason:"Native effect selection has not cleared",readback:empty};
  }
  const key=JSON.stringify([scope.projectPath,scope.projectId,scope.sequenceId,instance.premierePid,tab,work.trackItemId,work.target.mediaPath,work.target.startTicks,work.target.endTicks,effectLayout(work),work.target.componentMatchName]);
  if(phase==="inspect")session.binding=work.componentMatchNames.filter(n=>n===work.target.componentMatchName).length>1?undefined:bindings.get(key);
  // Identical match-name instances can be reordered without changing the public
  // name array. Recalibrate duplicates on each command instead of guessing.
  let readback:Record<string,any>={};
  let previousVector:string|undefined;
  // Learn only from this parent command's isolated transition. Cached binding is
  // identity evidence; desired state, window, tree and selection are always fresh.
  const observationDeadline=Date.now()+1500;
  for(let attempt=0;attempt<40;attempt++){
    readback=await readNativeEffectState(instance.premierePid,tab);
    if(phase==='inspect'&&session.binding&&bindingWindows.get(key)!==readback.panelHandle){bindings.delete(key);bindingWindows.delete(key);delete session.binding;}
    if(phase==="verify"&&session.baseline){
      const binding=deriveEffectHeaderBinding(work,session.baseline,readback);
      if(binding){session.binding=binding;if(bindings.size>=128){bindings.clear();bindingWindows.clear();}bindings.set(key,binding);bindingWindows.set(key,readback.panelHandle);}
    }
    if(session.binding)readback={...readback,binding:session.binding};
    const vector=JSON.stringify(readback.headers?.map((h:Record<string,any>)=>h.state&8));
    const complete=phase==="verify"?effectDisclosureProves(work,readback,true):effectNativeObservationProves(work,readback)&&(phase!=="calibrate_verify"||vector===previousVector);
    previousVector=vector;
    if(complete||readback.status!=="pass"||readback.selectedClipTab!==tab||Date.now()>=observationDeadline)break;
    await delay(10);
  }
  const layoutVerified=effectOccurrenceCount(work)>0&&effectNativeObservationProves(work,readback);
  if(session.binding&&!resolveEffectObservation(work,readback)){bindings.delete(key);delete session.binding;delete readback.binding;}
  if(effectDisclosureProves(work,readback,true))session.parameterHints=readback;
  else delete session.parameterHints;
  if(phase==="calibrate_verify"&&layoutVerified)session.baseline=readback;
  if(phase!=="scroll")return {status:layoutVerified?"pass":"unverified",available:work.target.disclosureScope==="component"||!!config,layoutVerified,bindingVerified:!!resolveEffectObservation(work,readback),readback,
    ...(phase==="verify"&&session.baseline?{calibration:{before:session.baseline.headers?.map((h:Record<string,any>)=>h.state&8),after:readback.headers?.map((h:Record<string,any>)=>h.state&8),expectedOccurrences:effectOccurrenceCount(work)}}:{})};
  if(!layoutVerified)return {status:"unsupported",reason:"Scroll layout is not verified",readback};
  if(effectSectionProves(work,readback))return {status:"pass",scope:"effect_section",changed:false,readback};
  const payload={pid:instance.premierePid,handle:readback.panelHandle,tab,headerCount:readback.headers.length,headerIndex:resolveEffectObservation(work,readback)?.index,initialRowsHeight:effectInitialRowsHeight(work),hints:readback.hints};
  if(payload.headerIndex===undefined)return {status:"unsupported",reason:"No verified native binding",readback};
  let dispatch=await runNativeEffectAdapter("scroll",[Buffer.from(JSON.stringify(payload)).toString("base64")],10000);
  if(dispatch.premierePid!==instance.premierePid||dispatch.selectedClipTab!==payload.tab||dispatch.headerIndex!==payload.headerIndex)dispatch={status:"unverified",reason:"Scroll response unavailable; inspect viewport"};
  const after={...await readNativeEffectState(instance.premierePid,payload.tab),binding:session.binding};
  return {status:effectSectionProves(work,after)?"pass":"unverified",scope:"effect_section",changed:dispatch.dispatchAccepted===true,dispatch,readback:after};
}
