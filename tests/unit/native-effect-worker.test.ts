import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mock.spawn}));
const actualPlatform = process.platform;
beforeEach(()=>{Object.defineProperty(process, 'platform', { value: 'win32' }); vi.resetModules();mock.spawn.mockReset();});
afterEach(()=>{Object.defineProperty(process, 'platform', { value: actualPlatform });});
function child(){
  const value=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),unref:vi.fn(),kill:vi.fn()});
  mock.spawn.mockReturnValue(value);return value;
}
describe('owned native effect worker',()=>{
  it('reports macOS unsupported without spawning a Windows process', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const {runNativeEffectAdapter}=await import('../../apps/mcp-server/src/native-effect-worker.js');
    expect(await runNativeEffectAdapter('state', [], 1000)).toMatchObject({ status: 'unsupported', dispatchAccepted: false });
    expect(mock.spawn).not.toHaveBeenCalled();
  });
  it('serializes requests and reuses a process without reusing observed state',async()=>{
    const host=child(),requests:any[]=[];host.stdin.on('data',raw=>requests.push(JSON.parse(String(raw))));
    const {runNativeEffectAdapter}=await import('../../apps/mcp-server/src/native-effect-worker.js');
    const first=runNativeEffectAdapter('state',['1','clip'],1000),second=runNativeEffectAdapter('state',['1','clip'],1000);
    await new Promise(resolve=>setImmediate(resolve));expect(requests).toHaveLength(1);
    host.stdout.write(JSON.stringify({id:requests[0].id,result:{state:0}})+'\n');expect(await first).toEqual({state:0});
    await new Promise(resolve=>setImmediate(resolve));expect(requests).toHaveLength(2);
    host.stdout.write(JSON.stringify({id:requests[1].id,result:{state:8}})+'\n');expect(await second).toEqual({state:8});
    expect(mock.spawn).toHaveBeenCalledTimes(1);expect(host.unref).toHaveBeenCalledOnce();host.emit('exit');
  });
  it('fails mismatched responses and never replays a dispatch',async()=>{
    const host=child();const {runNativeEffectAdapter}=await import('../../apps/mcp-server/src/native-effect-worker.js');
    const request=runNativeEffectAdapter('scroll',['bounded'],1000);await new Promise(resolve=>setImmediate(resolve));
    host.stdout.write(JSON.stringify({id:999,result:{status:'pass'}})+'\n');
    expect(await request).toMatchObject({status:'unverified'});expect(mock.spawn).toHaveBeenCalledOnce();expect(host.kill).toHaveBeenCalledOnce();
  });
  it('terminates only its own worker on timeout, with no automatic replay',async()=>{
    const host=child();const {runNativeEffectAdapter}=await import('../../apps/mcp-server/src/native-effect-worker.js');
    expect(await runNativeEffectAdapter('panel',['bounded'],15)).toMatchObject({status:'unverified',reason:'NATIVE_WORKER_TIMEOUT_DO_NOT_REPLAY'});
    expect(mock.spawn).toHaveBeenCalledOnce();expect(host.kill).toHaveBeenCalledOnce();
  });
  it('handles a broken input pipe without crashing the owner or replaying work',async()=>{
    const host=child();const {runNativeEffectAdapter}=await import('../../apps/mcp-server/src/native-effect-worker.js');
    const request=runNativeEffectAdapter('scroll',['bounded'],1000);await new Promise(resolve=>setImmediate(resolve));
    expect(()=>host.stdin.emit('error',Object.assign(Error('pipe closed'),{code:'EPIPE'}))).not.toThrow();
    expect(await request).toMatchObject({status:'unverified',reason:'NATIVE_WORKER_STREAM_FAILED'});
    expect(mock.spawn).toHaveBeenCalledOnce();expect(host.kill).toHaveBeenCalledOnce();
    expect(()=>host.stdin.emit('error',Error('late stream error'))).not.toThrow();
  });
});
