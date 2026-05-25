#!/usr/bin/env bash
# Sync packages/astrid-build/wit-staging/host/*.wit from the canonical
# unicity-astrid/wit submodule (at contracts/host/*.wit).
#
# Sibling of sync-contracts-wit.sh, but for the build package's needs
# rather than the SDK package's. Two different consumers, two different
# bundling shapes:
#
#   - packages/astrid-sdk/wit-contracts/astrid-contracts.wit (single
#     bundled file) drives codegenWitEvents — TypeScript types for the
#     event/contract surface from `astrid:contracts` package.
#
#   - packages/astrid-build/wit-staging/host/*.wit (per-domain layout,
#     one file per package) is what componentize-js reads to wire up
#     host imports for each capsule build. Same per-domain layout as
#     the canonical submodule.
#
# Why this exists: the npm tarball can only include files inside the
# package directory. When @unicity-astrid/build is consumed from the
# registry (not a workspace `file:` link), the canonical
# contracts/host/ submodule isn't available on the consumer's machine.
# Shipping a committed copy inside the package solves that.
#
# Drift detection: `sync-build-wit.sh --check` confirms wit-staging/host
# matches contracts/host. Run in CI.
#
# Usage:        scripts/sync-build-wit.sh
# Verify only:  scripts/sync-build-wit.sh --check

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/contracts/host"
DST_DIR="$ROOT/packages/astrid-build/wit-staging/host"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "sync-build-wit: source dir not found: $SRC_DIR" >&2
  echo "sync-build-wit: did you forget 'git submodule update --init'?" >&2
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  cp "$SRC_DIR"/*.wit "$tmp/"
  if ! diff -rq "$tmp" "$DST_DIR" >/dev/null 2>&1; then
    echo "sync-build-wit: $DST_DIR is out of sync with $SRC_DIR" >&2
    echo "sync-build-wit: run scripts/sync-build-wit.sh to fix" >&2
    diff -r "$tmp" "$DST_DIR" >&2 || true
    exit 1
  fi
  echo "sync-build-wit: in sync"
  exit 0
fi

mkdir -p "$DST_DIR"
# Sync exactly: copy all .wit, then remove any stale files in DST that
# the canonical source no longer has.
cp "$SRC_DIR"/*.wit "$DST_DIR/"
for f in "$DST_DIR"/*.wit; do
  base=$(basename "$f")
  if [[ ! -f "$SRC_DIR/$base" ]]; then
    rm "$f"
  fi
done
echo "sync-build-wit: $DST_DIR ← $SRC_DIR/*.wit ($(ls "$SRC_DIR" | grep -c '\.wit$' | tr -d ' ') files)"
