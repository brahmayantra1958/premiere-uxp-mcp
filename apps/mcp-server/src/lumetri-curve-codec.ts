import {createHash} from 'node:crypto';

export type CurvePoint={x:number;y:number};
export const curveDigest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** L0: observed Premiere 26.5 Hue-vs-Saturation Arb v3 record. Header word 0
 * is preserved as a format discriminator, never interpreted as a writable
 * interpolation option. Count + 32 pairs of LE doubles were established by
 * comparing Premiere's neutral and user-created three-point saved states.
 * Unused slots are preserved byte-for-byte, including old unused coordinates. */
export function decodeHueSaturationCurve(bytes:Buffer) {
  if(bytes.length!==520||bytes.readUInt32LE(0)!==3)throw Error('LUMETRI_CURVE_FORMAT_UNSUPPORTED');
  const count=bytes.readUInt32LE(4);
  if(count>32)throw Error('LUMETRI_CURVE_COUNT_INVALID');
  const points=Array.from({length:count},(_,i)=>({x:bytes.readDoubleLE(8+16*i),y:bytes.readDoubleLE(16+16*i)}));
  validateCurvePoints(points);
  return {format:'lumetri_hue_saturation_v1' as const,points,sha256:curveDigest(bytes)};
}
/** L1: complete point replacement. Normalized native hue x and signed native
 * saturation displacement y are not screen pixels or saturation percentages.
 * This deliberately limits writes to the observed native domain. */
export function validateCurvePoints(points:CurvePoint[]) {
  if(!Array.isArray(points)||points.length>32)throw Error('LUMETRI_CURVE_COUNT_INVALID');
  for(let i=0;i<points.length;i++){
    const p=points[i]!;
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>=1||p.y< -1||p.y>1)throw Error('LUMETRI_CURVE_POINT_INVALID');
    if(i&&points[i-1]!.x>=p.x)throw Error('LUMETRI_CURVE_POINTS_NOT_STRICTLY_ORDERED');
  }
}
export function encodeHueSaturationCurve(before:Buffer,expectedSha256:string,points:CurvePoint[]) {
  const prior=decodeHueSaturationCurve(before);
  if(prior.sha256!==expectedSha256)throw Error('LUMETRI_CURVE_STALE');
  validateCurvePoints(points);
  const output=Buffer.from(before);output.writeUInt32LE(points.length,4);
  points.forEach((p,i)=>{output.writeDoubleLE(p.x,8+16*i);output.writeDoubleLE(p.y,16+16*i);});
  return {bytes:output,before:prior,after:decodeHueSaturationCurve(output)};
}

/** Native 26.5 manual channel-isolation samples establish four independent
 * 520-byte records in master/red/green/blue order. RGB coordinates include both
 * endpoints and are normalized input/output levels, unlike signed hue curves. */
export const rgbChannels=['master','red','green','blue'] as const;
export type RgbChannel=typeof rgbChannels[number];
export function validateRgbPoints(points:CurvePoint[]) {
  if(!Array.isArray(points)||points.length<2||points.length>32)throw Error('LUMETRI_RGB_COUNT_INVALID');
  for(let i=0;i<points.length;i++){
    const p=points[i]!;
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)throw Error('LUMETRI_RGB_POINT_INVALID');
    if(i&&points[i-1]!.x>=p.x)throw Error('LUMETRI_CURVE_POINTS_NOT_STRICTLY_ORDERED');
  }
}
export function decodeRgbCurve(bytes:Buffer,channel:RgbChannel){
  if(bytes.length!==2080||!rgbChannels.includes(channel))throw Error('LUMETRI_RGB_FORMAT_UNSUPPORTED');
  const channels=rgbChannels.map((name,r)=>{
    const record=bytes.subarray(r*520,(r+1)*520);
    if(record.readUInt32LE(0)!==0)throw Error('LUMETRI_RGB_FORMAT_UNSUPPORTED');
    const count=record.readUInt32LE(4);if(count<2||count>32)throw Error('LUMETRI_RGB_COUNT_INVALID');
    const points=Array.from({length:count},(_,i)=>({x:record.readDoubleLE(8+16*i),y:record.readDoubleLE(16+16*i)}));
    validateRgbPoints(points);return {channel:name,points,sha256:curveDigest(record)};
  });
  return {format:'lumetri_rgb_v1' as const,channel,points:channels[rgbChannels.indexOf(channel)]!.points,channels,sha256:curveDigest(bytes)};
}
/** Whole-payload optimistic lock; only the chosen record's count/used points
 * change. Unused bytes and all three other channel records remain identical. */
export function encodeRgbCurve(before:Buffer,expectedSha256:string,channel:RgbChannel,points:CurvePoint[]){
  const prior=decodeRgbCurve(before,channel);if(prior.sha256!==expectedSha256)throw Error('LUMETRI_CURVE_STALE');
  validateRgbPoints(points);const output=Buffer.from(before),offset=rgbChannels.indexOf(channel)*520;
  output.writeUInt32LE(points.length,offset+4);
  points.forEach((p,i)=>{output.writeDoubleLE(p.x,offset+8+16*i);output.writeDoubleLE(p.y,offset+16+16*i);});
  return {bytes:output,before:prior,after:decodeRgbCurve(output,channel)};
}
