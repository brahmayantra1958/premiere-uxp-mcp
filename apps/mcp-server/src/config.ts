import path from "node:path";
import { existsSync } from 'node:fs';
import { fileURLToPath } from "node:url";
import type { MediaRoot, ToolProfile } from "@premiere-uxp/contracts";
import { discoverGraphicsRoot, discoverPremiereRoot, readInstallationSettings, sourceMediaRoots } from './installation-settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(here, "../../..");
export const artifactsRoot = path.join(repositoryRoot, "artifacts");
export const settingsPath = process.env.PREMIERE_MCP_CONFIG ?? path.join(artifactsRoot, 'settings.json');
// Module initialization snapshots settings in each stdio/owner process. Reconnecting
// a client cannot refresh an existing owner's settings; drain work and restart that
// owner when its config changes (docs/operator-runbook.md#recovery-decision).
export const installationSettings = readInstallationSettings(settingsPath);
const premiereRoot = installationSettings.premiereRoot ?? discoverPremiereRoot();
const graphicsRoot = installationSettings.graphicsRoot ?? discoverGraphicsRoot(premiereRoot);

export const adobePaths = {
  basicTitleMogrt: graphicsRoot ? path.join(graphicsRoot, 'Basic Title.mogrt') : '',
  classicLowerThirdOneLineMogrt: graphicsRoot ? path.join(graphicsRoot, 'Lower Thirds', 'Classic Lower Third One Line.mogrt') : '',
} as const;
export function requireAdobeTemplate(name: keyof typeof adobePaths): string {
  const template = adobePaths[name];
  if (!template || !existsSync(template)) throw Error(`ADOBE_TEMPLATE_UNAVAILABLE: ${name}. Set graphicsRoot in ${settingsPath} to your installed Essential Graphics directory.`);
  return template;
}

export const runtimePaths = {
  runtimeDirectory: path.join(artifactsRoot, "runtime"),
  audit: path.join(artifactsRoot, "audit", "operations.jsonl"),
  idempotency: path.join(artifactsRoot, "runtime", "idempotency.json"),
  token: path.join(artifactsRoot, "runtime", "bridge-token.txt"),
  credentials: path.join(artifactsRoot, "runtime", "bridge-credentials.json"),
  output: path.join(artifactsRoot, "output"),
  proxy: path.join(artifactsRoot, "proxies"),
  scratch: path.join(artifactsRoot, "scratch"),
  cepCaptionCommand: path.join(artifactsRoot, "runtime", "cep-caption-command.json"),
  cepCaptionResult: path.join(artifactsRoot, "runtime", "cep-caption-result.json"),
  cepCaptionReady: path.join(artifactsRoot, "runtime", "cep-caption-helper-ready.json"),
  controlToken: path.join(artifactsRoot, "runtime", "runtime-control-token.txt"),
  daemonState: path.join(artifactsRoot, "runtime", "runtime-daemon-state.json"),
  daemonStdout: path.join(artifactsRoot, "runtime", "runtime-daemon.stdout.log"),
  daemonStderr: path.join(artifactsRoot, "runtime", "runtime-daemon.stderr.log"),
  segmentationToken: path.join(artifactsRoot, "runtime", "segmentation-token.txt"),
} as const;

export const mediaExtensions = [
  ".mp4", ".mov", ".mxf", ".avi", ".mkv", ".mts", ".m2ts", ".wav", ".mp3", ".aac", ".flac", ".aif", ".aiff", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".exr", ".prproj", ".mogrt", ".epr", ".sqpreset", ".srt",
];

export const mediaRoots: MediaRoot[] = [
  ...sourceMediaRoots(installationSettings.sourceRoots, mediaExtensions),
  ...sourceMediaRoots(graphicsRoot ? [graphicsRoot] : [], ['.mogrt']),
  ...(premiereRoot ? [{ path: premiereRoot, role: 'source' as const, access: 'readOnly' as const, isNas: false, allowedExtensions: ['.epr', '.mogrt', '.sqpreset'], pathBoundary: 'enforced' as const }] : []),
  { path: runtimePaths.proxy, role: "proxy", access: "readWrite", isNas: false, allowedExtensions: [".mp4", ".mov"], pathBoundary: "enforced" },
  { path: runtimePaths.output, role: "output", access: "readWrite", isNas: false, allowedExtensions: [".mp4", ".mov", ".mxf", ".wav", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".exr"], pathBoundary: "enforced" },
  { path: runtimePaths.scratch, role: "scratch", access: "readWrite", isNas: false, allowedExtensions: mediaExtensions, pathBoundary: "enforced" },
];

// Tool exposure belongs to this stdio session. Profile-only changes need a new
// client connection, not a UXP reload or shared-owner restart.
const requestedProfiles = (process.env.PREMIERE_MCP_PROFILE ?? "inspect")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const enabledProfiles = new Set<ToolProfile>(
  requestedProfiles.filter((value): value is ToolProfile => value === "inspect" || value === "edit" || value === "delivery"),
);

export const bridgeConfig = {
  host: "localhost",
  port: Number(process.env.PREMIERE_UXP_PORT ?? 8099),
  controlHost: "127.0.0.1",
  // Zero asks the OS for a free loopback port. The selected port is published
  // through runtimePaths.daemonState for every MCP proxy to discover.
  controlPort: Number(process.env.PREMIERE_UXP_CONTROL_PORT ?? 0),
  defaultTimeoutMs: Number(process.env.PREMIERE_UXP_TIMEOUT_MS ?? 15_000),
  startupTimeoutMs: Number(process.env.PREMIERE_UXP_STARTUP_TIMEOUT_MS ?? 15_000),
  readyTimeoutMs: Number(process.env.PREMIERE_UXP_READY_TIMEOUT_MS ?? 90_000),
};

export const segmentationConfig = {
  baseUrl: process.env.PREMIERE_SEGMENTATION_URL ?? "http://127.0.0.1:8127",
  tokenPath: runtimePaths.segmentationToken,
  timeoutMs: Number(process.env.PREMIERE_SEGMENTATION_TIMEOUT_MS ?? 120_000),
} as const;
