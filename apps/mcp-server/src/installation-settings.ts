import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import type { MediaRoot } from '@premiere-uxp/contracts';

const absolutePath = z.string().min(1).refine(value => path.isAbsolute(value), 'Use an absolute path');
export const installationSettingsSchema = z.object({
  version: z.literal(1),
  sourceRoots: z.array(absolutePath).default([]),
  premiereRoot: absolutePath.optional(),
  graphicsRoot: absolutePath.optional(),
}).strict();

export function readInstallationSettings(filename: string) {
  if (!existsSync(filename)) return installationSettingsSchema.parse({ version: 1 });
  try { return installationSettingsSchema.parse(JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''))); }
  catch (error) { throw new Error(`Invalid installation settings (${filename}): ${String(error)}`); }
}
export function sourceMediaRoots(roots: string[], extensions: string[]): MediaRoot[] {
  return roots.map(source => ({ path: source, role: 'source', access: 'readOnly',
    isNas: source.startsWith('\\\\') || source.startsWith('//') || /^\/(?:Volumes|Network|net)\//.test(source),
    allowedExtensions: extensions, pathBoundary: 'enforced' }));
}
export function discoverGraphicsRoot(premiereRoot: string | undefined): string | undefined {
  if (!premiereRoot) return undefined;
  return [path.join(premiereRoot, 'Essential Graphics'),
    path.join(premiereRoot, 'Contents/Essential Graphics'),
    path.join(premiereRoot, 'Contents/Resources/Essential Graphics'),
    path.join(path.dirname(premiereRoot), 'Essential Graphics')].find(existsSync);
}

/** Resolve the actual installation, without embedding a release year or user name. */
export function discoverPremiereRoot(platform = process.platform, environment = process.env): string | undefined {
  const parent = platform === 'win32' ? path.join(environment.ProgramFiles ?? '', 'Adobe') : '/Applications';
  if (!path.isAbsolute(parent) || !existsSync(parent)) return undefined;
  return readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^Adobe Premiere Pro(?: |$)/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }))
    .map(entry => {
      const candidate = path.join(parent, entry.name);
      return platform === 'darwin' && !candidate.endsWith('.app') ? path.join(candidate, `${entry.name}.app`) : candidate;
    })
    .find(candidate => existsSync(path.join(candidate, platform === 'win32' ? 'Adobe Premiere Pro.exe' : 'Contents/MacOS/Adobe Premiere Pro')));
}
