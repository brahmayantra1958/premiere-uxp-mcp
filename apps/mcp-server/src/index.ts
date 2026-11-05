#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuditLog, ReceiptStore } from "./audit.js";
import { UxpBridgeServer } from "./bridge.js";
import { bridgeConfig, mediaRoots, mediaExtensions, runtimePaths, segmentationConfig, settingsPath } from "./config.js";
import { HostExecutor } from "./host-executor.js";
import { PathPolicy } from "./path-policy.js";
import { RemoteBridge } from "./remote-bridge.js";
import { ensureRuntime, runtimeControlUrl } from "./runtime-manager.js";
import { HttpSegmentationEngine } from "./segmentation-engine.js";
import { registerTools } from "./tools.js";
import { repositoryRoot } from "./config.js";
import { loadAgentGuidance } from "./agent-guidance.js";
import type { HostBridge } from "./bridge-port.js";

async function main(): Promise<void> {
  await Promise.all([runtimePaths.output, runtimePaths.proxy, runtimePaths.scratch].map((directory) => mkdir(directory, { recursive: true })));
  const approveNextLocalProject = process.argv.includes("--approve-next-project");
  const embedded = process.env.PREMIERE_UXP_RUNTIME_MODE === "embedded";
  let ownedBridge: UxpBridgeServer | undefined;
  let bridge: HostBridge;
  if (embedded) {
    ownedBridge = new UxpBridgeServer(bridgeConfig.host, bridgeConfig.port, runtimePaths.token, runtimePaths.credentials, {
      allowNextLocalProject: approveNextLocalProject,
    });
    await ownedBridge.start();
    bridge = ownedBridge;
  } else {
    const runtime = await ensureRuntime();
    const remote = new RemoteBridge(runtimeControlUrl, runtimePaths.controlToken, ensureRuntime);
    if (approveNextLocalProject) await remote.armNextLocalProject();
    bridge = remote;
    console.error("Premiere runtime " + runtime.disposition + " at " + await runtimeControlUrl() + " (PID " + runtime.health.processId + ")");
  }

  const receipts = new ReceiptStore(runtimePaths.idempotency);
  const audit = new AuditLog(runtimePaths.audit);
  const executor = new HostExecutor(bridge, audit, receipts, bridgeConfig.defaultTimeoutMs);
  const segmentation = new HttpSegmentationEngine(segmentationConfig);
  const guidance = loadAgentGuidance(repositoryRoot);
  const server = new McpServer({ name: "premiere-uxp", version: guidance.serverVersion }, {instructions: guidance.instructions});
  guidance.register(server);
  receipts.setClientNameProvider(() => server.server.getClientVersion()?.name ?? 'unknown MCP client');
  registerTools(server, bridge, executor, new PathPolicy(mediaRoots, { settingsPath, mediaReadExtensions: mediaExtensions }), segmentation);

  const shutdown = async () => {
    await ownedBridge?.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(embedded
    ? `Premiere UXP MCP embedded bridge listening on ws://${bridgeConfig.host}:${bridgeConfig.port}`
    : "Premiere UXP MCP proxy ready; the reusable runtime owns the UXP connection.");
  if (approveNextLocalProject) console.error("Command approval armed for the next local Premiere project.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
