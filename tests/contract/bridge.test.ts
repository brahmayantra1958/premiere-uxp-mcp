import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { UxpBridgeServer } from "../../apps/mcp-server/src/bridge.js";
import { freshTestDirectory } from "../helpers/workspace.js";
import {ExecutionEvidenceStore} from '../../apps/mcp-server/src/execution-evidence.js';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function opened(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (socket.readyState === WebSocket.CLOSED) return Promise.reject(new Error("WebSocket closed before the open listener was attached"));
  return new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
}

async function authenticateWithToken(socket: WebSocket, token: string, projectId = "project-a"): Promise<{ credential: string }> {
  await opened(socket);
  const acknowledged = new Promise<Record<string, unknown>>((resolve) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
  });
  socket.send(JSON.stringify({ version: 1, type: "authenticate", method: "pairing_token", token, projectId, client: "premiere-uxp-panel" }));
  const response = await acknowledged;
  expect(response).toMatchObject({ version: 1, type: "authenticated", ok: true, projectId, credentialIssued: true });
  expect(response.credential).toMatch(/^[a-f0-9]{64}$/);
  return { credential: String(response.credential) };
}

async function authenticateWithCredential(socket: WebSocket, credential: string, projectId = "project-a"): Promise<void> {
  await opened(socket);
  const acknowledged = new Promise<Record<string, unknown>>((resolve) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
  });
  socket.send(JSON.stringify({ version: 1, type: "authenticate", method: "project_credential", credential, projectId, client: "premiere-uxp-panel" }));
  await expect(acknowledged).resolves.toMatchObject({ version: 1, type: "authenticated", ok: true, projectId, credentialIssued: false });
}

async function authenticateWithLocalApproval(socket: WebSocket, projectId = "project-a"): Promise<{ credential: string }> {
  await opened(socket);
  const acknowledged = new Promise<Record<string, unknown>>((resolve) => {
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
  });
  socket.send(JSON.stringify({ version: 1, type: "authenticate", method: "local_approval", projectId, client: "premiere-uxp-panel" }));
  const response = await acknowledged;
  expect(response).toMatchObject({ version: 1, type: "authenticated", ok: true, projectId, credentialIssued: true });
  expect(response.credential).toMatch(/^[a-f0-9]{64}$/);
  return { credential: String(response.credential) };
}

function bridgePaths(directory: string) {
  return { token: path.join(directory, "token.txt"), credentials: path.join(directory, "credentials.json") };
}

const running: UxpBridgeServer[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((bridge) => bridge.stop())); });

