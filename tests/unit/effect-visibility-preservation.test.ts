import {it,expect,vi} from 'vitest';
import {effectVisibilityPreservation} from '../../apps/uxp-plugin/src/effect-visibility-preservation.js';
const raw=()=>[{componentIndex:0,matchName:'Point',params:[{paramIndex:0,value:[.5,.5],keyframeDetails:[{time:{ticks:'1'},value:[.5,.5],interpolationMode:null}],readStatus:{value:'pass',animation:'unverified'}}]}];
const native=()=>{const result:any=raw();Object.assign(result[0].params[0].keyframeDetails[0],{interpolationMode:5,nativePointFields:[5,0,.5]});result[0].params[0].readStatus.animation='pass';return result;};
it('keeps all public UI guards and completes fresh native proof once before content can proceed',async()=>{
 const read=vi.fn(async()=>raw()),prove=vi.fn(async()=>native()),guard=effectVisibilityPreservation(raw(),native(),[],read,prove);
 await guard.check();await guard.check();expect(prove).not.toHaveBeenCalled();await guard.finish();expect(read).toHaveBeenCalledTimes(3);expect(prove).toHaveBeenCalledTimes(1);
});
it('rejects public drift immediately and native-only drift at final UI proof',async()=>{
 const changed=raw();changed[0].params[0].value=[.2,.3];const prove=vi.fn(async()=>native());
 await expect(effectVisibilityPreservation(raw(),native(),[],async()=>changed,prove).check()).rejects.toThrow('CONTEXT_CHANGED');expect(prove).not.toHaveBeenCalled();
 const drift=native();drift[0].params[0].keyframeDetails[0].nativePointFields[2]=.7;
 const guard=effectVisibilityPreservation(raw(),native(),[],async()=>raw(),async()=>drift);await guard.check();await expect(guard.finish()).rejects.toThrow('CONTEXT_CHANGED');
});
it('uses optional identity boundaries while always completing fresh full public and native proof',async()=>{
 const boundary=vi.fn(async()=>{}),read=vi.fn(async()=>raw()),prove=vi.fn(async()=>native());
 const guard=effectVisibilityPreservation(raw(),native(),[],read,prove,boundary);
 await guard.check();await guard.check();expect(boundary).toHaveBeenCalledTimes(2);expect(read).not.toHaveBeenCalled();expect(prove).not.toHaveBeenCalled();
 await guard.finish();expect(read).toHaveBeenCalledTimes(1);expect(prove).toHaveBeenCalledTimes(1);expect(prove).toHaveBeenCalledWith(raw());
 await guard.finish();expect(read).toHaveBeenCalledTimes(2);expect(prove).toHaveBeenCalledTimes(2);expect(boundary).toHaveBeenCalledTimes(2);
});
it('propagates a failed boundary without substituting cached values, and still allows final proof in the owner finally path',async()=>{
 const error=Error('target changed'),read=vi.fn(async()=>raw()),prove=vi.fn(async()=>native());
 const guard=effectVisibilityPreservation(raw(),native(),[],read,prove,async()=>{throw error;});
 await expect(guard.check()).rejects.toBe(error);expect(read).not.toHaveBeenCalled();expect(prove).not.toHaveBeenCalled();
 await guard.finish();expect(read).toHaveBeenCalledTimes(1);expect(prove).toHaveBeenCalledTimes(1);
});
it.each(['value','keyValue','keyCount'])('detects persistent public %s drift at final proof even when every topology boundary passes',async kind=>{
 const changed=raw();
 if(kind==='value')changed[0].params[0].value=[.2,.3];
 else if(kind==='keyValue')changed[0].params[0].keyframeDetails[0].value=[.2,.3];
 else changed[0].params[0].keyframeDetails=[];
 const read=vi.fn(async()=>changed),prove=vi.fn(async()=>native());
 const guard=effectVisibilityPreservation(raw(),native(),[],read,prove,async()=>{});
 await guard.check();await expect(guard.finish()).rejects.toThrow('CONTEXT_CHANGED');
 expect(read).toHaveBeenCalledTimes(1);expect(prove).not.toHaveBeenCalled();
});
it.each(['interpolation','tangent'])('preserves native-only %s checks with optional topology boundaries',async kind=>{
 const changed=native();
 if(kind==='interpolation')changed[0].params[0].keyframeDetails[0].interpolationMode=4;
 else changed[0].params[0].keyframeDetails[0].nativePointFields[2]=.75;
 const read=vi.fn(async()=>raw()),prove=vi.fn(async()=>changed);
 const guard=effectVisibilityPreservation(raw(),native(),[],read,prove,async()=>{});
 await guard.check();await expect(guard.finish()).rejects.toThrow('CONTEXT_CHANGED');
 expect(read).toHaveBeenCalledTimes(1);expect(prove).toHaveBeenCalledTimes(1);
});
it('cannot finish or begin native proof while the final public read is unresolved',async()=>{
 let release!:(value:ReturnType<typeof raw>)=>void,finished=false;
 const pending=new Promise<ReturnType<typeof raw>>(resolve=>{release=resolve;}),prove=vi.fn(async()=>native());
 const guard=effectVisibilityPreservation(raw(),native(),[],()=>pending,prove,async()=>{});
 const result=guard.finish().then(()=>{finished=true;});
 try{await Promise.resolve();await Promise.resolve();expect(finished).toBe(false);expect(prove).not.toHaveBeenCalled();}
 finally{release(raw());await result;}
 expect(finished).toBe(true);expect(prove).toHaveBeenCalledTimes(1);
});
