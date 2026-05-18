/**
 * Wall-clock time — mirrors `astrid_sdk::time`.
 *
 * The WASM guest has no direct access to the system clock; all time
 * comes through `clockMs`. The host returns ms since UNIX epoch as a
 * bigint (WIT `u64`). We return a `Date` because that's the JS-native
 * representation.
 */

import { clockMs } from "astrid:capsule/sys@0.1.0";
import { callHost } from "./errors.js";

/** Current wall-clock time as a JS `Date`. */
export function now(): Date {
  const ms = callHost("time.now", () => clockMs());
  return new Date(Number(ms));
}

/** Current wall-clock time as a bigint of milliseconds since UNIX epoch. */
export function nowMs(): bigint {
  return callHost("time.nowMs", () => clockMs());
}
