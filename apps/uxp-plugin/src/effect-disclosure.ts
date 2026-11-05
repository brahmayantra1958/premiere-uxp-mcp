import {effectRevealPlan,effectNativeObservationProves,effectDisclosureProves,effectSectionProves,effectOccurrenceCount,type EffectDisclosurePhase,type EffectDisclosureWork} from "@premiere-uxp/contracts/effect-disclosure";
type Receipt=Record<string,any>;
/** Why the pre-write inspection could not bind the target header. Only the
 * panel reveal and target follow have run by then; no disclosure preference or
 * component property has been written. */
export function unobservedDisclosureReason(work:EffectDisclosureWork,readback:Receipt|undefined):string{
  const tab=`${work.sequenceName} • ${work.target.clipName}`;
  if(!effectOccurrenceCount(work))return "EFFECT_HEADER_NOT_ADDRESSABLE: the requested component has no unique native header; nothing was written";
  if(!readback||readback.status!=="pass")return `NATIVE_EFFECT_OBSERVATION_UNAVAILABLE: ${String(readback?.nativeReason??readback?.reason??"no native readback")}; nothing was written`;
  if(readback.selectedClipTab!==tab)return `EFFECT_CONTROLS_TAB_NOT_SELECTED: Effect Controls did not report "${tab}" as its selected clip tab; nothing was written, so the request can be retried`;
  return "EFFECT_HEADERS_UNVERIFIED: the native effect headers were not fully observed; nothing was written";
}
/** Result of the explicit set_effect_disclosure command. A stop before any
 * disclosure write is a known failure without dispatched content, so it keeps
 * no lease and can simply be retried. Later stops keep the flow's own status. */
export function explicitDisclosureResult(expansion:Receipt|undefined,panel:Receipt|undefined,expanded:unknown):Receipt{
  const unwritten=expansion?.status!=="pass"&&expansion?.disclosureDispatched===false&&!(Array.isArray(expansion?.propertyWrites)&&expansion.propertyWrites.length>0);
  const effectExpansion=unwritten?{...expansion,status:"fail"}:expansion;
  return {status:unwritten?"fail":expansion?.status??"unsupported",
    hostResult:{visibility:{...panel,effectExpansion},expanded,contentChanged:false,...(unwritten?{contentDispatched:false}:{})},
    errors:expansion?.status==="pass"?[]:[String(expansion?.reason??"Native disclosure was not verified")]};
}
export type EffectDisclosureServices={
  request:(phase:EffectDisclosurePhase,work:EffectDisclosureWork)=>Promise<Receipt>;
  assertTarget:()=>Promise<void>;
  clearSelection:()=>Promise<void>;
  restoreSelection:()=>Promise<void>;
  yieldToHost:()=>Promise<void>;
  writeComponentDisclosure?:(expanded:boolean)=>Promise<Receipt>;
  deferSectionToParameter?:boolean;
};
/** Runs inside the existing host queue. Clear/reselect in one synchronous turn
 * is coalesced by Premiere; the intervening completed async boundary is required.
 * Selection restoration is attempted after every dispatched clear, but never
 * into another project/sequence or a changed clip.
 */
