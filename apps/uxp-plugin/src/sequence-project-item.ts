import {assertMethod,ppro,sequenceId} from './host-context.js';
import {HostCommandError} from './bridge-client.js';

/** Sequence identity provides its own item. A bounded media inventory can omit
 * a newly cloned sequence in a large project and must never select a namesake. */
export async function sequenceProjectItem(sequence:any):Promise<any> {
  assertMethod(sequence,'getProjectItem','Sequence.getProjectItem');
  const item=await sequence.getProjectItem();
  const clip=await ppro.ClipProjectItem.cast(item);
  if(!clip||!await clip.isSequence()||await sequenceId(await clip.getSequence())!==await sequenceId(sequence))
    throw new HostCommandError('SEQUENCE_PROJECT_ITEM_MISMATCH','Associated project item does not resolve to the exact sequence');
  assertMethod(item,'createSetNameAction','ProjectItem.createSetNameAction');
  return item;
}
