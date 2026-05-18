/**
 * Host process spawning. Mirrors `astrid_sdk::process`. Capsules need the
 * `host_process` capability for the specific command being invoked; the
 * kernel runs the process under platform sandboxing (sandbox-exec / bwrap).
 */

import {
  spawn as hostSpawn,
  spawnBackground as hostSpawnBackground,
  readLogs as hostReadLogs,
  kill as hostKill,
} from "astrid:capsule/process@0.1.0";
import { callHost } from "./errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  /** Negative exit codes indicate the process was killed or unknown. */
  exitCode: number;
}

export interface ProcessLogs {
  stdout: string;
  stderr: string;
  running: boolean;
  exitCode: number | undefined;
}

export interface KillResult {
  killed: boolean;
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
}

/** Spawn a process and block until it exits. */
export function spawn(cmd: string, args: string[] = []): ProcessResult {
  const result = callHost(`process.spawn(${JSON.stringify(cmd)})`, () =>
    hostSpawn({ cmd, args }),
  );
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

/** Spawn a background process. Returns an opaque handle. */
export function spawnBackground(cmd: string, args: string[] = []): BackgroundProcessHandle {
  const result = callHost(`process.spawnBackground(${JSON.stringify(cmd)})`, () =>
    hostSpawnBackground({ cmd, args }),
  );
  return new BackgroundProcessHandle(result.id);
}

export class BackgroundProcessHandle {
  readonly id: bigint;

  constructor(id: bigint) {
    this.id = id;
  }

  /** Drain buffered stdout/stderr since the last read. */
  readLogs(): ProcessLogs {
    const result = callHost(`process.readLogs(${this.id})`, () => hostReadLogs(this.id));
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      running: result.running,
      exitCode: result.exitCode,
    };
  }

  /** Kill the process and collect any remaining output. */
  kill(): KillResult {
    const result = callHost(`process.kill(${this.id})`, () => hostKill(this.id));
    return {
      killed: result.killed,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
