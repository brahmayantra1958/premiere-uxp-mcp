import { readFile } from "node:fs/promises";
import {
  objectSegmentationRequestSchema,
  objectSegmentationResultSchema,
  segmentationEngineOnlineSchema,
  type ObjectSegmentationRequest,
  type ObjectSegmentationResult,
  type SegmentationEngineStatus,
} from "@premiere-uxp/contracts";
import { isFetchForbiddenPort } from "./runtime-control.js";

const maximumResponseBytes = 1024 * 1024;

export type SegmentationEngineConfig = {
  baseUrl: string;
  tokenPath: string;
  timeoutMs: number;
};

export interface SegmentationEnginePort {
  inspect(): Promise<SegmentationEngineStatus>;
  segment(request: ObjectSegmentationRequest): Promise<ObjectSegmentationResult>;
}

type SegmentationEngineDependencies = {
  fetchImpl?: typeof fetch;
  readToken?: () => Promise<string>;
};

function normalizeLoopbackBaseUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLocaleLowerCase("en-US");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error("SEGMENTATION_URL_MUST_BE_LOOPBACK_HTTP");
  }
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("SEGMENTATION_URL_MUST_NOT_CONTAIN_CREDENTIALS_PATH_QUERY_OR_FRAGMENT");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || isFetchForbiddenPort(port)) {
    throw new Error("SEGMENTATION_URL_REQUIRES_A_FETCH_SAFE_UNPRIVILEGED_PORT");
  }
  url.pathname = "/";
  return url;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function boundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumResponseBytes) throw new Error("SEGMENTATION_RESPONSE_TOO_LARGE");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumResponseBytes) throw new Error("SEGMENTATION_RESPONSE_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("SEGMENTATION_RESPONSE_INVALID_JSON");
  }
}

export class HttpSegmentationEngine implements SegmentationEnginePort {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly readToken: () => Promise<string>;

  constructor(
    private readonly config: SegmentationEngineConfig,
    dependencies: SegmentationEngineDependencies = {},
  ) {
    if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 30 * 60_000) {
      throw new Error("SEGMENTATION_TIMEOUT_OUT_OF_RANGE");
    }
    this.baseUrl = normalizeLoopbackBaseUrl(config.baseUrl);
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.readToken = dependencies.readToken ?? (async () => (await readFile(config.tokenPath, "utf8")).trim());
  }

  async inspect(): Promise<SegmentationEngineStatus> {
    try {
      return segmentationEngineOnlineSchema.parse(await this.request("GET", "v1/health"));
    } catch (error) {
      return {
        status: "offline",
        service: "premiere-object-segmentation",
        protocolVersion: "1",
        endpoint: this.baseUrl.toString(),
        reason: messageOf(error),
      };
    }
  }

  async segment(request: ObjectSegmentationRequest): Promise<ObjectSegmentationResult> {
    const validated = objectSegmentationRequestSchema.parse(request);
    return objectSegmentationResultSchema.parse(await this.request("POST", "v1/segment", validated));
  }

  private async request(method: "GET" | "POST", pathname: string, body?: unknown): Promise<unknown> {
    const token = await this.readToken();
    if (token.length < 32) throw new Error("SEGMENTATION_AUTH_TOKEN_INVALID");
    const response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const payload = await boundedJson(response);
    if (!response.ok) {
      const reason = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : String(response.status);
      throw new Error(`SEGMENTATION_ENGINE_REQUEST_FAILED: ${reason}`);
    }
    return payload;
  }
}
