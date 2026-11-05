import {editPlanSchema,type EditPlan,type ProjectSnapshot} from '@premiere-uxp/contracts';

/** Literal declared destinations only. This does not authorize a path or test
 * existence; both planning and artifact guards use the same input projection. */
export function declaredOutputPaths(args:Record<string,unknown>):string[]{
  return [args.outputPath,...(Array.isArray(args.outputPaths)?args.outputPaths:[])]
    .filter((value):value is string=>typeof value==='string');
}

/** A caller-supplied snapshot and ID determine the plan without host/file/time
 * access. A valid plan describes intended work; it never authorizes dispatch. */
export function createMutationPlan(snapshot:ProjectSnapshot,command:string,args:Record<string,unknown>,planId:string):EditPlan{
  const workingProjectPath=command==='create_working_copy'&&typeof args.outputPath==='string'?args.outputPath:snapshot.projectPath;
  return editPlanSchema.parse({
    planId,baseProjectId:snapshot.projectId,baseSnapshot:snapshot,
    ...(snapshot.activeSequence?{baseSequenceId:snapshot.activeSequence.id,workingSequenceName:snapshot.activeSequence.name}:{}),
    workingProjectPath,
    operations:[{command,args,expectedChange:`Verified state change for ${command}`}],
    expectedArtifacts:declaredOutputPaths(args),
    preconditions:command==='create_working_copy'
      ?['Active Premiere project exists','Destination is below the local scratch root']
      :['Host verifies the current saved local project and exact sequence for each command'],
    requiresUserAction:false,stopOnFailure:true,
  });
}
