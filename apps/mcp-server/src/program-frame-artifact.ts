import { open,stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { probePngEvidence } from "./mask-seed-frame.js";
import path from "node:path";
import {runtimePaths} from "./config.js";

/** Keep the host queue owned until Premiere's asynchronous PNG has its final IEND chunk. */
export async function waitForProgramFrame(file:string):Promise<Record<string,unknown>> {
  const relative=path.relative(runtimePaths.output,file);
  if(relative.startsWith("..")||path.isAbsolute(relative)||!relative.toLowerCase().endsWith(".png"))throw Error("PROGRAM_FRAME_PATH_NOT_ALLOWED");
  const deadline=Date.now()+5000;
  do {
    try {
      const info=await stat(file);
      if(info.size>12*1024*1024)throw Error("PROGRAM_FRAME_EXCEEDS_12_MIB");
      if(info.size>=32){const handle=await open(file,"r");try {
        const tail=Buffer.alloc(12);await handle.read(tail,0,12,info.size-12);
        if(tail.toString("hex")==="0000000049454e44ae426082")return await probePngEvidence(file);
      }finally{await handle.close();}}
    }catch(error){if(!["ENOENT","EBUSY","EACCES"].includes(String((error as NodeJS.ErrnoException).code)))throw error;}
    await delay(50);
  }while(Date.now()<deadline);
  throw Error("PROGRAM_FRAME_FINALIZATION_TIMEOUT_UNVERIFIED");
}
