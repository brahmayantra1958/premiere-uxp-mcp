import { hostNumericValuesEqual } from "./component-write.js";
import { unwrapHostValue } from "./host-value.js";
import { equalSnapshotValue as snapshotsEqual } from "./snapshot-equality.js";

type RecordValue = Record<string, any>;
/** L1: generated components have fixed native owners. Installed filters, even
 * with the same display label, keep per-instance Properties. Localized labels
 * are not identity and must not determine disclosure or deletion protection. */
export function isIntrinsicEffect(component: {matchName?: unknown}): boolean {
  const name=String(component.matchName??"");
  return /^AE\.ADBE (Motion|Opacity|Time Remapping|Volume|Channel Volume|Panner)$/.test(name)
    || /^Internal (?:Channel )?Volume .+$/.test(name)
    || /^Internal Panner(?: |$)/.test(name)
    || name==="BE.TimeRemapping";
}
export type ParameterSelector = { paramIndex?: number; parameterName?: string; expectedDisplayName?: string };
export type ParameterWrite = ParameterSelector & { value: unknown; expectedValue?: unknown };
const folded = (value: unknown) => String(value ?? "").toLocaleLowerCase("en-US");

/** Point/Color are semantic values. Native Variant arrays are not plain PointF
 * objects; compare both representations without coercing strings or booleans. */
export function effectValuesEqual(actualValue: unknown, expectedValue: unknown): boolean {
  const actual: any = unwrapHostValue(actualValue), expected: any = unwrapHostValue(expectedValue);
  if (expected?.kind === "point") {
    const coordinates = Array.isArray(actual) ? actual : [actual?.x, actual?.y];
    return coordinates.length === 2 && [expected.x, expected.y].every((v, i) => typeof coordinates[i] === "number" && hostNumericValuesEqual(coordinates[i], v));
  }
  if (expected?.kind === "color") {
    const channels = Array.isArray(actual) ? actual : [actual?.red, actual?.green, actual?.blue, actual?.alpha];
    return channels.length === 4 && [expected.red, expected.green, expected.blue, expected.alpha ?? channels[3]].every((v, i) => typeof channels[i] === "number" && hostNumericValuesEqual(channels[i], v));
  }
  if (typeof actual === "number" && typeof expected === "number") return hostNumericValuesEqual(actual, expected);
  if (Array.isArray(actual) && Array.isArray(expected)) return actual.length === expected.length && actual.every((v, i) => effectValuesEqual(v, expected[i]));
  return snapshotsEqual(actual, expected);
}

/** An index identifies the native slot; its observed name guards drift. Names
 * are a compatibility selector only when unique within the selected component. */
export function resolveEffectParameter(component: RecordValue, selector: ParameterSelector): RecordValue {
  const params: RecordValue[] = component.params ?? [];
  const matches = selector.paramIndex === undefined
    ? params.filter(p => folded(p.displayName) === folded(selector.parameterName))
    : params.filter(p => p.paramIndex === selector.paramIndex);
  if (matches.length !== 1) throw Error(`PARAMETER_${matches.length ? "AMBIGUOUS" : "NOT_FOUND"}: ${selector.parameterName ?? selector.paramIndex}; use paramIndex and expectedDisplayName from inspection`);
  const param = matches[0]!;
  if (selector.expectedDisplayName !== undefined && param.displayName !== selector.expectedDisplayName) throw Error("PARAMETER_IDENTITY_CHANGED: display name differs from inspection");
  if (selector.parameterName !== undefined && folded(param.displayName) !== folded(selector.parameterName)) throw Error("PARAMETER_IDENTITY_CHANGED: parameter name differs from inspection");
  return param;
}

