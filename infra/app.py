#!/usr/bin/env python3
"""CDK app entrypoint for StudyBuddy demo infrastructure."""

from __future__ import annotations

import os

import aws_cdk as cdk

from stacks.api_stack import ApiStack
from stacks.data_stack import DataStack

app = cdk.App()

env = cdk.Environment(
    account=os.getenv("CDK_DEFAULT_ACCOUNT"),
    region=os.getenv("CDK_DEFAULT_REGION"),
)

stage_name = app.node.try_get_context("stageName") or "dev"
demo_mode = app.node.try_get_context("demoMode") or "1"
bedrock_model_id = app.node.try_get_context("bedrockModelId") or "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
bedrock_model_arn = app.node.try_get_context("bedrockModelArn") or "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
bedrock_guardrail_id = app.node.try_get_context("bedrockGuardrailId") or ""
bedrock_guardrail_version = app.node.try_get_context("bedrockGuardrailVersion") or ""
knowledge_base_id_context = app.node.try_get_context("knowledgeBaseId") or ""
knowledge_base_id_env = os.getenv("KNOWLEDGE_BASE_ID", "")
knowledge_base_data_source_id_context = app.node.try_get_context("knowledgeBaseDataSourceId") or ""
knowledge_base_data_source_id_env = os.getenv("KNOWLEDGE_BASE_DATA_SOURCE_ID", "")
create_kb_stack_context = app.node.try_get_context("createKnowledgeBaseStack") or "0"
embedding_model_id = app.node.try_get_context("embeddingModelId") or "amazon.titan-embed-text-v2:0"
calendar_token_minting_path = app.node.try_get_context("calendarTokenMintingPath") or "endpoint"
calendar_token = app.node.try_get_context("calendarToken") or "demo-calendar-token"
calendar_token_user_id = app.node.try_get_context("calendarTokenUserId") or "demo-user"
calendar_fixture_fallback = app.node.try_get_context("calendarFixtureFallback") or "1"
canvas_sync_schedule_hours = int(app.node.try_get_context("canvasSyncScheduleHours") or "24")

data_stack = DataStack(
    app,
    "GurtDataStack",
    env=env,
)

knowledge_base_stack = None
knowledge_base_id = (knowledge_base_id_env or knowledge_base_id_context).strip()
knowledge_base_data_source_id = (
    knowledge_base_data_source_id_env or knowledge_base_data_source_id_context
).strip()
create_kb_stack = str(create_kb_stack_context).strip().lower() in {"1", "true", "yes", "on"}
if create_kb_stack and not knowledge_base_id:
    from stacks.knowledge_base_stack import KnowledgeBaseStack

    knowledge_base_stack = KnowledgeBaseStack(
        app,
        "GurtKnowledgeBaseStack",
        env=env,
        data_stack=data_stack,
        stage_name=stage_name,
        embedding_model_id=embedding_model_id,
    )
    knowledge_base_stack.add_dependency(data_stack)
    knowledge_base_id = knowledge_base_stack.knowledge_base_id
    knowledge_base_data_source_id = knowledge_base_stack.data_source_id

api_stack = ApiStack(
    app,
    "GurtApiStack",
    env=env,
    data_stack=data_stack,
    stage_name=stage_name,
    demo_mode=demo_mode,
    bedrock_model_id=bedrock_model_id,
    bedrock_model_arn=bedrock_model_arn,
    bedrock_guardrail_id=bedrock_guardrail_id,
    bedrock_guardrail_version=bedrock_guardrail_version,
    knowledge_base_id=knowledge_base_id,
    knowledge_base_data_source_id=knowledge_base_data_source_id,
    calendar_token_minting_path=calendar_token_minting_path,
    calendar_token=calendar_token,
    calendar_token_user_id=calendar_token_user_id,
    calendar_fixture_fallback=calendar_fixture_fallback,
    canvas_sync_schedule_hours=canvas_sync_schedule_hours,
)
api_stack.add_dependency(data_stack)
if knowledge_base_stack is not None:
    api_stack.add_dependency(knowledge_base_stack)

app.synth()