describe("authenticated UXP bridge", () => {
  it.each([false,true])('persists leased native completion before acknowledgment, including late replies: late=%s',async late=>{
    const directory=await freshTestDirectory('bridge-terminal-proof'),port=await freePort(),paths=bridgePaths(directory);
    const request={version:1 as const,id:randomUUID(),command:'save_working_project',args:{expectedProjectId:'project-a'},timeoutMs:late?30:1000};
    const file=path.join(directory,'idempotency.json');
    await writeFile(file+'.mutation-lock',JSON.stringify({version:1,commandId:request.id,operations:[{kind:'host',commandId:request.id,command:request.command,args:request.args,dispatched:true}]}));
    const bridge=new UxpBridgeServer('127.0.0.1',port,paths.token,paths.credentials);running.push(bridge);await bridge.start();
    const socket=new WebSocket(`ws://127.0.0.1:${port}/`);await authenticateWithToken(socket,await readFile(paths.token,'utf8'));
    let dispatched=0;socket.on('message',raw=>{const incoming=JSON.parse(raw.toString());dispatched++;setTimeout(()=>socket.send(JSON.stringify({version:1,id:incoming.id,ok:true,result:{status:'pass'},durationMs:1})),late?70:0);});
    if(late)await expect(bridge.call(request)).rejects.toThrow('timed out');else expect((await bridge.call(request)).ok).toBe(true);
    const evidence=new ExecutionEvidenceStore(file);let rows=await evidence.find([request.id]);
    for(let i=0;late&&!rows.length&&i<40;i++){await new Promise(r=>setTimeout(r,10));rows=await evidence.find([request.id]);}
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:request.id,state:'complete',response:{result:{status:'pass'}}});expect(dispatched).toBe(1);socket.close();
  });
  it('does not acknowledge success if terminal evidence cannot be flushed',async()=>{
    const directory=await freshTestDirectory('bridge-terminal-unwritable'),port=await freePort(),paths=bridgePaths(directory),id=randomUUID(),file=path.join(directory,'idempotency.json');
    await writeFile(file+'.mutation-lock',JSON.stringify({version:1,commandId:id,operations:[{kind:'host',commandId:id,command:'save_working_project',args:{},dispatched:true}]}));
    await writeFile(file+'.execution','not a directory');
    const bridge=new UxpBridgeServer('127.0.0.1',port,paths.token,paths.credentials);running.push(bridge);await bridge.start();
    const socket=new WebSocket(`ws://127.0.0.1:${port}/`);await authenticateWithToken(socket,await readFile(paths.token,'utf8'));
    socket.on('message',raw=>socket.send(JSON.stringify({version:1,id:JSON.parse(raw.toString()).id,ok:true,result:{status:'pass'},durationMs:1})));
    await expect(bridge.call({version:1,id,command:'save_working_project',args:{},timeoutMs:1000})).rejects.toThrow('EXECUTION_EVIDENCE_NOT_DURABLE');socket.close();
  });
  it.each(['disconnect','replace'])('ends a tracked job observation as unverified on panel %s',async mode=>{
    const directory=await freshTestDirectory('bridge-track-events-'+mode),port=await freePort(),paths=bridgePaths(directory);
    const bridge=new UxpBridgeServer('127.0.0.1',port,paths.token,paths.credentials);running.push(bridge);await bridge.start();
    const token=await readFile(paths.token,'utf8'),socket=new WebSocket(`ws://127.0.0.1:${port}/`);
    await authenticateWithToken(socket,token);const jobId=randomUUID();
    const progress={version:1,type:'track_job_progress',jobId,state:'running',completedSteps:1,totalSteps:2,durationMs:10};
    socket.on('message',raw=>{
      const request=JSON.parse(raw.toString());
      socket.send(JSON.stringify({...progress,jobId:randomUUID()})); // unregistered job
      socket.send(JSON.stringify({...progress,state:'pass'})); // lacks all steps
      socket.send(JSON.stringify(progress));
      socket.send(JSON.stringify({version:1,id:request.id,ok:true,result:{status:'partial'},durationMs:1}));
    });
    await bridge.call({version:1,id:jobId,command:'submit_track_command_sequence',args:{steps:[{},{}]},timeoutMs:1000});
    const page=bridge.events.list({jobId});expect(page.events.filter(e=>e.kind==='job').map(e=>e.state)).toEqual(['running']);
    const terminal=bridge.waitEvents({sessionId:page.sessionId,afterRevision:page.nextRevision,jobId,terminalOnly:true,timeoutMs:1000});
    let replacement:WebSocket|undefined;
    if(mode==='replace'){
      replacement=new WebSocket(`ws://127.0.0.1:${port}/`);await authenticateWithToken(replacement,token);
      replacement.send(JSON.stringify({...progress,state:'pass',completedSteps:2}));
    }else socket.close();
    expect((await terminal).events).toMatchObject([{jobId,state:'unverified',completedSteps:1,totalSteps:2}]);
    replacement?.close();
  });
  it("rejects an invalid pairing token", async () => {
    const directory = await freshTestDirectory("bridge-invalid-auth");
    const port = await freePort();
    const paths = bridgePaths(directory);
    const bridge = new UxpBridgeServer("127.0.0.1", port, paths.token, paths.credentials);
    running.push(bridge);
    await bridge.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    await opened(socket);
    socket.send(JSON.stringify({ version: 1, type: "authenticate", method: "pairing_token", token: "0".repeat(64), projectId: "project-a", client: "premiere-uxp-panel" }));
    const code = await new Promise<number>((resolve) => socket.once("close", resolve));
    expect(code).toBe(1008);
    expect(bridge.status().connected).toBe(false);
  });

  it("rejects command pairing unless the next local project was explicitly approved", async () => {
    const directory = await freshTestDirectory("bridge-local-approval-off");
    const port = await freePort();
    const paths = bridgePaths(directory);
    const bridge = new UxpBridgeServer("127.0.0.1", port, paths.token, paths.credentials);
    running.push(bridge);
    await bridge.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    await opened(socket);
    socket.send(JSON.stringify({ version: 1, type: "authenticate", method: "local_approval", projectId: "project-a", client: "premiere-uxp-panel" }));
    await expect(new Promise<number>((resolve) => socket.once("close", resolve))).resolves.toBe(1008);
    expect(bridge.status()).toMatchObject({ connected: false, localApprovalPending: false });
  });

  it("consumes command pairing approval once and persists the issued project credential", async () => {
    const directory = await freshTestDirectory("bridge-local-approval-once");
    const port = await freePort();
    const paths = bridgePaths(directory);
    const bridge = new UxpBridgeServer("127.0.0.1", port, paths.token, paths.credentials, { allowNextLocalProject: true });
    running.push(bridge);
    await bridge.start();
    const approved = new WebSocket(`ws://127.0.0.1:${port}/`);
    const { credential } = await authenticateWithLocalApproval(approved, "project-a");
    expect(bridge.status()).toMatchObject({ connected: true, authenticationMethod: "local_approval", localApprovalPending: false });
    const second = new WebSocket(`ws://127.0.0.1:${port}/`);
    await opened(second);
    second.send(JSON.stringify({ version: 1, type: "authenticate", method: "local_approval", projectId: "project-b", client: "premiere-uxp-panel" }));
    await expect(new Promise<number>((resolve) => second.once("close", resolve))).resolves.toBe(1008);
    approved.close();
    const reconnect = new WebSocket(`ws://127.0.0.1:${port}/`);
    await authenticateWithCredential(reconnect, credential, "project-a");
    reconnect.close();
  });

  it("authenticates one panel, correlates responses, and times out a missing response", async () => {
    const directory = await freshTestDirectory("bridge-roundtrip");
    const port = await freePort();
    const paths = bridgePaths(directory);
    const bridge = new UxpBridgeServer("127.0.0.1", port, paths.token, paths.credentials);
    running.push(bridge);
    await bridge.start();
    const token = await readFile(paths.token, "utf8");
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    await authenticateWithToken(socket, token);
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString()) as { id: string; command: string };
      if (request.command === "ignore") return;
      socket.send(JSON.stringify({ version: 1, id: request.id, ok: true, result: { host: "real-protocol-simulation" }, durationMs: 1 }));
    });
    await expect(bridge.call({ version: 1, id: "roundtrip", command: "ping", args: {}, timeoutMs: 1_000 })).resolves.toMatchObject({ ok: true, id: "roundtrip" });
    await expect(bridge.call({ version: 1, id: "timeout", command: "ignore", args: {}, timeoutMs: 30 })).rejects.toThrow(/timed out/);
    socket.close();
  });

  it("reconnects after server restart with a project-scoped credential", async () => {
    const directory = await freshTestDirectory("bridge-saved-project");
    const paths = bridgePaths(directory);
    const firstPort = await freePort();
    const first = new UxpBridgeServer("127.0.0.1", firstPort, paths.token, paths.credentials);
    await first.start();
    const firstSocket = new WebSocket(`ws://127.0.0.1:${firstPort}/`);
    const { credential } = await authenticateWithToken(firstSocket, await readFile(paths.token, "utf8"), "project-a");
    firstSocket.close();
    await first.stop();

    const secondPort = await freePort();
    const second = new UxpBridgeServer("127.0.0.1", secondPort, paths.token, paths.credentials);
    running.push(second);
    await second.start();
    const secondSocket = new WebSocket(`ws://127.0.0.1:${secondPort}/`);
    await authenticateWithCredential(secondSocket, credential, "project-a");
    expect(second.status()).toMatchObject({ connected: true, authenticationMethod: "project_credential" });
    secondSocket.close();
  });

  it("does not accept a saved credential for another project", async () => {
    const directory = await freshTestDirectory("bridge-project-isolation");
    const port = await freePort();
    const paths = bridgePaths(directory);
    const bridge = new UxpBridgeServer("127.0.0.1", port, paths.token, paths.credentials);
    running.push(bridge);
    await bridge.start();
    const paired = new WebSocket(`ws://127.0.0.1:${port}/`);
    const { credential } = await authenticateWithToken(paired, await readFile(paths.token, "utf8"), "project-a");
    paired.close();
    const wrongProject = new WebSocket(`ws://127.0.0.1:${port}/`);
    await opened(wrongProject);
    wrongProject.send(JSON.stringify({ version: 1, type: "authenticate", method: "project_credential", credential, projectId: "project-b", client: "premiere-uxp-panel" }));
    await expect(new Promise<number>((resolve) => wrongProject.once("close", resolve))).resolves.toBe(1008);
  });

  it("keeps the simulated localhost protocol p95 below 500 ms for 20 sequential calls", async () => {
    const directory = await freshTestDirectory("bridge-performance");
    const port = await freePort();
    const paths = bridgePaths(directory);
    const bridge = new UxpBridgeServer("127.0.0.1", port, paths.token, paths.credentials);
    running.push(bridge);
    await bridge.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    await authenticateWithToken(socket, await readFile(paths.token, "utf8"));
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString()) as { id: string };
      socket.send(JSON.stringify({ version: 1, id: request.id, ok: true, result: { pong: true }, durationMs: 0 }));
    });
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      await bridge.call({ version: 1, id: `perf-${index}`, command: "ping", args: {}, timeoutMs: 1_000 });
      samples.push(performance.now() - started);
    }
    const sorted = samples.toSorted((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    expect(p95).toBeLessThan(500);
    socket.close();
  });
});
