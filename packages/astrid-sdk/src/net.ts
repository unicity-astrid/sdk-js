/**
 * Unix domain socket networking. Mirrors `astrid_sdk::net` which itself
 * borrows shape from `std::sync::mpsc` (RecvError, TryRecvError::{Empty,
 * Closed}, SendError + recv/try_recv/send).
 *
 * The kernel pre-binds a single Unix socket per capsule; call `bindUnix()`
 * to activate it and start accepting connections.
 */

import {
  netBindUnix as hostBindUnix,
  netAccept as hostAccept,
  netPollAccept as hostPollAccept,
  netRead as hostRead,
  netWrite as hostWrite,
  netCloseStream as hostCloseStream,
  type NetReadStatus,
} from "astrid:capsule/net@0.1.0";
import { clockMs as hostClockMs } from "astrid:capsule/sys@0.1.0";
import { SysError, callHost } from "./errors.js";

// ---------------------------------------------------------------------------
// mpsc-shaped errors
// ---------------------------------------------------------------------------

export class RecvError extends Error {
  override readonly name = "RecvError";
  readonly code = "EPIPE" as const;
  constructor() {
    super("stream closed");
  }
}

export type TryRecvError =
  | { kind: "empty"; message: string; code: "EAGAIN" }
  | { kind: "closed"; message: string; code: "EPIPE" };

export class SendError extends Error {
  override readonly name = "SendError";
  readonly code = "EPIPE" as const;
  constructor() {
    super("stream closed");
  }
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

export class ListenerHandle {
  readonly id: bigint;
  constructor(id: bigint) {
    this.id = id;
  }
}

export class StreamHandle {
  readonly id: bigint;
  #closed = false;

  constructor(id: bigint) {
    this.id = id;
  }

  /** Non-blocking read. Returns bytes / `null` (empty) / throws on closed. */
  tryRecv(): Uint8Array | { kind: "empty" } {
    this.#requireOpen();
    const status: NetReadStatus = callHost(`net.tryRecv(${this.id})`, () => hostRead(this.id));
    switch (status.tag) {
      case "data":
        return status.value;
      case "pending":
        return { kind: "empty" };
      case "closed":
        this.#closed = true;
        throw new RecvError();
    }
  }

  /**
   * Blocking receive — polls until a frame arrives or the peer closes.
   * 50 ms sleep between polls matches the Rust SDK; bridge syncify
   * handles it.
   */
  recv(): Uint8Array {
    this.#requireOpen();
    // Pure polling loop. The WIT net-read is non-blocking; the Rust SDK
    // sleeps 50 ms between polls. We do the same; StarlingMonkey's
    // syncify makes this a real blocking call from the host's POV.
    while (true) {
      try {
        const result = this.tryRecv();
        if (result instanceof Uint8Array) return result;
      } catch (err) {
        if (err instanceof RecvError) throw err;
        throw err;
      }
      sleepMs(50);
    }
  }

  send(data: Uint8Array): void {
    this.#requireOpen();
    try {
      hostWrite(this.id, data);
    } catch {
      // The host returns an error on dead peers. Cleanup happens on next
      // read; here we surface SendError to match the Rust SDK.
      throw new SendError();
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      hostCloseStream(this.id);
    } catch {
      /* idempotent */
    }
  }

  /** Async iterator yielding each frame until the peer closes. */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array> {
    try {
      while (true) {
        try {
          yield this.recv();
        } catch (err) {
          if (err instanceof RecvError) return;
          throw err;
        }
      }
    } finally {
      this.close();
    }
  }

  #requireOpen(): void {
    if (this.#closed) throw SysError.api(`net stream ${this.id} is closed`);
  }
}

// ---------------------------------------------------------------------------
// Listener API
// ---------------------------------------------------------------------------

/** Bind the kernel-pre-provisioned Unix socket and return a listener handle. */
export function bindUnix(): ListenerHandle {
  const handle = callHost("net.bindUnix", () => hostBindUnix(0n));
  return new ListenerHandle(handle);
}

/** Block until the next incoming connection. */
export function accept(listener: ListenerHandle): StreamHandle {
  const id = callHost(`net.accept(${listener.id})`, () => hostAccept(listener.id));
  return new StreamHandle(id);
}

/** Non-blocking accept. Returns the stream or `undefined` if none ready. */
export function tryAccept(listener: ListenerHandle): StreamHandle | undefined {
  const id = callHost(`net.tryAccept(${listener.id})`, () => hostPollAccept(listener.id));
  return id === undefined ? undefined : new StreamHandle(id);
}

// ---------------------------------------------------------------------------
// Sleep shim
// ---------------------------------------------------------------------------

/**
 * 50 ms sleep used by the polling receive loop. Implemented as a busy-wait
 * against the host clock — StarlingMonkey's syncify wraps this into a
 * single blocking host call from the kernel's perspective. Not exposed
 * publicly because authors who need a real sleep should use IPC's
 * blocking `recv(timeoutMs)`.
 */
function sleepMs(ms: number): void {
  // Bounded busy-wait against the host clock. We deliberately avoid
  // setTimeout — the engine's microtask drain would refuse to settle the
  // surrounding promise. StarlingMonkey's syncify wraps the loop into a
  // single blocking host call from the kernel's POV.
  const deadline = hostClockMs() + BigInt(ms);
  while (hostClockMs() < deadline) {
    // spin
  }
}
