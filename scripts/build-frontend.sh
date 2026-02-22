#!/usr/bin/env bash

# Build frontend assets for deployment.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_NAME="${STAGE_NAME:-dev}"
OUTPUTS_FILE="${OUTPUTS_FILE:-$ROOT_DIR/outputs.${STAGE_NAME}.json}"
REQUIRE_API_BASE_URL="${REQUIRE_API_BASE_URL:-false}"

echo "Building frontend..."
cd "$ROOT_DIR"

if [ ! -f "package.json" ]; then
  echo "Error: package.json not found in $ROOT_DIR"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

if [ -z "${NEXT_PUBLIC_API_BASE_URL:-}" ] && [ -f "$OUTPUTS_FILE" ]; then
  NEXT_PUBLIC_API_BASE_URL="$(
    python3 - "$OUTPUTS_FILE" <<'PY'
import json
import pathlib
import sys

outputs_path = pathlib.Path(sys.argv[1]).resolve()
try:
    data = json.loads(outputs_path.read_text(encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)

stack = data.get("GurtApiStack")
if stack is None:
    for value in data.values():
        if isinstance(value, dict) and "ApiBaseUrl" in value:
            stack = value
            break

print((stack or {}).get("ApiBaseUrl", ""))
PY
  )"
fi

REQUIRE_API_BASE_URL_NORMALIZED="$(printf '%s' "$REQUIRE_API_BASE_URL" | tr '[:upper:]' '[:lower:]')"
if [ -z "${NEXT_PUBLIC_API_BASE_URL:-}" ] && [ "$REQUIRE_API_BASE_URL_NORMALIZED" = "true" ]; then
  echo "Error: NEXT_PUBLIC_API_BASE_URL is required but was not provided and could not be read from $OUTPUTS_FILE."
  exit 1
fi

if [ -z "${NEXT_PUBLIC_API_BASE_URL:-}" ]; then
  export NEXT_PUBLIC_USE_FIXTURES="${NEXT_PUBLIC_USE_FIXTURES:-true}"
  echo "NEXT_PUBLIC_API_BASE_URL not set; building in fixture mode (NEXT_PUBLIC_USE_FIXTURES=$NEXT_PUBLIC_USE_FIXTURES)."
else
  export NEXT_PUBLIC_API_BASE_URL
  export NEXT_PUBLIC_USE_FIXTURES="${NEXT_PUBLIC_USE_FIXTURES:-false}"
  echo "Using NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL"
  echo "Building with NEXT_PUBLIC_USE_FIXTURES=$NEXT_PUBLIC_USE_FIXTURES"
fi

npm run build
echo "Frontend build completed."
