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
  #
  # NEON_AUTH_BASE_URL is deliberately NOT in this list. It is the sign-in endpoint the
  # browser itself has to call, shipped on purpose as NEXT_PUBLIC_NEON_AUTH_URL with the
  # same value. Asserting its absence from the bundle asserts the opposite of the design,
  # so the check failed on a correct build — and a check that fails when nothing is wrong
  # is one you learn to skip past. What it was reaching for is checked below instead.
  CHECKED_ANY=0
  for var in DATABASE_URL NEON_AUTH_COOKIE_SECRET NEON_DATA_API_URL; do
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

# --- 4. a secret pasted into a client-exposed variable ------------------------------
# The bundle grep above only catches a value that already reached dist/. This catches
# the same mistake one step earlier and without depending on the bundle at all: a
# server-only secret copied into a NEXT_PUBLIC_/VITE_ name, which Vite inlines by
# design. That is the leak the name-based list was actually reaching for, and unlike a
# bundle grep it cannot be defeated by a stale or missing dist/ — so it runs out here,
# not inside the block guarded on dist/ existing.
CHECKED_PUBLIC=0
EXPOSED=0
for var in DATABASE_URL NEON_AUTH_COOKIE_SECRET NEON_DATA_API_URL; do
  secret="${!var:-}"
  [ -n "$secret" ] || continue
  CHECKED_PUBLIC=1
  while IFS='=' read -r public_name public_value; do
    case "$public_name" in
      NEXT_PUBLIC_*|VITE_*) ;;
      *) continue ;;
    esac
    if [ -n "$public_value" ] && [ "$public_value" = "$secret" ]; then
      fail "$public_name carries the value of $var; Vite would ship it to the browser"
      EXPOSED=1
    fi
  done < <(env)
done
if [ "$CHECKED_PUBLIC" -eq 0 ]; then
  echo "  skip  no server-only values in this shell; client-exposure check not run"
elif [ "$EXPOSED" -eq 0 ]; then
  pass "no NEXT_PUBLIC_/VITE_ variable carries a server-only value"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "No leaked secrets found."
else
  echo "SECRET CHECK FAILED."
fi
exit "$FAILED"
