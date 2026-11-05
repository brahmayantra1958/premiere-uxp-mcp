import {describe,it,expect} from 'vitest';
import {inspectSpeedGraph,patchSpeedGraph,inspectTransientSpeedGraph,materializeSpeedGraphView} from '../../apps/mcp-server/src/speed-graph-archive.js';

import {target,fixture} from '../fixtures/speed-graph.js';
describe('Speed graph UI owner',()=>{
 it.each(['','<Node Version="1"><Properties Version="1"><ECP.Slider.Expanded>true</ECP.Slider.Expanded></Properties></Node>'])('changes only the correlated owner and preserves the curve',props=>{
  let xml=fixture(props);const hash=inspectSpeedGraph(xml,target).contentSha256;
  for(const expanded of [false,true,false,true,false]){
   const changed=patchSpeedGraph(xml,target,hash,expanded);
   expect(changed.after).toMatchObject({expanded,contentSha256:hash});
   expect(changed.xml).toContain('<Other><ECP.Slider.Expanded>true</ECP.Slider.Expanded><Keyframes>KEEP</Keyframes></Other>');
   xml=changed.xml;
  }
 });
 it('rejects stale curves and an unavailable owner without materializing a speed ramp',()=>{
  const xml=fixture(),hash=inspectSpeedGraph(xml,target).contentSha256;
  expect(()=>patchSpeedGraph(xml.replace('100,1,6;','100,2,6;'),target,hash,true)).toThrow('CONTENT_CHANGED');
  expect(()=>inspectSpeedGraph(xml.replace('<TimeRemapping ObjectRef="5"/>',''),target)).toThrow('OWNER_UNAVAILABLE');
  expect(()=>inspectSpeedGraph(xml,{...target,startTicks:'101'})).toThrow();
 });
 it('rejects ambiguous/unknown disclosure values and parameter formats',()=>{
  const p='<ECP.Slider.Expanded>true</ECP.Slider.Expanded>';
  expect(()=>inspectSpeedGraph(fixture(p+p),target)).toThrow('PROPERTY_INVALID');
  expect(()=>inspectSpeedGraph(fixture(p.replace('true','maybe')),target)).toThrow('PROPERTY_INVALID');
  expect(()=>inspectSpeedGraph(fixture().replace('Version="9"','Version="10"'),target)).toThrow('FORMAT_UNSUPPORTED');
 });
});
describe('keyless default Speed UI owner',()=>{
 const defaultXml=()=>fixture().replace('<TimeRemapping ObjectRef="5"/>','');
 it('adds only a reference and keyless UI objects, with unique serialization IDs',()=>{
  const xml=defaultXml(),before=inspectTransientSpeedGraph(xml,target);
  for(const expanded of [false,true])for(const displayName of ['속도','Speed'] as const){
   const r=materializeSpeedGraphView(xml,target,before.contentSha256,expanded,displayName);
   expect(r.after).toMatchObject({kind:'transient_ui_only',expanded});
   const inserted=/<TimeComponentParam ObjectID="9"[^>]*>[\s\S]*?<\/TimeComponentParam>/.exec(r.xml)![0];
   expect(inserted).toContain(`<Name>${displayName}</Name>`);
   expect(inserted).not.toMatch(/<(?:Keyframes|StartKeyframe|CurrentValue|IsTimeVarying|LowerBound|UpperBound)>/);
   expect(r.xml).toContain('<TimeRemapping ObjectRef="8"/>');
   expect(r.xml).toContain('<ClipID>persistent</ClipID><InPoint>0</InPoint><OutPoint>100</OutPoint>');
  }
 });
 it('hashes actual referenced source content while allowing numeric ID renumbering',()=>{
  const xml=defaultXml(),hash=inspectTransientSpeedGraph(xml,target).contentSha256;
  expect(inspectTransientSpeedGraph(xml.replaceAll('ObjectID="7"','ObjectID="77"').replaceAll('ObjectRef="7"','ObjectRef="77"'),target).contentSha256).toBe(hash);
  expect(()=>materializeSpeedGraphView(xml.replace('media-id','changed-source'),target,hash,true,'속도')).toThrow('CONTENT_CHANGED');
  expect(()=>materializeSpeedGraphView(xml.replace('<InPoint>0','<InPoint>1'),target,hash,true,'속도')).toThrow('CONTENT_CHANGED');
  expect(()=>materializeSpeedGraphView(xml,target,hash,true,'' as 'Speed')).toThrow('DISPLAY_NAME_UNVERIFIED');
 });
 it('rejects unknown, nonempty and shared owners before materializing anything',()=>{
  expect(()=>inspectTransientSpeedGraph(fixture(),target)).toThrow('NOT_EMPTY');
  expect(()=>inspectTransientSpeedGraph(defaultXml().replace('Version="11"','Version="12"'),target)).toThrow('FORMAT_UNSUPPORTED');
  expect(()=>inspectTransientSpeedGraph(defaultXml().replace('</Data>','<Alias><Clip ObjectRef="4"/></Alias></Data>'),target)).toThrow('OWNER_SHARED');
 });
 it('does not confuse unrelated embedded view-state IDs with global owner collisions',()=>{
  const xml=defaultXml().replace('</Data>','<ViewStates><ProjectViewState ObjectID="5"><Name>embedded</Name></ProjectViewState></ViewStates></Data>');
  const before=inspectTransientSpeedGraph(xml,target),r=materializeSpeedGraphView(xml,target,before.contentSha256,true,'Speed');
  expect(r.after.parameterId).toBe('9');expect(r.xml).toContain('<Name>embedded</Name>');
 });
});
