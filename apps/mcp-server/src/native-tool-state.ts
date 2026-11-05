import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";

const executable=fileURLToPath(new URL("../native/windows/bin/PremiereToolStateBridge.exe",import.meta.url));
/** This helper only reads one native Tools pane. A bounded child owns its timeout. */
export function readNativeToolState(premierePid:number):Promise<Record<string,unknown>> {
  if(!Number.isSafeInteger(premierePid)||premierePid<=0)throw Error("EXACT_PREMIERE_PID_REQUIRED");
  return new Promise(resolve=>{
    execFile(executable,[String(premierePid)],{windowsHide:true,timeout:1500,maxBuffer:65536,encoding:"utf8"},(error,stdout)=>{
      try{
        const value=JSON.parse(stdout);
        if(error&&value.status==="pass")throw Error("TOOL_OBSERVER_DID_NOT_COMPLETE");
        resolve(value);
      }catch{resolve({status:"unverified",route:"windows_msaa_tool_state",reason:"NATIVE_TOOL_OBSERVATION_UNAVAILABLE"});}
    });
  });
}
