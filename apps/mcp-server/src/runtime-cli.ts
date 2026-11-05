import { randomUUID } from "node:crypto";
import {z} from "zod/v4";
import { setTimeout as delay } from "node:timers/promises";
import { type BridgeRequest } from "@premiere-uxp/contracts";
import { bridgeConfig, runtimePaths } from "./config.js";
import { detectPremiereProcess } from "./system.js";
import { RemoteBridge } from "./remote-bridge.js";
import { ensureRuntime, probeRuntime, runtimeControlUrl } from "./runtime-manager.js";
import { verifyReadySnapshot } from "./ready-check.js";

type CliOptions = { pair: boolean; timeoutMs: number; projectPath?: string; sequenceName?: string };

function options(values: string[]): CliOptions {
  const parsed: CliOptions = { pair: false, timeoutMs: bridgeConfig.readyTimeoutMs };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--pair") parsed.pair = true;
    else if (value === "--timeout-ms") parsed.timeoutMs = Number(values[++index]);
    else if (value === "--project") {
      const projectPath = values[++index];
      if (projectPath === undefined) throw new Error("--project requires a path");
      parsed.projectPath = projectPath;
    }
    else if (value === "--sequence") {
      const sequenceName = values[++index];
      if (sequenceName === undefined) throw new Error("--sequence requires a name");
      parsed.sequenceName = sequenceName;
    }
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) throw new Error("--timeout-ms must be a positive number");
  return parsed;
}

function request(command: string): BridgeRequest {
  return { version: 1, id: randomUUID(), command, args: {}, timeoutMs: bridgeConfig.defaultTimeoutMs };
}

async function ready(args: CliOptions): Promise<void> {
  const runtime = await ensureRuntime();
  const bridge = new RemoteBridge(runtimeControlUrl, runtimePaths.controlToken, ensureRuntime);
  if (args.pair) await bridge.armNextLocalProject();
  const deadline = Date.now() + args.timeoutMs;
  let status = await bridge.getStatus();
  while (!status.connected && Date.now() < deadline) {
    await delay(500);
    status = await bridge.getStatus();
  }
  if (!status.connected) {
    const processState = await detectPremiereProcess();
    throw new Error(`UXP authentication did not complete within ${args.timeoutMs} ms (Premiere: ${processState}). UDT and UI automation are not used by this launcher.`);
  }
  const ping = await bridge.call(request("premiere_ping"));
  if (!ping.ok) throw new Error(`Premiere ping failed: ${ping.error?.message ?? "unknown host error"}`);
  const orientation=request("get_agent_context");
  const inspected = await bridge.call(orientation);
  if (!inspected.ok) throw new Error(`Project inspection failed: ${inspected.error?.message ?? "unknown host error"}`);
  const context=z.object({status:z.literal('ready'),project:z.object({id:z.string(),path:z.string()}),sequence:z.object({id:z.string(),name:z.string()})}).parse(inspected.result);
  const snapshot={projectId:context.project.id,projectPath:context.project.path,activeSequence:context.sequence};
  const expectations = {
    scratchRoot: runtimePaths.scratch,
    activeLocalTarget: true,
    ...(args.projectPath ? { expectedProjectPath: args.projectPath } : {}),
    ...(args.sequenceName ? { expectedSequenceName: args.sequenceName } : {}),
  };
  const errors = verifyReadySnapshot(snapshot, expectations);
  if (errors.length) throw new Error(errors.join("; "));
  process.stdout.write(`${JSON.stringify({
    status: "ready",
    runtime: runtime.disposition,
    runtimeProcessId: runtime.health.processId,
    controlUrl: await runtimeControlUrl(),
    authenticationMethod: status.authenticationMethod,
    premiere: ping.result,
    projectPath: snapshot.projectPath,
    sequenceName: snapshot.activeSequence?.name,
    offlineMediaCount: null,
    inspectionScope:"bounded_agent_context",
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command = "ready", ...values] = process.argv.slice(2);
  if (command === "start") {
    if (values.length) throw new Error('Runtime start does not accept arguments');
    // UXP's fixed launcher starts/reuses transport only. No project discovery,
    // pairing approval, UI navigation or edit is performed by this command.
    process.stdout.write(JSON.stringify(await ensureRuntime()) + '\n');
    return;
  }
  if (command === "ready") return ready(options(values));
  if (command === "status") {
    const health = await probeRuntime();
    if (!health) {
      process.stdout.write(`${JSON.stringify({ status: "stopped" }, null, 2)}\n`);
      return;
    }
    const bridge = new RemoteBridge(runtimeControlUrl, runtimePaths.controlToken, ensureRuntime);
    process.stdout.write(`${JSON.stringify({ status: "running", controlUrl: await runtimeControlUrl(), health, bridge: await bridge.getStatus() }, null, 2)}\n`);
    return;
  }
  if (command === "stop") {
    const health = await probeRuntime();
    if (!health) {
      process.stdout.write("Premiere runtime is already stopped.\n");
      return;
    }
    const bridge = new RemoteBridge(runtimeControlUrl, runtimePaths.controlToken, ensureRuntime);
    await bridge.shutdown();
    process.stdout.write("Premiere runtime stop requested.\n");
    return;
  }
  throw new Error(`Unknown runtime command: ${command}`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
