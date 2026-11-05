import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { bridgeRequestSchema, bridgeResponseSchema } from "@premiere-uxp/contracts";
import type { UxpBridgeServer } from "./bridge.js";
import {eventQuerySchema} from './runtime-events.js';
import {transportFailure} from './bridge-transport.js';
import {parseCallWaitMs,runtimeCallAdmission,runtimeCallWaitHeader,waitForCallAdmission} from './runtime-call-admission.js';

export const runtimeServiceName = "premiere-uxp-runtime";
export const runtimeProtocolVersion = "1";
const maximumBodyBytes = 8 * 1024 * 1024;
const maximumEphemeralPortAttempts = 32;

// Node's WHATWG Fetch implementation rejects these ports before making a
// network request. The runtime control server must never advertise one because
// runtime-manager and RemoteBridge intentionally use fetch as their client.
const fetchForbiddenPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

export function isFetchForbiddenPort(port: number): boolean {
  return fetchForbiddenPorts.has(port);
}

export type RuntimeHealth = {
  service: typeof runtimeServiceName;
  version: typeof runtimeProtocolVersion;
  ready: true;
  processId: number;
  callAdmission?: typeof runtimeCallAdmission;
};

type RuntimeControlOptions = {
  host: string;
  port: number;
  token: string;
  bridge: UxpBridgeServer;
  onShutdown: () => void;
};

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBodyBytes) throw new Error("Runtime control request exceeded the maximum body size");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export class RuntimeControlServer {
  private server: Server | undefined;
  private boundPort = 0;

  constructor(private readonly options: RuntimeControlOptions) {}

  async start(): Promise<number> {
    if (this.server) return this.boundPort;
    if (this.options.port !== 0 && isFetchForbiddenPort(this.options.port)) {
      throw new Error(`Runtime control port ${this.options.port} is blocked by Fetch's bad-port policy`);
    }

    const maximumAttempts = this.options.port === 0 ? maximumEphemeralPortAttempts : 1;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const server = createServer((request, response) => void this.handle(request, response));
      await new Promise<void>((resolve, reject) => {
        const onListening = (): void => {
          server.off("error", onError);
          resolve();
        };
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        server.once("listening", onListening);
        server.once("error", onError);
        server.listen(this.options.port, this.options.host);
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        throw new Error("Runtime control server did not expose a TCP port");
      }
      if (isFetchForbiddenPort(address.port)) {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        continue;
      }

      this.server = server;
      this.boundPort = address.port;
      return this.boundPort;
    }

    throw new Error(`Runtime control server received a Fetch-forbidden ephemeral port ${maximumAttempts} times`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.boundPort = 0;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private authorized(request: IncomingMessage): boolean {
    const suppliedHeader = request.headers.authorization ?? "";
    const supplied = suppliedHeader.startsWith("Bearer ") ? suppliedHeader.slice("Bearer ".length) : "";
    const expectedBuffer = Buffer.from(this.options.token, "utf8");
    const suppliedBuffer = Buffer.from(supplied, "utf8");
    return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", `http://${this.options.host}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { service: runtimeServiceName, version: runtimeProtocolVersion, ready: true, processId: process.pid,callAdmission:runtimeCallAdmission } satisfies RuntimeHealth);
        return;
      }
      if (!this.authorized(request)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        sendJson(response, 200, await this.options.bridge.getStatus());
        return;
      }
      if (request.method === "POST" && url.pathname === "/call") {
        const waitMs = parseCallWaitMs(request.headers[runtimeCallWaitHeader]);
        const abort = new AbortController(), close = () => abort.abort();
        response.once('close',close);
        try {
        const parsed = bridgeRequestSchema.parse(await readBody(request));
        if(waitMs)await waitForCallAdmission(()=>this.options.bridge.getStatus(),waitMs,abort.signal);
        if(response.destroyed)return;
        const result = bridgeResponseSchema.parse(await this.options.bridge.call(parsed));
        if(!response.destroyed)sendJson(response, 200, result);
        } finally { response.off('close',close); }
        return;
      }
      if(request.method==='POST'&&url.pathname==='/events/wait'){
        const query=eventQuerySchema.parse(await readBody(request)),abort=new AbortController();
        const close=()=>abort.abort();response.once('close',close);
        try{const page=await this.options.bridge.waitEvents(query,abort.signal);if(!response.destroyed)sendJson(response,200,page);}
        finally{response.off('close',close);}return;
      }
      if (request.method === "POST" && url.pathname === "/approve-next-project") {
        this.options.bridge.armNextLocalProject();
        sendJson(response, 200, { armed: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/shutdown") {
        sendJson(response, 202, { stopping: true });
        setImmediate(this.options.onShutdown);
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if(!response.destroyed)sendJson(response, 503, { error: error instanceof Error ? error.message : String(error),transport:transportFailure(error) });
    }
  }
}
