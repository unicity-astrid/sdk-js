/**
 * Virtual filesystem — shape-compatible with `node:fs/promises` where it
 * makes sense, including a `Stats`-like object with `isFile()` /
 * `isDirectory()` methods.
 *
 * Path schemes follow VFS conventions (`workspace://`, `home://`, `tmp://`).
 * The kernel re-resolves and re-validates every path on every call;
 * {@link canonicalize} is for display / equality only, NOT a security check
 * that subsequent calls can rely on.
 *
 * The Rust SDK's surface is sync (`std::fs`); we expose async (`await`) to
 * match Node idioms even though the underlying host calls are synchronous.
 * StarlingMonkey syncifies awaits at the WASM boundary.
 */

import {
  fsOpen as hostOpen,
  fsExists as hostExists,
  fsMkdir as hostMkdir,
  fsMkdirAll as hostMkdirAll,
  fsReaddir as hostReaddir,
  fsStat as hostStat,
  fsStatSymlink as hostStatSymlink,
  fsUnlink as hostUnlink,
  readFile as hostReadFile,
  writeFile as hostWriteFile,
  fsAppend as hostAppend,
  fsCopy as hostCopy,
  fsRename as hostRename,
  fsRemoveDirAll as hostRemoveDirAll,
  fsCanonicalize as hostCanonicalize,
  fsReadLink as hostReadLink,
  fsHardLink as hostHardLink,
  type FileStat,
  type FileHandle as WitFileHandle,
  type OpenMode,
  type FileType,
} from "astrid:fs/host@1.0.0";
import { SysError, callHost } from "./errors.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export type { OpenMode, FileType } from "astrid:fs/host@1.0.0";

/**
 * Stat result. Shaped like Node's `fs.Stats` for the fields the Astrid VFS
 * surfaces. `size` is `bigint` (WIT `u64`); use `Number(size)` if you need a
 * regular number and you're sure it fits.
 */
export class Stats {
  readonly size: bigint;
  readonly mode: number;
  readonly kind: FileType;
  readonly mtimeMs: number | undefined;
  readonly birthtimeMs: number | undefined;
  readonly atimeMs: number | undefined;

  constructor(stat: FileStat) {
    this.size = stat.size;
    this.mode = stat.mode;
    this.kind = stat.kind;
    this.mtimeMs = datetimeToMs(stat.modified);
    this.birthtimeMs = datetimeToMs(stat.created);
    this.atimeMs = datetimeToMs(stat.accessed);
  }

  isFile(): boolean {
    return this.kind === "regular";
  }

  isDirectory(): boolean {
    return this.kind === "directory";
  }

  isSymbolicLink(): boolean {
    return this.kind === "symlink";
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
}

/**
 * Open file handle. Returned from {@link open}. The host releases the
 * underlying file descriptor automatically when the handle is dropped via
 * `Symbol.dispose` or `.close()`. Per-capsule cap: 16 open file handles.
 *
 * ```ts
 * using f = await fs.open("workspace://data.bin", "read-write");
 * await f.writeAt(0n, new TextEncoder().encode("hello"));
 * ```
 */
export class FileHandle {
  #inner: WitFileHandle | undefined;
  readonly path: string;

  constructor(inner: WitFileHandle, path: string) {
    this.#inner = inner;
    this.path = path;
  }

  /** Read up to `maxBytes` from `offset`. Empty result signals EOF at that offset. */
  async readAt(offset: bigint, maxBytes: number): Promise<Uint8Array> {
    return callHost(`fs.FileHandle.readAt(${quote(this.path)})`, () =>
      this.#requireInner().readAt(offset, maxBytes),
    );
  }

  /** Write `data` at `offset`. Returns bytes actually written. */
  async writeAt(offset: bigint, data: Uint8Array): Promise<number> {
    return callHost(`fs.FileHandle.writeAt(${quote(this.path)})`, () =>
      this.#requireInner().writeAt(offset, data),
    );
  }

  /** Flush buffered data (only) to disk — `fdatasync(2)`. */
  async syncData(): Promise<void> {
    callHost(`fs.FileHandle.syncData(${quote(this.path)})`, () =>
      this.#requireInner().syncData(),
    );
  }

  /** Flush both data and metadata to disk — `fsync(2)`. */
  async syncAll(): Promise<void> {
    callHost(`fs.FileHandle.syncAll(${quote(this.path)})`, () =>
      this.#requireInner().syncAll(),
    );
  }

  /** Race-free counterpart to {@link stat} on the path. */
  async stat(): Promise<Stats> {
    const raw = callHost(`fs.FileHandle.stat(${quote(this.path)})`, () =>
      this.#requireInner().stat(),
    );
    return new Stats(raw);
  }

  /** Truncate or extend the file to `size` bytes. Extending past end fills with zeros. */
  async setLen(size: bigint): Promise<void> {
    callHost(`fs.FileHandle.setLen(${quote(this.path)})`, () =>
      this.#requireInner().setLen(size),
    );
  }

