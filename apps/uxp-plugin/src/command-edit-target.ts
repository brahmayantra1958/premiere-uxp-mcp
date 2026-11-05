export type CommandEditTarget={projectPath:string;projectId:string;sequenceId:string;sequenceName:string};
const targets=new Map<string,CommandEditTarget>();
/** Scope belongs to one queued command, never the installed bundle. */
export function bindCommandEditTarget(id:string,context:Record<string,any>){
  if(context.activeProject&&context.activeSequence)targets.set(id,{projectPath:context.projectPath,projectId:context.projectId,sequenceId:context.sequenceId,sequenceName:context.sequenceName});
}
export const commandEditTarget=(id:string)=>targets.get(id);
export const releaseCommandEditTarget=(id:string)=>{targets.delete(id);};
