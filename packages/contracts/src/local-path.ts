/** Host-independent path spelling. POSIX paths remain case-sensitive. */
export function normalizeLocalPath(value: string): string {
  if (value.startsWith('/') && !value.startsWith('//')) return value.replace(/\/+$/, '');
  let result = value.replaceAll('/', '\\');
  if (/^\\\\\?\\UNC\\/i.test(result)) result = '\\\\' + result.slice(8);
  else if (result.startsWith('\\\\?\\')) result = result.slice(4);
  return result.replace(/\\+$/, '').toLowerCase();
}

/** Remote shares and macOS mounted volumes are not writable project targets.
 * Mounted volumes can be NAS; do not infer that an absolute POSIX path is local. */
export function isLocalProjectPath(value: string): boolean {
  const normalized = normalizeLocalPath(value);
  const absolute = /^[a-z]:\\/.test(normalized) || (normalized.startsWith('/') &&
    !/^\/(?:Volumes|Network|net)(?:\/|$)/i.test(normalized) && !normalized.includes('\\'));
  return absolute && /\.prproj$/i.test(normalized) &&
    !normalized.split(/[\\/]/).some(part => part === '.' || part === '..');
}

export function pathIsWithin(root: string, candidate: string): boolean {
  const parent = normalizeLocalPath(root), child = normalizeLocalPath(candidate);
  return Boolean(parent) && !candidate.split(/[\\/]/).some(part => part === '.' || part === '..') &&
    (child === parent || child.startsWith(parent + (parent.startsWith('/') ? '/' : '\\')));
}
