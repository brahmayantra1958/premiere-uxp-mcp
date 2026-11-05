import {parameterScrollCanContinue,parameterRebindReason,parameterVisibleProves,type EffectDisclosureWork,type EffectDisclosurePhase} from "@premiere-uxp/contracts/effect-disclosure";
type Receipt=Record<string,any>;
export type ParameterDisclosureServices={request:(phase:EffectDisclosurePhase,work:EffectDisclosureWork)=>Promise<Receipt>;assertTarget:()=>Promise<void>;write:(expanded:boolean)=>Promise<void>};
/** I/O adapter. Metadata opens ancestors; an isolated target transition binds
 * the native row. Every visible result includes fresh host geometry/state. */
export async function revealParameter(work:EffectDisclosureWork,services:ParameterDisclosureServices,rebind=false,forceAncestors=false):Promise<Receipt> {
  if(!work.parameter)return {status:"unsupported",reason:"PARAMETER_TARGET_REQUIRED"};
  await services.assertTarget();let result=await services.request("parameter_inspect",work);
  // Adapter transport status and scope cannot override the host proof.
  const finish=(r:Receipt)=>({...r,status:parameterVisibleProves(work,r.readback,r.ordinal)?"pass":"unverified",scope:"exact_parameter",paramIndex:work.parameter!.paramIndex,expectedDisplayName:work.parameter!.name,presentation:work.parameter!.inlineColor?'inline_color_controls':work.parameter!.disclosureKey==='ECP.Custom.Expanded'?'custom_graph_region':r.readback?.rows?.[r.ordinal]?.inlinePointControls?'inline_point_controls':'disclosure_row'});
  if(work.parameter.inlineColor){
    if(!parameterVisibleProves(work,result.readback,result.ordinal))result=await services.request('parameter_scroll',work);
    // A scroll can materialize native Color controls. The next inspection
    // reacquires the complete effect/parameter vector; stale indices are never
    // reused. Retry only this visibility operation, once, never a content edit.
    if(!rebind&&['COLOR_ROW_LAYOUT_CHANGED','PARAMETER_LAYOUT_CHANGED'].includes(result.readback?.reason)){
      await services.assertTarget();
      const refreshed=await revealParameter(work,services,true);
      return {...refreshed,recovery:{reason:result.readback.reason,attempts:1,previousReadback:result.readback}};
    }
    await services.assertTarget();return finish(result);
  }
  if(!rebind&&!forceAncestors&&parameterVisibleProves(work,result.readback,result.ordinal))return finish(result);
  const row=result.readback?.rows?.[result.ordinal];
  if(rebind||forceAncestors||result.ordinal===undefined||!row||((row.state&8)!==0)!==work.parameter.expanded){
    await services.write(false);await services.assertTarget();
    const baseline=await services.request("parameter_baseline",work);if(baseline.status!=="pass")return {status:"unverified",scope:"exact_parameter",reason:"PARAMETER_BASELINE_UNVERIFIED",baseline};
    await services.write(true);await services.assertTarget();
    result=await services.request("parameter_verify",work);
    if(result.ordinal===undefined)return {status:"unverified",scope:"exact_parameter",reason:"PARAMETER_NATIVE_BINDING_UNVERIFIED",result};
  }
  if(!parameterVisibleProves(work,result.readback,result.ordinal))result=await services.request("parameter_scroll",work);
  if(parameterScrollCanContinue(result)){
    await services.assertTarget();const previous=result.readback;
    result={...await services.request('parameter_scroll',work),scrollContinuation:{attempts:1,previousReadback:previous}};
  }
  await services.assertTarget();
  // Scrolling can lazily reconstruct an audio editor's native children. Never
  // accept old indices after that transition: one fresh causal bind is allowed.
  // No content command is replayed, and repeated reconstruction stays uncertain.
  const reason=parameterRebindReason(work,result);
  if(!rebind&&reason){
    const refreshed=await revealParameter(work,services,true);
    return {...refreshed,recovery:{reason,attempts:1,previousReadback:result.readback}};
  }
  return finish({...result,status:parameterVisibleProves(work,result.readback,result.ordinal)?"pass":"unverified"});
}
