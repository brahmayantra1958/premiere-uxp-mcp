import {effectRevealPlan,effectNativeObservationProves,effectDisclosureProves,effectSectionProves,type EffectDisclosurePhase,type EffectDisclosureWork} from "@premiere-uxp/contracts/effect-disclosure";
type Receipt=Record<string,any>;
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
  if(plan==="unavailable"||before.layoutVerified!==true)return {status:"unverified",reason:"Native effect observation is unavailable",readback:before.readback};
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
