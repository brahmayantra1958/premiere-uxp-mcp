import { closeSync, openSync } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { bridgeConfig, runtimePaths } from "./config.js";
import { runtimeProtocolVersion, runtimeServiceName, type RuntimeHealth } from "./runtime-control.js";

export type RuntimeEnsureResult = {
  disposition: "reused" | "started";
  health: RuntimeHealth;
};

type RuntimeState = {
  controlPort: number;
  protocolVersion: string;
};

export async function runtimeControlUrl(): Promise<string> {
  const serialized = await readFile(runtimePaths.daemonState, "utf8");
  const state = JSON.parse(serialized) as Partial<RuntimeState>;
  if (!Number.isInteger(state.controlPort) || Number(state.controlPort) <= 0 || state.protocolVersion !== runtimeProtocolVersion) {
    throw new Error("Premiere runtime state is invalid: " + runtimePaths.daemonState);
  }
  return "http://" + bridgeConfig.controlHost + ":" + state.controlPort;
}

export async function probeRuntime(): Promise<RuntimeHealth | undefined> {
  try {
    const response = await fetch(new URL("/health", await runtimeControlUrl()), { signal: AbortSignal.timeout(800) });
    if (!response.ok) return undefined;
    const value = await response.json() as Partial<RuntimeHealth>;
    if (value.service !== runtimeServiceName || value.version !== runtimeProtocolVersion || value.ready !== true || !Number.isInteger(value.processId)) return undefined;
    await access(runtimePaths.controlToken);
    return value as RuntimeHealth;
  } catch {
    return undefined;
  }
}

export async function ensureRuntime(): Promise<RuntimeEnsureResult> {
  const existing = await probeRuntime();
  if (existing) return { disposition: "reused", health: existing };
  if (process.env.PREMIERE_UXP_AUTOSTART === "0") throw new Error("Premiere runtime is not running and automatic start is disabled");

  await mkdir(runtimePaths.runtimeDirectory, { recursive: true });
  const stdout = openSync(runtimePaths.daemonStdout, "a");
  const stderr = openSync(runtimePaths.daemonStderr, "a");
  try {
    const daemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url));
    const child = spawn(process.execPath, [daemonPath], {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdout, stderr],
      env: { ...process.env, PREMIERE_UXP_DAEMON: "1" },
    });
    child.unref();
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }

  const deadline = Date.now() + bridgeConfig.startupTimeoutMs;
  while (Date.now() < deadline) {
    const health = await probeRuntime();
    if (health) return { disposition: "started", health };
    await delay(200);
  }
  throw new Error(`Premiere runtime did not become healthy. Check ${runtimePaths.daemonStderr}; another legacy server may already own port ${bridgeConfig.port}.`);
}
