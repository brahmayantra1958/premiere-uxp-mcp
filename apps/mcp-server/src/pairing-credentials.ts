import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type StoredCredential = {
  credentialHash: string;
  pairedAt: string;
};

type StoredCredentials = {
  version: 1;
  projects: Record<string, StoredCredential>;
};

function credentialHash(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

function hashesMatch(left: string, right: string): boolean {
  const expected = Buffer.from(left, "hex");
  const supplied = Buffer.from(right, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export class PairingCredentialStore {
  private data: StoredCredentials = { version: 1, projects: {} };

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<StoredCredentials>;
      this.data = parsed.version === 1 && parsed.projects && typeof parsed.projects === "object"
        ? { version: 1, projects: parsed.projects }
        : { version: 1, projects: {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.data = { version: 1, projects: {} };
    }
  }

  async issue(projectId: string): Promise<string> {
    const credential = randomBytes(32).toString("hex");
    this.data.projects[projectId] = {
      credentialHash: credentialHash(credential),
      pairedAt: new Date().toISOString(),
    };
    await this.persist();
    return credential;
  }

  verify(projectId: string, credential: string): boolean {
    const stored = this.data.projects[projectId];
    return Boolean(stored && hashesMatch(stored.credentialHash, credentialHash(credential)));
  }

  snapshot(): { projectCount: number; projects: Array<{ projectId: string; pairedAt: string }> } {
    return {
      projectCount: Object.keys(this.data.projects).length,
      projects: Object.entries(this.data.projects).map(([projectId, value]) => ({ projectId, pairedAt: value.pairedAt })),
    };
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