export async function revealEffectDisclosure(work:EffectDisclosureWork,services:EffectDisclosureServices):Promise<Receipt>{
  const started=performance.now(),timingsMs:Record<string,number>={};
  let initialObservation:{plan:ReturnType<typeof effectRevealPlan>;headerExpanded:boolean[]}|undefined;
  const base=services;
  const measure=async<T>(name:string,run:()=>Promise<T>):Promise<T>=>{const at=performance.now();try{return await run();}finally{timingsMs[name]=(timingsMs[name]??0)+performance.now()-at;}};
  services={...base,assertTarget:()=>measure("guards",base.assertTarget),request:(phase,target)=>measure(phase,()=>base.request(phase,target)),clearSelection:()=>measure("clear",base.clearSelection),restoreSelection:()=>measure("restore",base.restoreSelection),yieldToHost:()=>measure("yield",base.yieldToHost)};
  const finish=(result:Receipt)=>({...result,...(result.status==="pass"&&initialObservation?{initialObservation}:{}),timingsMs:{...timingsMs,total:performance.now()-started}});
  await services.assertTarget();
  const before=await services.request("inspect",work);
  const scroll=async(readback:unknown,detail:Receipt)=>{
    if(work.expanded===false)return {...detail,status:"pass",readback,parameterScroll:{status:"pass",scope:"collapsed_effect_header",changed:false}};
    if(services.deferSectionToParameter&&effectDisclosureProves(work,readback,true))return {...detail,status:"pass",scope:"expanded_effect_for_parameter",readback,parameterScroll:{status:"partial",scope:"parameter_pending"}};
    if(effectSectionProves(work,readback))return {...detail,status:"pass",readback,parameterScroll:{status:"pass",scope:"effect_section",changed:false}};
    await services.assertTarget();const result=await services.request("scroll",work);await services.assertTarget();
    const verified=effectSectionProves(work,result.readback);
    return {...detail,status:verified?"pass":"unverified",readback:result.readback,parameterScroll:{...result,status:verified?"pass":"unverified"}};
  };
  const plan=effectRevealPlan(work,before.readback);
  // Diagnostic only: capture the first observed plain vector before calibration
  // changes it. This neither binds a header nor changes the existing plan. The
  // native predicate bounds the vector to 128 fully observed headers.
  if(effectNativeObservationProves(work,before.readback))initialObservation={plan,headerExpanded:before.readback.headers.map((header:Receipt)=>(header.state&8)!==0)};
  if(plan==="ready")return finish(await scroll(before.readback,{changed:false}));
  if(before.available!==true)return {...before,status:"unsupported",reason:"Collapsed effect requires the approved disclosure helper"};
  if(plan==="unavailable"||before.layoutVerified!==true)return {status:"unverified",reason:unobservedDisclosureReason(work,before.readback),disclosureDispatched:false,readback:before.readback};
  let restored=false;
  const change=async(phase:"write"|"calibrate_write")=>{
    let clearAttempted=false;
    try {
      await services.assertTarget();clearAttempted=true;await services.clearSelection();
      await services.yieldToHost();await services.assertTarget();
      const cleared=await services.request("clear_verify",work);await services.assertTarget();
      if(cleared.status!=="pass"||cleared.empty!==true)return {status:"unverified",reason:"Native effect panel did not clear; no preference was written",clear:cleared};
      if(work.target.disclosureScope==="component"){
        if(!base.writeComponentDisclosure)return {status:"unsupported",reason:"Component Properties writer unavailable"};
        const write=await measure("componentProperty",()=>base.writeComponentDisclosure!(phase==="calibrate_write"?work.expanded===false:work.expanded!==false));
        await services.assertTarget();if(write.status!=="pass")return write;
      }
      return await services.request(phase,work);
    }finally{
      if(clearAttempted){await services.assertTarget();await services.restoreSelection();restored=true;await services.yieldToHost();}
    }
  };
  if(plan==="calibrate"){
    const calibration=await change("calibrate_write");await services.assertTarget();
    if(calibration.status!=="pass")return finish({status:calibration.status??"unverified",restored,calibration});
    const baseline=await services.request("calibrate_verify",work);await services.assertTarget();
    if(baseline.layoutVerified!==true)return finish({status:"unverified",restored,reason:"Calibration observation is incomplete",readback:baseline.readback});
  }
  const write=await change("write");
  await services.assertTarget();
  if(write?.status!=="pass")return {status:write?.status??"unverified",restored,preference:write};
  const after=await services.request("verify",work);
  await services.assertTarget();
  if(!effectDisclosureProves(work,after.readback,true))return {status:"unverified",changed:true,restored,preference:write,calibration:after.calibration,readback:after.readback};
  return finish(await scroll(after.readback,{changed:true,restored,calibrated:plan==="calibrate",preference:write,scope:work.target.disclosureScope??"match_name",affectedHeaderIndices:after.readback.binding.headerIndices}));
}