export function parameterWrites(values: Record<string, unknown> | undefined, parameters: ParameterWrite[] | undefined): ParameterWrite[] {
  if (values && Object.keys(values).length && parameters?.length) throw Error("Use either values or parameters, not both");
  if(values && Object.keys(values).some(name=>/^\d+$/.test(name)))throw Error('PARAMETER_INDEX_REQUIRES_IDENTITY: values/initialValues keys are display names. Use parameters/initialParameters:[{paramIndex:1,expectedDisplayName:"<inspected name>",value:...}] instead of {"1":...}');
  const writes = parameters ?? Object.entries(values ?? {}).map(([parameterName, value]) => ({ parameterName, value }));
  if (!writes.length) throw Error("At least one parameter write is required");
  return writes;
}

export function requireReadableParameter(param: RecordValue, staticWrite = false,preserveEmptyAnimation=false): void {
  if(["group_start","group_end"].includes(param.descriptor?.nativeKind))throw Error(`PARAMETER_IS_UI_GROUP: ${param.paramIndex}:${param.displayName}; use disclosure, not value writes`);
  if(param.descriptor?.semanticRole==="host_status")throw Error(`PARAMETER_READ_ONLY_HOST_STATUS: ${param.paramIndex}:${param.displayName}`);
  if(param.valueKind==="opaque") throw Error(`PARAMETER_VALUE_SHAPE_UNSUPPORTED: ${param.paramIndex}:${param.displayName}`);
  const exactColorKeys=!staticWrite && param.nativeValueType==="color" && param.readStatus?.value==="unsupported";
  if ((!exactColorKeys && param.readStatus?.value !== "pass") || param.readStatus?.animation !== "pass" || typeof param.timeVarying !== "boolean") {
    throw Error(`PARAMETER_READ_UNVERIFIED: ${param.paramIndex}:${param.displayName}`);
  }
  if (staticWrite && (param.keyframes.length || param.timeVarying&&!preserveEmptyAnimation)) throw Error(`PARAMETER_ANIMATED: ${param.displayName}; if the fresh key list is empty, pass preserveEmptyAnimation:true. If keys exist, inspect and use an explicit keyframe edit; static writes never disable animation.`);
}

export function preflightParameterValue(snapshot: RecordValue, value: unknown): unknown {
  const kind=snapshot.descriptor?.inputKind;
  if(!kind) throw Error(`PARAMETER_VALUE_SHAPE_UNSUPPORTED: ${snapshot.paramIndex}:${snapshot.displayName}`);
  if(["number","string","boolean"].includes(kind) ? typeof value!==kind : (value as any)?.kind!==kind) throw Error(`PARAMETER_VALUE_TYPE_MISMATCH: expected ${kind} for ${snapshot.displayName}`);
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw Error("PARAMETER_VALUE_NOT_FINITE");
    const range=snapshot.descriptor?.range;
    if(range&&(range.min!==null&&value<range.min||range.max!==null&&value>range.max))throw Error(`PARAMETER_OUT_OF_NATIVE_RANGE: ${snapshot.displayName}`);
  }
  if((value as any)?.kind!=="color")return value;
  const alpha=(value as any).alpha ?? snapshot.value?.alpha;
  if(alpha===undefined)throw Error("COLOR_ALPHA_REQUIRED: animated Color has no sampled alpha; use an inspected exact key value");
  return {...(value as any),alpha};
}

/** Saved definitions supplement public UXP values only after exact slot/name
 * correlation. They do not turn custom native data into editable scalar values. */
export function enrichEffectParameterSchema(component:RecordValue,schema:RecordValue|undefined,projection=false):RecordValue {
  if(!schema||schema.status!=="pass"||schema.matchName!==component.matchName||schema.componentIndex!==component.componentIndex||!Array.isArray(schema.parameters)||!projection&&schema.parameters.length!==component.params.length)return component;
  if(component.params.some((p:RecordValue)=>schema.parameters[p.paramIndex]?.paramIndex!==p.paramIndex||schema.parameters[p.paramIndex]?.name!==p.displayName))return component;
  return {...component,params:component.params.map((p:RecordValue)=>{
    const definition=schema.parameters[p.paramIndex],group=["group_start","group_end"].includes(definition.kind);
    return {...p,descriptor:{...p.descriptor,nativeKind:definition.kind,nativeControlType:definition.controlType,nativeParameterId:definition.nativeId,ancestorParameterIndices:definition.ancestors,disclosureKey:definition.disclosureKey,
      range:definition.range,uiRange:definition.uiRange,choices:definition.choices,boundsSource:schema.source,
      ...(group?{staticWrite:"ui_group_not_value",keyframeWrite:"unsupported"}:{})}};
  })};
}

