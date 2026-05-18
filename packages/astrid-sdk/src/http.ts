/**
 * Outbound HTTP. Two public shapes:
 *
 *   1. A builder-style `http.Request` / `http.Response` mirroring the Rust
 *      SDK's reqwest-like API (`http.get(url)`, `http.send(req)`).
 *   2. A WHATWG `fetch(url, init)` polyfill registered onto `globalThis`
 *      at SDK init via `installFetchPolyfill()`. Routes through the same
 *      capability-gated host imports so users can't bypass the per-capsule
 *      net allow-list by reaching for the platform fetch.
 *
 * Streaming: `streamStart` returns a handle, `streamRead` pulls chunks
 * until empty, `streamClose` releases the host-side resource.
 */

import {
  httpRequest as hostRequest,
  httpStreamStart as hostStreamStart,
  httpStreamRead as hostStreamRead,
  httpStreamClose as hostStreamClose,
  type HttpRequestData,
  type HttpResponseData,
  type HttpStreamStartResponse,
  type KeyValuePair,
} from "astrid:capsule/http@0.1.0";
import { SysError, callHost } from "./errors.js";

// ---------------------------------------------------------------------------
// Builder API (reqwest shape)
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export class Request {
  url: string;
  method: string;
  headers: Map<string, string>;
  body: string | undefined;

  constructor(method: string, url: string) {
    this.method = method;
    this.url = url;
    this.headers = new Map();
    this.body = undefined;
  }

  static get(url: string): Request {
    return new Request("GET", url);
  }
  static post(url: string): Request {
    return new Request("POST", url);
  }
  static put(url: string): Request {
    return new Request("PUT", url);
  }
  static delete(url: string): Request {
    return new Request("DELETE", url);
  }

  header(key: string, value: string): this {
    this.headers.set(key, value);
    return this;
  }

  setBody(body: string): this {
    this.body = body;
    return this;
  }

  json<T>(value: T): this {
    this.headers.set("Content-Type", "application/json");
    try {
      this.body = JSON.stringify(value);
    } catch (err) {
      throw SysError.json(`http.Request.json: ${(err as Error).message}`, err);
    }
    return this;
  }

  toWit(): HttpRequestData {
    return {
      url: this.url,
      method: this.method,
      headers: Array.from(this.headers, ([key, value]) => ({ key, value })),
      body: this.body,
    };
  }
}

export class Response {
  readonly status: number;
  readonly headers: Map<string, string>;
  readonly #body: Uint8Array;

  constructor(raw: HttpResponseData) {
    this.status = raw.status;
    this.headers = new Map(raw.headers.map((h) => [h.key, h.value]));
    this.#body = raw.body;
  }

  bytes(): Uint8Array {
    return this.#body;
  }

  text(): string {
    return new TextDecoder().decode(this.#body);
  }

  json<T = unknown>(): T {
    try {
      return JSON.parse(this.text()) as T;
    } catch (err) {
      throw SysError.json(`http.Response.json: ${(err as Error).message}`, err);
    }
  }

  ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
}

export function send(req: Request): Response {
  const wit = req.toWit();
  const raw = callHost(`http.send ${req.method} ${req.url}`, () => hostRequest(wit));
  return new Response(raw);
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export class HttpStreamHandle {
  readonly id: bigint;
  #closed = false;

  constructor(id: bigint) {
    this.id = id;
  }

  read(): Uint8Array | undefined {
    if (this.#closed) return undefined;
    const chunk = callHost(`http.streamRead`, () => hostStreamRead(this.id));
    if (chunk.length === 0) return undefined;
    return chunk;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      hostStreamClose(this.id);
    } catch {
      // idempotent close — host returns an error if the handle is gone;
      // safe to swallow here.
    }
  }

  /** Async iterator that yields each chunk until EOF. Closes on completion. */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    try {
      while (true) {
        const chunk = this.read();
        if (chunk === undefined) return;
        yield chunk;
      }
    } finally {
      this.close();
    }
  }
}

export interface StreamStart {
  handle: HttpStreamHandle;
  status: number;
  headers: Map<string, string>;
}

export function streamStart(req: Request): StreamStart {
  const wit = req.toWit();
  const raw: HttpStreamStartResponse = callHost(
    `http.streamStart ${req.method} ${req.url}`,
    () => hostStreamStart(wit),
  );
  return {
    handle: new HttpStreamHandle(raw.handle),
    status: raw.status,
    headers: new Map(raw.headers.map((h: KeyValuePair) => [h.key, h.value])),
  };
}

// ---------------------------------------------------------------------------
// WHATWG fetch polyfill
// ---------------------------------------------------------------------------

/**
 * Minimal WHATWG `fetch` shim that routes through Astrid's capability-
 * gated HTTP host. Supports the subset of options capsule authors
 * actually need: `method`, `headers`, `body` (string or object → JSON).
 *
 * Not supported: AbortSignal cancellation, streamed request bodies,
 * credentials/CORS (the host doesn't see browser semantics), Response
 * cloning (immutable Response by design). If you need streaming bodies,
 * call `http.streamStart` directly.
 *
 * Install at SDK init: `installFetchPolyfill()`. The bridge sets this up
 * before any user code runs.
 */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string> | Map<string, string> | [string, string][];
  body?: string | Uint8Array | Record<string, unknown>;
}

export class FetchResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly url: string;
  readonly ok: boolean;
  readonly #body: Uint8Array;

  constructor(url: string, status: number, headerEntries: [string, string][], body: Uint8Array) {
    this.url = url;
    this.status = status;
    this.statusText = httpStatusText(status);
    this.headers = new Headers(headerEntries);
    this.ok = status >= 200 && status < 300;
    this.#body = body;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.#body);
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.#body.buffer.slice(
      this.#body.byteOffset,
      this.#body.byteOffset + this.#body.byteLength,
    ) as ArrayBuffer;
  }

  async bytes(): Promise<Uint8Array> {
    return this.#body;
  }
}

export async function fetchPolyfill(url: string, init: FetchInit = {}): Promise<FetchResponse> {
  const req = new Request(init.method ?? "GET", url);
  if (init.headers) {
    for (const [k, v] of normalizeHeaders(init.headers)) {
      req.header(k, v);
    }
  }
  if (init.body !== undefined) {
    if (typeof init.body === "string") {
      req.setBody(init.body);
    } else if (init.body instanceof Uint8Array) {
      req.setBody(new TextDecoder().decode(init.body));
    } else {
      req.json(init.body);
    }
  }
  const raw = callHost(`fetch ${req.method} ${url}`, () => hostRequest(req.toWit()));
  return new FetchResponse(url, raw.status, raw.headers.map((h) => [h.key, h.value]), raw.body);
}

/**
 * Install the polyfill on `globalThis.fetch`, shadowing the engine's
 * built-in fetch (if any). Called by the bridge during capsule init.
 */
export function installFetchPolyfill(): void {
  (globalThis as unknown as { fetch?: typeof fetchPolyfill }).fetch = fetchPolyfill;
}

function normalizeHeaders(
  input: NonNullable<FetchInit["headers"]>,
): Iterable<[string, string]> {
  if (input instanceof Map) return input.entries();
  if (Array.isArray(input)) return input;
  return Object.entries(input);
}

function httpStatusText(code: number): string {
  // Minimal lookup table. Capsule authors rarely care about the precise
  // text; if needed, they can check `status` directly.
  const map: Record<number, string> = {
    200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    409: "Conflict", 422: "Unprocessable Entity", 429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
  };
  return map[code] ?? "";
}
