/**
 * Interactive user input during install/upgrade. Mirrors `astrid_sdk::elicit`.
 *
 * These functions are only callable from `@install` / `@upgrade` lifecycle
 * methods; calling them from a tool or interceptor returns a host error.
 * The host blocks the WASM thread until the frontend (TUI / CLI) collects
 * input and publishes a response, or the request times out (120s).
 */

import { elicit as hostElicit, hasSecret as hostHasSecret } from "astrid:capsule/elicit@0.1.0";
import { SysError, callHost } from "./errors.js";

function validateKey(key: string): void {
  if (key.trim() === "") {
    throw SysError.api("elicit key must not be empty");
  }
}

/**
 * Store a secret via the kernel's SecretStore. The capsule NEVER receives
 * the value back — verify via `hasSecret(key)` and dereference at runtime
 * by name.
 */
export function secret(key: string, description: string): void {
  validateKey(key);
  const respStr = callHost(`elicit.secret(${JSON.stringify(key)})`, () =>
    hostElicit({
      elicitType: "secret",
      key,
      description,
      options: undefined,
      defaultValue: undefined,
    }),
  );
  let resp: { ok?: boolean };
  try {
    resp = JSON.parse(respStr) as { ok?: boolean };
  } catch (err) {
    throw SysError.json(`elicit.secret: malformed host response: ${(err as Error).message}`, err);
  }
  if (resp.ok !== true) {
    throw SysError.api("kernel did not confirm secret storage");
  }
}

/** Check whether a secret with this key was previously stored. */
export function hasSecret(key: string): boolean {
  validateKey(key);
  return callHost(`elicit.hasSecret(${JSON.stringify(key)})`, () => hostHasSecret(key));
}

/** Prompt the user for a text value. */
export function text(key: string, description: string): string {
  return elicitText(key, description, undefined);
}

/** Prompt with a pre-filled default. */
export function textWithDefault(key: string, description: string, defaultValue: string): string {
  return elicitText(key, description, defaultValue);
}

/** Prompt for a selection from a list. */
export function select(key: string, description: string, options: string[]): string {
  validateKey(key);
  if (options.length === 0) {
    throw SysError.api("elicit.select requires at least one option");
  }
  const respStr = callHost(`elicit.select(${JSON.stringify(key)})`, () =>
    hostElicit({
      elicitType: "select",
      key,
      description,
      options,
      defaultValue: undefined,
    }),
  );
  const resp = parseStringResp("elicit.select", respStr);
  if (options.indexOf(resp) < 0) {
    throw SysError.api(
      `host returned value not in provided options: ${resp.slice(0, 64)}`,
    );
  }
  return resp;
}

/** Prompt for multiple text values. */
export function array(key: string, description: string): string[] {
  validateKey(key);
  const respStr = callHost(`elicit.array(${JSON.stringify(key)})`, () =>
    hostElicit({
      elicitType: "array",
      key,
      description,
      options: undefined,
      defaultValue: undefined,
    }),
  );
  let resp: { values?: string[] };
  try {
    resp = JSON.parse(respStr) as { values?: string[] };
  } catch (err) {
    throw SysError.json(`elicit.array: malformed host response: ${(err as Error).message}`, err);
  }
  if (!Array.isArray(resp.values)) {
    throw SysError.api(`elicit.array: host returned no values array`);
  }
  return resp.values;
}

function elicitText(key: string, description: string, defaultValue: string | undefined): string {
  validateKey(key);
  const respStr = callHost(`elicit.text(${JSON.stringify(key)})`, () =>
    hostElicit({
      elicitType: "text",
      key,
      description,
      options: undefined,
      defaultValue,
    }),
  );
  return parseStringResp("elicit.text", respStr);
}

function parseStringResp(label: string, raw: string): string {
  let resp: { value?: string };
  try {
    resp = JSON.parse(raw) as { value?: string };
  } catch (err) {
    throw SysError.json(`${label}: malformed host response: ${(err as Error).message}`, err);
  }
  if (typeof resp.value !== "string") {
    throw SysError.api(`${label}: host returned no value field`);
  }
  return resp.value;
}