/** Missing serialized intrinsic defaults do not supply a group path or bounds.
 * A scalar/Point can still try its public UI property; only a later isolated
 * native triangle transition can prove identity/expansion, never this plan. */
export function parameterDisclosurePath(snapshot:RecordValue,schema:RecordValue|undefined):Array<{paramIndex:number;name:string;key:string}>|undefined {
  if(schema?.status==="pass"){
    const definition=schema.parameters?.[snapshot.paramIndex];
    if(!definition||definition.name!==snapshot.displayName||!definition.disclosureKey)return undefined;
    const rows=[...definition.ancestors,definition.paramIndex].map(index=>{const row=schema.parameters[index];if(!row?.disclosureKey)throw Error("PARAMETER_ANCESTOR_DISCLOSURE_MISSING");return {paramIndex:index,name:row.name,key:row.disclosureKey};});
    const container=schema.containerDisclosure;
    if(container?.key==="ECP.NonParamGroup.Expanded"&&container.paramIndex===0&&container.name===schema.parameters[0]?.name&&snapshot.paramIndex>0)rows.unshift(container);
    return rows;
  }
  const key=snapshot.descriptor?.inputKind==="number"?"ECP.Slider.Expanded":snapshot.descriptor?.inputKind==="point"?"ECP.PointParameter.Expanded":undefined;
  return key?[{paramIndex:snapshot.paramIndex,name:snapshot.displayName,key}]:undefined;
}

/** Both UXP key positions/values and the freshly saved native temporal modes
 * must agree. A save file alone or a requested mode cannot complete the proof. */
export function enrichPointAnimation(component:RecordValue,archive:RecordValue):RecordValue {
  if(archive.status!=="pass"||archive.matchName!==component.matchName||archive.componentIndex!==component.componentIndex||!Array.isArray(archive.pointAnimation))throw Error("POINT_ANIMATION_ARCHIVE_UNVERIFIED");
  const params=component.params.map((p:RecordValue)=>{
    if(p.descriptor.inputKind!=="point")return p;
    const native=archive.pointAnimation.find((a:RecordValue)=>a.paramIndex===p.paramIndex);
    if(!native||native.keys.length!==p.keyframes.length||native.keys.some((k:RecordValue,i:number)=>k.ticks!==p.keyframes[i]?.ticks||!effectValuesEqual(p.keyframeDetails[i]?.value,{kind:"point",...k.value})))throw Error("POINT_ANIMATION_PUBLIC_NATIVE_MISMATCH");
    if(!p.keyframes.length)return p;
    return {...p,keyframeDetails:p.keyframeDetails.map((k:RecordValue,i:number)=>({...k,nativePointFields:native.keys[i].nativeFields,interpolationMode:native.keys[i].interpolationMode,interpolation:({0:"linear",4:"hold",5:"bezier"} as Record<number,string>)[native.keys[i].interpolationMode]??"unknown"})),readStatus:{...p.readStatus,animation:"pass"},readErrors:p.readErrors.filter((e:string)=>e!=="POINT_INTERPOLATION_REQUIRES_SAVED_NATIVE_READBACK"),descriptor:{...p.descriptor,keyframeWrite:"native_saved_interpolation_readback",animationProofSource:"public_key_values_and_fresh_saved_point_records"}};
  });
  return {...component,params,readbackCoverage:{...component.readbackCoverage,unverifiedParameterIndices:params.filter((p:RecordValue)=>p.readStatus.value==="unverified"||p.readStatus.animation!=="pass").map((p:RecordValue)=>p.paramIndex)}};
}

