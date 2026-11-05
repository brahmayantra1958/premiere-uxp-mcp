/** L0: slots identify edits; component disclosure is per instance; intrinsic preferences use match-name groups. */
export type EffectDisclosureTarget={mediaType:"video"|"audio";trackIndex:number;startTicks:string;endTicks:string;clipName:string;mediaPath:string;componentMatchName:string;componentIndex?:number|undefined;parameterCount?:number|undefined;disclosureScope?:"component"|"match_name"|undefined};
export type EffectDisclosurePhase="metadata"|"keyframes_readback"|"inspect"|"clear_verify"|"calibrate_write"|"calibrate_verify"|"write"|"verify"|"scroll"|"parameter_clear_verify"|"parameter_inspect"|"parameter_baseline"|"parameter_verify"|"parameter_scroll";
export type EffectDisclosureWork={target:EffectDisclosureTarget;sequenceName:string;componentMatchNames:string[];expanded?:boolean|undefined;trackItemId?:string|undefined;schemaTarget?:{projectItemId:string;parameterNames:string[]}|undefined;parameter?:{paramIndex:number;name:string;expanded:boolean;disclosureKey:string;inlineColor?:{indices:number[];timeVarying:boolean}|undefined}|undefined};
export type EffectHeaderBinding={method:"isolated_disclosure_transition";layout:string;matchName:string;headerIndices:number[];before:boolean[];after:boolean[]};
/** One public call follows its first actual parameter. Shared by the host and
 * callback boundary so a child callback cannot navigate another slot. */
export function firstEffectParameter(args:Record<string,any>):Record<string,any>|undefined {
 return args.paramIndex!==undefined?args:args.parameters?.[0]??args.keyframes?.[0]??args.operations?.[0]??(args.values&&Object.keys(args.values).length?{parameterName:Object.keys(args.values)[0]}:undefined);
}
export function effectParameterScopeProves(args:Record<string,any>,parameter:EffectDisclosureWork['parameter']):boolean {
 const expected=firstEffectParameter(args);
 if(!expected||!parameter||parameter.expanded!==true)return false;
 if(expected.paramIndex!==undefined&&expected.paramIndex!==parameter.paramIndex)return false;
 if(expected.expectedDisplayName!==undefined&&expected.expectedDisplayName!==parameter.name)return false;
 if(expected.parameterName!==undefined&&String(expected.parameterName).toLocaleLowerCase('en-US')!==parameter.name.toLocaleLowerCase('en-US'))return false;
 return expected.paramIndex!==undefined||expected.parameterName!==undefined;
}
type Observation=Record<string,any>;
/** One UI-only causal rebind is allowed after a structurally changed native
 * tree or an exhausted sweep. Both wire admission and UXP use this predicate. */
export function parameterRebindReason(work:EffectDisclosureWork,result:Observation):'native_layout_changed'|'native_scroll_exhausted'|undefined {
 if(String(result.readback?.reason??'').startsWith('PARAMETER_LAYOUT_CHANGED'))return 'native_layout_changed';
 if(result.readback?.status==='pass'&&result.readback.steps===64&&!parameterVisibleProves(work,result.readback,result.ordinal))return 'native_scroll_exhausted';
 return undefined;
}
/** One continuation can finish a bounded sweep that already brought the exact
 * row into the viewport. A completed name-scan budget failure is also known:
 * no native action remains pending. Unknown worker failures and invisible
 * targets do not authorize another dispatch. A fresh complete effect/parameter
 * observation must prove identity before the continuation can scroll. */
