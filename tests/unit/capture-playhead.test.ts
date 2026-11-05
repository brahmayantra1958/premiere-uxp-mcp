import {describe,it,expect} from 'vitest';
import {withCapturePlayhead} from '../../apps/uxp-plugin/src/capture-playhead.js';
function fixture(){let ticks='10';const writes:string[]=[];return {writes,get ticks(){return ticks;},seek:(v:string)=>{ticks=v;},sequence:{getPlayerPosition:async()=>({ticks}),setPlayerPosition:async(v:{ticks:string})=>{writes.push(v.ticks);ticks=v.ticks;}}};}
describe('capture playhead ownership',()=>{
  it('restores on success and on export error',async()=>{
    const f=fixture();
    const r=await withCapturePlayhead(f.sequence,{ticks:'20'},true,async()=>42,async()=>true);
    expect(r).toEqual({value:42,navigation:{originalTicks:'10',captureTicks:'20',restoreRequested:true,restored:true}});
    await expect(withCapturePlayhead(f.sequence,{ticks:'30'},true,async()=>{throw Error('export failed');},async()=>true)).rejects.toThrow('export failed');
    expect(f.writes).toEqual(['20','10','30','10']);
  });
  it('preserves concurrent user seeks and target switches',async()=>{
    const f=fixture();
    const r=await withCapturePlayhead(f.sequence,{ticks:'20'},true,async()=>{f.seek('99');return true;},async()=>true);
    expect(f.ticks).toBe('99');expect(r.navigation.restoreSkipped).toBe('user_navigation_changed');
    let current=true;
    await withCapturePlayhead(f.sequence,{ticks:'20'},true,async()=>{current=false;return true;},async()=>current);
    expect(f.writes).toEqual(['20','20']);
  });
  it('does not seek or export after panel navigation changed projects',async()=>{
    const f=fixture();let exported=false;
    await expect(withCapturePlayhead(f.sequence,{ticks:'20'},false,async()=>{exported=true;},async()=>false)).rejects.toThrow('CAPTURE_CONTEXT_DRIFT');
    expect(f.writes).toEqual([]);expect(exported).toBe(false);
  });
  it('checks context again after seeking and before export',async()=>{
    const f=fixture();let checks=0,exported=false;
    await expect(withCapturePlayhead(f.sequence,{ticks:'20'},false,async()=>{exported=true;},async()=>++checks===1)).rejects.toThrow('CAPTURE_CONTEXT_DRIFT');
    expect(f.writes).toEqual(['20']);expect(exported).toBe(false);
  });
});