  close(): void {
    if (this.#inner === undefined) return;
    const inner = this.#inner;
    this.#inner = undefined;
    try {
      inner[Symbol.dispose]();
    } catch {
      // Already disposed by the runtime; safe to ignore.
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #requireInner(): WitFileHandle {
    if (this.#inner === undefined) {
      throw SysError.api(`FileHandle ${quote(this.path)} is closed`);
    }
    return this.#inner;
  }
}

export interface ReadFileOptions {
  /** When set, decode bytes as a string with this encoding. */
  encoding?: "utf8";
}

export interface ReaddirOptions {
  /** When true, yields `Dirent` objects instead of bare name strings. */
  withFileTypes?: boolean;
}

/** Open a file by path. Required capability depends on `mode`. */
export async function open(path: string, mode: OpenMode): Promise<FileHandle> {
  const inner = callHost(`fs.open(${quote(path)})`, () => hostOpen(path, mode));
  return new FileHandle(inner, path);
}

export async function exists(path: string): Promise<boolean> {
  return callHost(`fs.exists(${quote(path)})`, () => hostExists(path));
}

export async function stat(path: string): Promise<Stats> {
  const raw = callHost(`fs.stat(${quote(path)})`, () => hostStat(path));
  return new Stats(raw);
}

/** Stat without following symlinks — `lstat(2)`. */
export async function lstat(path: string): Promise<Stats> {
  const raw = callHost(`fs.lstat(${quote(path)})`, () => hostStatSymlink(path));
  return new Stats(raw);
}

export async function readFile(
  path: string,
  options?: ReadFileOptions,
): Promise<Uint8Array | string> {
  const bytes = callHost(`fs.readFile(${quote(path)})`, () => hostReadFile(path));
  if (options?.encoding === "utf8") return decoder.decode(bytes);
  return bytes;
}

/** Read a file as UTF-8 text. */
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

/** Append `data` to a file, creating it if absent. */
export async function appendFile(path: string, data: string | Uint8Array): Promise<void> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  callHost(`fs.appendFile(${quote(path)})`, () => hostAppend(path, bytes));
}

/**
 * Create a directory. Mirrors `std::fs::create_dir` / `mkdir(2)` — strict.
 * Fails with `already-exists` if the path exists. Use {@link mkdirAll} for
 * idempotent "ensure-exists" semantics.
 */
export async function mkdir(path: string): Promise<void> {
  callHost(`fs.mkdir(${quote(path)})`, () => hostMkdir(path));
}

/** Create a directory and all missing parents. Idempotent. */
export async function mkdirAll(path: string): Promise<void> {
  callHost(`fs.mkdirAll(${quote(path)})`, () => hostMkdirAll(path));
}

/** Remove a file. Mirrors `fs.unlink` / `fs.rm` (file-only). */
export async function rm(path: string): Promise<void> {
  callHost(`fs.rm(${quote(path)})`, () => hostUnlink(path));
}

/** Alias for {@link rm} matching Node's `fs.unlink`. */
export const unlink = rm;

/**
 * Remove a directory and all its contents recursively. Refuses to traverse
 * symlinks to prevent sandbox escapes. Returns the count of removed entries.
 */
export async function removeDirAll(path: string): Promise<bigint> {
  return callHost(`fs.removeDirAll(${quote(path)})`, () => hostRemoveDirAll(path));
}

/** Copy a file from `src` to `dst`. Overwrites `dst`. */
export async function copy(src: string, dst: string): Promise<void> {
  callHost(`fs.copy(${quote(src)} -> ${quote(dst)})`, () => hostCopy(src, dst));
}

/** Rename (move) within the same VFS scheme. Cross-scheme returns `cross-vfs`. */
export async function rename(src: string, dst: string): Promise<void> {
  callHost(`fs.rename(${quote(src)} -> ${quote(dst)})`, () => hostRename(src, dst));
}

/**
 * Resolve a path to its canonical form, following symlinks. Returns a
 * VFS-scheme path, never a host real-path. NOT a TOCTOU-safe security check.
 */
export async function canonicalize(path: string): Promise<string> {
  return callHost(`fs.canonicalize(${quote(path)})`, () => hostCanonicalize(path));
}

/** Read a symlink target without following it. */
export async function readLink(path: string): Promise<string> {
  return callHost(`fs.readLink(${quote(path)})`, () => hostReadLink(path));
}

/** Create a hard link. Both endpoints must be in the same VFS scheme. */
export async function hardLink(src: string, linkPath: string): Promise<void> {
  callHost(`fs.hardLink(${quote(src)} -> ${quote(linkPath)})`, () =>
    hostHardLink(src, linkPath),
  );
}

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
 * Stream-style directory iteration. Mirrors `fs.opendir` / `Dir`. The VFS
 * resolves all entries in one host call, so the async-iterator is fully
 * populated up-front; the shape matches Node for compatibility.
 */
export async function opendir(path: string): Promise<AsyncIterableIterator<Dirent>> {
  const entries = await readdir(path, { withFileTypes: true });
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

function datetimeToMs(dt: FileStat["modified"]): number | undefined {
  if (dt === undefined) return undefined;
  return Number(dt.seconds) * 1000 + dt.nanoseconds / 1_000_000;
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}
