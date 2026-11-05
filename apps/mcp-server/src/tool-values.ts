import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';
import type { PathPolicy } from "./path-policy.js";

export function result(value: unknown) {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { result: value };
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], structuredContent };
}

export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const details=(error as {details?:Record<string,unknown>}|null)?.details;
  return { ...result({status:'fail',errors:[message],retryable:false,errorClassification:'postcondition',...details}), isError: true };
}

export function writePathForRole(paths: PathPolicy, candidate: string, role: "proxy" | "output" | "scratch"): string {
  const authorized = paths.authorizeWrite(candidate);
  if (authorized.root.role !== role) throw new Error(`Expected a ${role} path, but ${candidate} belongs to the ${authorized.root.role} root`);
  return authorized.path;
}

export function readPathForRole(paths: PathPolicy, candidate: string, role: "proxy" | "source" | "scratch" | "output"): string {
  const authorized = paths.authorizeRead(candidate);
  if (authorized.root.role !== role) throw new Error(`Expected a ${role} path, but ${candidate} belongs to the ${authorized.root.role} root`);
  return authorized.path;
}

export function comparablePath(value: string): string {
  return normalizeLocalPath(value);
}
