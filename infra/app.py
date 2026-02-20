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
bedrock_model_id = app.node.try_get_context("bedrockModelId") or "amazon.nova-lite-v1:0"
calendar_token_minting_path = app.node.try_get_context("calendarTokenMintingPath") or "endpoint"
calendar_token = app.node.try_get_context("calendarToken") or "demo-calendar-token"
calendar_token_user_id = app.node.try_get_context("calendarTokenUserId") or "demo-user"

data_stack = DataStack(
    app,
    "GurtDataStack",
    env=env,
)

api_stack = ApiStack(
    app,
    "GurtApiStack",
    env=env,
    data_stack=data_stack,
    stage_name=stage_name,
    demo_mode=demo_mode,
    bedrock_model_id=bedrock_model_id,
    calendar_token_minting_path=calendar_token_minting_path,
    calendar_token=calendar_token,
    calendar_token_user_id=calendar_token_user_id,
)
api_stack.add_dependency(data_stack)

app.synth()
