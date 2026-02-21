#!/usr/bin/env bash

# One-command deploy for GURT demo infrastructure and frontend build.
# Automatically uses AWS credentials from your current environment/profile.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra"
VENV_DIR="$INFRA_DIR/.venv"
CDK_CLI_PACKAGE="${CDK_CLI_PACKAGE:-aws-cdk@latest}"

STAGE_NAME="${STAGE_NAME:-dev}"
DEMO_MODE="${DEMO_MODE:-1}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-us.anthropic.claude-sonnet-4-6}"
KNOWLEDGE_BASE_ID="${KNOWLEDGE_BASE_ID:-}"
CALENDAR_TOKEN_MINTING_PATH="${CALENDAR_TOKEN_MINTING_PATH:-endpoint}"
CALENDAR_TOKEN="${CALENDAR_TOKEN:-demo-calendar-token}"
CALENDAR_TOKEN_USER_ID="${CALENDAR_TOKEN_USER_ID:-demo-user}"
OUTPUTS_FILE="${OUTPUTS_FILE:-$ROOT_DIR/outputs.${STAGE_NAME}.json}"
AWS_PROFILE="${AWS_PROFILE:-default}"

echo "Starting deploy for stage: $STAGE_NAME"
echo "Using AWS profile: $AWS_PROFILE"
echo "Using CDK CLI package: $CDK_CLI_PACKAGE"

if command -v aws > /dev/null; then
  echo "Validating AWS SSO session for profile: $AWS_PROFILE"
  if ! aws sts get-caller-identity --profile "$AWS_PROFILE" > /dev/null; then
    echo "AWS credentials are not valid for profile '$AWS_PROFILE'."
    echo "Run: aws sso login --profile $AWS_PROFILE"
    exit 1
  fi
  echo "AWS caller identity:"
  aws sts get-caller-identity --profile "$AWS_PROFILE"
  echo "AWS region: $(aws configure get region --profile "$AWS_PROFILE")"
else
  echo "Warning: aws CLI not found. CDK can still use environment credentials if available."
fi

python3 -m venv "$VENV_DIR"
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"
export AWS_PROFILE

python -m pip install --upgrade pip
pip install -r "$INFRA_DIR/requirements.txt"

"$ROOT_DIR/scripts/build-frontend.sh"
"$ROOT_DIR/scripts/check-cdk.sh"

pushd "$INFRA_DIR" > /dev/null
npx --yes "$CDK_CLI_PACKAGE" --version
npx --yes "$CDK_CLI_PACKAGE" bootstrap \
  --profile "$AWS_PROFILE" \
  --context "stageName=$STAGE_NAME" \
  --context "demoMode=$DEMO_MODE" \
  --context "bedrockModelId=$BEDROCK_MODEL_ID" \
  --context "knowledgeBaseId=$KNOWLEDGE_BASE_ID" \
  --context "calendarTokenMintingPath=$CALENDAR_TOKEN_MINTING_PATH" \
  --context "calendarToken=$CALENDAR_TOKEN" \
  --context "calendarTokenUserId=$CALENDAR_TOKEN_USER_ID"

npx --yes "$CDK_CLI_PACKAGE" deploy GurtDataStack GurtApiStack \
  --profile "$AWS_PROFILE" \
  --require-approval never \
  --outputs-file "$OUTPUTS_FILE" \
  --context "stageName=$STAGE_NAME" \
  --context "demoMode=$DEMO_MODE" \
  --context "bedrockModelId=$BEDROCK_MODEL_ID" \
  --context "knowledgeBaseId=$KNOWLEDGE_BASE_ID" \
  --context "calendarTokenMintingPath=$CALENDAR_TOKEN_MINTING_PATH" \
  --context "calendarToken=$CALENDAR_TOKEN" \
  --context "calendarTokenUserId=$CALENDAR_TOKEN_USER_ID"
popd > /dev/null

echo "Verifying CloudFormation stack status..."
aws cloudformation describe-stacks --profile "$AWS_PROFILE" --stack-name GurtDataStack \
  --query 'Stacks[0].StackStatus' --output text
aws cloudformation describe-stacks --profile "$AWS_PROFILE" --stack-name GurtApiStack \
  --query 'Stacks[0].StackStatus' --output text

python3 - "$OUTPUTS_FILE" <<'PY'
import json
import pathlib
import sys

outputs_path = pathlib.Path(sys.argv[1]).resolve()
data = json.loads(outputs_path.read_text(encoding="utf-8"))

stack = data.get("GurtApiStack")
if stack is None:
    for value in data.values():
        if isinstance(value, dict) and "ApiBaseUrl" in value:
            stack = value
            break

if stack is None:
    raise SystemExit("Could not find ApiBaseUrl in outputs file.")

api_base_url = stack.get("ApiBaseUrl", "")
mint_endpoint = stack.get("CalendarTokenMintEndpoint", "")
course_id = stack.get("SuggestedSmokeCourseIdSecret", "course-psych-101")

print("")
print(f"Outputs file: {outputs_path}")
print(f"DEV_BASE_URL={api_base_url}")
print(f"Mint calendar token via: {mint_endpoint}")
print(f"Suggested DEV_COURSE_ID={course_id}")
print("After minting a token, set DEV_CALENDAR_TOKEN in GitHub Actions secrets.")
PY

echo "Deploy completed."
