import path from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { BridgeRequest, BridgeResponse } from "@premiere-uxp/contracts";
import { AuditLog, ReceiptStore } from "../../apps/mcp-server/src/audit.js";
import { HostExecutor, PROJECT_OPEN_TIMEOUT_MS } from "../../apps/mcp-server/src/host-executor.js";
import type { UxpBridgeServer } from "../../apps/mcp-server/src/bridge.js";
import { freshTestDirectory } from "../helpers/workspace.js";

const snapshot = {
  projectId: "project-1",
  projectName: "Scratch",
  projectPath: "C:\\scratch\\working.prproj",
  capturedAt: "2026-08-24T00:00:00.000Z",
  activeSequence: null,
  sequences: [],
  projectItems: [],
  projectItemLimit: 500,
  projectItemsTruncated: false,
  offlineMediaIds: [],
  proxyAttachments: [],
  markers: [],
  mogrtItems: [],
  effects: [],
  audioState: [],
  unsupportedFields: [],
};

describe("HostExecutor readback and idempotency", () => {
  it('carries owner verification purpose in the envelope only and rejects content commands before dispatch',async()=>{
    const directory=await freshTestDirectory('host-verification-purpose'),requests:BridgeRequest[]=[];
    const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{requests.push(request);return {version:1,id:request.id,ok:true,durationMs:0,result:{items:[],page:{hasMore:false}}};}} as UxpBridgeServer;
    const host=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),new ReceiptStore(path.join(directory,'receipts.json')),1000);
    const args={expectedProjectId:'p',expectedSequenceId:'s',ids:['audio:0:0:source'],includeEffects:true};
    await host.read('query_timeline',args,{readPurpose:'job_preservation'});
    expect(requests[0]).toMatchObject({command:'query_timeline',readPurpose:'job_preservation',args});
    expect(requests[0]?.args.readPurpose).toBeUndefined();
    await host.read('query_timeline',args);
    expect(requests[1]?.readPurpose).toBeUndefined();
    await expect(host.read('set_effect_values',args,{readPurpose:'job_preservation'})).rejects.toThrow('INVALID_INTERNAL_READ_PURPOSE');
    expect(requests).toHaveLength(2);
  });
  it.each(['clone_clips','remove_clips','insert_mogrt_caption'])('keeps native evidence and receipts without an unused project plan: %s',async command=>{
    const directory=await freshTestDirectory('host-owned-preflight'),store=new ReceiptStore(path.join(directory,'receipts.json')),requests:BridgeRequest[]=[];
    const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{requests.push(request);return {version:1,id:request.id,ok:true,durationMs:1,result:{status:'fail',errors:['Native readback mismatch'],before:{count:1},after:{count:2}}};}} as UxpBridgeServer;
    const host=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
    const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'S'};
    const receipt=await host.mutate(command,args,'one');
    expect(receipt).toMatchObject({status:'fail',errors:['Native readback mismatch']});
    expect(requests.map(r=>r.command)).toEqual([command]);expect(requests[0]?.args).toEqual(args);
    expect(await store.inspectRecovery()).toBeDefined();
    expect(await host.mutate(command,args,'one')).toEqual(receipt);expect(requests).toHaveLength(1);
  });
  it.each(['clone_clips','remove_clips','insert_mogrt_caption'])('rejects missing sequence identity before host-owned preflight: %s',async command=>{
    const directory=await freshTestDirectory('missing-edit-pins'),store=new ReceiptStore(path.join(directory,'receipts.json'));let calls=0;
    const bridge={async call(){calls++;throw Error('must not dispatch');}} as unknown as UxpBridgeServer;
    const host=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
    expect(await host.mutate(command,{expectedProjectId:'p'},'bad')).toMatchObject({status:'fail',errors:[expect.stringContaining('EXACT_EDIT_TARGET_REQUIRED')]});
    expect(calls).toBe(0);expect(await store.inspectRecovery()).toBeUndefined();
  });
  it.each(['PARAMETER_ANIMATED','KEYFRAME_OUTSIDE_CLIP'])('releases proven pre-content refusal %s and lets the next independent edit run',async code=>{
    const directory=await freshTestDirectory('production-preflight'),store=new ReceiptStore(path.join(directory,'receipts.json'));
    const bridge={async call(r:BridgeRequest):Promise<BridgeResponse>{return r.id==='bad'?{version:1,id:r.id,ok:false,error:{code,message:code,details:{contentDispatched:false,retryable:false,errorClassification:'preflight'}},durationMs:1}:{version:1,id:r.id,ok:true,result:{status:'pass'},durationMs:1};}} as UxpBridgeServer;
    const host=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
    const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'S',trackItemId:'audio:0:0:source',expectedProjectItemId:'source',expectedMediaType:'audio',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:2,componentIndex:0};
    expect(await host.mutate('set_effect_values',args,'bad')).toMatchObject({status:'fail',retryable:false,errorClassification:'preflight',hostResult:{contentDispatched:false}});
    expect(await store.inspectRecovery()).toBeUndefined();
    expect((await host.mutate('set_effect_values',args,'next')).status).toBe('pass');
  });
  it('returns PASS for a successful quarantine query and exposes the actual MCP owner',async()=>{
    const directory=await freshTestDirectory('production-owner'),file=path.join(directory,'receipts.json'),store=new ReceiptStore(file);
    store.setClientNameProvider(()=> 'production-client');
    await store.runExclusive('root',async()=>{await store.intent('root','set_track_state',{expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'S'},'host');await store.quarantine('fixture unknown');});
    const host=new HostExecutor({call:async(r:BridgeRequest)=>({version:1,id:r.id,ok:true,result:{status:'pass'},durationMs:0})} as UxpBridgeServer,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
    expect(await host.inspectMutationRecovery()).toMatchObject({status:'pass',quarantined:true,owner:{clientName:'production-client',processId:process.pid,operationId:'root',command:'set_track_state',sequenceId:'s'}});
    await expect(new ReceiptStore(file).runExclusive('other',async()=>{})).rejects.toThrow('production-client');
  });
  it.each([true,false])('releases only a fully verified bounded split rollback: %s',async verified=>{
    const directory=await freshTestDirectory('split-rollback'),store=new ReceiptStore(path.join(directory,'receipts.json'));
    const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{return {version:1,id:request.id,ok:true,durationMs:1,result:{status:'fail',errors:['Split failed'],hostResult:{rollbackVerified:verified,rollback:{errors:verified?[]:['recovery mismatch'],removalResult:true,restoreResult:true}}}};}} as UxpBridgeServer;
    const executor=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
    const receipt=await executor.mutate('split_clips',{expectedProjectId:'p',expectedSequenceId:'s'},'split');
    expect(receipt.status).toBe('fail');expect(Boolean(await store.inspectRecovery())).toBe(!verified);
    expect(await store.get('split')).toEqual(receipt);
  });
  it('keeps quarantine when a post-content verification or rollback finds the panel disconnected',async()=>{
    const directory=await freshTestDirectory('post-content-disconnect'),store=new ReceiptStore(path.join(directory,'receipts.json'));
    const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{
      if(request.command==='inspect_project')return {version:1,id:request.id,ok:true,durationMs:1,result:snapshot};
      if(request.command==='insert_editable_graphic')return {version:1,id:request.id,ok:true,durationMs:1,result:{status:'unverified',hostResult:{shapeVerification:'requires_saved_archive_readback',insertedItem:{id:'video:0:0:p',projectItemId:'p',name:'shape',mediaType:'video',trackIndex:0,start:{seconds:0,ticks:'0'},end:{seconds:1,ticks:'100'}}}}};
      throw Error('Premiere runtime POST /call failed: Premiere UXP panel is not connected');
    }} as UxpBridgeServer;
    const executor=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
    expect((await executor.mutate('insert_editable_graphic',{expectedGraphicKind:'rectangle'},'shape-disconnect')).status).toBe('unverified');
    expect(await store.inspectRecovery()).toBeDefined();
  });
  it('saves an exact scoped project without an unrelated timeline navigation',async()=>{
    const directory=await freshTestDirectory('scoped-save'),commands:BridgeRequest[]=[];
    const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{commands.push(request);return {version:1,id:request.id,ok:true,durationMs:1,result:{status:'pass',errors:[]}};}} as UxpBridgeServer;
    const host=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),new ReceiptStore(path.join(directory,'receipts.json')),1000);
    const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'WORKING__s'};
    expect((await host.mutate('save_working_project',args)).status).toBe('pass');expect(commands.map(r=>r.command)).toEqual(['save_working_project']);expect(commands[0]?.args).toEqual(args);
  });
  it('public unpinned saves do not inspect and retarget the timeline after audio placement',async()=>{
    const directory=await freshTestDirectory('public-save-navigation'),commands:BridgeRequest[]=[];
    const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{commands.push(request);return {version:1,id:request.id,ok:true,durationMs:1,result:{status:'pass',errors:[]}};}} as UxpBridgeServer;
    const host=new HostExecutor(bridge,new AuditLog(path.join(directory,'audit.jsonl')),new ReceiptStore(path.join(directory,'receipts.json')),1000);
    expect((await host.mutate('save_working_project',{})).status).toBe('pass');
    expect(commands.map(r=>r.command)).toEqual(['save_working_project']);
  });
  it("uses bounded in-host effect preflight without a full project read",async()=>{
    const directory=await freshTestDirectory("bounded-effect-plan"),commands:string[]=[];
    const bridge={async call(request:BridgeRequest):Promise<BridgeResponse>{commands.push(request.command);return {version:1,id:request.id,ok:true,durationMs:1,result:{status:"pass",before:[],after:[],errors:[]}};}} as UxpBridgeServer;
    const host=new HostExecutor(bridge,new AuditLog(path.join(directory,"audit.jsonl")),new ReceiptStore(path.join(directory,"receipts.json")),1000);
    const args={expectedProjectId:"p",expectedSequenceId:"s",expectedSequenceName:"WORKING__s",trackItemId:"video:0:0:id",expectedProjectItemId:"id",expectedMediaType:"video",expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:2,componentIndex:0,values:{Opacity:90}};
    expect((await host.mutate("set_effect_values",args)).status).toBe("pass");expect(commands).toEqual(["set_effect_values"]);
  });
  it("pins the planning snapshot before a stale edit can cause query navigation", async () => {
    const directory = await freshTestDirectory("pinned-planning-navigation");
    const requests: BridgeRequest[] = [];
    const bridge = { async call(request: BridgeRequest): Promise<BridgeResponse> {
      requests.push(request);
      return { version: 1, id: request.id, ok: false, error: { code: "SEQUENCE_PRECONDITION_FAILED", message: "stale query target" }, durationMs: 1 };
    } } as UxpBridgeServer;
    const executor = new HostExecutor(bridge, new AuditLog(path.join(directory, "audit.jsonl")), new ReceiptStore(path.join(directory, "receipts.json")), 1000);
    const pin = { expectedProjectId: "project", expectedSequenceId: "stale", expectedSequenceName: "WORKING__stale" };
    expect((await executor.mutate("set_timeline_selection", { ...pin, trackItemIds: ["item"] }, "stale-edit")).status).toBe("fail");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ command: "inspect_project", args: pin });
  });

  it("serializes independent clients and replays the winner without dispatching twice", async () => {
    const directory = await freshTestDirectory("executor-concurrent-clients");
    const file = path.join(directory, "receipts.json");
    const create = () => new HostExecutor({} as UxpBridgeServer, new AuditLog(path.join(directory, "audit.jsonl")), new ReceiptStore(file), 1000);
    const first = create(), second = create();
    let dispatches = 0;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const action = async () => { dispatches++; entered(); await gate; return { status: "pass" as const, result: { readback: true } }; };
    const running = first.mutateLocal("test", {}, action, "shared-id");
    await started;
    await expect(second.mutateLocal("test", {}, action, "shared-id")).rejects.toThrow("MUTATION_IN_PROGRESS_OR_UNVERIFIED");
    release();
    const receipt = await running;
    expect(await second.mutateLocal("test", {}, action, "shared-id")).toEqual(receipt);
    expect(dispatches).toBe(1);
    expect((await second.mutateLocal("different", {}, action, "shared-id")).status).toBe("fail");
    expect(dispatches).toBe(1);
  });

  it("validates live capability and project snapshots at the bridge boundary", async () => {
    const directory = await freshTestDirectory("host-read-contracts");
    let malformed = false;
    const bridge = {
      async call(request: BridgeRequest): Promise<BridgeResponse> {
        if (request.command === "inspect_project") return { version: 1, id: request.id, ok: true, result: snapshot, durationMs: 1 };
        const result = malformed ? {
          premiereVersion: "26.3.2",
          uxpVersion: "unknown",
          hostContext: { activeProject: true, activeSequence: false },
          read: [], write: [], unsupported: [],
        } : {
          premiereVersion: "26.3.2",
          uxpVersion: "unknown",
          runtimeCompatibility: { requiredPremiereVersion: "26.3.0", status: "compatible" },
          hostContext: { activeProject: true, activeSequence: false },
          read: [], write: [], unsupported: [],
        };
        return { version: 1, id: request.id, ok: true, result, durationMs: 1 };
      },
    } as UxpBridgeServer;
    const executor = new HostExecutor(
      bridge,
      new AuditLog(path.join(directory, "audit.jsonl")),
      new ReceiptStore(path.join(directory, "receipts.json")),
      1_000,
    );
    await expect(executor.read("inspect_project")).resolves.toEqual(snapshot);
    await expect(executor.read("get_capabilities")).resolves.toMatchObject({ runtimeCompatibility: { status: "compatible" } });
    malformed = true;
    await expect(executor.read("get_capabilities")).rejects.toThrow(/runtimeCompatibility/);
  });

  it("downgrades a claimed export success when the declared file is absent and replays the stored receipt", async () => {
    const directory = await freshTestDirectory("host-executor");
    let calls = 0;
    const bridge = {
      async call(request: BridgeRequest): Promise<BridgeResponse> {
        calls += 1;
        if (request.command === "inspect_project") return { version: 1, id: request.id, ok: true, result: snapshot, durationMs: 1 };
        return {
          version: 1,
          id: request.id,
          ok: true,
          result: { status: "unverified", changedFiles: [path.join(directory, "missing.mp4")], errors: ["Node server must verify the exported file exists"] },
          durationMs: 1,
        };
      },
    } as UxpBridgeServer;
    const receipts = new ReceiptStore(path.join(directory, "receipts.json"));
    const executor = new HostExecutor(bridge, new AuditLog(path.join(directory, "audit.jsonl")), receipts, 1_000);
    const first = await executor.mutate("export_sequence", { outputPath: path.join(directory, "missing.mp4") }, "same-command-id");
    const second = await executor.mutate("export_sequence", { outputPath: path.join(directory, "missing.mp4") }, "same-command-id");
    const conflict = await executor.mutate("export_sequence", { outputPath: path.join(directory, "different.mp4") }, "same-command-id");
    expect(first.status).toBe("unverified");
    expect(first.errors.join(" ")).toMatch(/did not pass filesystem verification/);
    expect(second).toEqual(first);
    expect(conflict).toMatchObject({ status: "fail", errors: [expect.stringMatching(/IDEMPOTENCY_CONFLICT/)] });
    expect(calls).toBe(2);
  });

  it("preserves a host readback mismatch as fail even when the transaction returned success", async () => {
    const directory = await freshTestDirectory("host-readback-mismatch");
    const bridge = {
      async call(request: BridgeRequest): Promise<BridgeResponse> {
        if (request.command === "inspect_project") return { version: 1, id: request.id, ok: true, result: snapshot, durationMs: 1 };
        return {
          version: 1,
          id: request.id,
          ok: true,
          result: { status: "fail", before: { clipCount: 1 }, hostResult: true, after: { clipCount: 1 }, errors: ["Expected clip did not appear during readback"] },
          durationMs: 1,
        };
      },
    } as UxpBridgeServer;
    const executor = new HostExecutor(
      bridge,
      new AuditLog(path.join(directory, "audit.jsonl")),
      new ReceiptStore(path.join(directory, "receipts.json")),
      1_000,
    );
    const receipt = await executor.mutate("place_clips", { expectedProjectId:"project-1",expectedSequenceId:"sequence-1",placements: [] }, "readback-mismatch-id");
    expect(receipt).toMatchObject({ status: "fail", hostResult: true, before: { clipCount: 1 }, after: { clipCount: 1 } });
    expect(receipt.errors).toContain("Expected clip did not appear during readback");
  });

  it("classifies a missing public UXP method as unsupported", async () => {
    const directory = await freshTestDirectory("host-unsupported");
    const bridge = {
      async call(request: BridgeRequest): Promise<BridgeResponse> {
        if (request.command === "inspect_project") return { version: 1, id: request.id, ok: true, result: snapshot, durationMs: 1 };
        return { version: 1, id: request.id, ok: false, error: { code: "UNSUPPORTED_API", message: "Sequence.createCloneAction is unavailable" }, durationMs: 1 };
      },
    } as UxpBridgeServer;
    const executor = new HostExecutor(
      bridge,
      new AuditLog(path.join(directory, "audit.jsonl")),
      new ReceiptStore(path.join(directory, "receipts.json")),
      1_000,
    );
    await expect(executor.mutate("duplicate_working_sequence", { name: "WORKING__test" }, "unsupported-id")).resolves.toMatchObject({
      status: "unsupported",
      errors: ["UNSUPPORTED_API: Sequence.createCloneAction is unavailable"],
    });
  });

  it("refuses to overwrite an existing local artifact before contacting Premiere", async () => {
    const directory = await freshTestDirectory("host-output-collision");
    const outputPath = path.join(directory, "existing.mp4");
    await writeFile(outputPath, "keep me", "utf8");
    let calls = 0;
    const bridge = { async call(): Promise<BridgeResponse> { calls += 1; throw new Error("should not reach bridge"); } } as UxpBridgeServer;
    const executor = new HostExecutor(
      bridge,
      new AuditLog(path.join(directory, "audit.jsonl")),
      new ReceiptStore(path.join(directory, "receipts.json")),
      1_000,
    );
    const receipt = await executor.mutate("export_sequence", { outputPath }, "collision-id");
    expect(receipt).toMatchObject({ status: "fail", errors: [expect.stringMatching(/OUTPUT_ALREADY_EXISTS/)] });
    expect(calls).toBe(0);
  });

  it("marks a post-plan host timeout as unverified to prevent blind replay", async () => {
    const directory = await freshTestDirectory("host-timeout");
    const bridge = {
      async call(request: BridgeRequest): Promise<BridgeResponse> {
        if (request.command === "inspect_project") return { version: 1, id: request.id, ok: true, result: snapshot, durationMs: 1 };
        throw new Error("Premiere command timed out after 1000 ms: place_clips");
      },
    } as UxpBridgeServer;
    const executor = new HostExecutor(
      bridge,
      new AuditLog(path.join(directory, "audit.jsonl")),
      new ReceiptStore(path.join(directory, "receipts.json")),
      1_000,
    );
    const receipt = await executor.mutate("place_clips", { expectedProjectId:"project-1",expectedSequenceId:"sequence-1",placements: [{ projectItemId: "clip-1" }] }, "timeout-id");
    expect(receipt).toMatchObject({ status: "unverified", recovery: expect.stringMatching(/Do not repeat/) });
  });

  it("does not promote a local unverified lifecycle outcome merely because its changed files exist", async () => {
    const directory = await freshTestDirectory("host-local-unverified");
    const projectPath = path.join(directory, "working.prproj");
    await writeFile(projectPath, "restored project", "utf8");
    const executor = new HostExecutor(
      { async call(): Promise<BridgeResponse> { throw new Error("should not reach bridge"); } } as UxpBridgeServer,
      new AuditLog(path.join(directory, "audit.jsonl")),
      new ReceiptStore(path.join(directory, "receipts.json")),
      1_000,
    );
    const receipt = await executor.mutateLocal("edit_existing_sequence_structure", {}, async () => ({
      status: "unverified",
      result: { reopenObservation: { status: "unverified" } },
      changedFiles: [projectPath],
      errors: ["PROJECT_REOPEN_NOT_OBSERVED"],
    }), "local-unverified-id");
    expect(receipt.status).toBe("unverified");
    expect(receipt.errors).toContain("PROJECT_REOPEN_NOT_OBSERVED");
    expect(receipt.after).toMatchObject({ files: [{ path: projectPath, exists: true, status: "pass" }] });
  });

  it("can dispatch the bounded project-open lifecycle command without an active-project plan", async () => {
    const directory = await freshTestDirectory("host-lifecycle-open");
    const calls: string[] = [];
    let requestTimeoutMs = 0;
    const bridge = {
      async call(request: BridgeRequest): Promise<BridgeResponse> {
        calls.push(request.command);
        requestTimeoutMs = request.timeoutMs;
        if (request.command === "inspect_project") throw new Error("No active project");
        return {
          version: 1,
          id: request.id,
          ok: true,
          result: { status: "pass", hostResult: { opened: true }, errors: [] },
          durationMs: 1,
        };
      },
    } as UxpBridgeServer;
    const executor = new HostExecutor(
      bridge,
      new AuditLog(path.join(directory, "audit.jsonl")),
      new ReceiptStore(path.join(directory, "receipts.json")),
      1_000,
    );
    const receipt = await executor.mutateLifecycle("open_working_project", {
      projectPath: "C:\\scratch\\working.prproj",
      sequenceName: "WORKING__TEST",
      sequenceId: "sequence-1",
    }, "lifecycle-open-id");
    expect(receipt.status).toBe("pass");
    expect(calls).toEqual(["open_working_project"]);
    expect(requestTimeoutMs).toBe(PROJECT_OPEN_TIMEOUT_MS);
  });
});
