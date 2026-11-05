const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export type ModelCatalogEntry = {
  id: string;
  label?: string;
  transports?: string[];
  thinking?: string[];
};

export type ModelCatalog = {
  vendors?: string[];
  models?: Record<string, ModelCatalogEntry[]>;
  thinkingLevels?: string[];
};

export type ModelRequest = {
  vendor: string;
  model: string;
  thinking: string;
  prompt: string;
  resumeSessionId?: string;
  cwd?: string;
  addDirs?: string[];
};

export type ModelResponse = {
  responseText: string;
  sessionId: string | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Restricts the model surface to the user-owned local bridge. */
export function normalizeModelBridgeUrl(input: string): string {
  const target = new URL(input.trim());
  const isAuthorized = target.protocol === "http:"
    && LOOPBACK_HOSTS.has(target.hostname)
    && target.username === ""
    && target.password === ""
    && target.pathname === "/"
    && target.search === ""
    && target.hash === "";
  if (!isAuthorized) throw new Error("모델 브리지는 로컬 HTTP 주소만 사용할 수 있습니다");
  const port = target.port ? `:${target.port}` : "";
  return `http://${target.hostname}${port}`;
}

export function cliModels(catalog: ModelCatalog): Array<ModelCatalogEntry & { vendor: string }> {
  const entries: Array<ModelCatalogEntry & { vendor: string }> = [];
  for (const vendor of catalog.vendors ?? Object.keys(catalog.models ?? {})) {
    for (const model of catalog.models?.[vendor] ?? []) {
      if ((model.transports ?? []).includes("cli")) entries.push({ vendor, ...model });
    }
  }
  return entries;
}

export class ModelBridgeClient {
  constructor(private readonly fetcher: FetchLike = (input, init) => fetch(input, init)) {}

  async options(baseUrl: string): Promise<ModelCatalog> {
    const payload = await this.getJson(baseUrl, "/api/options");
    if (!payload || typeof payload !== "object") throw new Error("모델 목록 응답이 올바르지 않습니다");
    return payload as ModelCatalog;
  }

  async health(baseUrl: string): Promise<void> {
    await this.getJson(baseUrl, "/health");
  }

  async ask(baseUrl: string, request: ModelRequest): Promise<ModelResponse> {
    const response = await this.fetcher(`${normalizeModelBridgeUrl(baseUrl)}/api/model/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transport: "cli", ...request }),
    });
    const payload = await responseJson(response);
    if (!response.ok || payload.ok === false) {
      throw new Error(errorMessage(payload, `모델 요청 실패 (${response.status})`));
    }
    return {
      responseText: typeof payload.responseText === "string" ? payload.responseText : "",
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : null,
    };
  }

  private async getJson(baseUrl: string, path: string): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${normalizeModelBridgeUrl(baseUrl)}${path}`);
    const payload = await responseJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, `브리지 응답 실패 (${response.status})`));
    return payload;
  }
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  try {
    return await response.json() as Record<string, any>;
  } catch {
    throw new Error("브리지가 JSON 응답을 반환하지 않았습니다");
  }
}

function errorMessage(payload: Record<string, any>, fallback: string): string {
  for (const key of ["errorText", "error", "message"]) {
    if (typeof payload[key] === "string" && payload[key].trim()) return payload[key];
  }
  return fallback;
}
