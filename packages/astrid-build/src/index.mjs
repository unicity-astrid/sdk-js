#!/usr/bin/env node
/**
 * Astrid JS/TS capsule build orchestrator.
 *
 * Invoked by `core/crates/astrid-build/src/js.rs`. Reads a project
 * directory, produces a wasm32-wasip2 component.
 *
 * Pipeline:
 *   1. Read package.json metadata (name, version, main / source entry).
 *   2. tsc compile the project (if tsconfig.json present).
 *   3. Resolve the SDK's `wit/` directory so componentize sees astrid-capsule.wit.
 *   4. Emit gen/_entry.mjs: imports the user's compiled entry (decorators
 *      fire), constructs the bridge, re-exports the four WIT export names.
 *   5. Bundle gen/_entry.mjs (resolves @astrid-os/sdk into the bundle so
 *      componentize sees one self-contained ESM file).
 *   6. Invoke ComponentizeJS programmatic API.
 *   7. Write the .wasm to the requested output path.
 *
 * CLI: `astrid-js-build <project-dir> --out <wasm-path>`
 */

import { componentize } from "@bytecodealliance/componentize-js";
import * as esbuild from "esbuild";
import { codegenWitEvents } from "./wit-codegen.mjs";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK_PKG_DIR = resolve(HERE, "..", "..", "astrid-sdk");
// Canonical host ABI lives in the unicity-astrid/wit submodule (mounted at
// repo-root/contracts/). The SDK no longer ships its own copy of
// astrid-capsule.wit — it reads directly from the submodule.
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const CANONICAL_WIT_DIR = resolve(REPO_ROOT, "contracts", "host");

function die(msg) {
  console.error(`astrid-js-build: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length < 1) die("usage: astrid-js-build <project-dir> [--out <wasm-path>]");
  const projectDir = resolve(argv[0]);
  let out;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--out" && i + 1 < argv.length) {
      out = resolve(argv[++i]);
    } else {
      die(`unknown argument: ${argv[i]}`);
    }
  }
  return { projectDir, out };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    die(`failed to read ${path}: ${err.message}`);
  }
}

async function resolveProjectMetadata(projectDir) {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) die(`no package.json at ${pkgPath}`);
  const pkg = await readJson(pkgPath);
  if (typeof pkg.name !== "string" || pkg.name.length === 0) {
    die("package.json must have a non-empty 'name'");
  }
  return { name: pkg.name, version: pkg.version ?? "0.0.0", pkg };
}

function compileTypeScript(projectDir) {
  const tsconfigPath = join(projectDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    console.log("astrid-js-build: no tsconfig.json — skipping tsc compile");
    return null;
  }
  // Use tsc CLI for full project-references support. The programmatic API
  // would require us to re-implement project references; the CLI is the
  // contract-tested path.
  const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tscBin, "-p", projectDir], { stdio: "inherit" });
  if (result.status !== 0) die("tsc failed");
  // Read tsconfig to find outDir.
  const raw = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (raw.error) die(`tsconfig parse error: ${raw.error.messageText}`);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, projectDir);
  return parsed.options.outDir ?? join(projectDir, "dist");
}

function resolveEntry(projectDir, outDir) {
  // Prefer compiled JS in outDir; fall back to package.json main.
  const candidates = [
    outDir ? join(outDir, "index.js") : undefined,
    join(projectDir, "dist", "index.js"),
    join(projectDir, "index.js"),
    join(projectDir, "index.mjs"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  die("could not locate compiled entry. Expected dist/index.js after tsc or index.js/.mjs at project root.");
}

function resolveSdkRuntime() {
  const candidate = join(SDK_PKG_DIR, "dist", "runtime", "index.js");
  if (!existsSync(candidate)) {
    die(
      `SDK runtime not found at ${candidate}. ` +
        `Build @astrid-os/sdk first (npx tsc -b packages/astrid-sdk in the workspace root).`,
    );
  }
  return candidate;
}

async function emitEntry(projectDir, userEntry) {
  const genDir = join(projectDir, "gen");
  await mkdir(genDir, { recursive: true });
  const entryPath = join(genDir, "_entry.src.mjs");

  // ComponentizeJS's splicer rejects file:// URL imports — it treats the
  // entire URL as a relative path. Use POSIX-style relative paths instead.
  const userEntryRel = posixRelative(genDir, userEntry);
  const sdkRuntimeRel = posixRelative(genDir, resolveSdkRuntime());

  const entrySource = `// Auto-generated by @astrid-os/build. Do not edit by hand.
//
// This file gets bundled with esbuild before componentize. Importing the
// user module fires the @capsule / @tool / @install / @upgrade decorators,
// which populate the SDK registry. We then build the bridge and re-export
// the four WIT-required guest export names.

import "${userEntryRel}";
import { createBridge } from "${sdkRuntimeRel}";

const bridge = createBridge();

export function astridHookTrigger(action, payload) {
  return bridge.astridHookTrigger(action, payload);
}

export function run() {
  bridge.run();
}

export function astridInstall() {
  bridge.astridInstall();
}

export function astridUpgrade() {
  bridge.astridUpgrade();
}
`;
  await writeFile(entryPath, entrySource);
  return entryPath;
}

/**
 * Bundle the generated entry into a single ESM file. ComponentizeJS can't
 * resolve bare-specifier imports (`@astrid-os/sdk`); esbuild inlines
 * everything except the WIT-resolved `astrid:capsule/*` imports.
 */
async function bundle(entryPath, projectDir) {
  const genDir = dirname(entryPath);
  const bundlePath = join(genDir, "_entry.mjs");
  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: bundlePath,
    // Mark WIT module specifiers as external so esbuild doesn't try to
    // resolve them — ComponentizeJS owns those imports.
    external: ["astrid:*"],
    // Working dir resolution: esbuild needs to look in the project's
    // node_modules to find @astrid-os/sdk via the workspace symlink.
    absWorkingDir: projectDir,
    // Conditional exports: prefer ESM for everything.
    conditions: ["import", "module", "node"],
    // Don't minify — we want readable error messages during development.
    // Componentize will be the one stripping for size.
    minify: false,
    sourcemap: false,
  });
  return bundlePath;
}

