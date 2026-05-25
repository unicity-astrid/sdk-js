/**
 * Unified error type for SDK operations. Mirrors `astrid_sdk::SysError` but
 * uses idiomatic JS throw/catch instead of `Result<T, E>`.
 *
 * Post per-domain-WIT migration, every fallible host call returns a typed
 * `result<T, error-code>` where `error-code` is a domain-specific variant
 * (e.g. `astrid:fs/host.error-code`, `astrid:ipc/host.error-code`).
 * ComponentizeJS rejects with `{ tag, val? }` objects on the error arm. We
 * preserve the variant tag on `SysError.code` so downstream code can branch
 * on `if (err.code === "quota") ...` without losing the typed kind. The
 * raw payload (the unpacked variant value, if any) survives on `err.payload`
 * for the few callers that need it.
 *
 * The three legacy origin tags — `HostError`, `JsonError`, `ApiError` —
 * remain on `SysError.kind` for source compatibility. Code that previously
 * checked `err.code` for "HostError" should migrate to `err.kind` because
 * `err.code` now carries the WIT variant tag.
 */

export type SysErrorKind = "HostError" | "JsonError" | "ApiError";

export class SysError extends Error {
  override readonly name = "SysError";
  /** Legacy classification: where the error originated. */
  readonly kind: SysErrorKind;
  /** Typed WIT variant tag (e.g. "quota", "capability-denied", "timeout").
   *  `undefined` for SDK-internal errors that didn't come from the host. */
  readonly code: string | undefined;
  /** Raw unpacked WIT variant payload, when present. */
  readonly payload: unknown;

  constructor(
    kind: SysErrorKind,
    message: string,
    options?: ErrorOptions & { code?: string; payload?: unknown },
  ) {
    super(`[${kind}${options?.code ? `:${options.code}` : ""}] ${message}`, options);
    this.kind = kind;
    this.code = options?.code;
    this.payload = options?.payload;
  }

  static host(
    message: string,
    cause?: unknown,
    code?: string,
    payload?: unknown,
  ): SysError {
    const opts: ErrorOptions & { code?: string; payload?: unknown } = {};
    if (cause !== undefined) opts.cause = cause;
    if (code !== undefined) opts.code = code;
    if (payload !== undefined) opts.payload = payload;
    return new SysError("HostError", message, opts);
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
 * `SysError`. After the per-domain WIT split, host imports throw
 * `{ tag, val? }` objects representing the typed error-code variant.
 * We unpack the tag onto `SysError.code` so capsule authors can branch
 * on the WIT variant by name. The raw payload (the unpacked `val`, if any)
 * survives on `SysError.payload` for callers that need it.
 */
export function callHost<T>(label: string, fn: () => T): T {
  try {
    return fn();
  } catch (raw) {
    if (raw instanceof SysError) throw raw;
    const wit = extractWitError(raw);
    if (wit !== undefined) {
      throw SysError.host(`${label}: ${wit.message}`, raw, wit.code, wit.payload);
    }
    const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
    throw SysError.host(`${label}: ${message}`, raw);
  }
}

interface WitErrorView {
  code: string;
  message: string;
  payload: unknown;
}

/**
 * Componentize-js rejects fallible host calls with `{ tag, val? }` shapes
 * (the unpacked variant of `result<T, error-code>`). Strings or numbers
 * occasionally surface for trap-style failures. This helper produces a
 * uniform view of the variant for `callHost` to convert into `SysError`.
 */
function extractWitError(raw: unknown): WitErrorView | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r["tag"] !== "string") return undefined;
  const code = r["tag"];
  const val = r["val"];
  let message: string;
  if (typeof val === "string") {
    message = `${code}: ${val}`;
  } else if (val === undefined) {
    message = code;
  } else {
    message = `${code}: ${safeStringify(val)}`;
  }
  return { code, message, payload: val };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
