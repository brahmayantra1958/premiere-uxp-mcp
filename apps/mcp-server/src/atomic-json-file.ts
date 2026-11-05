import {randomUUID} from 'node:crypto';
import {lstat,mkdir,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const pendingWrites=new Map<string,Promise<void>>();
const retryDelaysMs=[10,20,40,80,160,320] as const;
type Options={rename?:typeof rename;delay?:(ms:number)=>Promise<unknown>;platform?:NodeJS.Platform};

async function assertRegular(file:string,allowMissing:boolean){
 try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('ATOMIC_RECORD_NOT_REGULAR: '+file);}
 catch(error){if(allowMissing&&(error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
}

/** Serialize writes to the same destination and replace it atomically. Retry
 * only the exact rename on bounded sharing/permission errors; never unlink the
 * prior record or repeat the operation whose evidence is being saved. */
export class AtomicJsonFileWriter{
 constructor(private readonly options:Options={}){}
 write(file:string,value:unknown):Promise<void>{
  const destination=path.resolve(file),key=process.platform==='win32'?destination.toLowerCase():destination;
  // Capture at invocation, before queued writes or their caller can mutate it.
  const serialized=JSON.stringify(value),prior=pendingWrites.get(key)??Promise.resolve();
  const current=prior.catch(()=>undefined).then(()=>this.replace(destination,serialized));
  pendingWrites.set(key,current);
  void current.finally(()=>{if(pendingWrites.get(key)===current)pendingWrites.delete(key);}).catch(()=>undefined);
  return current;
 }
 private async replace(destination:string,serialized:string):Promise<void>{
  await mkdir(path.dirname(destination),{recursive:true});
  await assertRegular(destination,true);
  const temporary=destination+'.'+process.pid+'.'+randomUUID()+'.tmp';let created=false;
  try{
   const handle=await open(temporary,'wx',0o600);created=true;
   try{await handle.writeFile(serialized,'utf8');await handle.sync();}finally{await handle.close();}
   for(let attempt=0;;attempt++){
    try{await (this.options.rename??rename)(temporary,destination);return;}
    catch(error){
     const code=(error as NodeJS.ErrnoException).code,platform=this.options.platform??process.platform;
     if(attempt>=retryDelaysMs.length||!(code==='EBUSY'||platform==='win32'&&['EPERM','EACCES'].includes(code??'')))throw error;
     // Do not retry a changed/missing source, directory, or link destination.
     await assertRegular(temporary,false);await assertRegular(destination,true);
     await (this.options.delay??delay)(retryDelaysMs[attempt]!);
    }
   }
  }catch(error){
   if(created)try{await unlink(temporary);}catch(cleanupError){if((cleanupError as NodeJS.ErrnoException).code!=='ENOENT'&&error instanceof Error)Object.assign(error,{temporaryCleanupError:String(cleanupError)});}
   throw error;
  }
 }
}
