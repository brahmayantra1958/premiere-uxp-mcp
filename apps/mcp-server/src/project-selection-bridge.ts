import {currentRequestEditTarget} from "./active-edit-target.js";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {z} from "zod/v4";
import {runtimePaths} from "./config.js";
import {randomUUID} from "node:crypto";

const targetSchema=z.object({pathSegments:z.array(z.string().min(1).max(512)).min(1).max(32),kind:z.enum(["clip","sequence","folder"]),mediaPath:z.string().max(4096).optional(),sequenceId:z.string().max(100).optional()}).strict();
export async function selectNativeProjectItem(target:unknown):Promise<Record<string,unknown>> {
  let config;
  try{config=z.object({port:z.literal(8097),token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(JSON.parse(await readFile(path.join(runtimePaths.runtimeDirectory,"project-selection-connection.json"),"utf8")));}
  catch(error){return {status:"unsupported",reason:(error as NodeJS.ErrnoException).code==="ENOENT"?"Project-selection CEP helper has not been approved/installed":String(error)};}
  try{
    const parsed=targetSchema.parse(target);
    const response=await fetch(`http://127.0.0.1:${config.port}/selection`,{method:"POST",headers:{authorization:`Bearer ${config.token}`,"content-type":"application/json"},signal:AbortSignal.timeout(12000),body:JSON.stringify({version:1,id:randomUUID(),operation:"set_project_selection",expiresAt:Date.now()+15000,projectPath:currentRequestEditTarget().projectPath,sequenceId:currentRequestEditTarget().sequenceId,sequenceName:currentRequestEditTarget().sequenceName,target:parsed})});
    if(!response.ok)throw Error(`PROJECT_SELECTION_HTTP_${response.status}`);
    return z.object({status:z.enum(["pass","fail","unverified"])}).passthrough().parse(await response.json());
  }catch(error){return {status:"unverified",reason:String(error)};}
}
