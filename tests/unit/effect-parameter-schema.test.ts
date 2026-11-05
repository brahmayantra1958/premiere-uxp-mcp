import {describe,it,expect} from 'vitest';
import {inspectEffectParameterSchema,parameterSchemaFromBlock} from '../../apps/mcp-server/src/effect-parameter-schema.js';
import {parameterDisclosurePath,enrichEffectParameterSchema,preflightParameterWrites,verifyParameterPreservation} from '../../apps/uxp-plugin/src/effect-parameter-contract.js';
const target={sequenceId:'seq',trackIndex:0,startTicks:'100',endTicks:'200',projectItemId:'source',clipName:'clip.mov',mediaType:'video' as const,componentIndex:1,componentMatchName:'vendor.fx',componentMatchNames:['AE.ADBE Opacity','vendor.fx'],parameterNames:['Group','Gain','']};
function fixture(){return `<Data><Sequence ObjectUID="seq"><Second ObjectRef="1"/></Sequence><VideoTrackGroup ObjectID="1"><Track Index="0" ObjectURef="track"/></VideoTrackGroup><VideoTrack ObjectUID="track"><TrackItem Index="0" ObjectRef="2"/></VideoTrack><VideoClipTrackItem ObjectID="2"><Start>100</Start><End>200</End><SubClip ObjectRef="3"/><Components ObjectRef="4"/></VideoClipTrackItem><ClipProjectItem ObjectUID="source"><MasterClip ObjectURef="master"/></ClipProjectItem><SubClip ObjectID="3"><Name>clip.mov</Name><MasterClip ObjectURef="master"/></SubClip><VideoComponentChain ObjectID="4"><DefaultOpacity>true</DefaultOpacity><Component Index="0" ObjectRef="5"/></VideoComponentChain><VideoFilterComponent ObjectID="5"><MatchName>vendor.fx</MatchName><Param Index="0" ObjectRef="6"/><Param Index="1" ObjectRef="7"/><Param Index="2" ObjectRef="8"/></VideoFilterComponent><VideoComponentParam ObjectID="6"><Name>Group</Name><ParameterControlType>11</ParameterControlType><StartKeyframe>0,false,0</StartKeyframe></VideoComponentParam><VideoComponentParam ObjectID="7"><Name>Gain</Name><LowerBound>-20</LowerBound><UpperBound>20</UpperBound><LowerUIBound>-10</LowerUIBound><UpperUIBound>10</UpperUIBound><StartKeyframe>0,0,0</StartKeyframe></VideoComponentParam><VideoComponentParam ObjectID="8"><Name></Name><ParameterControlType>12</ParameterControlType></VideoComponentParam></Data>`;}
describe('native parameter definition correlation',()=>{
 it('opens custom controls only when the actual native archive declares their disclosure key',()=>{
  const block='<ArbVideoComponentParam><ParameterControlType>9</ParameterControlType><ECP.Custom.Expanded>false</ECP.Custom.Expanded></ArbVideoComponentParam>';
  expect(parameterSchemaFromBlock(block,0,[]).disclosureKey).toBe('ECP.Custom.Expanded');
  expect(parameterSchemaFromBlock(block.replace('<ECP.Custom.Expanded>false</ECP.Custom.Expanded>',''),0,[]).disclosureKey).toBeNull();
 });
 it('keeps an inferred disclosure probe distinct from proven metadata and rejects known non-disclosure controls',()=>{
  const snapshot={paramIndex:1,displayName:'Gain',descriptor:{inputKind:'number'}};
  expect(parameterDisclosurePath(snapshot,undefined)).toEqual([{paramIndex:1,name:'Gain',key:'ECP.Slider.Expanded'}]);
  expect(parameterDisclosurePath({...snapshot,descriptor:{inputKind:'boolean'}},undefined)).toBeUndefined();
  const schema=inspectEffectParameterSchema(fixture(),target);expect(parameterDisclosurePath(snapshot,schema)?.map(p=>p.paramIndex)).toEqual([0,1]);
  expect(parameterDisclosurePath({...snapshot,paramIndex:2,displayName:''},schema)).toBeUndefined();
 });
 it('aligns omitted intrinsic owners and builds nested parameter paths',()=>{const s=inspectEffectParameterSchema(fixture(),target);expect(s.parameters[1]).toMatchObject({name:'Gain',ancestors:[0],range:{min:-20,max:20},uiRange:{min:-10,max:10},disclosureKey:'ECP.Slider.Expanded'});expect(s.parameters[0]?.kind).toBe('group_start');expect(s.parameters[2]?.kind).toBe('group_end');});
 it('rejects stale names, duplicate instances, malformed groups and wrong sources',()=>{
  expect(()=>inspectEffectParameterSchema(fixture(),{...target,parameterNames:['Other','Gain','']})).toThrow('NAME_CHANGED');
  expect(()=>inspectEffectParameterSchema(fixture(),{...target,componentMatchNames:['vendor.fx','vendor.fx']})).toThrow('OCCURRENCES_CHANGED');
  expect(()=>inspectEffectParameterSchema(fixture().replace('<ParameterControlType>11','<ParameterControlType>0'),target)).toThrow('UNBALANCED_GROUP');
  expect(()=>inspectEffectParameterSchema(fixture(),{...target,projectItemId:'wrong'})).toThrow();
 });
 it('retains unknown bounds and custom storage without inventing enum choices',()=>{
  const n=parameterSchemaFromBlock('<VideoComponentParam><UpperBound>9</UpperBound><StartKeyframe>0,2,0</StartKeyframe></VideoComponentParam>',0,[]);expect(n.range).toEqual({min:null,max:9});expect(n.choices).toBeNull();
  expect(parameterSchemaFromBlock('<ArbVideoComponentParam><Name>Curve</Name></ArbVideoComponentParam>',0,[])).toMatchObject({kind:'opaque',disclosureKey:null});
  expect(()=>parameterSchemaFromBlock('<VideoComponentParam><LowerBound>10</LowerBound><UpperBound>9</UpperBound></VideoComponentParam>',0,[])).toThrow('INVALID_BOUNDS');
 });
 it('uses native bounds for preflight and never treats group Booleans as values',()=>{
  const schema=inspectEffectParameterSchema(fixture(),target),component={componentIndex:1,matchName:'vendor.fx',params:target.parameterNames.map((displayName,paramIndex)=>({paramIndex,displayName,value:paramIndex===1?0:false,keyframes:[],keyframeDetails:[],timeVarying:false,readStatus:{value:'pass',animation:'pass'},descriptor:{inputKind:paramIndex===1?'number':'boolean'}}))};
  const enriched=enrichEffectParameterSchema(component,schema);
  expect(enrichEffectParameterSchema({...component,params:[component.params[1]]},schema,true).params[0]).toEqual(enriched.params[1]);
  expect(enrichEffectParameterSchema({...component,params:[{...component.params[1],displayName:'Other'}]},schema,true).params[0].descriptor).not.toHaveProperty('boundsSource');
  expect(()=>preflightParameterWrites(enriched,[{paramIndex:0,value:true}])).toThrow('UI_GROUP');
  expect(()=>preflightParameterWrites(enriched,[{paramIndex:1,value:21}])).toThrow('OUT_OF_NATIVE_RANGE');
  expect(preflightParameterWrites(enriched,[{paramIndex:1,value:20}])).toHaveLength(1);
  expect(verifyParameterPreservation([component],[enriched],[])).toEqual([]);
 });
 it('also resolves an exact audio track chain',()=>{const xml=fixture().replaceAll('Video','Audio');expect(inspectEffectParameterSchema(xml,{...target,mediaType:'audio'}).parameters[1]?.range?.max).toBe(20);});
 it('matches audio FilterMatchName when intrinsic default owners are omitted',()=>{const xml=fixture().replaceAll('Video','Audio').replaceAll('MatchName>','FilterMatchName>');expect(inspectEffectParameterSchema(xml,{...target,mediaType:'audio'})).toMatchObject({matchName:'vendor.fx'});});
 it('opens the audio individual-parameter container through its Boolean owner before the target',()=>{
  const xml=fixture().replaceAll('Video','Audio').replaceAll('MatchName>','FilterMatchName>')
   .replace('<AudioComponentParam ObjectID="6">','<AudioComponentParam ObjectID="6" ClassID="32657501-3aa4-445f-a49b-d09ecb9fa1ae">')
   .replace('<ParameterControlType>11</ParameterControlType>','').replace('<ParameterControlType>12</ParameterControlType>','');
  const schema=inspectEffectParameterSchema(xml,{...target,mediaType:'audio'});
  expect(schema.containerDisclosure).toEqual({paramIndex:0,name:'Group',key:'ECP.NonParamGroup.Expanded'});
  expect(schema.parameters[0]?.disclosureKey).toBeNull();
  expect(parameterDisclosurePath({paramIndex:1,displayName:'Gain'},schema)).toEqual([
   {paramIndex:0,name:'Group',key:'ECP.NonParamGroup.Expanded'},
   {paramIndex:1,name:'Gain',key:'ECP.Slider.Expanded'},
  ]);
  const other=inspectEffectParameterSchema(xml.replace('32657501-3aa4-445f-a49b-d09ecb9fa1ae','unknown'),{...target,mediaType:'audio'});
  expect(other).not.toHaveProperty('containerDisclosure');expect(other.definitionHash).not.toBe(schema.definitionHash);
 });
});
