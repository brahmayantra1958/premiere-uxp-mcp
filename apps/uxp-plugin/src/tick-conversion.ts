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

/** Nearest boundary of the sequence frame grid (ties move later). Callers have
 * already rejected requests that are not within float noise of that grid. */
export function nearestFrameTicks(ticks:string|bigint,frameTicks:string|bigint):string {
  const value=BigInt(ticks),frame=BigInt(frameTicks);
  if(value<0n||frame<=0n)throw Error('INVALID_TIME: expected non-negative ticks and a positive frame timebase');
  return (((value+frame/2n)/frame)*frame).toString();
}
