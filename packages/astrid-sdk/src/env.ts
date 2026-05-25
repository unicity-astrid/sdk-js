/**
 * Capsule configuration — Astrid's equivalent of environment variables.
 * Mirrors `astrid_sdk::env`. Values are injected by the kernel at load time
 * from `Capsule.toml [env]` entries.
 *
 * Per the per-domain WIT split, `get-config` now returns `option<string>` so
 * the caller can distinguish "key not set" from "key explicitly set to empty
 * string". The wrapper preserves that distinction via {@link tryGet}; {@link get}
 * collapses `none` to `""` for the std::env::var-style ergonomic case.
 */

import { getConfig } from "astrid:sys/host@1.0.0";
import { callHost } from "./errors.js";

/** Well-known config key carrying the kernel's Unix domain socket path. */
export const CONFIG_SOCKET_PATH = "ASTRID_SOCKET_PATH";

/** Read a config value. Returns `""` if the key is not set. */
export function get(key: string): string {
  return tryGet(key) ?? "";
}

/** Read a config value or `undefined` if not set. */
export function tryGet(key: string): string | undefined {
  return callHost(`env.get(${JSON.stringify(key)})`, () => getConfig(key));
}

/** Read a config value as bytes. */
export function getBytes(key: string): Uint8Array {
  return new TextEncoder().encode(get(key));
}
