import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type GuidanceResource = {name: string; path: string; description: string};

/** Load only shipped, explicitly listed guidance. Resource URIs never become
 * filesystem paths or host commands; neither discovery nor reads touch Premiere.
 * Instructions/resources are snapshotted at MCP initialization. Reconnect stdio
 * after a guidance update; UXP Reload cannot refresh this client's catalog. */
export function loadAgentGuidance(root: string): {
  instructions: string;
  serverVersion: string;
  register: (server: McpServer) => void;
} {
  const bundle = JSON.parse(readFileSync(path.join(root, 'skills/bundle.json'), 'utf8')) as {resources: GuidanceResource[]};
  const instructions = readFileSync(path.join(root, 'docs/agent-instructions.md'), 'utf8');
  const serverVersion = (JSON.parse(readFileSync(path.join(root, 'apps/mcp-server/package.json'), 'utf8')) as {version: string}).version;
  const resources = bundle.resources.map(resource => {
    if (!/^[a-z][a-z0-9-]*$/.test(resource.name) || !/^(docs|skills)\//.test(resource.path) || resource.path.split('/').some(part => !part || part === '..' || part === '.') || resource.path.includes('\\') || resource.path.includes(':')) throw Error('Invalid bundled guidance resource');
    return {...resource, text: readFileSync(path.join(root, resource.path), 'utf8')};
  });
  if (new Set(resources.map(resource => resource.name)).size !== resources.length) throw Error('Duplicate guidance resource');
  const uris = new Map(resources.map(resource => [resource.path, `premiere://guide/${resource.name}`]));
  return { instructions, serverVersion, register(server) {
    for (const resource of resources) {
      const uri = `premiere://guide/${resource.name}`;
      const mimeType = resource.path.endsWith('.json') ? 'application/json' : 'text/markdown';
      // Resolve only links to the same fixed resource set. Fileless clients can
      // follow the guide without interpreting repository-relative filesystem paths.
      const text = mimeType === 'text/markdown' ? resource.text.replace(/(\[[^\]]*\]\()([^\s)]+)(\))/g, (whole, prefix, href: string, suffix) => {
        if (/^[a-z]+:|^#|^\//i.test(href)) return whole;
        const [file = '', anchor] = href.split('#');
        const target = uris.get(path.posix.normalize(path.posix.join(path.posix.dirname(resource.path), file)));
        return target ? `${prefix}${target}${anchor ? `#${anchor}` : ''}${suffix}` : whole;
      }) : resource.text;
      server.registerResource(resource.name, uri, {description: resource.description, mimeType}, async () => ({contents:[{uri, mimeType, text}]}));
    }
  }};
}
