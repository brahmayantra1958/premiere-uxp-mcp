import type {MaskTrackingPhase,MaskTrackingWork} from "@premiere-uxp/contracts/mask-tracking";
type Receipt=Record<string,any>;
export type MaskTrackingServices={assertTarget:()=>Promise<void>;save:()=>Promise<void>;position:()=>Promise<string>;request:(phase:MaskTrackingPhase,step:number,work:MaskTrackingWork)=>Promise<Receipt>;yieldToHost:()=>Promise<void>};
/** One submitted command owns all steps. Never retry a dispatched step whose
 * exact frame advance was not observed. Archive and live frame proof are both required.
 */
export async function trackObjectMaskFrames(work:MaskTrackingWork,timebaseTicks:string,services:MaskTrackingServices):Promise<Receipt>{
 const frame=BigInt(timebaseTicks),start=BigInt(await services.position()),end=start+frame*BigInt(work.direction==="forward"?work.frames:-work.frames);
 if(frame<=0n||start%frame!==0n||start<BigInt(work.target.startTicks)||start>=BigInt(work.target.endTicks)||end<BigInt(work.target.startTicks)||end>=BigInt(work.target.endTicks))throw Error("MASK_TRACK_RANGE_INVALID");
 await services.assertTarget();await services.save();
 const before=await services.request("before",0,work);if(before.status!=="pass")return before;
 let completed=0;const steps:Receipt[]=[];
 try {
 for(let i=0;i<work.frames;i++){
  await services.assertTarget();const expectedBefore=start+frame*BigInt(work.direction==="forward"?i:-i);
  if(BigInt(await services.position())!==expectedBefore)throw Error("MASK_PLAYHEAD_CHANGED_BEFORE_STEP");
  const receipt=await services.request("step",i,work);steps.push(receipt);
  if(receipt.dispatchAccepted!==true)return {status:"unverified",completedFrames:completed,steps,reason:"Step was not verified; inspect before retry"};
  const expected=expectedBefore+(work.direction==="forward"?frame:-frame);let observed=BigInt(await services.position());
  for(let poll=0;observed===expectedBefore&&poll<15;poll++){await services.yieldToHost();observed=BigInt(await services.position());}
  if(observed!==expected)return {status:"unverified",completedFrames:completed,steps,reason:"Native mask step did not advance exactly one frame",expectedTicks:String(expected),observedTicks:String(observed)};
  completed++;
 }
 await services.assertTarget();await services.save();
 const after=await services.request("after",completed,work);
 await services.assertTarget();const final=await services.position();
 return {status:after.status==="pass"&&BigInt(final)===end?"pass":"unverified",completedFrames:completed,before,after,steps,position:{beforeTicks:String(start),afterTicks:final,timebaseTicks},errors:after.status==="pass"?[]:["Native mask archive verification failed"]};
 } catch(error) {
  return {status:"unverified",completedFrames:completed,steps,reason:String(error),recovery:"Inspect target and saved mask before retry; no dispatched step was replayed"};
 }
}
