import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PANEL_ENTRYPOINT_ID, PANEL_VERSION } from "../../apps/uxp-plugin/src/plugin-contract.js";

describe("UXP manifest safety contract", () => {
  it("targets Premiere 26.3 with only the minimum local permissions", async () => {
    const manifest = JSON.parse(await readFile(path.resolve("apps/uxp-plugin/public/manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest).toMatchObject({
      manifestVersion: 5,
      version: PANEL_VERSION,
      host: { app: "premierepro", minVersion: "26.3.0" },
      main: "index.html",
      requiredPermissions: {
        localFileSystem: "request",
        ipc: {
          enablePluginCommunication: true,
        },
        network: {
          domains: [
            "ws://127.0.0.1/",
            "ws://localhost/",
            "http://127.0.0.1/",
            "http://127.0.0.1:8098/",
            "http://localhost:8098/",
            "http://127.0.0.1:8095/",
            "http://localhost:8095/",
            "http://localhost/",
          ],
        },
      },
    });
    expect(manifest.requiredPermissions.launchProcess).toEqual({extensions:[".exe", ".app"],schemes:[]});
    expect(Object.keys(manifest.requiredPermissions.ipc)).toEqual(["enablePluginCommunication"]);
    expect(manifest.requiredPermissions.localFileSystem).not.toBe("fullAccess");
    expect(manifest.requiredPermissions.network.domains).not.toContain("all");
    expect(manifest.requiredPermissions.network.domains).not.toContain("https://*");
    expect(manifest.entrypoints).toHaveLength(1);
    expect(manifest.entrypoints[0]).toMatchObject({ id: PANEL_ENTRYPOINT_ID, type: "panel" });
  });
});
