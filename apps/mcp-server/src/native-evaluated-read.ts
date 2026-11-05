import {readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {watch} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {runtimePaths} from './config.js';
import {runNativeEffectAdapter} from './native-effect-worker.js';

let busy=false;
const request=path.join(runtimePaths.runtimeDirectory,'native-read-request.txt'),output=path.join(runtimePaths.runtimeDirectory,'native-read-result.json');
function waitResult(id:string):Promise<Record<string,any>> {return new Promise((resolve,reject)=>{
  let done=false,reading=false;
  const close=(error?:unknown,value?:Record<string,any>)=>{if(done)return;done=true;clearTimeout(timer);watcher.close();if(error)reject(error);else resolve(value!);};
  const read=async()=>{if(done||reading)return;reading=true;try{const info=await stat(output);if(info.size>1048576)throw Error('READ_SDK_OUTPUT_UNBOUNDED');const value=JSON.parse(await readFile(output,'utf8'));if(value.id===id)close(undefined,value);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')close(error);}finally{reading=false;}};
  const watcher=watch(runtimePaths.runtimeDirectory,(_event,name)=>{if(String(name)==='native-read-result.json')void read();});
  const timer=setTimeout(()=>close(Error('READ_SDK_CALLBACK_TIMEOUT_UNVERIFIED')),12000);watcher.on('error',error=>close(error));void read();
});}
// Same no-argument, allowlisted menu trigger; reuse only its blocked-stdin
// process. Every sample still owns a fresh request, native render and proof.
function trigger(){return runNativeEffectAdapter('read_trigger',[],12000);}

/** One fixed read adapter, exclusive request ownership, no idle polling. Caller
 * first focuses/proves its UXP timeline, and must correlate the PARTIAL result. */
export async function nativeEvaluatedRead(input:{ticks:string;matchName:string;paramIndex:number}) {
  if (process.platform !== 'win32') throw Error('UNSUPPORTED_PLATFORM: Native evaluated effect read requires the Windows Adobe SDK adapter');
  if(!/^\d{1,18}$/.test(input.ticks)||BigInt(input.ticks)>254016000000n*86400n*7n||!/^[\x20-\x7e]{1,200}$/.test(input.matchName)||!Number.isInteger(input.paramIndex)||input.paramIndex<0||input.paramIndex>4095)throw Error('INVALID_NATIVE_READ');
  if(busy)throw Error('NATIVE_READ_BUSY');busy=true;let owns=false;
  const id=randomUUID(),started=Date.now();
  try {
    const config=JSON.parse(await readFile(path.join(runtimePaths.runtimeDirectory,'native-visual-config.json'),'utf8'));
    if(!/^[a-f0-9]{64}$/.test(config.token))throw Error('NATIVE_READ_CREDENTIAL_UNAVAILABLE');
    await writeFile(request,[config.token,id,String(Date.now()+15000),input.ticks,input.matchName,String(input.paramIndex)].join('\n'),{flag:'wx'});owns=true;
    const dispatch=await trigger();if(dispatch.dispatchAccepted!==true)throw Error('READ_TRIGGER_REJECTED: '+String(dispatch.code??dispatch.reason??'UNKNOWN_NATIVE_TRIGGER_FAILURE'));
    const sdk=await waitResult(id);
    if(sdk.id!==id||sdk.protocol!==1||sdk.premierePid!==dispatch.premierePid||sdk.sequenceTicks!==input.ticks||sdk.status!=='partial'||sdk.at<started||sdk.at>Date.now()+1000)throw Error('READ_SDK_RECEIPT_MISMATCH');
    return {id,dispatch,sdk,elapsedMs:Date.now()-started};
  } finally {
    // Do not remove a later caller's request after a timeout/reload.
    try{if(owns){const current=await readFile(request,'utf8').catch(()=>undefined);if(current?.split('\n')[1]===id)await unlink(request);}}finally{busy=false;}
  }
}
