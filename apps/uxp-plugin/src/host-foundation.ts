import { HostCommandError } from "./bridge-client.js";
import { deployment } from './installation-config.js';
import { normalizeLocalPath, pathIsWithin } from '@premiere-uxp/contracts/local-path';

/** Absolute root from this installation's local sidecar, never a public build. */
export const LOCAL_SCRATCH_ROOT = deployment.scratchRoot;
export const WORKING_SEQUENCE_PREFIX = "WORKING__";
export const PROJECT_ITEM_LIMIT = 500;
export const TRACK_ITEM_LIMIT = 1_000;

export type AnyRecord = Record<string, any>;

export function text(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Windows is case-insensitive; POSIX spelling preserves case and separators. */
export function normalizeHostPath(value: string): string {
  return normalizeLocalPath(value);
}

/**
 * Host-side defense in depth for writes.
 *
 * The Node path policy remains the first boundary; this assertion prevents a
 * connected caller from bypassing the local scratch project contract.
 */
export function assertLocalScratchPath(value: string, extension?: string): void {
  const normalized = normalizeHostPath(value);
  const root = normalizeHostPath(LOCAL_SCRATCH_ROOT);
  if (!pathIsWithin(root, normalized)) {
    throw new HostCommandError("PATH_NOT_ALLOWED", `Host write path is outside the local scratch root: ${value}`);
  }
  if (extension && !normalized.toLowerCase().endsWith(extension.toLocaleLowerCase("en-US"))) {
    throw new HostCommandError("EXTENSION_NOT_ALLOWED", `Expected ${extension} output: ${value}`);
  }
}

export function asTickTime(value: any): { ticks: string; seconds: number } {
  const ticks = value?.ticks ?? value?.ticksNumber ?? 0;
  return { ticks: String(ticks), seconds: Number(value?.seconds ?? 0) };
}

export function durationBetween(start: AnyRecord, end: AnyRecord): { ticks: string; seconds: number } {
  const tickDelta = BigInt(text(end.ticks) || "0") - BigInt(text(start.ticks) || "0");
  return {
    ticks: tickDelta > 0n ? tickDelta.toString() : "0",
    seconds: Math.max(0, Number(end.seconds) - Number(start.seconds)),
  };
}

export function splitWindowsPath(value: string): { directory: string; filename: string } {
  const normalized = value.startsWith('/') ? value : value.replaceAll("/", "\\");
  const index = normalized.lastIndexOf(value.startsWith('/') ? '/' : "\\");
  return { directory: normalized.slice(0, index + 1), filename: normalized.slice(index + 1) };
}
