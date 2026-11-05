import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BridgeRequest, BridgeResponse } from "@premiere-uxp/contracts";
import { describe, expect, it } from "vitest";
import type { UxpBridgeServer } from "../../apps/mcp-server/src/bridge.js";
import { RemoteBridge } from "../../apps/mcp-server/src/remote-bridge.js";
import { isFetchForbiddenPort, RuntimeControlServer } from "../../apps/mcp-server/src/runtime-control.js";
import {RuntimeEvents} from '../../apps/mcp-server/src/runtime-events.js';
import {BridgeTransportError} from '../../apps/mcp-server/src/bridge-transport.js';
import {setTimeout as delay} from 'node:timers/promises';
import {parseCallWaitMs,runtimeCallAdmission,runtimeCallWaitHeader} from '../../apps/mcp-server/src/runtime-call-admission.js';

describe("reusable Premiere runtime control", () => {
  it.each(['ready','delayed','offline','lost-response'] as const)('negotiates one POST with pre-dispatch admission: %s',async scenario=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'premiere-admission-')),tokenPath=path.join(directory,'token.txt');
    await writeFile(tokenPath,'token');let polls=0,calls=0;
    const bridge={async getStatus(){return {connected:scenario==='ready'||(scenario!=='offline'&&++polls>=2)};},async call(request:BridgeRequest){
      calls++;if(scenario==='lost-response')throw new BridgeTransportError('response lost',{code:'PANEL_DISCONNECTED',dispatchState:'unknown'});
      return {version:1,id:request.id,ok:true,durationMs:0,result:{done:true}};
    }} as unknown as UxpBridgeServer;
    const control=new RuntimeControlServer({host:'127.0.0.1',port:0,token:'token',bridge,onShutdown(){}}),port=await control.start();
    try{
      const url=`http://127.0.0.1:${port}`,health=await fetch(`${url}/health`).then(r=>r.json());
      expect(health).toMatchObject({callAdmission:runtimeCallAdmission});
      const remote=new RemoteBridge(url,tokenPath,async()=>({disposition:'reused',health}),scenario==='offline'?40:1500);
      // A separate status preflight would fail this probe. The owner itself
      // still checks its cached connection state before dispatching once.
      const request=(remote as any).request.bind(remote),routes:string[]=[];
      (remote as any).request=async(method:string,route:string,...args:unknown[])=>{routes.push(`${method} ${route}`);return request(method,route,...args);};
      const result=remote.call({version:1,id:'one',command:'save_working_project',args:{},timeoutMs:1000});
      if(scenario==='ready'||scenario==='delayed')await expect(result).resolves.toMatchObject({ok:true});
      else await expect(result).rejects.toMatchObject({transport:{dispatchState:scenario==='offline'?'not_sent':'unknown'}});
      expect(routes).toEqual(['POST /call']);expect(calls).toBe(scenario==='offline'?0:1);
    }finally{await control.stop();await rm(directory,{recursive:true,force:true});}
  });
  it('never dispatches a caller-abandoned admission after the panel connects',async()=>{
    let entered!:()=>void;const checking=new Promise<void>(resolve=>{entered=resolve;});let connected=false,calls=0;
    const bridge={async getStatus(){entered();return {connected};},async call(){calls++;throw Error('must not dispatch');}} as unknown as UxpBridgeServer;
    const control=new RuntimeControlServer({host:'127.0.0.1',port:0,token:'token',bridge,onShutdown(){}}),port=await control.start();
    try{
      const abort=new AbortController();
      const pending=fetch(`http://127.0.0.1:${port}/call`,{method:'POST',headers:{authorization:'Bearer token','content-type':'application/json',[runtimeCallWaitHeader]:'1500'},body:JSON.stringify({version:1,id:'abandoned',command:'save_working_project',args:{},timeoutMs:1000}),signal:abort.signal});
      const rejected=expect(pending).rejects.toThrow();await checking;abort.abort();await rejected;
      // Allow the HTTP close event to reach the owner before authentication.
      await delay(50);connected=true;await delay(300);expect(calls).toBe(0);
    }finally{await control.stop();}
  });
  it.each(['0','-1','90001','NaN','1.5','Infinity',['1','2']])('rejects malformed admission without dispatch: %s',value=>{
    expect(()=>parseCallWaitMs(value)).toThrow(BridgeTransportError);
    expect(parseCallWaitMs(undefined)).toBe(0);expect(parseCallWaitMs('90000')).toBe(90000);
  });
  it.each(['not_sent','unknown','legacy'] as const)('forwards transport metadata without changing legacy error text: %s',async state=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'premiere-transport-')),tokenPath=path.join(directory,'token.txt');await writeFile(tokenPath,'token');let calls=0;
    const detail='Premiere UXP panel is not connected';
    const bridge={async getStatus(){return {connected:true};},async call(){calls++;if(state==='legacy')throw Error(detail);throw new BridgeTransportError(detail,{code:'PANEL_DISCONNECTED',dispatchState:state});}} as unknown as UxpBridgeServer;
    const control=new RuntimeControlServer({host:'127.0.0.1',port:0,token:'token',bridge,onShutdown(){}}),port=await control.start();
    try{
      const remote=new RemoteBridge(`http://127.0.0.1:${port}`,tokenPath,async()=>undefined);
      const result=remote.call({version:1,id:'one',command:'save_working_project',args:{},timeoutMs:1000});
      await expect(result).rejects.toMatchObject({message:'Premiere runtime POST /call failed: '+detail,transport:{code:state==='legacy'?'RUNTIME_REQUEST_FAILED':'PANEL_DISCONNECTED',dispatchState:state==='legacy'?'unknown':state}});
      expect(calls).toBe(1);
    }finally{await control.stop();await rm(directory,{recursive:true,force:true});}
  });
  it.each(['delayed', 'offline', 'lost-response'] as const)('waits before dispatch and never replays (%s)', async scenario => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "premiere-connect-"));
    const tokenPath = path.join(directory, 'token.txt');
    await writeFile(tokenPath, 'test-token');
    let polls = 0, calls = 0;
    const bridge = {
      async getStatus() { return { connected: scenario !== 'offline' && ++polls >= 2 }; },
      async call(request: BridgeRequest) {
        calls++;
        if (scenario === 'lost-response') throw Error('Premiere panel disconnected while a command was running');
        return {version: 1, id: request.id, ok: true, durationMs: 1, result: {done: true}};
      },
    } as unknown as UxpBridgeServer;
    const control = new RuntimeControlServer({host:'127.0.0.1',port:0,token:'test-token',bridge,onShutdown() {}});
    const port = await control.start();
    try {
      const remote = new RemoteBridge(`http://127.0.0.1:${port}`,tokenPath,async()=>undefined,scenario === 'offline' ? 80 : 1500);
      const promise = remote.call({version:1,id:'one-exact-command',command:'place_clips',args:{},timeoutMs:1000});
      if (scenario === 'delayed') await expect(promise).resolves.toMatchObject({ok:true,result:{done:true}});
      // A busy CI runner can exhaust this deliberately short 80 ms budget in
      // the read-only status HTTP request. Both outcomes are pre-dispatch;
      // the calls===0 assertion below is the safety contract, not its wording.
      else await expect(promise).rejects.toThrow(scenario === 'offline' ? /Premiere UXP panel is not connected|operation was aborted due to timeout/i : 'disconnected while a command was running');
      expect(calls).toBe(scenario === 'offline' ? 0 : 1);
    } finally {
      await control.stop();
      await rm(directory,{recursive:true,force:true});
    }
  });
  it("rejects ports that Node fetch refuses before a network request", async () => {
    expect(isFetchForbiddenPort(6000)).toBe(true);
    expect(isFetchForbiddenPort(8099)).toBe(false);
    const control = new RuntimeControlServer({
      host: "127.0.0.1",
      port: 6000,
      token: "unused",
      bridge: {} as UxpBridgeServer,
      onShutdown() {},
    });
    await expect(control.start()).rejects.toThrow("blocked by Fetch's bad-port policy");
  });

  it("authenticates local clients and forwards status, approval, and one exact host request", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "premiere-runtime-"));
    const tokenPath = path.join(directory, "token.txt");
    const token = "runtime-test-token";
    await writeFile(tokenPath, token, "utf8");
    let approvalArmed = false;
    const events=new RuntimeEvents();
    const fakeBridge = {
      async getStatus() {
        return { connected: true, connectedAt: "2026-08-26T00:00:00.000Z", authenticationMethod: "project_credential", projectKey: "test", host: "localhost", port: 8099, tokenPath: "test", localApprovalPending: approvalArmed };
      },
      async call(request: BridgeRequest): Promise<BridgeResponse> {
        return { version: 1, id: request.id, ok: true, result: { command: request.command }, durationMs: 1 };
      },
      armNextLocalProject() { approvalArmed = true; },
      waitEvents:events.wait.bind(events),
    } as unknown as UxpBridgeServer;
    const control = new RuntimeControlServer({ host: "127.0.0.1", port: 0, token, bridge: fakeBridge, onShutdown() {} });
    const port = await control.start();
    try {
      const url = `http://127.0.0.1:${port}`;
      const health = await fetch(`${url}/health`).then((response) => response.json()) as { ready: boolean };
      expect(health.ready).toBe(true);
      const unauthorized = await fetch(`${url}/status`);
      expect(unauthorized.status).toBe(401);
      expect((await fetch(`${url}/events/wait`,{method:'POST',body:'{}'})).status).toBe(401);
      let resolvedUrl = url;
      const remote = new RemoteBridge(async () => resolvedUrl, tokenPath, async () => undefined);
      expect((await remote.getStatus()).connected).toBe(true);
      const waiting=remote.waitEvents({jobId:'job',terminalOnly:true,timeoutMs:1000});
      events.append({kind:'job',id:'job',state:'pass'});expect((await waiting).events[0]?.state).toBe('pass');
      await remote.armNextLocalProject();
      expect((await remote.getStatus()).localApprovalPending).toBe(true);
      const response = await remote.call({ version: 1, id: "request-1", command: "premiere_ping", args: {}, timeoutMs: 1_000 });
      expect(response).toMatchObject({ ok: true, result: { command: "premiere_ping" } });
      resolvedUrl = `${url}/`;
      expect((await remote.getStatus()).connected).toBe(true);
    } finally {
      events.close();
      await control.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
