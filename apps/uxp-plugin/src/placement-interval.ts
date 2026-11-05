import {exactTicksFromSeconds} from './tick-conversion.js';
const ticksPerSecond=254016000000;
/** Native sequence placement retains complete sequence frames. Predict that
 * one exact duration before dispatch, rather than tolerating any shorter clip.
 * This applies to video and audio placed by the frame-based sequence editor. */
export function placementDurationTicks(seconds:number,frameTicks:string):string {
  const frame=BigInt(frameTicks),requested=BigInt(exactTicksFromSeconds(seconds));
  if(frame<=0n||requested<frame)throw Error('PLACEMENT_DURATION_BELOW_ONE_FRAME: inspect the source and sequence timebase before placement');
  return String(requested/frame*frame);
}
/** Round interval endpoints, not duration separately: adjacent decimal seconds
 * can differ below one Premiere tick. Real one-tick overlaps still reject. */
export function placementIntervalsOverlap(a:number,aDuration:number,b:number,bDuration:number):boolean {
  const tick=(seconds:number)=>BigInt(Math.round(seconds*ticksPerSecond));
  return tick(a)<tick(b+bDuration)&&tick(b)<tick(a+aDuration);
}
