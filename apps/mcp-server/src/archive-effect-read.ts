/** Host read adapter shared by Speed and Lumetri. Mutation dispatch and
 * transaction ownership remain with their callers. */
type Row=Record<string,any>;
/** Project reopening can invalidate the first read's UXP handles or leave its
 * native Effect Controls pane empty until selection materializes. Reacquire
 * only this idempotent read once; never repeat a save/close/archive mutation. */
export async function readCurveChain(read:()=>Promise<Row>,attempts:Row[]){
  for(let attempt=0;attempt<2;attempt++){
    try{
      const result=await read(),native=result.visibility?.effectExpansion?.readback;
      if(attempt===0&&native?.status==='pass'&&native.selectedClipTab===null&&native.headers?.length===0){attempts.push({reason:'empty_native_effect_pane',attempt});continue;}
      // The effect-state worker has no action surface: its timeout cannot hide
      // a content dispatch. Reacquire the complete guarded read once after the
      // project's UI reconstructs. Never apply this to a scroll/write timeout.
      if(attempt===0&&native?.reason==='NATIVE_EFFECT_OBSERVATION_UNAVAILABLE'&&native.nativeReason==='NATIVE_WORKER_TIMEOUT_DO_NOT_REPLAY'){
        attempts.push({reason:'read_only_effect_observation_timeout',attempt});continue;
      }
      return result;
    }catch(error){
      if(attempt!==0||!/script object is no longer valid/i.test(String(error)))throw error;
      attempts.push({reason:'invalidated_read_handle',attempt,error:String(error)});
    }
  }
  throw Error('LUMETRI_CURVE_READ_UNVERIFIED');
}
