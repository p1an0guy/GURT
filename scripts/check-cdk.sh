#!/usr/bin/env bash

# Run required CDK validation checks.
# Use this whenever infra/ CDK code changes.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"
VENV_DIR="$INFRA_DIR/.venv"
CDK_CLI_PACKAGE="${CDK_CLI_PACKAGE:-aws-cdk@latest}"

STAGE_NAME="${STAGE_NAME:-dev}"
DEMO_MODE="${DEMO_MODE:-1}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-amazon.nova-lite-v1:0}"
CALENDAR_TOKEN_MINTING_PATH="${CALENDAR_TOKEN_MINTING_PATH:-endpoint}"
CALENDAR_TOKEN="${CALENDAR_TOKEN:-demo-calendar-token}"
CALENDAR_TOKEN_USER_ID="${CALENDAR_TOKEN_USER_ID:-demo-user}"

echo "Running CDK checks..."

python3 -m venv "$VENV_DIR"
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"

python -m pip install --upgrade pip
pip install -r "$INFRA_DIR/requirements.txt"

python -m compileall "$INFRA_DIR"

pushd "$INFRA_DIR" > /dev/null
echo "Using CDK CLI package: $CDK_CLI_PACKAGE"
npx --yes "$CDK_CLI_PACKAGE" --version
npx --yes "$CDK_CLI_PACKAGE" synth \
  --context "stageName=$STAGE_NAME" \
  --context "demoMode=$DEMO_MODE" \
  --context "bedrockModelId=$BEDROCK_MODEL_ID" \
  --context "calendarTokenMintingPath=$CALENDAR_TOKEN_MINTING_PATH" \
  --context "calendarToken=$CALENDAR_TOKEN" \
  --context "calendarTokenUserId=$CALENDAR_TOKEN_USER_ID" \
  > /dev/null
popd > /dev/null

echo "CDK checks passed."
