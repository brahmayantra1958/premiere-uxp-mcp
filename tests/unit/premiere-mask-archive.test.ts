import {describe,it,expect} from "vitest";
import {inspectPremiereMasks} from "../../apps/mcp-server/src/premiere-mask-archive.js";
const target={sequenceId:"seq",trackIndex:0,startTicks:"100",endTicks:"200",projectItemId:"source",clipName:"clip.mov"};
function fixture(payload='<StartKeyframeValue BinaryHash="h">AQIDBA==</StartKeyframeValue>'){
 return `<Data><Sequence ObjectUID="seq"><Second ObjectRef="1"/></Sequence><VideoTrackGroup ObjectID="1"><Track Index="0" ObjectURef="track"/></VideoTrackGroup><VideoTrack ObjectUID="track"><TrackItem Index="0" ObjectRef="2"/></VideoTrack><VideoClipTrackItem ObjectID="2"><Start>100</Start><End>200</End><SubClip ObjectRef="3"/><SelectionComponents ObjectRef="4"/></VideoClipTrackItem><ClipProjectItem ObjectUID="source"><MasterClip ObjectURef="master"/></ClipProjectItem><SubClip ObjectID="3"><Name>clip.mov</Name><MasterClip ObjectURef="master"/></SubClip><VideoComponentChain ObjectID="4"><Component Index="0" ObjectRef="5"/></VideoComponentChain><VideoFilterComponent ObjectID="5"><MatchName>AE.ADBE AEMask2</MatchName><SubComponent Index="0" ObjectRef="6"/></VideoFilterComponent><VideoFilterComponent ObjectID="6"><MatchName>AE.ADBE AEMask2</MatchName><InstanceName>01</InstanceName><Param Index="0" ObjectRef="7"/><Param Index="1" ObjectRef="8"/></VideoFilterComponent><VideoComponentParam ObjectID="7"><ParameterID>22</ParameterID><ParameterControlType>10</ParameterControlType><Name>Type</Name><StartKeyframe>0,4,0</StartKeyframe></VideoComponentParam><VideoComponentParam ObjectID="8"><ParameterID>24</ParameterID><ParameterControlType>22</ParameterControlType><Name>Tracker</Name>${payload}</VideoComponentParam></Data>`;
}
describe("scoped native mask archive",()=>{
 it('accepts only the observed v4 omitted-zero Start with exact end/source identity',()=>{
  const xml=fixture().replace('<Start>100</Start><End>200</End>','<TrackItem Version="4"><End>200</End></TrackItem>');
  expect(inspectPremiereMasks(xml,{...target,startTicks:'0'}).masks).toHaveLength(1);
  expect(()=>inspectPremiereMasks(xml,target)).toThrow('CLIP_NOT_UNIQUE');
  expect(()=>inspectPremiereMasks(xml.replace('Version="4"','Version="5"'),{...target,startTicks:'0'})).toThrow('CLIP_NOT_UNIQUE');
  expect(()=>inspectPremiereMasks(xml.replace('<End>','<Start/><End>'),{...target,startTicks:'0'})).toThrow('CLIP_NOT_UNIQUE');
 });
 it("follows the selection component chain and preserves opaque tracking bytes",()=>{expect(inspectPremiereMasks(fixture(),target).masks[0]).toMatchObject({name:"01",nativeType:4,parameters:[{id:22},{id:24,binary:{bytes:4}}]});});
 it("resolves a hash-only value before the full payload without consuming intervening XML",()=>{
  const full=fixture(),reference=fixture('<StartKeyframeValue BinaryHash="h"/>').replace('</Data>','<Shared><StartKeyframeValue BinaryHash="other">BQYHCA==</StartKeyframeValue><StartKeyframeValue BinaryHash="h">AQIDBA==</StartKeyframeValue></Shared></Data>');
  expect(inspectPremiereMasks(reference,target).masks).toEqual(inspectPremiereMasks(full,target).masks);
 });
 it.each([{trackIndex:1},{clipName:"other"},{projectItemId:"other"},{startTicks:"101"},{endTicks:"201"}])("rejects a stale target %j",patch=>expect(()=>inspectPremiereMasks(fixture(),{...target,...patch})).toThrow());
 it("rejects conflicting binary references and malformed base64",()=>{
  const xml=fixture('<StartKeyframeValue BinaryHash="h"/>').replace('</Data>','<Shared><StartKeyframeValue BinaryHash="h">AQIDBA==</StartKeyframeValue><StartKeyframeValue BinaryHash="h">BQYHCA==</StartKeyframeValue></Shared></Data>');
  expect(()=>inspectPremiereMasks(xml,target)).toThrow("HASH_CONFLICT");expect(()=>inspectPremiereMasks(fixture('<StartKeyframeValue>not!base64</StartKeyframeValue>'),target)).toThrow("ENCODING_INVALID");
 });
 it("does not treat an ordinary effect as a selection mask",()=>{expect(inspectPremiereMasks(fixture().replace('<SelectionComponents ObjectRef="4"/>','<Components ObjectRef="4"/>'),target).masks).toEqual([]);});
 it("rejects external entity declarations",()=>expect(()=>inspectPremiereMasks('<!DOCTYPE x>'+fixture(),target)).toThrow("UNSAFE"));
});
