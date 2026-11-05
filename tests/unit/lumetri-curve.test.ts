import {describe,it,expect} from 'vitest';
import {curveDigest,decodeHueSaturationCurve,encodeHueSaturationCurve,decodeRgbCurve,encodeRgbCurve,rgbChannels} from '../../apps/mcp-server/src/lumetri-curve-codec.js';
import {inspectLumetriCurve,patchLumetriCurve,lumetriCurvePreservation} from '../../apps/mcp-server/src/lumetri-curve-archive.js';
import {points,blank,target,fixture} from '../fixtures/lumetri-curve.js';
describe('typed Hue vs Saturation curve',()=>{
 it('decodes manual three-point evidence and preserves unused bytes',()=>{
  const b=blank();b.writeDoubleLE(.123,400);const edited=encodeHueSaturationCurve(b,curveDigest(b),points);
  expect(edited.after.points).toEqual(points);expect(edited.bytes.subarray(56)).toEqual(b.subarray(56));
  expect(encodeHueSaturationCurve(edited.bytes,edited.after.sha256,[]).after.points).toEqual([]);
 });
 it('requires the inspected exact bytes and a known header',()=>{
  expect(()=>encodeHueSaturationCurve(blank(),'stale',points)).toThrow('STALE');
  expect(()=>decodeHueSaturationCurve(Buffer.alloc(520))).toThrow('FORMAT');
  const b=blank();b.writeUInt32LE(33,4);expect(()=>decodeHueSaturationCurve(b)).toThrow('COUNT');
 });
 it.each([[{x:NaN,y:0}],[{x:0,y:Infinity}],[{x:1,y:0}],[{x:.2,y:2}],[{x:.2,y:0},{x:.2,y:1}]])('rejects invalid points before touching bytes',p=>expect(()=>encodeHueSaturationCurve(blank(),curveDigest(blank()),p)).toThrow());
 it('preserves hash-only aliases after replacing the sole payload owner',()=>{
  const out=patchLumetriCurve(fixture(),target,curveDigest(blank()),points);
  expect(inspectLumetriCurve(out.xml,target).points).toEqual(points);
  expect(out.xml).toContain(`<Other><StartKeyframeValue Encoding="base64" BinaryHash="abc">${blank().toString('base64')}</StartKeyframeValue></Other>`);
  expect(out.xml).toContain('<Start>100</Start><End>200</End>');
 });
 it('rejects ambiguous payloads, unknown parameters, stale instance/name/source',()=>{
  expect(()=>inspectLumetriCurve(fixture().replace('</Data>','<Other BinaryHash="abc">AAAA</Other></Data>'),target)).toThrow('AMBIGUOUS');
  expect(()=>inspectLumetriCurve(fixture().replace('<ParameterID>42','<ParameterID>106'),target)).toThrow('UNSUPPORTED');
  expect(()=>inspectLumetriCurve(fixture(),{...target,expectedDisplayName:'wrong'})).toThrow('CHANGED');
  expect(()=>inspectLumetriCurve(fixture(),{...target,projectItemId:'wrong'})).toThrow();
  expect(()=>inspectLumetriCurve(fixture(),{...target,componentMatchNames:[...target.componentMatchNames,'AE.ADBE Lumetri']})).toThrow('OCCURRENCES');
 });
});

const rgb=()=>{const b=Buffer.alloc(2080);for(let r=0;r<4;r++){b.writeUInt32LE(2,520*r+4);b.writeDoubleLE(1,520*r+24);b.writeDoubleLE(1,520*r+32);}return b;};
const identity=[{x:0,y:0},{x:1,y:1}];
describe('native RGB channel codec and archive isolation',()=>{
 it.each(rgbChannels)('edits %s with full-payload locking and preserves all other channel bytes',channel=>{
  const b=rgb(),points=[{x:0,y:0},{x:.5027322404371585,y:.7172131147540983},{x:1,y:1}];b.writeDoubleLE(.123,400);
  const out=encodeRgbCurve(b,curveDigest(b),channel,points),offset=rgbChannels.indexOf(channel)*520;
  expect(out.after.points).toEqual(points);expect(out.bytes.subarray(0,offset)).toEqual(b.subarray(0,offset));expect(out.bytes.subarray(offset+520)).toEqual(b.subarray(offset+520));
  expect(out.bytes.subarray(offset+56,offset+520)).toEqual(b.subarray(offset+56,offset+520));
  expect(encodeRgbCurve(out.bytes,out.after.sha256,channel,identity).after.points).toEqual(identity);
  expect(()=>encodeRgbCurve(out.bytes,curveDigest(b),channel,identity)).toThrow('STALE');
 });
 it('rejects corrupt non-target channels, unknown formats and invalid RGB domains',()=>{
  const b=rgb();b.writeUInt32LE(3,1560);expect(()=>decodeRgbCurve(b,'red')).toThrow('FORMAT');
  for(const points of [[],[{x:0,y:0}],[{x:0,y:-.1},{x:1,y:1}],[{x:.5,y:0},{x:.5,y:1}],[{x:0,y:0},{x:1.1,y:1}]])expect(()=>encodeRgbCurve(rgb(),curveDigest(rgb()),'red',points)).toThrow();
 });
 it('requires RGB native parameter ID and includes unchanged channels in preservation proof',()=>{
  const xml=fixture(rgb().toString('base64')).replace('<ParameterID>42','<ParameterID>39');
  const t={...target,curveKind:'rgb' as const,channel:'red' as const},before=lumetriCurvePreservation(xml,t);
  const out=patchLumetriCurve(xml,t,curveDigest(rgb()),[{x:0,y:0},{x:.5,y:.7},{x:1,y:1}]);
  expect(inspectLumetriCurve(out.xml,t)).toMatchObject({nativeParameterId:39,channel:'red'});
  expect(lumetriCurvePreservation(out.xml,t)).toEqual(before);
  const changeGreen=patchLumetriCurve(out.xml,{...t,channel:'green'},out.after.sha256,[{x:0,y:0},{x:.5,y:.4},{x:1,y:1}]);
  expect(lumetriCurvePreservation(changeGreen.xml,t)).not.toEqual(before);
  expect(()=>inspectLumetriCurve(xml,target)).toThrow('UNSUPPORTED');
 });
});
