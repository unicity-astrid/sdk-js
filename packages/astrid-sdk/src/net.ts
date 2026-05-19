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
  netCloseStream as hostCloseStream,
  netConnectTcp as hostConnectTcp,
  netReadBytes as hostReadBytes,
  netWriteBytes as hostWriteBytes,
  netPeek as hostPeek,
  netShutdown as hostShutdown,
  netPeerAddr as hostPeerAddr,
  netLocalAddr as hostLocalAddr,
  netSetNodelay as hostSetNodelay,
  netNodelay as hostNodelay,
  netSetReadTimeout as hostSetReadTimeout,
  netReadTimeout as hostReadTimeout,
  netSetWriteTimeout as hostSetWriteTimeout,
  netWriteTimeout as hostWriteTimeout,
  netSetTtl as hostSetTtl,
  netTtl as hostTtl,
  type ShutdownHow,
} from "astrid:capsule/net@0.1.0";
import { SysError, callHost } from "./errors.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate + convert a timeout to the host's `bigint | undefined`.
 * Mirrors Rust SDK's `to_host_timeout`. Rejects `0` (would be
 * ambiguous with "no timeout") matching
 * `std::net::TcpStream::set_read_timeout`'s `Duration::ZERO` rule.
 */
function toHostTimeout(timeoutMs: number | undefined): bigint | undefined {
  if (timeoutMs === undefined) return undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw SysError.api(
      `timeout must be a positive integer (got ${timeoutMs}); use undefined to clear`,
    );
  }
  return BigInt(Math.floor(timeoutMs));
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

  // -------------------------------------------------------------------------
  // Byte-stream surface (mirrors std::net::TcpStream / std::io::Read+Write)
  // -------------------------------------------------------------------------

  /**
   * Read up to `maxBytes` without length-prefix framing. Mirrors
   * `std::net::TcpStream::read`.
   *
   * Contract:
   * - **Empty Uint8Array = EOF** (peer disconnected). Unambiguous.
   * - Non-empty = data read (may be shorter than `maxBytes`).
   * - Throws `SysError` with message containing `"would block"` if a
   *   read timeout was set via {@link setReadTimeout} and expired
   *   with no data. With no timeout set, blocks until data, EOF, or
   *   capsule unload.
   */
  readBytes(maxBytes: number): Uint8Array {
    this.#requireOpen();
    return callHost(`net.readBytes(${this.id}, ${maxBytes})`, () =>
      hostReadBytes(this.id, maxBytes),
    );
  }

  /**
   * Write `data` without framing. Returns bytes written (may be less than
   * `data.length` when the kernel's socket buffer is full). Honours any
   * timeout set via {@link setWriteTimeout}; with no timeout set, blocks
   * until the write completes or the peer disconnects.
   */
  writeBytes(data: Uint8Array): number {
    this.#requireOpen();
    return callHost(`net.writeBytes(${this.id})`, () => hostWriteBytes(this.id, data));
  }

  /**
   * Peek up to `maxBytes` without consuming them — the next
   * {@link readBytes} returns the same data again. Same EOF /
   * would-block semantics as {@link readBytes}.
   */
  peek(maxBytes: number): Uint8Array {
    this.#requireOpen();
    return callHost(`net.peek(${this.id}, ${maxBytes})`, () => hostPeek(this.id, maxBytes));
  }

  /** Half-close the read side, write side, or both. */
  shutdown(how: ShutdownHow): void {
    this.#requireOpen();
    callHost(`net.shutdown(${this.id}, ${how})`, () => hostShutdown(this.id, how));
  }

  /** Remote peer address as `"ip:port"`. */
  peerAddr(): string {
    this.#requireOpen();
    return callHost(`net.peerAddr(${this.id})`, () => hostPeerAddr(this.id));
  }

  /** Local socket address as `"ip:port"`. */
  localAddr(): string {
    this.#requireOpen();
    return callHost(`net.localAddr(${this.id})`, () => hostLocalAddr(this.id));
  }

  /** Toggle `TCP_NODELAY` (Nagle's algorithm off when `true`). */
  setNodelay(nodelay: boolean): void {
    this.#requireOpen();
    callHost(`net.setNodelay(${this.id}, ${nodelay})`, () => hostSetNodelay(this.id, nodelay));
  }

  /** Current `TCP_NODELAY` setting. */
  nodelay(): boolean {
    this.#requireOpen();
    return callHost(`net.nodelay(${this.id})`, () => hostNodelay(this.id));
  }

  /**
   * Set the read timeout (milliseconds). `undefined` clears the
   * timeout (reads block indefinitely). `0` is rejected — matches
   * `std::net::TcpStream::set_read_timeout` which errors on
   * `Duration::ZERO`.
   */
  setReadTimeout(timeoutMs: number | undefined): void {
    this.#requireOpen();
    const ms = toHostTimeout(timeoutMs);
    callHost(`net.setReadTimeout(${this.id}, ${timeoutMs})`, () =>
      hostSetReadTimeout(this.id, ms),
    );
  }

  /** Current read timeout in milliseconds, or `undefined` if unset. */
  readTimeout(): number | undefined {
    this.#requireOpen();
    const v = callHost(`net.readTimeout(${this.id})`, () => hostReadTimeout(this.id));
    return v === undefined ? undefined : Number(v);
  }

  /**
   * Set the write timeout (milliseconds). `undefined` clears it;
   * `0` is rejected (matches
   * `std::net::TcpStream::set_write_timeout`).
   */
  setWriteTimeout(timeoutMs: number | undefined): void {
    this.#requireOpen();
    const ms = toHostTimeout(timeoutMs);
    callHost(`net.setWriteTimeout(${this.id}, ${timeoutMs})`, () =>
      hostSetWriteTimeout(this.id, ms),
    );
  }

  /** Current write timeout in milliseconds, or `undefined` if unset. */
  writeTimeout(): number | undefined {
    this.#requireOpen();
    const v = callHost(`net.writeTimeout(${this.id})`, () => hostWriteTimeout(this.id));
    return v === undefined ? undefined : Number(v);
  }

  /** Set the IP `TTL` on outgoing packets. */
  setTtl(ttl: number): void {
    this.#requireOpen();
    callHost(`net.setTtl(${this.id}, ${ttl})`, () => hostSetTtl(this.id, ttl));
  }

  /** Current IP `TTL`. */
  ttl(): number {
    this.#requireOpen();
    return callHost(`net.ttl(${this.id})`, () => hostTtl(this.id));
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
// Outbound TCP — STUB pending host fn
// ---------------------------------------------------------------------------

/**
 * Open an outbound TCP connection to `host:port`.
 *
 * The returned {@link StreamHandle} flows through the same `recv` /
 * `tryRecv` / `send` / `close` API as the `accept` path — Astrid's host
 * ABI keeps inbound and outbound on one stream-handle type.
 *
 * The kernel runs three checks before the TCP syscall:
 *
 * 1. The capsule's `net_connect` allowlist in `Capsule.toml` must
 *    contain a pattern matching `"host:port"` (exact) or `"host:*"`
 *    (any port for the named host). Missing or empty list denies all
 *    outbound TCP (fail-closed).
 * 2. DNS resolution rejects loopback, private, link-local, multicast,
 *    and unspecified IPs (same airlock as `http.request`).
 * 3. Per-capsule active-stream cap (default 8, shared with inbound
 *    `accept`).
 *
 * Connect attempts are bounded to ~10s by the host. A stalled DNS or
 * TCP handshake surfaces as a `SysError`, not an indefinite hang.
 *
 * @param host Hostname or IP, matched against the manifest allowlist.
 * @param port TCP port (1–65535).
 *
 * Tracking issue: https://github.com/unicity-astrid/astrid/issues/745
 * RFC: https://github.com/unicity-astrid/rfcs/pull/27
 */
export function connect(host: string, port: number): StreamHandle {
  const id = callHost(`net.connect(${JSON.stringify(host)}, ${port})`, () =>
    hostConnectTcp(host, port),
  );
  return new StreamHandle(id);
}

