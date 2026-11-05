import {effectValuesEqual,resolveEffectParameter,type ParameterWrite} from './effect-parameter-contract.js';
import {deriveDependencyGraph,type EffectDependencyGraph} from './effect-dependency-graph.js';

type Component=Record<string,any>;
type PlannedWrite={snapshot:Record<string,any>;write:ParameterWrite};
export type DerivedValues={writes:ParameterWrite[];rules:string[];linkedWrites?:ParameterWrite[]};
const scaleRule='adobe_auto_reframe_static_scale_v1';

/** L1: the observed Adobe Auto Reframe relation is
 * merged = generated * reframe / 100. Identity, static inputs and the existing
 * relation are prerequisites, not permissions to accept arbitrary drift.
 * All three parameters' animation and all other component state remain guarded. */
function autoReframe(component:Component,plan:PlannedWrite[]):DerivedValues {
 if(component.matchName!=='AE.ADBE AEFilterAutoFramer'||!plan.some(p=>p.snapshot.paramIndex===11))return {writes:[],rules:[]};
 const required=[[3,'Scale (Merged)'],[11,'Reframe Scale'],[12,'Scale (Auto Generated)']] as const;
 if(component.params.length!==14)throw Error('DERIVED_SCALE_LAYOUT_UNVERIFIED');
 const [merged,reframe,generated]=required.map(([index,name])=>{
  const p=component.params[index];
  if(p?.paramIndex!==index||p.displayName!==name||p.readStatus?.value!=='pass'||p.readStatus?.animation!=='pass'||p.timeVarying!==false||p.keyframes?.length!==0||p.keyframeDetails?.length!==0||typeof p.value!=='number'||!Number.isFinite(p.value))throw Error('DERIVED_SCALE_INPUT_UNVERIFIED');
  return p;
 });
 if(plan.some(p=>p.snapshot.paramIndex===3||p.snapshot.paramIndex===12))throw Error('DERIVED_PARAMETER_OVERLAP: Auto Reframe scale output/generated input is also directly written');
 if(!effectValuesEqual(merged.value,generated.value*reframe.value/100))throw Error('DERIVED_SCALE_BASELINE_MISMATCH');
 const input=plan.find(p=>p.snapshot.paramIndex===11)!.write.value;
 if(typeof input!=='number'||!Number.isFinite(input))throw Error('DERIVED_SCALE_INPUT_UNVERIFIED');
 const value=generated.value*input/100;
 if(!Number.isFinite(value))throw Error('DERIVED_SCALE_OUTPUT_UNVERIFIED');
 return {writes:[{paramIndex:3,expectedDisplayName:merged.displayName,expectedValue:merged.value,value}],rules:[scaleRule]};
}

/** L2: explicit expectations can strengthen a known rule, never override it.
 * Unknown/vendor dependencies still require the caller's exact before/after
 * guards; inference never learns permissive rules from a mutation's after-state. */
export function deriveEffectValues(component:Component,plan:PlannedWrite[],explicit:ParameterWrite[]=[],dependencies?:EffectDependencyGraph,preserveEmptyAnimation=false):DerivedValues {
 const automatic=autoReframe(component,plan),declared=dependencies?deriveDependencyGraph(component,plan,dependencies,preserveEmptyAnimation):{writes:[],rules:[]},writes=[...explicit];
 for(const expected of [...automatic.writes,...declared.writes]){
  const overlapping=writes.filter(p=>resolveEffectParameter(component,p).paramIndex===expected.paramIndex);
  if(overlapping.some(p=>!Object.hasOwn(p,'expectedValue')||!effectValuesEqual(p.expectedValue,expected.expectedValue)||!effectValuesEqual(p.value,expected.value)))throw Error('DERIVED_PARAMETER_RULE_CONFLICT');
  if(!overlapping.length)writes.push(expected);
 }
 // Applying declared links is explicitly opt-in. Automatic native rules and
 // expectedDerivedParameters remain observation-only and cannot be promoted
 // into extra writes merely because the caller provided a declaration.
 return {writes,rules:[...automatic.rules,...declared.rules],...(dependencies?.mode==='apply'?{linkedWrites:declared.writes}: {})};
}
