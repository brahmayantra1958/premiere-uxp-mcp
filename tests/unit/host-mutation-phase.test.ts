import {it,expect} from 'vitest';
import {withMutationPhase,dispatchContent} from '../../apps/uxp-plugin/src/host-mutation-phase.js';
import {preflightValue,HostCommandError} from '../../apps/uxp-plugin/src/bridge-client.js';

it('distinguishes a read-only rejection from a native transaction exception',async()=>{
  await expect(withMutationPhase('set_effect_values',async()=>{throw new HostCommandError('COMPONENT_NOT_FOUND_OR_AMBIGUOUS','missing');}))
    .rejects.toMatchObject({details:{contentDispatched:false,errorClassification:'preflight',retryable:false}});
  let dispatched=0;
  await expect(withMutationPhase('set_effect_values',async()=>dispatchContent(()=>{dispatched++;throw Error('native failure');})))
    .rejects.toMatchObject({details:undefined});
  expect(dispatched).toBe(1);
});
it('does not let inner preflight evidence erase an earlier mutation',async()=>{
  await expect(withMutationPhase('apply_audio_effect',async()=>{
    dispatchContent(()=>true);
    return preflightValue(()=>{throw Error('PARAMETER_ANIMATED: after insertion');});
  })).rejects.toMatchObject({code:'PARAMETER_ANIMATED',details:undefined});
  expect(await withMutationPhase('place_voiceover',async()=>{
    dispatchContent(()=>true);
    return {status:'fail',hostResult:{contentDispatched:false},errors:['placement preflight after import']};
  })).toMatchObject({status:'fail',hostResult:{contentDispatched:true}});
});
it('retains uncertainty when an API failure follows a write',async()=>{
  await expect(withMutationPhase('apply_audio_effect',async()=>{
    dispatchContent(()=>true);throw new HostCommandError('UNSUPPORTED_API','readback unavailable');
  })).rejects.toMatchObject({code:'HOST_MUTATION_UNVERIFIED',details:undefined});
});
