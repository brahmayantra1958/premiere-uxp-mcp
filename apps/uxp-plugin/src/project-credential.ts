export type SecureStorageLike = {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<Uint8Array>;
  removeItem(key: string): Promise<void>;
};

const KEY_PREFIX = "premiere-uxp-mcp.project-credential.";

function decodeAscii(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

export function projectCredentialKey(projectId: string): string {
  if (!projectId.trim()) throw new Error("A project ID is required for saved pairing");
  return `${KEY_PREFIX}${encodeURIComponent(projectId)}`;
}

/** The saved transport identity persists across active editing projects. */
export async function resolveSavedConnection(store: {get(id:string):Promise<string|undefined>}, savedId:string, activeId:string) {
  for (const projectId of [...new Set([savedId,activeId])].filter(Boolean)) {
    const credential=await store.get(projectId);
    if(credential)return {projectId,credential};
  }
  return undefined;
}

export class ProjectCredentialStore {
  constructor(private readonly storage: SecureStorageLike) {}

  async get(projectId: string): Promise<string | undefined> {
    try {
      const bytes = await this.storage.getItem(projectCredentialKey(projectId));
      const credential = decodeAscii(bytes);
      return /^[a-f0-9]{64}$/.test(credential) ? credential : undefined;
    } catch {
      return undefined;
    }
  }

  async set(projectId: string, credential: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(credential)) throw new Error("Invalid project credential format");
    await this.storage.setItem(projectCredentialKey(projectId), credential);
  }

  async remove(projectId: string): Promise<void> {
    try { await this.storage.removeItem(projectCredentialKey(projectId)); }
    catch { /* Removing an absent or already-cleared secure value is idempotent. */ }
  }
}
