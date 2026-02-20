#!/usr/bin/env bash

# Build frontend assets for deployment.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

npm run build
echo "Frontend build completed."
