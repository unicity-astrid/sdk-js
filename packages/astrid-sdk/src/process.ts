/**
 * Host process spawning. Mirrors `astrid_sdk::process`. Capsules need the
 * `host_process` capability for the specific command being invoked; the
 * kernel runs the process under platform sandboxing (sandbox-exec on macOS,
 * bwrap on Linux).
 *
 * Per-capsule cap: 8 concurrent background processes. `ProcessHandle` is a
 * Component Model resource — drop releases the slot and reaps the child.
 *
 * **Desktop-kernel only.** Unikernel targets (hermit-rs, etc.) do not implement
 * this package; capsules importing `astrid:process` will fail to load there.
 */

import {
  spawn as hostSpawn,
  spawnBackground as hostSpawnBackground,
  type ProcessHandle as WitProcessHandle,
  type ProcessSignal,
  type SpawnRequest,
  type ExitInfo,
} from "astrid:process/host@1.0.0";
import { SysError, callHost } from "./errors.js";

export type { ProcessSignal, EnvVar } from "astrid:process/host@1.0.0";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  /** Exit code if exited normally; `undefined` if killed by signal. */
  exitCode: number | undefined;
  /** Unix signal number if killed by signal; `undefined` otherwise. */
  signal: number | undefined;
}

export interface ProcessLogs {
  stdout: string;
  stderr: string;
  running: boolean;
  exitCode: number | undefined;
  signal: number | undefined;
}

export interface KillResult {
  killed: boolean;
  exitCode: number | undefined;
  signal: number | undefined;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  /** Working directory relative to the workspace. */
  cwd?: string;
  /** Environment variables to pass to the child. */
  env?: Record<string, string>;
  /** Stdin bytes piped to the child on spawn. */
  stdin?: Uint8Array;
}

function buildSpawnRequest(
  cmd: string,
  args: string[],
  options: SpawnOptions | undefined,
): SpawnRequest {
  return {
    cmd,
    args,
    stdin: options?.stdin,
    env: options?.env
      ? Object.entries(options.env).map(([key, value]) => ({ key, value }))
      : [],
    cwd: options?.cwd,
  };
}

function unpackExit(exit: ExitInfo): { exitCode: number | undefined; signal: number | undefined } {
  return { exitCode: exit.exitCode, signal: exit.signal };
}

/** Spawn a process and block until it exits. */
export function spawn(
  cmd: string,
  args: string[] = [],
  options?: SpawnOptions,
): ProcessResult {
  const request = buildSpawnRequest(cmd, args, options);
  const result = callHost(`process.spawn(${JSON.stringify(cmd)})`, () =>
    hostSpawn(request),
  );
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    ...unpackExit(result.exit),
  };
}

/** Spawn a background process. Returns a resource handle. */
export function spawnBackground(
  cmd: string,
  args: string[] = [],
  options?: SpawnOptions,
): BackgroundProcessHandle {
  const request = buildSpawnRequest(cmd, args, options);
  const inner = callHost(`process.spawnBackground(${JSON.stringify(cmd)})`, () =>
    hostSpawnBackground(request),
  );
  return new BackgroundProcessHandle(inner);
}

export class BackgroundProcessHandle {
  #inner: WitProcessHandle | undefined;

  constructor(inner: WitProcessHandle) {
    this.#inner = inner;
  }

  /** Drain buffered stdout/stderr since the last read. */
  readLogs(): ProcessLogs {
    const result = callHost("process.readLogs", () => this.#requireInner().readLogs());
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      running: result.running,
      exitCode: result.exit?.exitCode,
      signal: result.exit?.signal,
    };
  }

  /** Write to stdin. Returns bytes actually written. */
  writeStdin(data: Uint8Array): number {
    return callHost("process.writeStdin", () => this.#requireInner().writeStdin(data));
  }

  /** Close the stdin pipe (child observes EOF). */
  closeStdin(): void {
    callHost("process.closeStdin", () => this.#requireInner().closeStdin());
  }

  /** Send a signal (fire-and-forget). Use {@link kill} for SIGKILL + log drainage. */
  signal(sig: ProcessSignal): void {
    callHost(`process.signal(${sig})`, () => this.#requireInner().signal(sig));
  }

  /** Send SIGKILL and drain remaining output. */
  kill(): KillResult {
    const result = callHost("process.kill", () => this.#requireInner().kill());
    return {
      killed: result.killed,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exit?.exitCode,
      signal: result.exit?.signal,
    };
  }

  /**
   * Wait for the process to exit. `timeoutMs = undefined` waits indefinitely;
   * a bounded value throws `wait-timeout` if the timeout elapses first.
   */
  wait(timeoutMs?: number): { exitCode: number | undefined; signal: number | undefined } {
    const ms = timeoutMs === undefined ? undefined : BigInt(Math.max(0, Math.floor(timeoutMs)));
    const exit = callHost(`process.wait(${timeoutMs ?? "∞"})`, () =>
      this.#requireInner().wait(ms),
    );
    return unpackExit(exit);
  }

  /** Wait for the process AND drain remaining stdout/stderr atomically. */
  waitWithOutput(timeoutMs?: number): ProcessResult {
    const ms = timeoutMs === undefined ? undefined : BigInt(Math.max(0, Math.floor(timeoutMs)));
    const result = callHost(`process.waitWithOutput(${timeoutMs ?? "∞"})`, () =>
      this.#requireInner().waitWithOutput(ms),
    );
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      ...unpackExit(result.exit),
    };
  }

  /** OS-level PID. Throws if the process has already been reaped. */
  osPid(): number {
    return callHost("process.osPid", () => this.#requireInner().osPid());
  }

  close(): void {
    if (this.#inner === undefined) return;
    const inner = this.#inner;
    this.#inner = undefined;
    try {
      inner[Symbol.dispose]();
    } catch {
      // already released
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #requireInner(): WitProcessHandle {
    if (this.#inner === undefined) throw SysError.api("ProcessHandle is closed");
    return this.#inner;
  }
}
