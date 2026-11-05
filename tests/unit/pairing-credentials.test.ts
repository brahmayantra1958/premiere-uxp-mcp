import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PairingCredentialStore } from "../../apps/mcp-server/src/pairing-credentials.js";
import { freshTestDirectory } from "../helpers/workspace.js";

describe("project-scoped pairing credential store", () => {
  it("persists only hashes and verifies credentials per project", async () => {
    const directory = await freshTestDirectory("pairing-credentials");
    const filePath = path.join(directory, "credentials.json");
    const first = new PairingCredentialStore(filePath);
    await first.load();
    const credential = await first.issue("project-a");

    expect(credential).toMatch(/^[a-f0-9]{64}$/);
    expect(first.verify("project-a", credential)).toBe(true);
    expect(first.verify("project-b", credential)).toBe(false);
    expect(await readFile(filePath, "utf8")).not.toContain(credential);

    const reloaded = new PairingCredentialStore(filePath);
    await reloaded.load();
    expect(reloaded.verify("project-a", credential)).toBe(true);
    expect(reloaded.snapshot()).toMatchObject({ projectCount: 1, projects: [{ projectId: "project-a" }] });
  });

  it("rotates the credential when the project is paired again", async () => {
    const directory = await freshTestDirectory("pairing-credential-rotation");
    const store = new PairingCredentialStore(path.join(directory, "credentials.json"));
    await store.load();
    const oldCredential = await store.issue("project-a");
    const newCredential = await store.issue("project-a");

    expect(newCredential).not.toBe(oldCredential);
    expect(store.verify("project-a", oldCredential)).toBe(false);
    expect(store.verify("project-a", newCredential)).toBe(true);
  });
});
