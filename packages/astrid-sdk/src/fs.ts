/**
 * Virtual filesystem — shape-compatible with `node:fs/promises` where it
 * makes sense, including a `Stats`-like object with `isFile()` /
 * `isDirectory()` methods.
 *
 * The Astrid VFS uses UTF-8 path strings throughout. Path schemes:
 *
 *   cwd://path   → capsule's workspace root (overlay; writes are staged)
 *   home://path  → the invoking agent's home dir (per-invocation principal)
 *   /tmp/path    → invoking agent's transient tmp directory
 *   anything else → workspace-relative
 *
 * The Rust SDK's surface is sync (`std::fs`); we expose async (`await`) to
 * match Node idioms even though the underlying host calls are synchronous.
 * StarlingMonkey syncifies awaits at the WASM boundary.
 */

import {
  fsExists as hostExists,
  fsMkdir as hostMkdir,
  fsReaddir as hostReaddir,
  fsStat as hostStat,
  fsUnlink as hostUnlink,
  readFile as hostReadFile,
  writeFile as hostWriteFile,
  type FileStat,
} from "astrid:capsule/fs@0.1.0";
import { SysError, callHost } from "./errors.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Stat result. Shaped like Node's `fs.Stats` for the fields the Astrid
 * VFS surfaces. Size is `bigint` (WIT `u64`); use `Number(size)` if you
 * need a regular number and you're sure it fits.
 */
export class Stats {
  readonly size: bigint;
  readonly mtimeMs: number | undefined;
  readonly #isDir: boolean;

  constructor(stat: FileStat) {
    this.size = stat.size;
    this.#isDir = stat.isDir;
    this.mtimeMs = stat.mtime === undefined ? undefined : Number(stat.mtime) * 1000;
  }

  isFile(): boolean {
    return !this.#isDir;
  }

  isDirectory(): boolean {
    return this.#isDir;
  }

  isEmpty(): boolean {
    return this.size === 0n;
  }
}

/** Directory entry returned by `readdir({ withFileTypes: true })`. */
export class Dirent {
  readonly name: string;
  readonly path: string;
  readonly parentPath: string;

  constructor(parentPath: string, name: string) {
    this.name = name;
    this.parentPath = parentPath;
    this.path = parentPath.endsWith("/") ? parentPath + name : `${parentPath}/${name}`;
  }

  /**
   * Per-entry isFile/isDirectory are NOT available without a host stat
   * call per entry — the WIT contract returns names only. Use
   * `await fs.stat(dirent.path)` when needed.
   */
}

export interface ReadFileOptions {
  /** When set, decode bytes as a string with this encoding. */
  encoding?: "utf8";
}

export interface ReaddirOptions {
  /** When true, yields `Dirent` objects instead of bare name strings. */
  withFileTypes?: boolean;
}

export async function exists(path: string): Promise<boolean> {
  return callHost(`fs.exists(${quote(path)})`, () => hostExists(path));
}

export async function stat(path: string): Promise<Stats> {
  const raw = callHost(`fs.stat(${quote(path)})`, () => hostStat(path));
  return new Stats(raw);
}

export async function readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array | string> {
  const bytes = callHost(`fs.readFile(${quote(path)})`, () => hostReadFile(path));
  if (options?.encoding === "utf8") return decoder.decode(bytes);
  return bytes;
}

/** Read a file as UTF-8 text. Equivalent to `await readFile(path, { encoding: "utf8" })`. */
export async function readTextFile(path: string): Promise<string> {
  const bytes = callHost(`fs.readTextFile(${quote(path)})`, () => hostReadFile(path));
  try {
    return decoder.decode(bytes);
  } catch (err) {
    throw SysError.api(`fs.readTextFile(${quote(path)}): ${(err as Error).message}`, err);
  }
}

export async function writeFile(path: string, data: string | Uint8Array): Promise<void> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  callHost(`fs.writeFile(${quote(path)})`, () => hostWriteFile(path, bytes));
}

export async function mkdir(path: string): Promise<void> {
  callHost(`fs.mkdir(${quote(path)})`, () => hostMkdir(path));
}

/** Remove a file. Mirrors `fs.unlink` / `fs.rm` (file-only). */
export async function rm(path: string): Promise<void> {
  callHost(`fs.rm(${quote(path)})`, () => hostUnlink(path));
}

/** Alias for {@link rm} matching Node's `fs.unlink`. */
export const unlink = rm;

/**
 * Read directory entries. Returns string[] by default to match
 * `fs.readdir(path)`; pass `{ withFileTypes: true }` for `Dirent[]`.
 */
export async function readdir(path: string): Promise<string[]>;
export async function readdir(
  path: string,
  options: { withFileTypes: true },
): Promise<Dirent[]>;
export async function readdir(
  path: string,
  options?: ReaddirOptions,
): Promise<string[] | Dirent[]> {
  const names = callHost(`fs.readdir(${quote(path)})`, () => hostReaddir(path));
  if (options?.withFileTypes) {
    return names.map((n) => new Dirent(path, n));
  }
  return names;
}

/**
 * Stream-style directory iteration. Mirrors `fs.opendir` / `Dir`. The
 * Astrid VFS resolves all entries in one host call, so the async-iterator
 * is fully populated up-front; the API shape matches Node for code that
 * already uses `for await (const ent of dir)`.
 */
export async function opendir(path: string): Promise<AsyncIterableIterator<Dirent>> {
  const entries = (await readdir(path, { withFileTypes: true }));
  let i = 0;
  const iter: AsyncIterableIterator<Dirent> = {
    [Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
      return iter;
    },
    async next(): Promise<IteratorResult<Dirent>> {
      if (i >= entries.length) {
        return { value: undefined as unknown as Dirent, done: true };
      }
      return { value: entries[i++]!, done: false };
    },
    async return(): Promise<IteratorResult<Dirent>> {
      i = entries.length;
      return { value: undefined as unknown as Dirent, done: true };
    },
  };
  return iter;
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
