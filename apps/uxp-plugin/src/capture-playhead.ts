/** Restore only the position we still own. A concurrent user seek wins. */
export async function withCapturePlayhead<T>(sequence:any,target:any,restore:boolean,work:()=>Promise<T>,isCurrent:()=>Promise<boolean>) {
  if(!await isCurrent())throw Error('CAPTURE_CONTEXT_DRIFT');
  const before=await sequence.getPlayerPosition(),original=String(before.ticks);
  await sequence.setPlayerPosition(target);
  const navigation:Record<string,unknown>={originalTicks:original,captureTicks:String(target.ticks),restoreRequested:restore,restored:false};
  let value:T|undefined,failed=false,failure:unknown;
  try {
    if(!await isCurrent())throw Error('CAPTURE_CONTEXT_DRIFT');
    if(String((await sequence.getPlayerPosition()).ticks)!==String(target.ticks))throw Error('CAPTURE_PLAYHEAD_CHANGED');
    value=await work();
  } catch(e){failed=true;failure=e;}
  try {
    if(restore) {
      if(await isCurrent()&&String((await sequence.getPlayerPosition()).ticks)===String(target.ticks)) {
        await sequence.setPlayerPosition(before);
        const restored=String((await sequence.getPlayerPosition()).ticks)===original;
        navigation.restored=restored;
        if(!restored)throw Error('CAPTURE_PLAYHEAD_RESTORE_UNVERIFIED');
      }else navigation.restoreSkipped='user_navigation_changed';
    }
  }catch(e){if(failed)throw Error(`${String(failure)}; restoration: ${String(e)}`);throw e;}
  if(failed)throw failure;
  return {value:value as T,navigation};
}
