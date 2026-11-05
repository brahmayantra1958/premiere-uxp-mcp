import {currentRequestEditTarget} from "./active-edit-target.js";
import {z} from 'zod/v4';
import {readEffectChainAnimation} from './native-archive-readers.js';

export const effectChainProofWorkSchema=z.object({
  projectId:z.string().min(1).max(200),sequenceId:z.string().min(1).max(200),sequenceName:z.string().min(1).max(500),
  trackItemId:z.string().min(1).max(500),projectItemId:z.string().min(1).max(200),clipName:z.string().min(1).max(512),
  mediaType:z.enum(['video','audio']),trackIndex:z.number().int().min(0).max(99),
  startTicks:z.string().regex(/^\d{1,24}$/),endTicks:z.string().regex(/^\d{1,24}$/),
  componentMatchNames:z.array(z.string().min(1).max(200)).min(1).max(64),
  components:z.array(z.object({componentIndex:z.number().int().min(0).max(63),componentMatchName:z.string().min(1).max(200),parameterNames:z.array(z.string().max(512)).max(4096)}).strict()).min(1).max(64)
}).strict().refine(w=>new Set(w.components.map(c=>c.componentIndex)).size===w.components.length
  &&w.components.every(c=>w.componentMatchNames[c.componentIndex]===c.componentMatchName)
  &&w.components.reduce((n,c)=>n+c.parameterNames.length,0)<=4096,'Exact unique component slots and bounded parameter vectors required');

export async function requestEffectChainProof(input:unknown){
  const work=effectChainProofWorkSchema.parse(input);
  const pin=currentRequestEditTarget();
  if(work.projectId!==pin.projectId||work.sequenceId!==pin.sequenceId||work.sequenceName!==pin.sequenceName)throw Error('EFFECT_CHAIN_PIN_CHANGED');
  return readEffectChainAnimation(pin.projectPath,work);
}