/** Premiere 26.5 may marshal native Color through an imprecise JS uint64.
 * Decode the observable conversion before dispatch; never accept rounded blue. */
export function colorKeyframeConversionMatches(actual: unknown, requested: unknown): boolean {
  if(typeof actual!=="number") return effectValuesEqual(actual,requested);
  if(!Number.isFinite(actual)||!Number.isInteger(actual)||actual<0)return false;
  const bits=BigInt(actual);
  return effectValuesEqual({red:Number((bits>>32n)&65535n)/65280,green:Number((bits>>16n)&65535n)/65280,blue:Number(bits&65535n)/65280,alpha:Number((bits>>48n)&65535n)/65280},requested);
}

export function preflightParameterWrites(component: RecordValue, writes: ParameterWrite[], newInstance=false,preserveEmptyAnimation=false): Array<{ snapshot: RecordValue; write: ParameterWrite }> {
  const seen = new Set<number>();
  return writes.map(write => {
    const snapshot = resolveEffectParameter(component, write);
    if (seen.has(snapshot.paramIndex)) throw Error(`DUPLICATE_PARAMETER: ${snapshot.paramIndex}`);
    seen.add(snapshot.paramIndex);
    // Only a just-created owned instance can initialize a default animated
    // parameter as a constant. Existing effects retain the strict animation guard.
    requireReadableParameter(snapshot,true,newInstance||preserveEmptyAnimation);
    const value=preflightParameterValue(snapshot,write.value);
    if (Object.hasOwn(write, "expectedValue") && !effectValuesEqual(snapshot.value, write.expectedValue)) throw Error(`PARAMETER_VALUE_CHANGED: ${snapshot.displayName}`);
    const resolved = {...write,value};
    return { snapshot, write:resolved };
  });
}

function parameterContent(param:RecordValue):RecordValue {
  // Premiere changes localized Scale -> Vertical Scale labels when a native
  // graphic's Properties UI initializes. Labels/descriptors are selector
  // metadata, not effect state; values, indices, animation and read health are.
  const {displayName:_name,descriptor:_descriptor,...content}=param;
  // Warp Stabilizer increments this native status counter on selection/reveal,
  // even after analysis completes. Keep its observed value in query output;
  // it is not editable content. Animation/read health remain part of proof.
  void _name;return _descriptor?.semanticRole==="host_status"?{...content,value:undefined}:content;
}
function componentContent(component: RecordValue): RecordValue {
  const { componentIndex: _index, ...content } = component;
  void _index;
  return {...content,params:content.params.map(parameterContent)};
}

/** Count equality alone is not effect identity/preservation evidence. */
export function verifyEffectChainChange(before: RecordValue[], after: RecordValue[], change: { kind: "add" | "remove"; index: number; matchName?: string; displayName?: string }): string[] {
  const errors: string[] = [];
  const delta = change.kind === "add" ? 1 : -1;
  if (after.length !== before.length + delta) errors.push("Effect count differs from the requested change");
  if (change.kind === "add") {
    const inserted = after[change.index];
    if (!inserted || (change.matchName !== undefined && inserted.matchName !== change.matchName) || (change.displayName !== undefined && inserted.displayName !== change.displayName)) errors.push("Effect was not inserted at the requested index");
  }
  const oldSurvivors = before.filter((_, i) => change.kind !== "remove" || i !== change.index).map(componentContent);
  const newSurvivors = after.filter((_, i) => change.kind !== "add" || i !== change.index).map(componentContent);
  if (!snapshotsEqual(oldSurvivors, newSurvivors)) errors.push("Unrelated effect order, values, or animation changed");
  return errors;
}

