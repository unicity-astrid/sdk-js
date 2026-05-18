/**
 * Key-value persistent storage. Phase 1 surface: bytes I/O, JSON helpers,
 * delete/listKeys/clearPrefix. Versioned KV envelope helpers land in Phase 2.
 *
 * Mirrors `astrid_sdk::kv` semantics. Keys are scoped per-capsule/principal
 * by the host; the guest sees an isolated namespace.
 */

import {
  kvGet as hostGet,
  kvSet as hostSet,
  kvDelete as hostDelete,
  kvListKeys as hostListKeys,
  kvClearPrefix as hostClearPrefix,
} from "astrid:capsule/kv@0.1.0";
import { SysError, callHost } from "./errors.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export function clearPrefix(prefix: string): bigint {
  return callHost(`kv.clearPrefix(${quote(prefix)})`, () => hostClearPrefix(prefix));
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
