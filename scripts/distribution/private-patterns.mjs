import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * A release must not carry the maintainer's private vocabulary: account names,
 * NAS hosts, production titles or job IDs. That list is private itself, so it is
 * never committed. The maintainer keeps it outside version control in
 * `.local-git/personal-patterns.txt`, or names another file in
 * PREMIERE_MCP_PRIVATE_PATTERNS. One case-insensitive regular expression per
 * line; `#` starts a comment and `!` marks an allowed exception. Without the file
 * only the generic checks run, which is the normal state of an installed copy.
 */
export function loadPrivatePatterns(root, environment = process.env) {
  const file = environment.PREMIERE_MCP_PRIVATE_PATTERNS || path.join(root, '.local-git', 'personal-patterns.txt');
  if (!existsSync(file)) return undefined;
  const block = [], allow = [];
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const exception = line.startsWith('!');
    try {
      (exception ? allow : block).push(new RegExp((exception ? line.slice(1) : line).trim(), 'gi'));
    } catch {
      // Name only the line: the expression itself is private.
      throw Error(`Invalid private pattern at line ${index + 1}`);
    }
  });
  return {block, allow};
}

/** The 1-based line of the first private match after allowed spans are masked, or 0. */
export function privateDataLine(text, patterns) {
  if (!patterns?.block.length) return 0;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    for (const expression of patterns.allow) line = line.replace(expression, match => ' '.repeat(match.length));
    if (patterns.block.some(expression => { expression.lastIndex = 0; return expression.test(line); })) return index + 1;
  }
  return 0;
}

/** Every file below `directory` whose path or content (binary included) carries private data. */
export function findPrivateData(directory, patterns) {
  if (!patterns?.block.length) return [];
  const findings = [];
  const visit = relative => {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      const entry = relative ? `${relative}/${name}` : name, file = path.join(directory, entry);
      if (lstatSync(file).isDirectory()) { visit(entry); continue; }
      if (privateDataLine(entry, patterns)) findings.push(`${entry} (path)`);
      const body = readFileSync(file), binary = body.subarray(0, 8000).includes(0);
      const line = privateDataLine(body.toString(binary ? 'latin1' : 'utf8'), patterns);
      if (line) findings.push(binary ? `${entry} (binary)` : `${entry}:${line}`);
    }
  };
  visit('');
  return findings;
}