export function parameterScrollCanContinue(result:Observation):boolean {
 const r=result.readback,p=r?.progress;
 return r?.status==='unverified'&&r.route==='windows_msaa_parameter_state'&&['PARAMETER_SCROLL_BUDGET','ACCESSIBILITY_NAME_READ_BUDGET'].includes(r.reason)&&r.dispatchAccepted===true
  &&p&&Number.isInteger(p.steps)&&p.steps>0&&p.steps<=64&&Number.isInteger(p.targetState)&&(p.targetState&(1|32768|65536))===0
  &&[p.targetTop,p.viewportTop,p.viewportHeight].every(Number.isFinite)&&p.viewportHeight>=80&&p.targetTop>=p.viewportTop&&p.targetTop<p.viewportTop+p.viewportHeight;
}
export type BoundEffectObservation={observation:Observation;binding:EffectHeaderBinding;index:number;anchor:Observation};
/** L1: pure facts. Display names and coordinates never identify a component. */
export function effectLayout(work:EffectDisclosureWork):string{return JSON.stringify([work.target.mediaType,work.componentMatchNames,work.target.componentIndex,work.target.disclosureScope??"match_name"]);}
export function effectOccurrenceCount(work:EffectDisclosureWork):number {
 const {target:t,componentMatchNames:names}=work,matches=names.filter(n=>n===t.componentMatchName).length;
 if(t.componentIndex!==undefined&&names[t.componentIndex]!==t.componentMatchName)return 0;
 if(matches&&(t.componentIndex!==undefined||matches===1))return t.disclosureScope==="component"?1:matches;
 // A native-only header, not a public component or a Speed value API.
 return t.componentIndex===undefined&&t.mediaType==="video"&&t.componentMatchName==="BE.TimeRemapping"&&names.filter(n=>n==="AE.ADBE Motion").length===1&&names.filter(n=>n==="AE.ADBE Opacity").length===1?1:0;
}
export function effectNativeObservationProves(work:EffectDisclosureWork,observation:unknown):observation is Observation {
 if(!observation||typeof observation!=="object")return false;const r=observation as Observation;
 return r.protocol===1&&r.status==="pass"&&r.route==="windows_msaa_effect_state"&&Number.isSafeInteger(r.premierePid)&&r.premierePid>0&&Number.isSafeInteger(r.panelHandle)&&r.panelHandle>0&&r.selectedClipTab===`${work.sequenceName} • ${work.target.clipName}`&&Array.isArray(r.headers)&&r.headers.length>0&&r.headers.length<=128&&r.headers.every((h:Observation)=>h.role===43&&Number.isInteger(h.state)&&(h.state&1)===0&&h.height>0);
}
export function effectInitialRowsHeight(work:EffectDisclosureWork):number{return work.target.parameterCount===0?21:work.target.parameterCount===1||work.target.componentMatchName==="BE.TimeRemapping"?42:80;}
function pressed(r:Observation):boolean[]{return r.headers.map((h:Observation)=>(h.state&8)!==0);}
function changedIndices(before:boolean[],after:boolean[]):number[]{return before.flatMap((v,i)=>v!==after[i]?[i]:[]);}
function targetOccurrence(work:EffectDisclosureWork):number {
 return work.target.disclosureScope==="component"||work.target.componentIndex===undefined?0:work.componentMatchNames.slice(0,work.target.componentIndex).filter(n=>n===work.target.componentMatchName).length;
}
function visibleAnchor(r:Observation,index:number,empty:boolean):Observation{return empty?r.headers[index].enable??r.headers[index]:r.headers[index];}
function desiredState(bound:BoundEffectObservation,expanded:boolean,allowOffscreen:boolean):boolean {
 const {observation:r,binding,anchor}=bound;
 return binding.headerIndices.every(i=>((r.headers[i].state&8)!==0)===expanded)&&anchor.role===43&&anchor.height>0&&(anchor.state&(allowOffscreen?1:(1|32768|65536)))===0;
}
function sectionVisible(bound:BoundEffectObservation,initialRowsHeight:number):boolean {
 const {observation:r,anchor:h}=bound,v=r.viewport;
 return v?.role===3&&Number.isFinite(v.top)&&Number.isFinite(v.height)&&v.height>=100&&Number.isFinite(h.top)&&h.top>=v.top+4&&h.top+initialRowsHeight<=v.top+v.height;
}
/** L2: an isolated preference transition identifies native headers without an
 * effect-name allowlist or guessed screen order. The adapter proves stable content. */
export function deriveEffectHeaderBinding(work:EffectDisclosureWork,before:unknown,after:unknown):EffectHeaderBinding|undefined {
 if(!effectNativeObservationProves(work,before)||!effectNativeObservationProves(work,after)||before.premierePid!==after.premierePid||before.panelHandle!==after.panelHandle||before.headers.length!==after.headers.length)return undefined;
 const b=pressed(before),a=pressed(after),indices=changedIndices(b,a),desired=work.expanded!==false;
 if(!effectOccurrenceCount(work)||indices.length!==effectOccurrenceCount(work)||indices.some(i=>b[i]===desired||a[i]!==desired))return undefined;
 return {method:"isolated_disclosure_transition",layout:effectLayout(work),matchName:work.target.componentMatchName,headerIndices:indices,before:b,after:a};
}
/** L2: independently validate a binding and resolve this slot against a fresh
 * observation. Does not call the transition-derivation theorem or any L3 API. */
