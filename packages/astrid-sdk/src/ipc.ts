/**
 * IPC event bus. Mirrors `astrid_sdk::ipc`.
 *
 * Publish: `publish(topic, payload)`, `publishJson(topic, obj)`, plus the
 * `publish_as` variants for uplinks (`uplink = true` capability required).
 *
 * Subscribe: `subscribe(topic)` returns a `Subscription` with explicit
 * `.poll()` / `.recv(timeoutMs)` methods (full parity with Rust, surfaces
 * lagged/dropped counts) AND an `[Symbol.asyncIterator]` for the JS-native
 * `for await (const msg of sub)` pattern. The async iterator silently
 * drops lag info — use `.poll()` / `.recv()` when those signals matter.
 *
 * Interceptor handles: `runtimeInterceptors()` returns the kernel-
 * pre-registered subscription bindings for runnable+interceptor capsules.
 * The bridge uses this internally; capsule authors generally don't call it
 * directly (the `@interceptor` decorator + bridge wiring handle dispatch).
 */

import {
  ipcPublish as hostPublish,
  ipcSubscribe as hostSubscribe,
  ipcUnsubscribe as hostUnsubscribe,
  ipcPoll as hostPoll,
  ipcRecv as hostRecv,
  getInterceptorHandles as hostGetInterceptorHandles,
  type IpcEnvelope,
  type InterceptorHandle,
} from "astrid:capsule/ipc@0.1.0";
import { SysError, callHost } from "./errors.js";

export interface IpcMessage {
  topic: string;
  payload: string;
  sourceId: string;
  /** Convenience: parse `payload` as JSON. Throws SysError.json on failure. */
  json<T = unknown>(): T;
}

export interface PollResult {
  messages: IpcMessage[];
  /** Messages dropped due to buffer overflow since the previous poll. */
  dropped: bigint;
  /** Cumulative lag — total messages missed since subscription opened. */
  lagged: bigint;
}

export interface InterceptorBinding {
  /** Subscription handle that backs this interceptor. */
  handle: bigint;
  /** Hook action name the kernel dispatches when a message matches. */
  action: string;
  /** Topic pattern this subscription was registered for. */
  topic: string;
}

const DEFAULT_RECV_TIMEOUT_MS = 5_000n;

export function publish(topic: string, payload: string): void {
  callHost(`ipc.publish(${quote(topic)})`, () => hostPublish(topic, payload));
}

export function publishJson<T>(topic: string, payload: T): void {
  publish(topic, jsonify(`ipc.publishJson(${quote(topic)})`, payload));
}

// TODO: `publishAs` / `publishJsonAs` were on sdk-rust's feat/ipc-publish-as
// branch but the kernel WIT (core/wit/astrid-capsule.wit) hasn't been
// updated to include the host function yet. Re-introduce these when the
// kernel-side `ipc_publish_as` lands — the JS bridge will need the
// matching import declaration in wit-imports.d.ts to re-enable, too.

/**
 * Subscribe to an IPC topic pattern. Returns a {@link Subscription} that
 * must eventually be `.close()`d, or used inside a `for await` loop that
 * runs to completion.
 */
export function subscribe(topicPattern: string): Subscription {
  const handle = callHost(`ipc.subscribe(${quote(topicPattern)})`, () =>
    hostSubscribe(topicPattern),
  );
  return new Subscription(handle, topicPattern);
}

/**
 * Get the pre-registered interceptor handles for a runnable+interceptor
 * capsule. Most authors don't call this — the bridge consumes it to feed
 * `@interceptor` methods.
 */
export function runtimeInterceptors(): InterceptorBinding[] {
  const handles: InterceptorHandle[] = callHost(
    "ipc.runtimeInterceptors",
    () => hostGetInterceptorHandles(),
  );
  return handles.map((h) => ({ handle: h.handleId, action: h.action, topic: h.topic }));
}

export class Subscription {
  readonly topic: string;
  #handle: bigint;
  #closed = false;

  constructor(handle: bigint, topic: string) {
    this.#handle = handle;
    this.topic = topic;
  }

  get id(): bigint {
    return this.#handle;
  }

  /** Non-blocking poll. Returns whatever's already queued. */
  poll(): PollResult {
    this.#requireOpen();
    const env = callHost(`ipc.poll(${quote(this.topic)})`, () => hostPoll(this.#handle));
    return envelopeToPollResult(env);
  }

  /** Blocking receive (timeout capped at 60s by the host). */
  recv(timeoutMs: bigint = DEFAULT_RECV_TIMEOUT_MS): PollResult {
    this.#requireOpen();
    const env = callHost(`ipc.recv(${quote(this.topic)})`, () => hostRecv(this.#handle, timeoutMs));
    return envelopeToPollResult(env);
  }

  /** Idempotent — closing an already-closed subscription is a no-op. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      hostUnsubscribe(this.#handle);
    } catch {
      // Runtime-owned interceptor handles can't be unsubscribed; that's
      // expected. We swallow the error rather than expose it as a SysError
      // since close() is meant to be safe to call from cleanup paths.
    }
  }

  /**
   * AsyncIterable convenience. Loops calling `.recv()` and yielding each
   * message. Stops when the subscription is closed (or the loop body
   * breaks). Drops `lagged`/`dropped` info — use `.poll()`/`.recv()`
   * explicitly if you need to react to lag.
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<IpcMessage> {
    while (!this.#closed) {
      const batch = this.recv();
      for (const msg of batch.messages) {
        yield msg;
      }
    }
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw SysError.api(`subscription on ${quote(this.topic)} is closed`);
    }
  }
}

function envelopeToPollResult(env: IpcEnvelope): PollResult {
  return {
    messages: env.messages.map((m) => makeIpcMessage(m.topic, m.payload, m.sourceId)),
    dropped: env.dropped,
    lagged: env.lagged,
  };
}

function makeIpcMessage(topic: string, payload: string, sourceId: string): IpcMessage {
  return {
    topic,
    payload,
    sourceId,
    json<T = unknown>(): T {
      try {
        return JSON.parse(payload) as T;
      } catch (err) {
        throw SysError.json(
          `IpcMessage.json() on topic ${quote(topic)}: ${(err as Error).message}`,
          err,
        );
      }
    },
  };
}

function jsonify(label: string, value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    throw SysError.json(`${label}: ${(err as Error).message}`, err);
  }
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
