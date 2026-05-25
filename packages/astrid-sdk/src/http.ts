/**
 * Outbound HTTP. Two public shapes:
 *
 *   1. A builder-style {@link Request} / {@link Response} mirroring the Rust
 *      SDK's reqwest-like API (`http.get(url)`, `http.send(req)`).
 *   2. A WHATWG `fetch(url, init)` polyfill registered onto `globalThis`
 *      at SDK init via {@link installFetchPolyfill}. Routes through the same
 *      capability-gated host imports so users can't bypass the per-capsule
 *      net allow-list by reaching for the platform fetch.
 *
 * Streaming: {@link streamStart} returns an {@link HttpStream} resource
 * handle with `read-chunk` for explicit per-chunk pulls, an `async-iterator`
 * convenience, and access to the body as an `astrid:io/streams` `InputStream`
 * for capsules forwarding the body into another sink.
 */

import {
  httpRequest as hostRequest,
  httpStreamStart as hostStreamStart,
  type HttpRequestData,
  type HttpResponseData,
  type HttpStream as WitHttpStream,
  type HttpMethod as WitHttpMethod,
  type KeyValuePair,
} from "astrid:http/host@1.0.0";
import { SysError, callHost } from "./errors.js";

// ---------------------------------------------------------------------------
// Method type
// ---------------------------------------------------------------------------

export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS"
  | "TRACE"
  | "PATCH"
  | string;

/** Convert a string method name into the WIT variant the host expects. */
function methodToWit(method: string): WitHttpMethod {
  switch (method.toUpperCase()) {
    case "GET":
      return { tag: "get" };
    case "HEAD":
      return { tag: "head" };
    case "POST":
      return { tag: "post" };
    case "PUT":
      return { tag: "put" };
    case "DELETE":
      return { tag: "delete" };
    case "CONNECT":
      return { tag: "connect" };
    case "OPTIONS":
      return { tag: "options" };
    case "TRACE":
      return { tag: "trace" };
    case "PATCH":
      return { tag: "patch" };
    default:
      return { tag: "other", val: method };
  }
}

// ---------------------------------------------------------------------------
// Builder API (reqwest shape)
// ---------------------------------------------------------------------------

export class Request {
  url: string;
  method: string;
  headers: Map<string, string>;
  body: Uint8Array | undefined;

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
  static patch(url: string): Request {
    return new Request("PATCH", url);
  }
  static head(url: string): Request {
    return new Request("HEAD", url);
  }

  header(key: string, value: string): this {
    this.headers.set(key, value);
    return this;
  }

  setBody(body: string | Uint8Array): this {
    this.body = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return this;
  }

  json<T>(value: T): this {
    this.headers.set("Content-Type", "application/json");
    let s: string;
    try {
      s = JSON.stringify(value);
    } catch (err) {
      throw SysError.json(`http.Request.json: ${(err as Error).message}`, err);
    }
    this.body = new TextEncoder().encode(s);
    return this;
  }

  toWit(): HttpRequestData {
    return {
      url: this.url,
      method: methodToWit(this.method),
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

/**
 * Streaming HTTP response. The kernel buffers chunks server-side; the
 * capsule reads them via `.read()` (or the async iterator) until EOF. Drop
 * (via `using` or `.close()`) releases the host-side resource.
 */
export class HttpStreamHandle {
  #inner: WitHttpStream | undefined;
  readonly status: number;
  readonly headers: Map<string, string>;

  constructor(inner: WitHttpStream) {
    this.#inner = inner;
    this.status = inner.status();
    this.headers = new Map(inner.headers().map((h: KeyValuePair) => [h.key, h.value]));
  }

  /** Read the next chunk. Returns `undefined` at EOF. */
  read(): Uint8Array | undefined {
    if (this.#inner === undefined) return undefined;
    const chunk = callHost("http.HttpStream.readChunk", () => this.#inner!.readChunk());
    if (chunk.length === 0) return undefined;
    return chunk;
  }

  close(): void {
    if (this.#inner === undefined) return;
    const inner = this.#inner;
    this.#inner = undefined;
    try {
      // Explicit close mirrors the WIT-defined `.close()`; the Drop step still
      // runs on resource release regardless.
      inner.close();
    } catch {
      // idempotent close — host may have already released it.
    }
    try {
      inner[Symbol.dispose]();
    } catch {
      // already released
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  /** Async iterator that yields each chunk until EOF. Auto-closes on completion. */
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
  const inner: WitHttpStream = callHost(
    `http.streamStart ${req.method} ${req.url}`,
    () => hostStreamStart(wit),
  );
  const handle = new HttpStreamHandle(inner);
  return { handle, status: handle.status, headers: handle.headers };
}

// ---------------------------------------------------------------------------
// WHATWG fetch polyfill
// ---------------------------------------------------------------------------

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
      req.setBody(init.body);
    } else {
      req.json(init.body);
    }
  }
  const raw = callHost(`fetch ${req.method} ${url}`, () => hostRequest(req.toWit()));
  return new FetchResponse(url, raw.status, raw.headers.map((h) => [h.key, h.value]), raw.body);
}

/** Install the polyfill on `globalThis.fetch`. */
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
  const map: Record<number, string> = {
    200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    409: "Conflict", 422: "Unprocessable Entity", 429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
  };
  return map[code] ?? "";
}