export function resolveEffectObservation(work:EffectDisclosureWork,r:unknown):BoundEffectObservation|undefined {
 if(!effectNativeObservationProves(work,r))return undefined;
 const b=r.binding as EffectHeaderBinding|undefined;
 if(!b||b.method!=="isolated_disclosure_transition"||b.layout!==effectLayout(work)||b.matchName!==work.target.componentMatchName||!Array.isArray(b.before)||!Array.isArray(b.after)||!Array.isArray(b.headerIndices)||b.before.length!==r.headers.length||b.after.length!==r.headers.length||![...b.before,...b.after].every(v=>typeof v==="boolean"))return undefined;
 const indices=changedIndices(b.before,b.after);
 if(!effectOccurrenceCount(work)||indices.length!==effectOccurrenceCount(work)||JSON.stringify(indices)!==JSON.stringify(b.headerIndices)||!indices.every(i=>b.before[i]!==b.after[i]&&b.after[i]===b.after[indices[0]!]))return undefined;
 const index=indices[targetOccurrence(work)];return index===undefined?undefined:{observation:r,binding:b,index,anchor:visibleAnchor(r,index,work.target.parameterCount===0)};
}
/** L3 public results use one L2 conclusion plus L1 state/geometry predicates. */
export function effectDisclosureProves(work:EffectDisclosureWork,observation:unknown,allowOffscreen=false):boolean {
 const bound=resolveEffectObservation(work,observation);return !!bound&&desiredState(bound,work.expanded!==false,allowOffscreen);
}
export function effectSectionProves(work:EffectDisclosureWork,observation:unknown):boolean {
 const bound=resolveEffectObservation(work,observation);return !!bound&&desiredState(bound,work.expanded!==false,false)&&sectionVisible(bound,effectInitialRowsHeight(work));
}
/** L3: native identity + learned binding + desired state derive the public plan.
 * Selection, preferences, observations, caches and timing stay in I/O adapters. */
export function effectRevealPlan(work:EffectDisclosureWork,observation:unknown):"unavailable"|"calibrate"|"write"|"ready" {
 if(!effectOccurrenceCount(work)||!effectNativeObservationProves(work,observation))return "unavailable";
 const bound=resolveEffectObservation(work,observation);if(!bound)return "calibrate";
 return desiredState(bound,work.expanded!==false,true)?"ready":"write";
}
export function isEffectValueQuery(command:string,args:Record<string,any>):boolean{return command==="inspect_effects"||(command==="query_timeline"&&args.includeEffects===true);}
export function effectQueryScopeProves(command:string,args:Record<string,any>,work:EffectDisclosureWork):boolean {
 const t=work.target;
 if(!isEffectValueQuery(command,args)||!work.trackItemId?.startsWith(`${t.mediaType}:${t.trackIndex}:${t.startTicks}:`)||work.expanded===false)return false;
 if(args.ids&&!args.ids.includes(work.trackItemId)||args.mediaType&&args.mediaType!==t.mediaType||args.trackIndex!==undefined&&args.trackIndex!==t.trackIndex)return false;
 if(args.nameContains&&!t.clipName.toLowerCase().includes(String(args.nameContains).toLowerCase()))return false;
 if(args.startSeconds!==undefined&&Number(t.endTicks)/254016000000<=args.startSeconds||args.endSeconds!==undefined&&Number(t.startTicks)/254016000000>=args.endSeconds)return false;
 return t.componentMatchName===work.componentMatchNames[0]&&(t.componentIndex===undefined||t.componentIndex===0);
}

