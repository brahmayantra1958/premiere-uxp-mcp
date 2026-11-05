import { describe, expect, it,vi } from "vitest";
import { BridgeClient,shouldLogBridgeCommand } from "../../apps/uxp-plugin/src/bridge-client.js";

describe("BridgeClient activity logging", () => {
  it('passes a validated preservation-read envelope to the host without accepting it for mutations',async()=>{
    const dispatch=vi.fn(async()=>({items:[],page:{hasMore:false}})),client=new BridgeClient(dispatch,()=>{},()=>{},()=>{},()=>{}) as any;
    Object.assign(client,{authenticated:true,socket:{send:vi.fn()}});
    const query={version:1,id:'internal-read',command:'query_timeline',args:{ids:['audio:0:0:source'],includeEffects:true},timeoutMs:1000,readPurpose:'job_preservation'};
    await client.onMessage(JSON.stringify(query));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(query);
    await client.onMessage(JSON.stringify({...query,id:'not-a-read',command:'set_effect_values'}));
    await client.onMessage(JSON.stringify({...query,id:'unknown-purpose',readPurpose:'silent'}));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('finalizes exported PNGs when a Mac owner has no native panel adapter', async () => {
    const client = new BridgeClient(async()=>({}),()=>{},()=>{},()=>{},()=>{}) as any;
    const send = vi.fn();
    Object.assign(client, { socket: { send, close() {} } });
    await client.onMessage(JSON.stringify({ version: 1, type: 'authenticated', ok: true, projectId: 'p', credentialIssued: false, programFrameProtocol: 1 }));
    const pending = client.requestProgramFrameReady('parent');
    const request = JSON.parse(send.mock.calls[0]![0]);
    expect(request.type).toBe('program_frame_ready');
    await client.onMessage(JSON.stringify({ type: 'native_visibility_result', id: request.id, result: { status: 'pass', width: 1920 } }));
    await expect(pending).resolves.toEqual({ status: 'pass', width: 1920 });
    await expect(client.requestNativeVisibility('parent', 'timeline', 'p', 's')).resolves.toMatchObject({ status: 'unsupported' });
    client.disconnect();
  });
  it.each(['no-event','error-only','open-without-auth'] as const)('recovers incomplete UXP handshakes (%s)', async scenario => {
    vi.useFakeTimers();
    const sockets: EventTarget[] = [];
    class Socket extends EventTarget {
      constructor() { super(); sockets.push(this); }
      send() {}
      close() { this.dispatchEvent(Object.assign(new Event('close'),{code:1000,reason:'local close'})); }
    }
    vi.stubGlobal('WebSocket',Socket);
    const closed=vi.fn(),status=vi.fn();
    const client=new BridgeClient(async()=>({}),status,()=>{},()=>{},closed);
    try {
      client.connect('ws://localhost:8099',{method:'project_credential',projectId:'saved',credential:'a'.repeat(64)});
      if(scenario==='error-only')sockets[0]!.dispatchEvent(new Event('error'));
      if(scenario==='open-without-auth')sockets[0]!.dispatchEvent(new Event('open'));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({code:1006,wasAuthenticated:false}));
      expect(status).toHaveBeenLastCalledWith('disconnected');
      sockets[0]!.dispatchEvent(Object.assign(new Event('close'),{code:1006,reason:'late close'}));
      expect(closed).toHaveBeenCalledTimes(1);
      client.connect('ws://localhost:8099',{method:'project_credential',projectId:'saved',credential:'a'.repeat(64)});
      client.disconnect();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(closed).toHaveBeenCalledTimes(1);
    } finally { client.disconnect();vi.unstubAllGlobals();vi.useRealTimers(); }
  });
  it('rejects reverse work promptly when the owner only advertises older Color sampling',async()=>{
    const client=new BridgeClient(async()=>({}),()=>{},()=>{},()=>{},()=>{}) as any,send=vi.fn();
    Object.assign(client,{authenticated:true,effectNativeSampleProtocol:true,socket:{send}});
    await expect(client.requestEffectNativeSample('parent',{reversed:true,purpose:'time_mapping'})).resolves.toMatchObject({status:'unsupported'});
    expect(send).not.toHaveBeenCalled();expect(client.visibility.size).toBe(0);
  });
  it("keeps high-frequency lifecycle observation commands out of the visible activity log", () => {
    expect(shouldLogBridgeCommand("get_capabilities")).toBe(false);
    expect(shouldLogBridgeCommand("inspect_host_context")).toBe(false);
    expect(shouldLogBridgeCommand("open_working_project")).toBe(true);
  });
});
