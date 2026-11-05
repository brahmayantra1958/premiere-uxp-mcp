import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(relativePath), "utf8");
}

describe("deployment path contracts", () => {
  it("keeps the shared build unconfigured and personalizes only during installation", async () => {
    const [foundation, vite, sidecar, installer, html] = await Promise.all([
      source("apps/uxp-plugin/src/host-foundation.ts"),
      source("apps/uxp-plugin/vite.config.mjs"),
      source("apps/uxp-plugin/public/deployment-config.js"),
      source("installer/install.mjs"),
      source("apps/uxp-plugin/public/index.html"),
    ]);

    expect(foundation).toContain("deployment.scratchRoot");
    expect(vite).not.toContain('track-targeting-connection.json');
    expect(vite).not.toContain('__PREMIERE_MCP_LOCAL_SCRATCH_ROOT__');
    expect(sidecar).toContain("scratchRoot: ''");
    expect(installer).toContain("writeLocalDeployment(root)");
    expect(await source('installer/lib.mjs')).toContain("apps/uxp-plugin/dist/deployment-config.js");
    expect(html.indexOf('src="deployment-config.js"')).toBeLessThan(html.indexOf('src="index.js"'));
  });

  it("keeps CEP paths tokenized in source and injects them during install", async () => {
    const [client, host, installer, manifest] = await Promise.all([
      source("apps/cep-caption-helper/client.js"),
      source("apps/cep-caption-helper/host/caption.jsx"),
      source("tests/live-premiere/install-cep-caption-helper.ps1"),
      source("apps/cep-caption-helper/CSXS/manifest.xml"),
    ]);

    expect(client).toContain("__PREMIERE_MCP_REPOSITORY_ROOT__");
    expect(client).toContain("__PREMIERE_MCP_CEP_VERSION__");
    expect(host).toContain("__PREMIERE_MCP_SCRATCH_ROOT__");
    expect(installer).toContain('throw "Unresolved deployment token"');
    const bundleVersion=manifest.match(/ExtensionBundleVersion="([^"]+)"/)?.[1];
    expect(bundleVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest).toContain(`Id="ai.brahma.yantra.caption-helper" Version="${bundleVersion}"`);
  });
});
