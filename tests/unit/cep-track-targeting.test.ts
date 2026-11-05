import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type { Server } from "node:http";

const require = createRequire(import.meta.url);
const service = require("../../apps/cep-track-targeting/service.cjs");
const scope = { projectPath: "C:\\work\\edit.prproj", sequenceId: "seq-123", sequenceName: "WORKING__test" };
function request(overrides = {}) { return { version: 1, id: "test-123456", operation: "set_track_targeting", expiresAt: Date.now() + 15000, ...scope,
  trackNames: { video: ["V1", "V2"], audio: ["A1"] }, targets: [{ mediaType: "video", trackIndex: 1 }], ...overrides }; }
function fixture() {
  const tracks = [true, false, true].map((targeted, i) => ({ name: ["V1", "V2", "A1"][i], targeted, isTargeted() { return this.targeted; }, setTargeted: vi.fn(function (this: any, value: boolean, broadcast: boolean) { expect(broadcast).toBe(true); this.targeted = value; }) }));
  const project: any = { path: scope.projectPath, activeSequence: { name: scope.sequenceName, sequenceID: scope.sequenceId, videoTracks: { 0: tracks[0], 1: tracks[1], numTracks: 2 }, audioTracks: { 0: tracks[2], numTracks: 1 } } };
  const code = readFileSync("apps/cep-track-targeting/host/targeting.jsx", "utf8").replace("__BRAHMA_YANTRA_TRACK_SCOPE__", JSON.stringify(scope));
  const context: any = { app: { project }, JSON: undefined };
  runInNewContext(code, context);
  const execute = (value: any) => JSON.parse(runInNewContext(service.expression(value), context));
  return { tracks, project, execute };
}
describe("targeting-only CEP native adapter", () => {
  it("broadcasts exclusive V2 state, reads every target and avoids redundant calls", () => {
    const f = fixture(); const result = f.execute(request());
    expect(result.status).toBe("pass"); expect(result.after.map((t: any) => t.targeted)).toEqual([false, true, false]);
    f.execute(request()); f.tracks.forEach(track => expect(track.setTargeted).toHaveBeenCalledOnce());
  });
  it("reads targeting without setters even when ExtendScript has no JSON global", () => {
    const f = fixture(); expect(f.execute(request({ operation: "read_track_targeting", targets: [] })).after.map((t: any) => t.targeted)).toEqual([true, false, true]);
    f.tracks.forEach(track => expect(track.setTargeted).not.toHaveBeenCalled());
  });
  it.each(["path", "sequenceID", "name", "trackNames", "trackCount"])("rejects stale %s before any setter", field => {
    const f = fixture();
    if (field === "path") f.project.path = "C:\\other.prproj";
    else if (field === "trackNames") f.tracks[1]!.name = "changed";
    else if (field === "trackCount") f.project.activeSequence.videoTracks.numTracks = 3;
    else f.project.activeSequence[field] = "other";
    expect(f.execute(request()).status).toBe("fail"); f.tracks.forEach(track => expect(track.setTargeted).not.toHaveBeenCalled());
  });
  it("rejects silent setter failure and restores the complete prior vector", () => {
    const f = fixture(); f.tracks[1]!.setTargeted.mockImplementationOnce(() => {});
    const result = f.execute(request()); expect(result.status).toBe("fail"); expect(result.restored).toBe(true);
    expect(f.tracks.map(t => t.targeted)).toEqual([true, false, true]);
  });
  it("reports unverified if context switches after mutation instead of writing another sequence", () => {
    const f = fixture(); f.tracks[1]!.setTargeted.mockImplementationOnce(() => { f.project.activeSequence.sequenceID = "other"; });
    const result = f.execute(request()); expect(result.status).toBe("unverified"); expect(result.restored).toBe(false);
  });
  it("rejects arbitrary operations, executable fields, duplicate and nonexistent targets", () => {
    for (const changes of [{ id: undefined }, { id: 12345678 }, { operation: "eval" }, { script: "app.project.save()" }, { targets: [{ mediaType: "video", trackIndex: 2 }] }, { targets: [request().targets[0], request().targets[0]] }]) expect(() => service.validate(request(changes))).toThrow();
  });
  it("keeps hostile string content inside JSON literals", () => {
    const f = fixture(); const name = 'quote"\\\n); app.project.save(); //\u2028';
    f.tracks[1]!.name = name;
    const result = f.execute(request({ trackNames: { video: ["V1", name], audio: ["A1"] } }));
    expect(result.status).toBe("pass"); expect(result.after[1].name).toBe(name);
  });
});
describe("targeting-only authenticated transport", () => {
  it("keeps quarantine until a late callback completes and a subsequent fresh read reconciles", async () => {
    const realTimer=globalThis.setTimeout,deadlines:Array<()=>void>=[],callbacks:Array<(raw:string)=>void>=[],f=fixture(),records:any[]=[];
    const timer=vi.spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,ms:any,...args:any[])=>{if(ms===12000){deadlines.push(fn);return realTimer(fn,60000,...args);}return realTimer(fn,ms,...args);}) as any);
    const evaluate=vi.fn((script:string,callback:(v:string)=>void)=>{callbacks.push(callback);if(callbacks.length>1){const req=JSON.parse(script.slice('BrahmaYantraTrackTargeting.execute('.length,-1));callback(JSON.stringify(f.execute(req)));}});
    const config={port:0,token:'b'.repeat(64)},server:Server=service.createTargetingServer(config,evaluate,(r:any)=>records.push(r));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));config.port=(server.address() as any).port;
    const post=(r:any)=>fetch(`http://127.0.0.1:${config.port}/targeting`,{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},body:JSON.stringify(r)});
    try{
      const pending=post(request());await vi.waitFor(()=>expect(callbacks).toHaveLength(1));deadlines[0]!();expect((await (await pending).json()).error).toBe('HOST_TIMEOUT_DO_NOT_REPLAY');
      expect((await (await post(request({id:'read-a-123',operation:'read_track_targeting',targets:[]}))).json()).status).toBe('pass');expect(records.some(r=>r.reconciled)).toBe(false);
      expect((await post(request({id:'write-a-123'}))).status).toBe(409);
      callbacks[0]!(JSON.stringify({status:'fail',error:'EXPIRED_REQUEST'}));expect(records.some(r=>r.reconciled)).toBe(false);
      await post(request({id:'read-b-123',operation:'read_track_targeting',targets:[]}));expect(records.some(r=>r.reconciled)).toBe(true);
      expect((await (await post(request({id:'write-b-123'}))).json()).status).toBe('pass');
    }finally{timer.mockRestore();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it("reconciles only a complete fresh read and never replays an uncertain mutation", async () => {
    const f=fixture(),records:any[]=[];
    const evaluate=vi.fn((script:string,callback:(v:string)=>void)=>{const req=JSON.parse(script.slice('BrahmaYantraTrackTargeting.execute('.length,-1));callback(JSON.stringify(evaluate.mock.calls.length===1?{status:'unverified'}:f.execute(req)));});
    const config={port:0,token:'a'.repeat(64)},server:Server=service.createTargetingServer(config,evaluate,(r:any)=>records.push(r));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));config.port=(server.address() as any).port;
    const post=(r:any)=>fetch(`http://127.0.0.1:${config.port}/targeting`,{method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},body:JSON.stringify(r)});
    const original=request();
    try{
      expect((await (await post(original)).json()).status).toBe('unverified');
      expect((await post(request({id:'next-123456'}))).status).toBe(409);
      const read=await post(request({id:'read-123456',operation:'read_track_targeting',targets:[]}));expect((await read.json()).status).toBe('pass');
      expect(records.some(r=>r.reconciled)).toBe(true);
      expect((await (await post(request({id:'next-223456'}))).json()).status).toBe('pass');expect(evaluate).toHaveBeenCalledTimes(3);
      expect((await (await post(original)).json()).status).toBe('unverified');expect(evaluate).toHaveBeenCalledTimes(3);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it("requires authentication, limits operations and deduplicates an exact request", async () => {
    const records: any[] = []; const evaluate = vi.fn((script: string, callback: (value: string) => void) => callback(JSON.stringify({ status: "pass", scriptLength: script.length })));
    const config = { port: 0, token: "a".repeat(64) }; const server: Server = service.createTargetingServer(config, evaluate, (record: any) => records.push(record));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); config.port = (server.address() as any).port;
    const url = `http://127.0.0.1:${config.port}/targeting`;
    const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
    try {
      expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify(request({ operation: "eval" })) })).status).toBe(400);
      const body = JSON.stringify(request());
      expect((await fetch(url, { method: "POST", headers, body })).status).toBe(200);
      expect((await fetch(url, { method: "POST", headers, body })).status).toBe(200);
      expect((await fetch(url, { method: "POST", headers, body: JSON.stringify(request({ targets: [] })) })).status).toBe(409);
      expect(evaluate).toHaveBeenCalledOnce(); expect(records).toHaveLength(1);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
