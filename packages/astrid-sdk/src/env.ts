/**
 * Capsule configuration — Astrid's equivalent of environment variables.
 * Mirrors `astrid_sdk::env`. Values are injected by the kernel at load
 * time from `Capsule.toml [env]` entries.
 */

import { getConfig } from "astrid:capsule/sys@0.1.0";
import { callHost } from "./errors.js";

/** Well-known config key carrying the kernel's Unix domain socket path. */
export const CONFIG_SOCKET_PATH = "ASTRID_SOCKET_PATH";

/** Read a config value. Returns `""` if the key is not set. Mirrors `std::env::var`. */
export function get(key: string): string {
  return callHost(`env.get(${JSON.stringify(key)})`, () => getConfig(key));
}

/** Read a config value as bytes. Mirrors `std::env::var_os`. */
export function getBytes(key: string): Uint8Array {
  return new TextEncoder().encode(get(key));
}
