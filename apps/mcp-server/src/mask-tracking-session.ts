import type {MaskTrackingWork} from "@premiere-uxp/contracts/mask-tracking";
import {maskTrackingWorkSchema,readMaskTrackingArchive,trackNativeMaskFrame,verifyMaskTrackingArchive,nativeMaskWorkMatches} from "./mask-tracking-bridge.js";
import type {NativeMaskArchive} from "./premiere-mask-archive.js";

/** A parent command owns exactly one archive baseline and an ordered series of
 * non-replayable steps. The panel cannot supply a path or alter the requested target.
 */
export class MaskTrackingSession {
  private phase="new";
  private work?:string;
  private before?:NativeMaskArchive[];
  private nextStep=0;
  constructor(private readonly args:Record<string,any>,private readonly services={read:readMaskTrackingArchive,step:trackNativeMaskFrame}){}
  async request(phase:unknown,step:unknown,input:unknown):Promise<Record<string,any>|undefined>{
    const parsed=maskTrackingWorkSchema.safeParse(input);
    if(!parsed.success||!Number.isSafeInteger(step))return;
    const work:MaskTrackingWork=parsed.data,a=this.args;
    if(!nativeMaskWorkMatches(a,work)||a.maskName!==work.maskName||a.direction!==work.direction||a.frames!==work.frames)return;
    const key=JSON.stringify(work);
    if(phase==="before"&&step===0&&this.phase==="new"){
      this.phase="reading";this.work=key;
      try{
        const archive=await this.services.read(work);
        if(archive.masks.length!==1||archive.masks[0]?.name!==work.maskName||archive.masks[0]?.nativeType!==4){this.phase="stopped";return {status:"unsupported",reason:"Exactly one matching native Object Mask is required",masks:archive.masks.map(m=>({name:m.name,nativeType:m.nativeType}))};}
        this.before=archive.masks;this.phase="ready";
        return {status:"pass",archive};
      }catch(error){this.phase="stopped";return {status:"fail",reason:String(error)};}
    }
    if(this.work!==key)return;
    if(phase==="step"&&this.phase==="ready"&&step===this.nextStep&&this.nextStep<work.frames){
      this.phase="dispatching";
      try{const result=await this.services.step(work);this.nextStep++;this.phase=result.dispatchAccepted===true?"ready":"stopped";return result;}
      catch(error){this.phase="stopped";return {status:"unverified",reason:String(error),dispatchAccepted:false};}
    }
    if(phase==="after"&&this.phase==="ready"&&step===work.frames&&this.nextStep===work.frames&&this.before){
      this.phase="verifying";
      try{const archive=await this.services.read(work);return {...verifyMaskTrackingArchive(this.before,archive.masks,work.maskName,work.direction),archive};}
      catch(error){return {status:"unverified",reason:String(error)};}
      finally{this.phase="finished";}
    }
  }
}
