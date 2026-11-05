import { describe, expect, it } from "vitest";
import { ProjectCredentialStore, projectCredentialKey, type SecureStorageLike } from "../../apps/uxp-plugin/src/project-credential.js";

class FakeSecureStorage implements SecureStorageLike {
  readonly values = new Map<string, Uint8Array>();

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, new TextEncoder().encode(value));
  }

  async getItem(key: string): Promise<Uint8Array> {
    const value = this.values.get(key);
    if (!value) throw new Error("missing");
    return value;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("UXP project credential cache", () => {
  it("isolates secure-storage keys by project ID", async () => {
    const storage = new FakeSecureStorage();
    const store = new ProjectCredentialStore(storage);
    const credential = "a".repeat(64);
    await store.set("project/a", credential);

    expect(projectCredentialKey("project/a")).not.toBe(projectCredentialKey("project-b"));
    await expect(store.get("project/a")).resolves.toBe(credential);
    await expect(store.get("project-b")).resolves.toBeUndefined();
    await store.remove("project/a");
    await expect(store.get("project/a")).resolves.toBeUndefined();
  });

  it("rejects malformed credentials", async () => {
    const store = new ProjectCredentialStore(new FakeSecureStorage());
    await expect(store.set("project-a", "not-a-credential")).rejects.toThrow(/Invalid project credential/);
  });
});
