import {describe,it,expect} from 'vitest';
import {assessAudioEffectAddRecovery} from '../../apps/mcp-server/src/effect-add-recovery.js';
const prior={componentIndex:0,matchName:'Volume',params:[{value:0.25,keyframes:[]}]};
const added={componentIndex:1,displayName:'Limiter',matchName:'native-limiter',params:[{paramIndex:1,displayName:'Max',value:0.85000002,keyframes:[],keyframeDetails:[],readStatus:{value:'pass',animation:'pass'}}]};
const args={expectedEffectState:[prior],trackItemId:'a',expectedProjectItemId:'source',expectedClipName:'Clip',expectedMediaType:'audio',expectedTrackIndex:1,expectedStartSeconds:0,expectedEndSeconds:10,displayName:'Limiter',initialParameters:[{paramIndex:1,expectedDisplayName:'Max',value:0.85}]};
const current={items:[{id:'a',projectItemId:'source',name:'Clip',mediaType:'audio',trackIndex:1,start:{seconds:0},end:{seconds:10},components:[prior,added]}]};
describe('audio effect crash reconciliation',()=>{
  it('proves current addition and unchanged outcome without replay',()=>{
    expect(assessAudioEffectAddRecovery(args,current).outcome).toBe('verified_current_audio_effect_addition');
    expect(assessAudioEffectAddRecovery(args,{items:[{...current.items[0],components:[prior]}]}).outcome).toBe('verified_audio_effect_not_applied');
  });
  it.each(['prior','value','keys','target','extra','health'] as const)('rejects changed %s',fault=>{
    const c:any=structuredClone(current);
    if(fault==='prior')c.items[0].components[0].params[0].value=0.5;
    if(fault==='value')c.items[0].components[1].params[0].value=0.9;
    if(fault==='keys')c.items[0].components[1].params[0].keyframes=[1];
    if(fault==='target')c.items[0].id='other';
    if(fault==='extra')c.items[0].components.push(added);
    if(fault==='health')c.items[0].components[1].params[0].readStatus.value='unverified';
    expect(()=>assessAudioEffectAddRecovery(args,c)).toThrow('RECOVERY_');
  });
});
