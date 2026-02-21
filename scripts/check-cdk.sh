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
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-us.anthropic.claude-sonnet-4-5}"
EMBEDDING_MODEL_ID="${EMBEDDING_MODEL_ID:-amazon.titan-embed-text-v2:0}"
KNOWLEDGE_BASE_ID="${KNOWLEDGE_BASE_ID:-}"
KNOWLEDGE_BASE_DATA_SOURCE_ID="${KNOWLEDGE_BASE_DATA_SOURCE_ID:-HYYHTCJQFP}"
CREATE_KB_STACK="${CREATE_KB_STACK:-0}"
CALENDAR_TOKEN_MINTING_PATH="${CALENDAR_TOKEN_MINTING_PATH:-endpoint}"
CALENDAR_TOKEN="${CALENDAR_TOKEN:-demo-calendar-token}"
CALENDAR_TOKEN_USER_ID="${CALENDAR_TOKEN_USER_ID:-demo-user}"

echo "Running CDK checks..."

python3 -m venv "$VENV_DIR"
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"
export KNOWLEDGE_BASE_ID
export KNOWLEDGE_BASE_DATA_SOURCE_ID
export CREATE_KB_STACK

python -m pip install --upgrade pip
pip install -r "$INFRA_DIR/requirements.txt"

python -m compileall "$INFRA_DIR/app.py" "$INFRA_DIR/stacks"

pushd "$INFRA_DIR" > /dev/null
echo "Using CDK CLI package: $CDK_CLI_PACKAGE"
npx --yes "$CDK_CLI_PACKAGE" --version
npx --yes "$CDK_CLI_PACKAGE" synth \
  --context "stageName=$STAGE_NAME" \
  --context "demoMode=$DEMO_MODE" \
  --context "bedrockModelId=$BEDROCK_MODEL_ID" \
  --context "embeddingModelId=$EMBEDDING_MODEL_ID" \
  --context "knowledgeBaseId=$KNOWLEDGE_BASE_ID" \
  --context "knowledgeBaseDataSourceId=$KNOWLEDGE_BASE_DATA_SOURCE_ID" \
  --context "createKnowledgeBaseStack=$CREATE_KB_STACK" \
  --context "calendarTokenMintingPath=$CALENDAR_TOKEN_MINTING_PATH" \
  --context "calendarToken=$CALENDAR_TOKEN" \
  --context "calendarTokenUserId=$CALENDAR_TOKEN_USER_ID" \
  > /dev/null

if [ -n "$KNOWLEDGE_BASE_ID" ]; then
  STACK_LIST="$(npx --yes "$CDK_CLI_PACKAGE" ls \
    --context "stageName=$STAGE_NAME" \
    --context "demoMode=$DEMO_MODE" \
    --context "bedrockModelId=$BEDROCK_MODEL_ID" \
    --context "embeddingModelId=$EMBEDDING_MODEL_ID" \
    --context "knowledgeBaseId=$KNOWLEDGE_BASE_ID" \
    --context "knowledgeBaseDataSourceId=$KNOWLEDGE_BASE_DATA_SOURCE_ID" \
    --context "createKnowledgeBaseStack=$CREATE_KB_STACK" \
    --context "calendarTokenMintingPath=$CALENDAR_TOKEN_MINTING_PATH" \
    --context "calendarToken=$CALENDAR_TOKEN" \
    --context "calendarTokenUserId=$CALENDAR_TOKEN_USER_ID")"
  if echo "$STACK_LIST" | grep -q '^GurtKnowledgeBaseStack$'; then
    echo "CDK check failed: KNOWLEDGE_BASE_ID is set but synth still includes GurtKnowledgeBaseStack."
    exit 1
  fi
fi
popd > /dev/null

echo "CDK checks passed."
