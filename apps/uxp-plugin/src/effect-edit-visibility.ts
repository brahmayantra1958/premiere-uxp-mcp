import {firstEffectParameter} from '@premiere-uxp/contracts/effect-disclosure';
type Row=Record<string,any>;
const mutations=new Set(['set_effect_values','set_effect_keyframes','edit_effect_keyframes','remove_effect','set_transform','set_basic_grade','set_audio_level','apply_color_adjustments','scale_clip_to_fill']);
/** A native view failure is a precondition failure, not a cosmetic warning on
 * an otherwise dispatched edit. Adding an effect is handled after insertion,
 * because its native row does not exist before that transaction. */
export function effectEditVisibilityError(command:string,args:Row,visibility:Row|undefined):string|undefined{
  if(!mutations.has(command))return undefined;
  if(visibility?.effectExpansion?.status!=='pass')return 'EFFECT_VIEW_UNVERIFIED: no content edit was dispatched';
  if(command!=='remove_effect'&&firstEffectParameter(args)&&(visibility.parameterScroll?.status!=='pass'||visibility.parameterScroll.scope!=='exact_parameter'))return 'PARAMETER_VIEW_UNVERIFIED: no content edit was dispatched';
  return undefined;
}
