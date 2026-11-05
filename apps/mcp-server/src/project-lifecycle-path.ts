import type { PathPolicy } from "./path-policy.js";
import {localProjectPath} from './active-edit-target.js';
/** User-authorized local projects are selected per operation, without a deployment allowlist. */
export function projectLifecyclePath(_paths:PathPolicy,candidate:string,sequenceName:string,sequenceId:string,_target?:unknown):string{
  void _target;
  if(!sequenceName||!sequenceId)throw Error('EXACT_SEQUENCE_REQUIRED');
  return localProjectPath(candidate);
}
