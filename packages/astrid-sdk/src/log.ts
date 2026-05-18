/**
 * Structured logging — mirrors `astrid_sdk::log`. Levels match the WIT
 * `log-level` enum exactly. Messages are coerced to string via the host
 * call. Infallible: the host `log()` function returns void.
 *
 * Deliberate non-feature: this module does NOT override `globalThis.console`.
 * The embedded JS engine may already wire `console` to its own sink (or to
 * `wasi:cli/stderr`), and shadowing risks capturing engine-internal log lines.
 * Users who want `console.log` to flow through Astrid must explicitly forward
 * to one of these functions.
 */

import { log as hostLog } from "astrid:capsule/sys@0.1.0";

export function trace(message: unknown): void {
  hostLog({ tag: "trace" }, format(message));
}

export function debug(message: unknown): void {
  hostLog({ tag: "debug" }, format(message));
}

export function info(message: unknown): void {
  hostLog({ tag: "info" }, format(message));
}

export function warn(message: unknown): void {
  hostLog({ tag: "warn" }, format(message));
}

export function error(message: unknown): void {
  hostLog({ tag: "error" }, format(message));
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