function resolveWitPath() {
  // Read straight from the canonical `unicity-astrid/wit` submodule.
  // The kernel side (cargo-published `astrid-sys` crate) also has to keep
  // an in-tree copy because `cargo package` only bundles files inside the
  // crate dir — but the JS SDK has no such constraint, so we consume the
  // submodule directly and skip the drift surface entirely.
  if (!existsSync(join(CANONICAL_WIT_DIR, "astrid-capsule.wit"))) {
    die(
      `canonical host WIT missing at ${CANONICAL_WIT_DIR}/astrid-capsule.wit. ` +
        `Run 'git submodule update --init --recursive' from the sdk-js repo root.`,
    );
  }
  return CANONICAL_WIT_DIR;
}

async function runComponentize(entryPath, outPath) {
  const witPath = resolveWitPath();
  const t0 = performance.now();
  const { component, imports } = await componentize({
    sourcePath: entryPath,
    witPath,
    worldName: "capsule",
    // Phase 0 finding: ALL features must be disabled to avoid pulling in
    // WASI 0.2 imports the Astrid kernel doesn't satisfy.
    disableFeatures: ["stdio", "random", "clocks", "http", "fetch-event"],
  });
  const elapsedMs = performance.now() - t0;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, component);
  const info = await stat(outPath);
  return {
    bytes: info.size,
    componentizeSec: (elapsedMs / 1000).toFixed(2),
    importCount: imports.length,
  };
}

async function main() {
  const { projectDir, out } = parseArgs(process.argv.slice(2));
  if (!existsSync(projectDir)) die(`project directory does not exist: ${projectDir}`);

  const { name } = await resolveProjectMetadata(projectDir);
  const outPath = out ?? join(projectDir, "target", `${name}.wasm`);

  // WIT events codegen runs BEFORE tsc so the generated .d.ts files are
  // visible during type-checking. Idempotent: if there's no wit/ dir,
  // returns { files: 0, types: 0 } and skips the work.
  const witResult = await codegenWitEvents(projectDir);
  if (witResult.files > 0) {
    console.log(
      `astrid-js-build: wit-events emitted ${witResult.types} type(s) from ${witResult.files} file(s)`,
    );
  }

  const outDir = compileTypeScript(projectDir);
  const userEntry = resolveEntry(projectDir, outDir);
  console.log(`astrid-js-build: user entry = ${userEntry}`);
  const entrySrcPath = await emitEntry(projectDir, userEntry);
  console.log(`astrid-js-build: generated entry = ${entrySrcPath}`);
  const bundledPath = await bundle(entrySrcPath, projectDir);
  console.log(`astrid-js-build: bundled = ${bundledPath}`);
  console.log("astrid-js-build: running componentize-js...");
  const result = await runComponentize(bundledPath, outPath);
  console.log(
    `astrid-js-build: wrote ${outPath} (${(result.bytes / 1024 / 1024).toFixed(2)} MB, ${result.componentizeSec}s, ${result.importCount} host imports)`,
  );
  // The kernel-side Rust caller can parse this JSON for the binary path
  // without scraping logs.
  console.log(
    `astrid-js-build-result: ${JSON.stringify({ wasmPath: outPath, bytes: result.bytes })}`,
  );
}

function posixRelative(fromDir, toFile) {
  let rel = relative(fromDir, toFile);
  if (sep !== "/") rel = rel.split(sep).join("/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

main().catch((err) => {
  console.error("astrid-js-build: FAILED");
  console.error(err?.stack ?? err);
  process.exit(1);
});
