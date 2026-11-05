import {runNativeEffectAdapter} from "./native-effect-worker.js";
import type { NativeWorkPanel } from "@premiere-uxp/contracts";

export async function focusNativePanel(panel:NativeWorkPanel, projectName:string, sequenceName:string):Promise<Record<string,unknown>> {
  try {
    const payload=Buffer.from(JSON.stringify({panel,projectName,sequenceName})).toString("base64");
    const r=await runNativeEffectAdapter("panel",[payload],2000);
    if(r.status==="unsupported"||r.status==="unverified"&&r.reason&&!r.dispatchAccepted)return {...r,panel};
    if(r.panel!==panel||!Number.isInteger(r.premierePid)||r.premierePid<=0||r.dispatchAccepted!==true)throw Error(r.reason??"NATIVE_PANEL_RECEIPT_MISMATCH");
    return r;
  }catch(error){return {status:"unsupported",panel,reason:String(error)};}
}
