#!/usr/bin/env bash
#
# Fails if a secret could have reached the browser bundle or the git history.
#
# An earlier version of this script grepped the bundle for server-only variable NAMES.
# That check could never fail: Vite inlines variable VALUES, not identifiers, so the
# string "DATABASE_URL" cannot appear in dist/ whether or not anything leaked. It
# passed unconditionally and proved nothing.
#
# This version checks the three things that can actually go wrong:
#   1. a connection string pasted into source and inlined into the bundle
#   2. the literal VALUE of a server-only variable appearing in the built assets
#   3. a real .env file tracked in git — the leak that actually happens, and the one
#      a bundle grep would never see
set -uo pipefail

cd "$(dirname "$0")/.."
FAILED=0
DIST="apps/web/dist"

fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }
pass() { printf '  ok    %s\n' "$1"; }

echo "Checking for leaked secrets..."

# --- 1. tracked environment files -------------------------------------------------
if git rev-parse --git-dir >/dev/null 2>&1; then
  TRACKED_ENV=$(git ls-files | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)
  if [ -n "$TRACKED_ENV" ]; then
    fail "environment files are tracked in git:"
    printf '        %s\n' $TRACKED_ENV
  else
    pass "no .env file tracked in git (only .env.example)"
  fi
fi

# --- 2. connection strings anywhere in the built bundle ---------------------------
if [ -d "$DIST" ]; then
  for pattern in 'postgresql://' 'postgres://' 'npg_'; do
    if grep -rlF "$pattern" "$DIST" >/dev/null 2>&1; then
      fail "found '$pattern' in $DIST"
    else
      pass "no '$pattern' in the built bundle"
    fi
  done

  # --- 3. literal values of server-only variables --------------------------------
  # Only meaningful when the values are present in this shell, so it is reported as
  # skipped rather than passed when they are not — a skip that prints as a pass is how
  # a check like this becomes decorative.
  CHECKED_ANY=0
  for var in DATABASE_URL NEON_AUTH_COOKIE_SECRET NEON_DATA_API_URL NEON_AUTH_BASE_URL; do
    value="${!var:-}"
    if [ -n "$value" ]; then
      CHECKED_ANY=1
      # Includes source maps: a value stripped from the bundle can survive in the map.
      if grep -rlF "$value" "$DIST" >/dev/null 2>&1; then
        fail "the value of $var appears in $DIST"
      else
        pass "the value of $var does not appear in the bundle"
      fi
    fi
  done
  if [ "$CHECKED_ANY" -eq 0 ]; then
    echo "  skip  no server-only values in this shell; value check not run"
    echo "        (run with the API's env loaded to exercise it)"
  fi
else
  echo "  skip  $DIST not built; run 'npm run build' first to check the bundle"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "No leaked secrets found."
else
  echo "SECRET CHECK FAILED."
fi
exit "$FAILED"
