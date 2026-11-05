import {describe,it,expect} from "vitest";
import {effectTreeArchive,patchEffectTreeDepth,withoutDisclosureProperties} from "../../apps/mcp-server/src/effect-tree-archive.js";
const target={sequenceId:"seq",trackIndex:0,startTicks:"100",endTicks:"200",projectItemId:"source",clipName:"clip.mov"};
function fixture(){return `<Data><Sequence ObjectUID="seq"><Second ObjectRef="1"/></Sequence><VideoTrackGroup ObjectID="1"><Track Index="0" ObjectURef="track"/></VideoTrackGroup><VideoTrack ObjectUID="track"><TrackItem Index="0" ObjectRef="2"/></VideoTrack><VideoClipTrackItem ObjectID="2"><Start>100</Start><End>200</End><SubClip ObjectRef="3"/><Components ObjectRef="4"/></VideoClipTrackItem><ClipProjectItem ObjectUID="source"><MasterClip ObjectURef="master"/></ClipProjectItem><SubClip ObjectID="3"><Name>clip.mov</Name><MasterClip ObjectURef="master"/></SubClip><VideoComponentChain ObjectID="4"><Component Index="0" ObjectRef="5"/></VideoComponentChain><VideoFilterComponent ObjectID="5"><Component Version="7"><MatchName>AE.ADBE Motion</MatchName><Param Index="0" ObjectRef="6"/><Param Index="1" ObjectRef="7"/></Component></VideoFilterComponent><VideoComponentParam ObjectID="6"><ParameterID>1</ParameterID><Name>Scale</Name><StartKeyframe>0,150,0</StartKeyframe></VideoComponentParam><VideoComponentParam ObjectID="7"><ParameterID>2</ParameterID><Name>Uniform</Name><StartKeyframe>0,true,0</StartKeyframe></VideoComponentParam><VideoClipTrackItem ObjectID="99"><Start>100</Start><End>200</End><SubClip ObjectRef="999"/></VideoClipTrackItem></Data>`;}
describe("UI-only archive disclosure metadata",()=>{
 it("resolves the exact track even with another identical-time clip",()=>{expect(effectTreeArchive(fixture(),target).nodes.map(n=>[n.name,n.depth])).toEqual([["AE.ADBE Motion",0],["Scale",1]]);});
 it("changes only allowlisted UI metadata and preserves opaque/scalar content",()=>{
  const xml=fixture(),closed=patchEffectTreeDepth(xml,target,-1),root=patchEffectTreeDepth(closed.xml,target,0),deep=patchEffectTreeDepth(root.xml,target,1);
  for(const stage of [closed,root,deep]){expect(withoutDisclosureProperties(stage.xml)).toBe(withoutDisclosureProperties(xml));expect(stage.contentHash).toBe(closed.contentHash);expect(stage.xml).toContain('<StartKeyframe>0,150,0</StartKeyframe>');}
  expect(root.xml).toContain('<ECP.Filter.Expanded>true</ECP.Filter.Expanded>');expect(root.xml).toContain('<ECP.Slider.Expanded>false</ECP.Slider.Expanded>');expect(deep.xml).toContain('<ECP.Slider.Expanded>true</ECP.Slider.Expanded>');
 });
 it("fails before writing a stale target, external entity, or unrecognized property type",()=>{
  expect(()=>patchEffectTreeDepth(fixture(),{...target,projectItemId:"other"},1)).toThrow();expect(()=>patchEffectTreeDepth('<!DOCTYPE x>'+fixture(),target,1)).toThrow("UNSAFE");
  expect(()=>patchEffectTreeDepth(fixture().replace('<Component Version="7">','<Component Version="7"><Node Version="1"><Properties Version="1"><ECP.Filter.Expanded>unknown</ECP.Filter.Expanded></Properties></Node>'),target,1)).toThrow("UNKNOWN_PROPERTY_VALUE");
 });
 it("rejects an unsupported owner instead of silently claiming a write",()=>expect(()=>patchEffectTreeDepth(fixture().replace('<Component Version="7">','<Component Version="99">'),target,1)).toThrow("OWNER_LAYOUT_UNSUPPORTED"));
 it("ignores known Boolean disclosure metadata without hiding other parameter or mask properties",()=>{
  const block='<VideoComponentParam><Node Version="1"><Properties Version="1"><ECP.Slider.Expanded>false</ECP.Slider.Expanded><ECP.Unknown>false</ECP.Unknown><TrackerEnabled>false</TrackerEnabled></Properties></Node><StartKeyframe>0,150,0</StartKeyframe><StartKeyframeValue>AQID</StartKeyframeValue></VideoComponentParam>';
  const normalized=withoutDisclosureProperties(block);
  expect(normalized).not.toContain('<ECP.Slider.Expanded>');
  expect(normalized).toContain('<ECP.Unknown>false</ECP.Unknown>');expect(normalized).toContain('<TrackerEnabled>false</TrackerEnabled>');
  expect(normalized).toContain('<StartKeyframe>0,150,0</StartKeyframe>');expect(normalized).toContain('<StartKeyframeValue>AQID</StartKeyframeValue>');
  expect(withoutDisclosureProperties(block.replace('Expanded>false','Expanded>unknown'))).toContain('<ECP.Slider.Expanded>unknown</ECP.Slider.Expanded>');
 });
});
