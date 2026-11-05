import {describe,it,expect} from "vitest";
import {isIntrinsicEffect,colorKeyframeConversionMatches,describeEffectParameter,effectValuesEqual,preflightParameterValue,preflightParameterWrites,verifyParameterPreservation} from "../../apps/uxp-plugin/src/effect-parameter-contract.js";
import {effectParameters} from "../../apps/mcp-server/src/tool-inputs.js";
import {effectTime,nativeToSequenceTime} from "../../apps/uxp-plugin/src/effect-time.js";
import {parseTimelineId,queryBounds} from "../../apps/uxp-plugin/src/item-query.js";
describe("observed native effect contracts",()=>{
 it("keeps native analyzer status observable but read-only and outside content preservation",()=>{
  const param={paramIndex:31,displayName:"AnalysisStatusCounter",value:305,timeVarying:false,keyframes:[],readStatus:{value:"pass",animation:"pass"}};
  const descriptor=describeEffectParameter('AE.ADBE SubspaceStabilizer',param);
  expect(descriptor).toMatchObject({semanticRole:'host_status',staticWrite:'read_only_host_status'});
  const before=[{componentIndex:0,matchName:'AE.ADBE SubspaceStabilizer',params:[{...param,descriptor}]}],after=structuredClone(before);after[0]!.params[0]!.value=408;
  expect(verifyParameterPreservation(before,after,[])).toEqual([]);
  after[0]!.params[0]!.timeVarying=true;expect(verifyParameterPreservation(before,after,[])).not.toEqual([]);
  expect(()=>preflightParameterWrites(before[0]!,[{paramIndex:31,value:400}])).toThrow('READ_ONLY_HOST_STATUS');
  expect(describeEffectParameter('vendor.unrelated',param).semanticRole).toBeNull();
 });
 it("ignores changing UI labels while preserving actual values and surviving effects",()=>{
  const before=[{componentIndex:0,matchName:'analyzer',params:[{paramIndex:0,displayName:'Analyzing.',value:5,descriptor:{selector:{expectedDisplayName:'Analyzing.'}}}]}];
  const after=structuredClone(before);after[0]!.params[0]!.displayName='Analyzing..';after[0]!.params[0]!.descriptor.selector.expectedDisplayName='Analyzing..';
  expect(verifyParameterPreservation(before,after,[])).toEqual([]);
  after[0]!.params[0]!.value=6;expect(verifyParameterPreservation(before,after,[])).not.toEqual([]);
  expect(verifyParameterPreservation(before,after,[{componentIndex:0,paramIndex:0}])).toEqual([]);
  expect(verifyParameterPreservation(before,[...after,{componentIndex:1,matchName:'unexpected',params:[]}],[{componentIndex:0,paramIndex:0}])).not.toEqual([]);
 });
 it("accepts inspected native point guards but requires tagged mutation points",()=>{
  const selector={paramIndex:0,expectedDisplayName:""};
  expect(effectParameters.safeParse([{...selector,expectedValue:[.5,.5],value:{kind:"point",x:.6,y:.5}}]).success).toBe(true);
  expect(effectParameters.safeParse([{...selector,value:[.6,.5]}]).success).toBe(false);
 });
 it("permits empty default animation only for an owned new instance",()=>{
  const param={paramIndex:0,displayName:"Gain",value:0,keyframes:[],timeVarying:true,readStatus:{value:"pass",animation:"pass"},descriptor:{inputKind:"number"}};
  const writes=[{paramIndex:0,expectedDisplayName:"Gain",value:1}];
  expect(()=>preflightParameterWrites({params:[param]},writes)).toThrow("PARAMETER_ANIMATED");
  expect(preflightParameterWrites({params:[param]},writes,true)).toHaveLength(1);
  expect(()=>preflightParameterWrites({params:[{...param,keyframes:[{time:1}]}]},writes,true)).toThrow("PARAMETER_ANIMATED");
 });
 it("uses native intrinsic identity, never a factory label shared by installed filters",()=>{
  for(const matchName of ["AE.ADBE Motion","Internal Volume Stereo","Internal Channel Volume Mono","BE.TimeRemapping"])expect(isIntrinsicEffect({matchName})).toBe(true);
  for(const matchName of ["vendor.Motion","ADBE Volume","AE.ADBE Tint","Internal Volume","Internal Channel Volume"])expect(isIntrinsicEffect({matchName})).toBe(false);
 });
 it("detects Premiere's uint64 alpha/blue precision loss before mutation",()=>{
  const color={kind:"color",red:.2,green:.4,blue:.8,alpha:1};
  expect(colorKeyframeConversionMatches(Number(0xff0033006600cc00n),color)).toBe(false);
  expect(colorKeyframeConversionMatches(Number(0x000033006600cc00n),{...color,alpha:0})).toBe(true);
 });
 it("rejects rounded opaque cyan but accepts exact opaque channels and Color objects",()=>{
  const cyan={kind:"color",red:0,green:1,blue:1,alpha:1};
  // The blue channel carries into green even though each requested RGB channel
  // is exactly zero or one. This is uint64 Number precision, not premultiplication.
  expect(BigInt(Number(0xff000000ff00ff00n))).toBe(0xff000000ff010000n);
  expect(colorKeyframeConversionMatches(Number(0xff000000ff00ff00n),cyan)).toBe(false);
  expect(colorKeyframeConversionMatches(Number(0x00000000ff00ff00n),{...cyan,alpha:0})).toBe(true);
  expect(colorKeyframeConversionMatches(Number(0xff00ff0000000000n),{kind:"color",red:1,green:0,blue:0,alpha:1})).toBe(true);
  expect(colorKeyframeConversionMatches({red:0,green:1,blue:1,alpha:1},cyan)).toBe(true);
  const preserved=preflightParameterValue({descriptor:{inputKind:"color"},value:{alpha:1}},{kind:"color",red:0,green:1,blue:1});
  expect(preserved).toEqual(cyan);
  expect(colorKeyframeConversionMatches(Number(0xff000000ff00ff00n),preserved)).toBe(false);
 });
 it("preserves alpha and scalar types",()=>{
  const p={descriptor:{inputKind:"color"},value:{red:0,green:0,blue:0,alpha:0}};
  expect(preflightParameterValue(p,{kind:"color",red:1,green:0,blue:0})).toMatchObject({alpha:0});
  expect(effectValuesEqual("1",1)).toBe(false);
  expect(()=>preflightParameterValue({descriptor:{inputKind:"boolean"}},1)).toThrow("TYPE_MISMATCH");
 });
 it("identifies localized native geometry without inventing bounds",()=>{
  const d=describeEffectParameter("AE.ADBE Motion",{displayName:"비율 조정",paramIndex:1,value:100,readStatus:{value:"pass",animation:"pass"},timeVarying:false});
  expect(d).toMatchObject({semanticRole:"scale",inputKind:"number",unit:"percent",range:null,choices:null});
  expect(describeEffectParameter("AE.ADBE Shape",{displayName:"위치",value:[.5,.5],readStatus:{value:"pass",animation:"pass"}}).keyframeWrite).toBe("native_saved_interpolation_readback_required");
 });
 it("maps exact sequence ticks to source without floating round trips",()=>{
  const clip={start:{ticks:"3534353222400"},end:{ticks:"7594197811200"},inPoint:{ticks:"1495499673600"},speed:1,reversed:false};
  const t="3542828889601";const mapped=effectTime(clip,{timeTicks:t});
  expect(nativeToSequenceTime(clip,mapped.nativeTicks)?.ticks).toBe(t);
  expect(()=>effectTime(clip,{timeTicks:clip.end.ticks})).toThrow("OUTSIDE_CLIP");
  expect(()=>effectTime({...clip,speed:2},{timeTicks:t})).toThrow("MAPPING_UNSUPPORTED");
 });
 it("discovers point parameters from native shape for arbitrary effect vendors",()=>{
  for(const value of [{x:120,y:50},[120,50]])expect(describeEffectParameter('vendor.arbitrary',{displayName:'Custom origin',value,readStatus:{value:'pass',animation:'pass'},timeVarying:false})).toMatchObject({inputKind:'point',semanticRole:null,unit:null,staticWrite:'preflight_required'});
  expect(describeEffectParameter('vendor.arbitrary',{displayName:'Opaque matrix',value:[1,2,3,4],readStatus:{value:'pass',animation:'pass'}}).inputKind).toBeNull();
 });
 it("bounds expensive metadata reads and accepts a real native graphic ID",()=>{
  expect(()=>queryBounds({includeSourceMetadata:true,limit:21})).toThrow("INVALID_QUERY");
  expect(parseTimelineId("video:1:0:")?.projectItemId).toBe("");
 });
});
