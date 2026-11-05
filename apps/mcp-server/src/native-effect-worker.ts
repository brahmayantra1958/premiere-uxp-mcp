import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {fileURLToPath} from "node:url";

type NativeOperation="state"|"panel"|"scroll"|"parameter"|"read_trigger";
const executable=fileURLToPath(new URL("../native/windows/bin/PremiereEffectSessionBridge.exe",import.meta.url));
let worker:ChildProcessWithoutNullStreams|undefined,serial=Promise.resolve(),counter=0;
let active:{id:number;resolve:(value:Record<string,any>)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
let output="";
function reset(reason:string){
  const child=worker;worker=undefined;output="";
  if(active){clearTimeout(active.timer);active.resolve({status:"unverified",reason});active=undefined;}
  child?.stdin.end();child?.kill();
}
function start():ChildProcessWithoutNullStreams {
  if(worker)return worker;
  const child=spawn(executable,[],{windowsHide:true,stdio:["pipe","pipe","pipe"]});worker=child;
  // No idle polling or timers. EOF closes the native process when this runtime
  // exits. A pending request's timer alone keeps short-lived diagnostic clients alive.
  child.unref();
  for(const stream of [child.stdin,child.stdout,child.stderr]){
    (stream as typeof stream & {unref?:()=>void}).unref?.();
    // A worker dying during a write can emit both its write callback and EPIPE.
    // Convert stream errors to an uncertain receipt, never an owner-runtime crash.
    stream.on("error",()=>{if(worker===child)reset("NATIVE_WORKER_STREAM_FAILED");});
  }
  child.stdout.setEncoding("utf8");child.stderr.resume();
  child.stdout.on("data",(chunk:string)=>{
    if(worker!==child)return;output+=chunk;
    if(output.length>131072){reset("NATIVE_WORKER_OUTPUT_UNBOUNDED");return;}
    let end;while((end=output.indexOf("\n"))>=0){
      const line=output.slice(0,end);output=output.slice(end+1);
      try{const message=JSON.parse(line);if(!active||message.id!==active.id||!message.result||typeof message.result!=="object")throw Error("Mismatched native response");
        const pending=active;active=undefined;clearTimeout(pending.timer);pending.resolve(message.result);
      }catch{reset("NATIVE_WORKER_RESPONSE_UNVERIFIED");return;}
    }
  });
  child.on("error",()=>{if(worker===child)reset("NATIVE_WORKER_UNAVAILABLE");});
  child.on("exit",()=>{if(worker===child)reset("NATIVE_WORKER_EXITED");});
  return child;
}
/** One owned, blocked-stdin worker for the three existing feature adapters.
 * Only fresh native values are returned. It exposes no executable/script/input
 * endpoint and never replays an operation after a timeout or process failure. */
export function runNativeEffectAdapter(operation:NativeOperation,args:string[],timeoutMs:number):Promise<Record<string,any>> {
  if (process.platform !== 'win32') return Promise.resolve({ status: 'unsupported', reason: 'This native UI adapter requires Windows', dispatchAccepted: false });
  const run=()=>new Promise<Record<string,any>>(resolve=>{
    const child=start(),id=++counter;
    active={id,resolve,timer:setTimeout(()=>reset("NATIVE_WORKER_TIMEOUT_DO_NOT_REPLAY"),timeoutMs)};
    child.stdin.write(JSON.stringify({id,operation,args})+"\n",error=>{if(error&&worker===child)reset("NATIVE_WORKER_WRITE_FAILED");});
  });
  const result=serial.then(run);serial=result.then(()=>{},()=>{});return result;
}
