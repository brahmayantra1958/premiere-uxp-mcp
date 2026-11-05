/** Explicit absolute media inputs may be read from local or NAS locations. Read acceptance never grants writes; output/proxy/scratch roles and link-escape guards remain independent. */
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { MediaRoot } from "@premiere-uxp/contracts";
import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';

export class PathPolicyError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PathPolicyError";
  }
}

function stripExtendedPathPrefix(value: string): string {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice("\\\\?\\UNC\\".length)}`;
  if (value.startsWith("\\\\?\\")) return value.slice("\\\\?\\".length);
  return value;
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(stripExtendedPathPrefix(value)).replace(/[\\/]+$/, "");
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function nearestExistingAncestor(candidate: string): { ancestor: string; suffix: string[] } {
  const suffix: string[] = [];
  let cursor = path.resolve(stripExtendedPathPrefix(candidate));
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new PathPolicyError("PATH_PARENT_MISSING", `No existing ancestor for ${candidate}`);
    }
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  return { ancestor: cursor, suffix };
}

function canonicalCandidate(candidate: string): string {
  const { ancestor, suffix } = nearestExistingAncestor(candidate);
  return path.join(realpathSync.native(ancestor), ...suffix);
}

function canonicalRoot(root: MediaRoot): string {
  return existsSync(root.path) ? realpathSync.native(root.path) : canonicalCandidate(root.path);
}

export class PathPolicy {
  constructor(private readonly roots: readonly MediaRoot[], private readonly options: { mediaReadExtensions?: readonly string[]; settingsPath?: string } = {}) {}

  private reject(code: string, reason: string): never {
    const allowedRoots = this.roots.map(root => ({ path: root.path, role: root.role, access: root.access, isNas: root.isNas, allowedExtensions: root.allowedExtensions }));
    const mediaReadScope = { enabled: Boolean(this.options.mediaReadExtensions?.length), paths: 'explicit absolute files, including UNC and mounted volumes', access: 'readOnly', allowedExtensions: this.options.mediaReadExtensions ?? [] };
    const settings = this.options.settingsPath ?? 'artifacts/settings.json';
    const suggestion = `${mediaReadScope.enabled ? 'Use an explicit absolute media filename with an allowed extension; local and NAS media need no folder registration.' : `Use a configured source root from ${settings}.`} Use the real target path instead of a redirected link/junction. Writes are limited to configured writable artifact roots; source/NAS roots remain read-only. Reconnect the MCP client after updating server code or ${settings}.`;
    throw new PathPolicyError(code, `${reason}. Allowed roots: ${JSON.stringify(allowedRoots)}. Media read scope: ${JSON.stringify(mediaReadScope)}. Resolution: ${suggestion}`, { code, allowedRoots, mediaReadScope, suggestion, contentDispatched: false, errorClassification: 'preflight', retryable: false });
  }

  authorizeRead(candidate: string): { path: string; root: MediaRoot } {
    const supplied = stripExtendedPathPrefix(candidate);
    if (!path.isAbsolute(supplied)) this.reject('ABSOLUTE_PATH_REQUIRED', `Read path must be absolute: ${candidate}`);
    // A configured boundary cannot be bypassed by the explicit-file fallback.
    const insideConfiguredRoot = this.roots.some(value => isWithin(value.path, candidate));
    const resolved = this.resolve(candidate);
    let root = this.matchRoot(candidate, resolved, this.roots);
    if (!root && !insideConfiguredRoot && this.options.mediaReadExtensions?.length) root = this.explicitSource(candidate, resolved);
    if (!root) this.reject("PATH_NOT_ALLOWED", `Read path is outside configured roots or escaped through a link: ${candidate}`);
    // Artifact roles keep their narrower type rules for role-specific consumers,
    // but an explicit local WAV/SRT remains a source even when stored there.
    if (this.options.mediaReadExtensions?.length && [candidate, resolved].some(value => !root!.allowedExtensions.includes(path.extname(value).toLowerCase()))) {
      root = this.explicitSource(candidate, resolved) ?? root;
    }
    if (!existsSync(resolved)) this.reject("PATH_NOT_FOUND", `Input path does not exist: ${candidate}`);
    if (!statSync(resolved).isFile()) this.reject("PATH_NOT_FILE", `Input path is not a file: ${candidate}`);
    this.assertExtension(root, candidate);
    this.assertExtension(root, resolved);
    return { path: resolved, root };
  }

  /** Explicit media files are readable from any folder; this ephemeral source
   * descriptor never enters authorizeWrite. Reject redirected paths rather than
   * allowing an arbitrary link to redefine the caller's filesystem boundary. */
  private explicitSource(requested: string, resolved: string): MediaRoot | undefined {
    const isAbsoluteFile = (value: string) => {
      const clean = stripExtendedPathPrefix(value);
      return path.isAbsolute(clean) &&
        !clean.split(/[\\/]/).some(part => part === '..') &&
        !(process.platform === 'win32' && clean.slice(2).includes(':'));
    };
    if (!isAbsoluteFile(requested) || !isAbsoluteFile(resolved)) return undefined;
    if (normalizeLocalPath(path.resolve(stripExtendedPathPrefix(requested))) !== normalizeLocalPath(resolved)) return undefined;
    return { path: path.dirname(resolved), role: 'source', access: 'readOnly', isNas: resolved.startsWith('\\\\') || resolved.startsWith('//') || /^\/(?:Volumes|Network|net)(?:\/|$)/i.test(resolved), allowedExtensions: [...this.options.mediaReadExtensions!], pathBoundary: 'enforced' };
  }

  authorizeWrite(candidate: string): { path: string; root: MediaRoot } {
    if (!this.roots.some(root => isWithin(root.path, candidate))) this.reject('PATH_NOT_ALLOWED', `Write path is outside configured roots: ${candidate}`);
    const resolved = this.resolve(candidate);
    const root = this.matchRoot(candidate, resolved, this.roots);
    if (!root) this.reject("PATH_NOT_ALLOWED", `Write path is outside configured roots or escaped through a link: ${candidate}`);
    if (root.access !== "readWrite" || root.isNas || resolved.startsWith("\\\\")) {
      this.reject("READ_ONLY_ROOT", `Writes are forbidden for root ${root.path}`);
    }
    this.assertExtension(root, candidate);
    this.assertExtension(root, resolved);
    return { path: resolved, root };
  }

  private resolve(candidate: string): string {
    try { return canonicalCandidate(candidate); }
    catch (error) {
      this.reject(error instanceof PathPolicyError ? error.code : 'PATH_RESOLUTION_FAILED', `Cannot resolve ${candidate}: ${String(error)}`);
    }
  }

  private matchRoot(requested: string, canonical: string, roots: readonly MediaRoot[]): MediaRoot | undefined {
    // The lexical check avoids touching unrelated NAS roots for every local request.
    // The second canonical check still catches junction and symlink escapes.
    return roots
      .filter((root) => isWithin(root.path, requested))
      .find((root) => isWithin(canonicalRoot(root), canonical));
  }

  private assertExtension(root: MediaRoot, candidate: string): void {
    const extension = path.extname(candidate).toLocaleLowerCase("en-US");
    if (!extension || !root.allowedExtensions.includes(extension)) {
      this.reject("EXTENSION_NOT_ALLOWED", `Extension ${extension || "<none>"} is not allowed in ${root.role}`);
    }
  }
}
