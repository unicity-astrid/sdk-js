/**
 * Key-value persistent storage. Mirrors `astrid_sdk::kv` semantics.
 *
 * Keys are scoped per-(principal, capsule). Each capsule sees an isolated
 * namespace. Keys are UTF-8 NFC strings (max 256 bytes); values are arbitrary
 * bytes (max 1 MiB per value). Per-(principal, capsule) cumulative quota is
 * bounded; exceeding it returns `quota` from the host.
 */

import {
  kvGet as hostGet,
  kvSet as hostSet,
  kvDelete as hostDelete,
  kvListKeys as hostListKeys,
  kvListKeysPage as hostListKeysPage,
  kvClearPrefix as hostClearPrefix,
  kvCas as hostCas,
} from "astrid:kv/host@1.0.0";
import { SysError, callHost } from "./errors.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface KeyPage {
  keys: string[];
  /** Pass back to {@link listKeysPage} for the next page. `undefined` on the last page. */
  nextCursor: string | undefined;
}

export function getBytes(key: string): Uint8Array | undefined {
  return callHost(`kv.getBytes(${quote(key)})`, () => hostGet(key));
}

export function setBytes(key: string, value: Uint8Array): void {
  callHost(`kv.setBytes(${quote(key)})`, () => hostSet(key, value));
}

export function has(key: string): boolean {
  return getBytes(key) !== undefined;
}

export function get<T = unknown>(key: string): T | undefined {
  const bytes = getBytes(key);
  if (bytes === undefined || bytes.length === 0) return undefined;
  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch (err) {
    throw SysError.json(`kv.get(${quote(key)}): ${(err as Error).message}`, err);
  }
}

export function set<T>(key: string, value: T): void {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch (err) {
    throw SysError.json(`kv.set(${quote(key)}): ${(err as Error).message}`, err);
  }
  setBytes(key, encoder.encode(json));
}

/** Idempotent: deleting a non-existent key succeeds silently. */
export function del(key: string): void {
  callHost(`kv.delete(${quote(key)})`, () => hostDelete(key));
}

export function listKeys(prefix: string): string[] {
  return callHost(`kv.listKeys(${quote(prefix)})`, () => hostListKeys(prefix));
}

/**
 * Paginated key listing for unbounded stores. Pass `undefined` cursor on the
 * first call and the `nextCursor` from the previous page on subsequent calls.
 * `limit` is capped at 1024 per page; 0 means "use the server default".
 */
export function listKeysPage(
  prefix: string,
  cursor: string | undefined,
  limit: number = 0,
): KeyPage {
  return callHost(`kv.listKeysPage(${quote(prefix)})`, () =>
    hostListKeysPage(prefix, cursor, limit),
  );
}

export function clearPrefix(prefix: string): bigint {
  return callHost(`kv.clearPrefix(${quote(prefix)})`, () => hostClearPrefix(prefix));
}

/**
 * Atomic compare-and-swap. If the current value for `key` equals `expected`,
 * write `newValue` and return `true`. Otherwise leave the store unchanged and
 * return `false`. `expected = undefined` means "swap only if the key does not
 * currently exist" (create-if-absent).
 *
 * Required for any concurrent coordination on shared state — the kernel runs
 * capsule invocations across a multi-threaded worker pool so naive RMW
 * patterns race.
 */
export function cas(
  key: string,
  expected: Uint8Array | undefined,
  newValue: Uint8Array,
): boolean {
  return callHost(`kv.cas(${quote(key)})`, () => hostCas(key, expected, newValue));
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
