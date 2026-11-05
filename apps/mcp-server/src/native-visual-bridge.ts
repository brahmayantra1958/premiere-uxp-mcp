import {readFile} from "node:fs/promises";
import {createConnection} from "node:net";
import {fileURLToPath} from "node:url";

import {nativeToolStateProves,type NativeVisualFeature} from "@premiere-uxp/contracts";
import {readNativeToolState} from "./native-tool-state.js";
const allowed=new Set<NativeVisualFeature>(["inspect","selection_tool","razor_tool","object_selection_tool"]);
const runtime=fileURLToPath(new URL("../../../artifacts/runtime/",import.meta.url));

/** Local SDK requests have one owner/correlation ID. An accepted dispatch is never PASS. */
export async function requestNativeVisual(feature:NativeVisualFeature,id:string):Promise<Record<string,unknown>> {
  if (process.platform !== 'win32') return { status: 'unsupported', reason: 'This native adapter requires Windows', contentDispatched: false };
  if(!allowed.has(feature)||!/^[a-f\d-]{36}$/.test(id))throw Error("INVALID_NATIVE_VISUAL_REQUEST");
  let credentials:{token:string},instance:{protocol:number;premierePid:number;connected:boolean};
  try {
    credentials=JSON.parse(await readFile(runtime+"native-visual-config.json","utf8"));
    instance=JSON.parse(await readFile(runtime+"native-visual-instance.json","utf8"));
    if(!/^[a-f\d]{64}$/.test(credentials.token)||instance.protocol!==1||!instance.connected||!Number.isSafeInteger(instance.premierePid)||instance.premierePid<=0)throw Error("NATIVE_VISUAL_NOT_CONNECTED");
  }catch{return {status:"unsupported",reason:"Native visual SDK plugin is not installed/registered or has disconnected"};}
  const pipe=`\\\\.\\pipe\\Brahma.Yantra.NativeVisual.v1.${instance.premierePid}`;
  const receipt=await new Promise<Record<string,unknown>>(resolve=>{
    let output="",dispatched=false,finished=false;
    const socket=createConnection(pipe);
    const finish=(result:Record<string,unknown>)=>{if(finished)return;finished=true;clearTimeout(timer);socket.destroy();resolve(result);};
    const timer=setTimeout(()=>finish({status:dispatched?"unverified":"unsupported",reason:"NATIVE_VISUAL_TIMEOUT_INSPECT_BEFORE_RETRY"}),5000);
    socket.setEncoding("utf8");
    socket.once("connect",()=>{dispatched=true;socket.write(`${credentials.token}\t${id}\t${feature}\n`);});
    socket.on("data",chunk=>{
      output+=chunk;
      if(output.length>1024*1024){finish({status:"unverified",reason:"NATIVE_VISUAL_RESPONSE_TOO_LARGE"});return;}
      if(!output.endsWith("\n"))return;
      try{
        const result=JSON.parse(output);
        if(result.protocol!==1||result.id!==id||result.premierePid!==instance.premierePid)throw Error("NATIVE_VISUAL_RECEIPT_MISMATCH");
        if(feature!=="inspect"&&result.status==="pass")throw Error("DISPATCH_IS_NOT_STATE_PROOF");
        if(result.feature&&result.feature!==feature)throw Error("NATIVE_VISUAL_FEATURE_MISMATCH");
        finish(result);
      }catch(error){finish({status:"unverified",reason:String(error)});}
    });
    socket.once("error",()=>finish({status:dispatched?"unverified":"unsupported",reason:"NATIVE_VISUAL_PIPE_UNAVAILABLE"}));
    socket.once("end",()=>{if(!finished)finish({status:"unverified",reason:"NATIVE_VISUAL_INCOMPLETE_RESPONSE"});});
  });
  if(feature==="inspect"||receipt.dispatchAccepted!==true||receipt.sdkError!==0||receipt.status!=="unverified")return receipt;
  const readback=await readNativeToolState(instance.premierePid);
  const verified=nativeToolStateProves(feature,readback,instance.premierePid);
  return {...receipt,status:verified?"pass":"unverified",readback,reason:verified?"Requested tool is selected in Premiere's native Tools pane":"SDK accepted the command; independent native tool-state proof is unavailable or differs"};
}
