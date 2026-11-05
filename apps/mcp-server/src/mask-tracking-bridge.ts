import {currentRequestEditTarget} from "./active-edit-target.js";
import {readFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {z} from "zod/v4";
import {runtimePaths} from "./config.js";
import {focusNativePanel} from "./native-panel-bridge.js";
import type {NativeMaskArchive} from "./premiere-mask-archive.js";
import {readSavedNativeMasks} from './native-archive-readers.js';
import type {MaskTrackingWork,NativeMaskWork} from "@premiere-uxp/contracts/mask-tracking";

export const maskTrackingWorkSchema=z.object({sequenceName:z.string().min(1).max(500),maskName:z.string().min(1).max(100),direction:z.enum(["forward","backward"]),frames:z.number().int().min(1).max(30),target:z.object({sequenceId:z.string().min(1).max(100),trackIndex:z.number().int().min(0).max(99),startTicks:z.string().regex(/^\d{1,24}$/),endTicks:z.string().regex(/^\d{1,24}$/),projectItemId:z.string().min(1).max(100),clipName:z.string().min(1).max(512)}).strict()}).strict();
const executable=fileURLToPath(new URL("../native/windows/bin/PremiereMaskTrackingBridge.exe",import.meta.url));
export const nativeMaskWorkSchema=maskTrackingWorkSchema.pick({sequenceName:true,target:true});
export function nativeMaskWorkMatches(args:Record<string,any>,work:NativeMaskWork):boolean {
 const t=work.target;
 return args.expectedMediaType==="video"&&args.expectedSequenceId===t.sequenceId&&args.expectedSequenceName===work.sequenceName&&args.expectedProjectItemId===t.projectItemId&&args.expectedClipName===t.clipName&&args.expectedTrackIndex===t.trackIndex
  &&Number.isFinite(args.expectedStartSeconds)&&Number.isFinite(args.expectedEndSeconds)&&Math.abs(Number(t.startTicks)/254016000000-args.expectedStartSeconds)<=1e-7&&Math.abs(Number(t.endTicks)/254016000000-args.expectedEndSeconds)<=1e-7;
}
export async function readMaskTrackingArchive(work:NativeMaskWork){
 const pin=currentRequestEditTarget();
 if(pin.sequenceId!==work.target.sequenceId||pin.sequenceName!==work.sequenceName||!/^\w:[\\/]/.test(pin.projectPath))throw Error("MASK_TRACKING_DESIGNATED_TARGET_MISMATCH");
 return readSavedNativeMasks(pin.projectPath,work.target);
}
/** Native Type=4 and IDs 23/24 are observed on Premiere 26.5 Object Masks.
 * Tracking adds native interaction records (23) and tracker records (24).
 * No other mask parameter may change. Bytes do not imply a frame count.
 */
export function verifyMaskTrackingArchive(before:NativeMaskArchive[],after:NativeMaskArchive[],maskName:string,direction="forward"){
 if(before.length!==1||after.length!==1||before[0]?.name!==maskName||after[0]?.name!==maskName||before[0]?.nativeType!==4||after[0]?.nativeType!==4)return {status:"unverified",reason:"Exactly one matching native Object Mask is required"};
 const a=before[0]!,b=after[0]!;
 if(a.parameters.length!==b.parameters.length)return {status:"unverified",reason:"Mask parameter structure changed"};
 const changes:number[]=[];
 for(const p of a.parameters){const q=b.parameters.find(q=>q.id===p.id);if(!q||q.name!==p.name||q.controlType!==p.controlType)return {status:"unverified",reason:"Mask parameter identity changed"};if(q.stateHash!==p.stateHash)changes.push(p.id);}
 // Premiere 26.5 persists the reverse one-frame button's Boolean latch (ID 2,
 // control 16). Only this observed false→true transition with identical remaining
 // structure is allowed, and only for a backward tracking request.
 const left=a.parameters.find(p=>p.id===2),right=b.parameters.find(p=>p.id===2);
 const reverseLatch=direction==="backward"&&left?.controlType===16&&right?.controlType===16&&!!left.structureHash&&left.structureHash===right.structureHash
  &&left.scalar==="-91445760000000000,false,0,0,0,0,0,0"&&right.scalar==="-91445760000000000,true,0,0,0,0,0,0";
 const trackerBefore=a.parameters.find(p=>p.id===24)?.binary,trackerAfter=b.parameters.find(p=>p.id===24)?.binary;
 if(changes.some(id=>id!==23&&id!==24&&!(id===2&&reverseLatch))||!trackerBefore||!trackerAfter||trackerBefore.sha256===trackerAfter.sha256)return {status:"unverified",reason:"Native tracker data did not change, or unrelated mask parameters changed",changedParameterIds:changes};
 return {status:"pass",changedParameterIds:changes,trackerBefore:a.parameters.find(p=>p.id===24)?.binary,trackerAfter:b.parameters.find(p=>p.id===24)?.binary};
}
export async function trackNativeMaskFrame(work:MaskTrackingWork):Promise<Record<string,any>>{
  if (process.platform !== 'win32') return { status: 'unsupported', reason: 'This native adapter requires Windows', contentDispatched: false };
 const instance=JSON.parse(await readFile(path.join(runtimePaths.runtimeDirectory,"native-visual-instance.json"),"utf8"));
 const focus=await focusNativePanel("effect_controls","",work.sequenceName) as Record<string,any>;
 if(!instance.connected||!Number.isSafeInteger(instance.premierePid)||focus.premierePid!==instance.premierePid||focus.dispatchAccepted!==true||!focus.focus?.handle)return {status:"fail",reason:"Native effect panel focus unavailable"};
 const request={pid:instance.premierePid,handle:focus.focus.handle,sequenceName:work.sequenceName,clipName:work.target.clipName,direction:work.direction};
 return new Promise(resolve=>execFile(executable,[Buffer.from(JSON.stringify(request)).toString("base64")],{windowsHide:true,timeout:3500,maxBuffer:65536,encoding:"utf8"},(error,stdout)=>{
  try{const r=JSON.parse(stdout);
   if(error&&r.route==="windows_msaa_mask_tracking"&&["fail","unverified"].includes(r.status)&&typeof r.dispatchAccepted==="boolean"&&typeof r.reason==="string"){resolve(r);return;}
   if(error||r.protocol!==1||r.premierePid!==instance.premierePid||r.route!=="windows_msaa_mask_tracking"||r.direction!==work.direction||r.frames!==1||r.selectedClipTab!==`${work.sequenceName} • ${work.target.clipName}`||r.status!=="unverified")throw Error("MASK_NATIVE_RECEIPT_UNVERIFIED");resolve(r);}
  catch{resolve({status:"unverified",dispatchAccepted:false,reason:"Mask step result unavailable; inspect before retry"});}
 }));
}
