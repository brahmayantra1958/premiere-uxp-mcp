/** Convert the requested decimal seconds to the nearest integer tick without
 * binary multiplication/truncation. 1.001 * 254016000000 is just below the
 * exact 30-frame (30000/1001) boundary in JS; flooring it can lose a frame. */
export function exactTicksFromSeconds(seconds:number):string {
  if(!Number.isFinite(seconds)||seconds<0)throw Error('INVALID_TIME: expected finite non-negative seconds');
  const match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(seconds))!;
  const fraction=match[2]??'',scale=fraction.length-Number(match[3]??0);
  const numerator=BigInt(match[1]+fraction)*254016000000n;
  if(scale<=0)return (numerator*10n**BigInt(-scale)).toString();
  const denominator=10n**BigInt(scale);
  return ((numerator+denominator/2n)/denominator).toString();
}

/** Signed form for relative offsets (moves, clones). The magnitude is rounded
 * like exactTicksFromSeconds, so +x and -x stay exact inverses of each other. */
export function exactTickOffsetFromSeconds(seconds:number):string {
  if(!Number.isFinite(seconds))throw Error('INVALID_TIME: expected finite seconds');
  const magnitude=exactTicksFromSeconds(Math.abs(seconds));
  return seconds<0&&magnitude!=='0'?'-'+magnitude:magnitude;
}

/** Exact Premiere frame duration in ticks for an interpreted footage rate.
 * Recognizes whole rates and NTSC n×1000/1001 rates. Any other rate returns
 * undefined, so callers keep the exact requested ticks without a grid check. */
export function frameTicksFromRate(fps:unknown):string|undefined {
  if(typeof fps!=='number'||!Number.isFinite(fps)||fps<=0||fps>1000)return undefined;
  const whole=Math.round(fps);
  if(whole>0&&Math.abs(fps-whole)<1e-6&&254016000000%whole===0)return String(254016000000/whole);
  const ntsc=Math.round(fps*1.001),scaled=254016000000n*1001n,divisor=BigInt(ntsc)*1000n;
  if(ntsc>0&&Math.abs(fps-ntsc*1000/1001)<1e-4&&scaled%divisor===0n)return (scaled/divisor).toString();
  return undefined;
}

/** Snap requested ticks to the frame grid when they sit within float noise
 * (at most 1/1000 frame) of a boundary, e.g. 5.333333 s for frame 160 at 30 fps.
 * Returns null when the time falls between frames, so callers can refuse it
 * before dispatch instead of letting Premiere truncate it a frame short. */
export function snapTicksToFrameGrid(ticks:string,frameTicks:string):{ticks:string;frame:string;snapped:boolean}|null {
  const value=BigInt(ticks),frame=BigInt(frameTicks),nearest=BigInt(nearestFrameTicks(value,frame));
  const distance=value>nearest?value-nearest:nearest-value;
  if(distance*1000n>frame)return null;
  return {ticks:nearest.toString(),frame:(nearest/frame).toString(),snapped:distance!==0n};
}

/** Nearest boundary of the sequence frame grid (ties move later). Callers have
 * already rejected requests that are not within float noise of that grid. */
export function nearestFrameTicks(ticks:string|bigint,frameTicks:string|bigint):string {
  const value=BigInt(ticks),frame=BigInt(frameTicks);
  if(value<0n||frame<=0n)throw Error('INVALID_TIME: expected non-negative ticks and a positive frame timebase');
  return (((value+frame/2n)/frame)*frame).toString();
}
