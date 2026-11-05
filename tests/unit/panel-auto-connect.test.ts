import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const state=vi.hoisted(()=>({snapshot:vi.fn(),dispatch:vi.fn(),connect:vi.fn(),disconnect:vi.fn(),dispose:vi.fn(),closed:undefined as any,status:undefined as any}));

let lifecycle:any;
let uxp:any;
const elements=new Map<string,any>();
function loadPanel(){
  const modules=new Map<string,any>();
  function load(file:string):any{
    if(modules.has(file))return modules.get(file);
    const exports={};modules.set(file,exports);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    runInNewContext(code,{exports,document,localStorage,setTimeout,clearTimeout,URL,performance,console,
      require:(name:string)=>{
        if(name==='uxp')return uxp;
        if(name.endsWith('premiere-host.js'))return {PremiereHost:class {connectionSnapshot=state.snapshot;dispatch=state.dispatch;}};
        if(name.endsWith('bridge-client.js'))return {BridgeClient:class {
          constructor(_dispatch:any,status:any,_log:any,_authenticated:any,closed:any){state.closed=closed;state.status=status;}
          connect=state.connect;disconnect=state.disconnect;dispose=state.dispose;
        }};
        if(name.endsWith('task-activity.js'))return {TaskHistory:class {items=[];},TaskActivityView:class {}};
        if(name.endsWith('mask-prompt-controller.js'))return {initializeMaskPromptController(){},destroyMaskPromptController(){},hideMaskPromptPanel(){}};
        return load(resolve(dirname(file),name.replace(/\.js$/,'.ts')));
      },
    },{filename:file});
    return exports;
  }
  load(resolve('apps/uxp-plugin/index.ts'));
}
beforeEach(()=>{
  vi.resetModules();vi.clearAllMocks();vi.useFakeTimers();elements.clear();lifecycle=undefined;
  const storage=new Map([['premiere-uxp-mcp.connection-identity','saved-connection']]);
  vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)});
  uxp={entrypoints:{setup:(config:any)=>{lifecycle=config.plugin;}},storage:{secureStorage:{
    getItem:async()=>new TextEncoder().encode('a'.repeat(64)),setItem:async()=>{},removeItem:async()=>{},
  }}};
  vi.stubGlobal('document',{
    getElementById:(id:string)=>{
      if(!elements.has(id))elements.set(id,{hidden:true,value:'',listeners:{},focus(){},addEventListener(name:string,fn:any){this.listeners[name]=fn;}});
      return elements.get(id);
    },
    addEventListener(){},body:{classList:{remove(){},add(){}}},
  });
  state.snapshot.mockResolvedValue({projectId:'project',projectName:'project'});
  state.dispatch.mockResolvedValue({});
  state.dispose.mockReturnValue({status:'pass',scope:'callback_release',sockets:1,closeRequested:1,closedAtRead:0,errors:[]});
});
afterEach(()=>{lifecycle?.destroy();vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});

describe('actual panel Load lifecycle',()=>{
  it('keeps retrying transient host initialization failures without another Load',async()=>{
    state.snapshot.mockRejectedValueOnce(Error('host starting')).mockRejectedValueOnce(Error('still starting'));
    loadPanel();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.connect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(state.connect).toHaveBeenCalledTimes(1);
  });
  it('waits for an open project when no prior pairing exists',async()=>{
    localStorage.removeItem('premiere-uxp-mcp.connection-identity');
    state.snapshot.mockResolvedValue({projectId:'',projectName:''});
    loadPanel();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.connect).not.toHaveBeenCalled();
    state.snapshot.mockResolvedValue({projectId:'new-project',projectName:'new'});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.connect).toHaveBeenCalledTimes(1);
  });
  it('reconnects a normal server close but respects explicit disconnect and destroy',async()=>{
    loadPanel();
    await vi.advanceTimersByTimeAsync(0);
    await state.closed({code:1000,reason:'server shutting down',wasAuthenticated:true});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.connect).toHaveBeenCalledTimes(2);
    state.status('connected');
    elements.get('connectButton').listeners.click();
    await state.closed({code:1006,reason:'late',wasAuthenticated:false});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.connect).toHaveBeenCalledTimes(2);
    await lifecycle.destroy();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.connect).toHaveBeenCalledTimes(2);
  });
  it('releases callbacks synchronously without a Promise, new timer, or transport-completion claim',async()=>{
    const info=vi.spyOn(console,'info').mockImplementation(()=>{});
    loadPanel();await vi.advanceTimersByTimeAsync(0);
    const schedule=vi.spyOn(globalThis,'setTimeout');
    expect(lifecycle.destroy()).toBeUndefined();
    lifecycle.destroy();expect(state.dispose).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
    const records=info.mock.calls.filter(call=>call[0]==='[plugin-teardown]').map(call=>JSON.parse(String(call[1])));
    expect(records.map(record=>record.phase)).toEqual(['destroy-enter','destroy-callbacks-released']);
    expect(records[1]).toMatchObject({scope:'callback_release',closeRequested:1,closedAtRead:0});
    await vi.advanceTimersByTimeAsync(20_000);expect(state.connect).toHaveBeenCalledTimes(1);
  });
  it('reports callback release failure synchronously without ordinary disconnect or reconnect',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    state.dispose.mockReturnValue({status:'unverified',scope:'callback_release',closeRequested:1,closedAtRead:0,errors:['socket_close_failed']});
    loadPanel();await vi.advanceTimersByTimeAsync(0);
    await lifecycle.destroy();
    await state.closed({code:1006,reason:'late close',wasAuthenticated:false});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.disconnect).not.toHaveBeenCalled();expect(state.connect).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[plugin-teardown]',expect.stringContaining('"phase":"destroy-unverified"'));
  });
  it('does not continue initialization native reads after destroy while identity is pending',async()=>{
    let finish!: (value:unknown)=>void;
    state.snapshot.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
    loadPanel();await vi.advanceTimersByTimeAsync(0);
    expect(state.snapshot).toHaveBeenCalledTimes(1);
    await lifecycle.destroy();
    finish({projectId:'late-project',projectName:'late'});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.dispatch).not.toHaveBeenCalled();expect(state.connect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops the reconnect identity continuation before late DOM or credential access',async()=>{
    let finish!: (value:unknown)=>void;
    state.snapshot.mockResolvedValueOnce({projectId:'',projectName:''})
      .mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
    loadPanel();await vi.advanceTimersByTimeAsync(0);
    expect(state.snapshot).toHaveBeenCalledTimes(2);
    await lifecycle.destroy();
    const lookup=vi.spyOn(document,'getElementById');
    const credentials=vi.spyOn(uxp.storage.secureStorage,'getItem');
    finish({projectId:'late-project',projectName:'late'});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lookup).not.toHaveBeenCalled();expect(credentials).not.toHaveBeenCalled();
    expect(state.connect).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels deferred initial panel wiring if destroyed immediately after Load',async()=>{
    loadPanel();await lifecycle.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.snapshot).not.toHaveBeenCalled();expect(state.connect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
