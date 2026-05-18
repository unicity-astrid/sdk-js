/**
 * Single error type for SDK operations. Mirrors `astrid_sdk::SysError` but
 * uses idiomatic JS throw/catch instead of `Result<T, E>` — see the plan's
 * "Error model" section for the rationale.
 */

export type SysErrorCode = "HostError" | "JsonError" | "ApiError";

export class SysError extends Error {
  override readonly name = "SysError";
  readonly code: SysErrorCode;

  constructor(code: SysErrorCode, message: string, options?: ErrorOptions) {
    super(`[${code}] ${message}`, options);
    this.code = code;
  }

  static host(message: string, cause?: unknown): SysError {
    return new SysError("HostError", message, cause === undefined ? undefined : { cause });
  }

  static json(message: string, cause?: unknown): SysError {
    return new SysError("JsonError", message, cause === undefined ? undefined : { cause });
  }

  static api(message: string, cause?: unknown): SysError {
    return new SysError("ApiError", message, cause === undefined ? undefined : { cause });
  }
}

/**
 * Wraps a synchronous host call, normalizing any thrown value into a
 * `SysError`. Host imports throw `string` (per WIT `result<_, string>`
 * semantics) which we convert to a structured error.
 */
export function callHost<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (raw) {
    if (raw instanceof SysError) throw raw;
    const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
    throw SysError.host(`${label}: ${message}`, raw);
  }
}
