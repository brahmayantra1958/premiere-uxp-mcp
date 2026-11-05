import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { UxpBridgeServer } from "./bridge.js";
import { bridgeConfig, runtimePaths } from "./config.js";
import { RuntimeControlServer } from "./runtime-control.js";

async function main(): Promise<void> {
  await mkdir(runtimePaths.runtimeDirectory, { recursive: true });
  const bridge = new UxpBridgeServer(bridgeConfig.host, bridgeConfig.port, runtimePaths.token, runtimePaths.credentials);
  const controlToken = randomBytes(32).toString("hex");
  let control: RuntimeControlServer | undefined;
  let stopping = false;

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    // Release event waits before waiting for HTTP connections to close.
    bridge.events.close();
    try { await control?.stop(); } catch { /* Continue bounded shutdown. */ }
    try { await bridge.stop(); } catch { /* Continue bounded shutdown. */ }
    try { await unlink(runtimePaths.daemonState); } catch { /* State may not exist after startup failure. */ }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    await bridge.start();
    control = new RuntimeControlServer({
      host: bridgeConfig.controlHost,
      port: bridgeConfig.controlPort,
      token: controlToken,
      bridge,
      onShutdown: () => void shutdown(),
    });
    const controlPort = await control.start();
    await writeFile(runtimePaths.controlToken, controlToken, { encoding: "utf8", mode: 0o600 });
    await writeFile(runtimePaths.daemonState, `${JSON.stringify({
      processId: process.pid,
      startedAt: new Date().toISOString(),
      panelPort: bridgeConfig.port,
      controlPort,
      protocolVersion: "1",
    }, null, 2)}\n`, "utf8");
    process.stderr.write(`${JSON.stringify({ component: "premiere_runtime", event: "ready", processId: process.pid, panelPort: bridgeConfig.port, controlPort })}\n`);
  } catch (error) {
    try { await control?.stop(); } catch { /* Preserve original startup error. */ }
    try { await bridge.stop(); } catch { /* Preserve original startup error. */ }
    throw error;
  }
}

void main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ component: "premiere_runtime", event: "fatal", message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
});
