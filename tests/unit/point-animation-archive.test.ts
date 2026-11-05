import {describe,it,expect} from 'vitest';
import {pointAnimationFromBlock} from '../../apps/mcp-server/src/effect-parameter-schema.js';
import {readEffectChainAnimation} from '../../apps/mcp-server/src/native-archive-readers.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {enrichPointAnimation} from '../../apps/uxp-plugin/src/effect-parameter-contract.js';
const record='100,0.3:0.5,4,0,0,0,0,0,5,4,0,0,0,0;';
const block=(r=record)=>`<PointComponentParam Version="4"><Keyframes>${r}</Keyframes></PointComponentParam>`;
const component=()=>({componentIndex:2,matchName:'vendor.point',readbackCoverage:{opaqueParameterIndices:[],unverifiedParameterIndices:[0]},params:[{paramIndex:0,keyframes:[{ticks:'100'}],keyframeDetails:[{time:{ticks:'100'},value:[.3,.5],interpolationMode:null,interpolation:'unknown'}],descriptor:{inputKind:'point'},readStatus:{value:'pass',animation:'unverified'},readErrors:['POINT_INTERPOLATION_REQUIRES_SAVED_NATIVE_READBACK']}]});
const archive=()=>({status:'pass',componentIndex:2,matchName:'vendor.point',pointAnimation:[pointAnimationFromBlock(block(),0)]});
describe('independent Point temporal readback',()=>{
 it('retains the temporal mode and spatial fields separately',()=>{expect(pointAnimationFromBlock(block(),0)?.keys[0]).toMatchObject({ticks:'100',value:{x:.3,y:.5},interpolationMode:4});expect(pointAnimationFromBlock(block(),0)?.keys[0]?.nativeFields).toHaveLength(12);});
 it('does not accept unsupported versions, malformed records or duplicate time',()=>{expect(pointAnimationFromBlock(block().replace('Version="4"','Version="5"'),0)).toBeUndefined();expect(()=>pointAnimationFromBlock(block('100,0.3:0.5,4;'),0)).toThrow('FORMAT');expect(()=>pointAnimationFromBlock(block(record+record),0)).toThrow('DUPLICATE');});
 it('requires matching public key positions and values before completing readback',()=>{
  const result=enrichPointAnimation(component(),archive());expect(result.params[0].keyframeDetails[0].interpolation).toBe('hold');expect(result.readbackCoverage.unverifiedParameterIndices).toEqual([]);expect(result.params[0].readErrors).toEqual([]);
  const changed=component();changed.params[0]!.keyframeDetails[0]!.value=[.4,.5];expect(()=>enrichPointAnimation(changed,archive())).toThrow('MISMATCH');
  expect(()=>enrichPointAnimation(component(),{...archive(),componentIndex:3})).toThrow('UNVERIFIED');
 });
 it('reads independent duplicate Point instances from one exact saved clip',async()=>{
  const xml=`<Data><Sequence ObjectUID="seq"><Second ObjectRef="1"/></Sequence><VideoTrackGroup ObjectID="1"><Track Index="0" ObjectURef="track"/></VideoTrackGroup><VideoTrack ObjectUID="track"><TrackItem Index="0" ObjectRef="2"/></VideoTrack><VideoClipTrackItem ObjectID="2"><Start>100</Start><End>200</End><SubClip ObjectRef="3"/><Components ObjectRef="4"/></VideoClipTrackItem><ClipProjectItem ObjectUID="source"><MasterClip ObjectURef="master"/></ClipProjectItem><SubClip ObjectID="3"><Name>clip</Name><MasterClip ObjectURef="master"/></SubClip><VideoComponentChain ObjectID="4"><DefaultOpacity>true</DefaultOpacity><Component Index="0" ObjectRef="5"/><Component Index="1" ObjectRef="7"/></VideoComponentChain><VideoFilterComponent ObjectID="5"><MatchName>vendor.point</MatchName><Param Index="0" ObjectRef="6"/></VideoFilterComponent><VideoFilterComponent ObjectID="7"><MatchName>vendor.point</MatchName><Param Index="0" ObjectRef="8"/></VideoFilterComponent>${block().replace('Version="4"','ObjectID="6" Version="4"').replace('<Keyframes>','<Name>Position</Name><Keyframes>')}${block(record.replace('0.3:0.5','0.7:0.5')).replace('Version="4"','ObjectID="8" Version="4"').replace('<Keyframes>','<Name>Position</Name><Keyframes>')}</Data>`;
  const dir='artifacts/tests/effect-chain-animation',file=dir+'/duplicates.prproj';await mkdir(dir,{recursive:true});await writeFile(file,gzipSync(xml));
  const target={sequenceId:'seq',trackIndex:0,startTicks:'100',endTicks:'200',projectItemId:'source',clipName:'clip',mediaType:'video' as const,componentMatchNames:['AE.ADBE Opacity','vendor.point','vendor.point'],components:[1,2].map(componentIndex=>({componentIndex,componentMatchName:'vendor.point',parameterNames:['Position']}))};
  const result=await readEffectChainAnimation(file,target);
  expect(result.components.map(c=>c.pointAnimation?.[0]?.keys[0]?.value.x)).toEqual([.3,.7]);expect(result.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(readEffectChainAnimation(file,{...target,componentMatchNames:['AE.ADBE Opacity','vendor.point']})).rejects.toThrow('OCCURRENCES');
  await expect(readEffectChainAnimation(file,{...target,components:[{...target.components[0]!,parameterNames:['wrong']}]})).rejects.toThrow('NAME_CHANGED');
 });
});