export function verifyParameterPreservation(before: RecordValue[], after: RecordValue[], allowed: Array<{ componentIndex: number; paramIndex: number }>,valueOnly: Array<{componentIndex:number;paramIndex:number}>=[]): string[] {
  const permitted = new Set(allowed.map(p => `${p.componentIndex}:${p.paramIndex}`));
  // Native derived values need explicit expected before/after proof at the
  // caller. This permission never covers their animation, keys or read health.
  const derived=new Set(valueOnly.map(p=>`${p.componentIndex}:${p.paramIndex}`));
  const stable = (chain: RecordValue[]) => chain.map(c => ({ ...c, params: c.params.map((p: RecordValue) => permitted.has(`${c.componentIndex}:${p.paramIndex}`)
    ? { paramIndex: p.paramIndex } : parameterContent(derived.has(`${c.componentIndex}:${p.paramIndex}`)?{...p,value:undefined}:p)) }));
  return snapshotsEqual(stable(before), stable(after)) ? [] : ["Unrequested component/parameter state changed"];
}

/** Metadata never invents a native range/enum. Known Motion units describe the
 * observed Premiere component contract; all other effect-specific bounds stay null. */
export function describeEffectParameter(matchName: string, param: RecordValue): RecordValue {
  const name = folded(param.displayName);
  const hostStatus=matchName==="AE.ADBE SubspaceStabilizer"&&param.paramIndex===31&&param.displayName==="AnalysisStatusCounter";
  const motion = ["AE.ADBE Motion", "AE.ADBE Graphic Group", "AE.ADBE Shape", "AE.ADBE Text"].includes(matchName);
  const role = motion ? (
    ["position", "위치"].includes(name) ? "position" : ["anchor point", "기준점"].includes(name) ? "anchor" :
    ["scale", "비율 조정", "세로 비율", "vertical scale"].includes(name) ? "scale" : ["scale width", "폭 비율 조정", "가로 비율", "horizontal scale"].includes(name) ? "scaleWidth" :
    ["rotation", "회전"].includes(name) ? "rotation" : (param.paramIndex === 3 && (name.trim() === "" || name === "uniform scale")) ? "uniformScale" : null) : null;
  const value = param.value;
  const pointShape=value&&typeof value==="object"&&(Array.isArray(value)?value.length===2&&value.every(n=>typeof n==="number"&&Number.isFinite(n)):typeof value.x==="number"&&typeof value.y==="number");
  const inputKind = role === "position" || role === "anchor" || pointShape ? "point" : param.nativeValueType==="color" || value && typeof value === "object" && ["red", "green", "blue", "alpha"].every(k => typeof value[k] === "number") ? "color" :
    ["number", "string", "boolean"].includes(typeof value) ? typeof value : null;
  const readable = (param.readStatus.value === "pass" || param.nativeValueType==="color" && param.timeVarying && param.readStatus.value==="unsupported") && param.readStatus.animation === "pass";
  return { selector: { paramIndex: param.paramIndex, expectedDisplayName: param.displayName }, inputKind, semanticRole: hostStatus?"host_status":role,
    unit: role === "position" || role === "anchor" ? "normalized_xy" : role === "scale" || role === "scaleWidth" ? "percent" : role === "rotation" ? "degrees" : null,
    range: null, choices: null, boundsSource: "not_exposed_by_public_uxp",
    staticWrite: hostStatus?"read_only_host_status":param.valueKind==="opaque" ? "unsupported_value_shape" : !readable ? "unverified" : !inputKind ? "unsupported_value_shape" : param.timeVarying ? "requires_explicit_animation_edit" : "preflight_required",
    keyframeWrite: hostStatus?"unsupported":inputKind==="point" ? "native_saved_interpolation_readback_required" : !readable ? "unverified" : !inputKind ? "unsupported_value_shape" : param.supportsKeyframes === true ? "native_type_preflight_required" : param.supportsKeyframes === false ? "unsupported" : "unknown",
    ...(param.timeVarying&&param.keyframes?.length===0&&!hostStatus?{emptyAnimationBaseValue:"explicit_preserveEmptyAnimation_required"}:{}),
    ...(inputKind==="color" ? {nativePrecision:"conversion_roundtrip_required",alphaDefault:"preserve_inspected_alpha"}: {}) };
}