/** L1: fresh parameter observations live inside the already bound effect. */
export function parameterObservationProves(work:EffectDisclosureWork,r:any):boolean {
 return !!work.parameter&&r?.protocol===1&&r.status==="pass"&&r.route==="windows_msaa_parameter_state"&&r.selectedClipTab===`${work.sequenceName} • ${work.target.clipName}`&&Number.isSafeInteger(r.premierePid)&&r.premierePid>0&&Number.isSafeInteger(r.panelHandle)&&r.panelHandle>0&&Array.isArray(r.rows)&&r.rows.length<=512&&r.rows.every((p:any,i:number)=>p.ordinal===i&&p.role===43&&Number.isInteger(p.state));
}
/** L2: only an isolated false -> true property transition binds a parameter. */
export function deriveParameterOrdinal(work:EffectDisclosureWork,before:any,after:any):number|undefined {
 if(!parameterObservationProves(work,before)||!parameterObservationProves(work,after)||before.premierePid!==after.premierePid||before.panelHandle!==after.panelHandle||before.headerIndex!==after.headerIndex||before.rows.length!==after.rows.length)return undefined;
 const changed=before.rows.flatMap((r:any,i:number)=>((r.state&8)!==(after.rows[i].state&8))?[i]:[]);
 return changed.length===1&&(before.rows[changed[0]].state&8)===0&&(after.rows[changed[0]].state&8)!==0?changed[0]:undefined;
}
/** L3: causal identity + current disclosure + viewport prove the actual row. */
export function parameterVisibleProves(work:EffectDisclosureWork,r:any,ordinal:unknown):boolean {
 if(!parameterObservationProves(work,r)||!Number.isInteger(ordinal))return false;
 const p=r.rows[Number(ordinal)],v=r.viewport;
 if(work.parameter!.inlineColor){
  const expected=work.parameter!.inlineColor,proof=r.rowMapping,controls=p?.inlineColorControls;
  return Number(ordinal)===work.parameter!.paramIndex&&r.rows.length===work.target.parameterCount&&proof?.method==='complete_native_parameter_rows'
   &&proof.parameterCount===work.target.parameterCount&&JSON.stringify(proof.colorIndices)===JSON.stringify(expected.indices)
   &&expected.indices.includes(Number(ordinal))&&!!p&&((p.state&8)!==0)===expected.timeVarying&&(p.state&(1|32768|65536))===0
   &&['애니메이션 켜기/끄기','Toggle animation'].includes(p.name)&&p.height>0&&p.width>0&&v?.height>=80&&p.top>=v.top+4&&p.top+p.height<=v.top+v.height
   &&Array.isArray(controls)&&controls.length===4&&controls.every((c:any,i:number)=>c.index===p.index+i+1&&c.role===43&&Number.isInteger(c.state)
    &&(c.state&(32768|65536))===0&&c.height>0&&c.width>0&&Math.abs(c.top-p.top)<=4&&c.top>=v.top+4&&c.top+c.height<=v.top+v.height)
   &&['이전 키프레임으로 이동','Go to previous keyframe'].includes(controls[0].name)&&['다음 키프레임으로 이동','Go to next keyframe'].includes(controls[1].name)
   &&['키프레임 추가/제거','Add/Remove Keyframe'].includes(controls[2].name)&&['매개 변수 재설정','Reset Parameter'].includes(controls[3].name);
 }
 if(!p||((p.state&8)!==0)!==work.parameter!.expanded||(p.state&1)!==0||!(p.height>0)||!(v?.height>=80))return false;
 if(work.parameter!.disclosureKey==='ECP.Custom.Expanded'){
  const b=p.customGraphBoundary,next=r.rows[Number(ordinal)+1]?.index??p.index+32;
  return (p.state&(32768|65536))===0&&p.top>=v.top+4&&!!b&&Number.isInteger(b.index)&&b.index>p.index&&b.index<p.index+32
   &&b.role===43&&(b.index<next&&['매개 변수 재설정','Reset Parameter'].includes(b.name)||b.index===next&&b.name==='UI_DisclosureTriangleButton'&&(b.state&(1|32768|65536))===0)
   &&b.height>0&&b.width>0&&b.top>p.top+42&&b.top<=v.top+v.height-4;
 }
 if((p.state&(32768|65536))===0&&p.top>=v.top+4&&p.top+42<=v.top+v.height)return true;
 const controls=p.inlinePointControls,next=r.rows[Number(ordinal)+1]?.index??p.index+25;
 return work.parameter!.disclosureKey==='ECP.PointParameter.Expanded'&&(p.state&32768)!==0&&Array.isArray(controls)&&controls.length===2&&controls[0].index<controls[1].index&&controls.every((c:any)=>Number.isInteger(c.index)&&c.index>p.index&&c.index<Math.min(next,p.index+25)&&c.name==='UI_HotText'&&c.role===42&&Number.isInteger(c.state)&&(c.state&(1|32768|65536))===0&&typeof c.value==='string'&&c.value.length>0&&c.width>0&&c.height>0&&c.left>p.left&&Math.abs(c.top-p.top)<=4&&c.top>=v.top+4&&c.top+c.height<=v.top+v.height);
}
