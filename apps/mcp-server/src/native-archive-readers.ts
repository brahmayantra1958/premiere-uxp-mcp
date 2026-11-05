import {createHash} from 'node:crypto';
import {readNativeArchiveFile} from './saved-native-archive.js';
import {inspectPremiereMasks,type MaskArchiveTarget} from './premiere-mask-archive.js';
import {inspectEffectParameterSchema,inspectEffectChainAnimation,type SchemaTarget,type ChainAnimationTarget} from './effect-parameter-schema.js';

/** Read adapters attach file evidence to pure native parsing. They never save,
 * patch, select a clip or treat a saved file as proof of the current host UI. */
export async function readSavedNativeMasks(projectPath:string,target:MaskArchiveTarget){
  const file=await readNativeArchiveFile(projectPath,'MASK_ARCHIVE_FILE_UNBOUNDED');
  return {...inspectPremiereMasks(file.document,target),fileSha256:createHash('sha256').update(file.bytes).digest('hex'),savedAt:file.savedAt};
}

/** Return definitions for the exact correlated component, with fresh mtime. */
export async function readEffectParameterSchema(projectPath:string,target:SchemaTarget,includePointAnimation=false){
  const file=await readNativeArchiveFile(projectPath,'PARAMETER_SCHEMA_FILE_UNBOUNDED');
  return {...inspectEffectParameterSchema(file.document,target,includePointAnimation),savedAt:file.savedAt};
}

/** All requested Point components share this read's index. Each component's
 * occurrence/name vector is still independently checked by the pure parser. */
export async function readEffectChainAnimation(projectPath:string,target:ChainAnimationTarget){
  const file=await readNativeArchiveFile(projectPath,'PARAMETER_SCHEMA_FILE_UNBOUNDED');
  return {...inspectEffectChainAnimation(file.document,target),savedAt:file.savedAt,fileSha256:createHash('sha256').update(file.bytes).digest('hex')};
}
