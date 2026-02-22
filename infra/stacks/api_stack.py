"""API infrastructure stack for Lambda + API Gateway wiring."""

from __future__ import annotations

from pathlib import Path

from aws_cdk import CfnOutput, Duration, Size, Stack
from aws_cdk import aws_apigateway as apigateway
from aws_cdk import aws_ecr_assets as ecr_assets
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_stepfunctions as sfn
from aws_cdk import aws_stepfunctions_tasks as sfn_tasks
from constructs import Construct

from stacks.data_stack import DataStack


class ApiStack(Stack):
    """Owns API Gateway and Lambda resources for the demo API surface."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        data_stack: DataStack,
        stage_name: str,
        demo_mode: str,
        bedrock_model_id: str,
        bedrock_model_arn: str,
        knowledge_base_id: str,
        knowledge_base_data_source_id: str,
        calendar_token_minting_path: str,
        calendar_token: str,
        calendar_token_user_id: str,
        calendar_fixture_fallback: str,
        canvas_sync_schedule_hours: int,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        project_root = Path(__file__).resolve().parents[2]
        lambda_code = lambda_.Code.from_asset(
            str(project_root),
            exclude=[
                ".git",
                ".github",
                ".next",
                "infra",
                "node_modules",
                "cdk.out",
                "__pycache__",
                "tests",
                "docs",
            ],
        )

        env = {
            "DEMO_MODE": demo_mode,
            "BEDROCK_MODEL_ID": bedrock_model_id,
            "KNOWLEDGE_BASE_ID": knowledge_base_id,
            "KNOWLEDGE_BASE_DATA_SOURCE_ID": knowledge_base_data_source_id,
            "BEDROCK_MODEL_ARN": bedrock_model_arn,
            "CALENDAR_TOKEN_MINTING_PATH": calendar_token_minting_path,
            "CANVAS_DATA_TABLE": data_stack.canvas_data_table.table_name,
            "CALENDAR_TOKENS_TABLE": data_stack.calendar_tokens_table.table_name,
            "DOCS_TABLE": data_stack.docs_table.table_name,
            "CARDS_TABLE": data_stack.cards_table.table_name,
            "UPLOADS_BUCKET": data_stack.uploads_bucket.bucket_name,
            "CALENDAR_TOKEN": calendar_token,
            "CALENDAR_TOKEN_USER_ID": calendar_token_user_id,
            "CALENDAR_FIXTURE_FALLBACK": calendar_fixture_fallback,
        }

        app_api_handler = lambda_.Function(
            self,
            "AppApiHandler",
            runtime=lambda_.Runtime.PYTHON_3_12,
            code=lambda_code,
            handler="backend.runtime.lambda_handler",
            timeout=Duration.seconds(29),
            memory_size=256,
            environment=env,
        )

        uploads_handler = lambda_.Function(
            self,
            "UploadsHandler",
            runtime=lambda_.Runtime.PYTHON_3_12,
            code=lambda_code,
            handler="backend.uploads.lambda_handler",
            timeout=Duration.seconds(15),
            memory_size=256,
            environment=env,
        )

        ingest_extract_handler = lambda_.DockerImageFunction(
            self,
            "IngestExtractHandler",
            code=lambda_.DockerImageCode.from_image_asset(
                str(project_root),
                file="infra/lambda/ingest_extract/Dockerfile",
                exclude=[
                    ".git",
                    ".cursor",
                    ".next",
                    "node_modules",
                    ".venv",
                    "infra/.venv",
                    "infra/cdk.out",
                    "**/cdk.out",
                    "**/cdk.out/**",
                ],
                platform=ecr_assets.Platform.LINUX_AMD64,
            ),
            timeout=Duration.seconds(120),
            memory_size=1536,
            ephemeral_storage_size=Size.mebibytes(2048),
            architecture=lambda_.Architecture.X86_64,
            environment={"DOCS_TABLE": data_stack.docs_table.table_name},
        )
        ingest_start_textract_handler = lambda_.Function(
            self,
            "IngestStartTextractHandler",
            runtime=lambda_.Runtime.PYTHON_3_12,
            code=lambda_code,
            handler="backend.ingest_workflow.start_textract_handler",
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={"DOCS_TABLE": data_stack.docs_table.table_name},
        )
        ingest_poll_textract_handler = lambda_.Function(
            self,
            "IngestPollTextractHandler",
            runtime=lambda_.Runtime.PYTHON_3_12,
            code=lambda_code,
            handler="backend.ingest_workflow.poll_textract_handler",
            timeout=Duration.seconds(60),
            memory_size=512,
            environment={"DOCS_TABLE": data_stack.docs_table.table_name},
        )
        ingest_finalize_handler = lambda_.Function(
            self,
            "IngestFinalizeHandler",
            runtime=lambda_.Runtime.PYTHON_3_12,
            code=lambda_code,
            handler="backend.ingest_workflow.finalize_handler",
            timeout=Duration.seconds(30),
            memory_size=256,
            environment={
                "DOCS_TABLE": data_stack.docs_table.table_name,
                "KNOWLEDGE_BASE_ID": knowledge_base_id,
                "KNOWLEDGE_BASE_DATA_SOURCE_ID": knowledge_base_data_source_id,
            },
        )

        data_stack.uploads_bucket.grant_read_write(app_api_handler)
        data_stack.uploads_bucket.grant_put(uploads_handler)
        data_stack.uploads_bucket.grant_read_write(ingest_extract_handler)
        data_stack.uploads_bucket.grant_read(ingest_start_textract_handler)
        data_stack.uploads_bucket.grant_read(ingest_poll_textract_handler)

        data_stack.canvas_data_table.grant_read_write_data(app_api_handler)
        data_stack.calendar_tokens_table.grant_read_write_data(app_api_handler)
        data_stack.docs_table.grant_read_write_data(app_api_handler)
        data_stack.docs_table.grant_read_write_data(ingest_finalize_handler)
        data_stack.cards_table.grant_read_write_data(app_api_handler)

        for fn in (ingest_start_textract_handler, ingest_poll_textract_handler):
            fn.add_to_role_policy(
                iam.PolicyStatement(
                    actions=[
                        "textract:StartDocumentTextDetection",
                        "textract:GetDocumentTextDetection",
                    ],
                    resources=["*"],
                )
            )
        ingest_finalize_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:StartIngestionJob"],
                resources=["*"],
            )
        )

        ingest_extract_step = sfn_tasks.LambdaInvoke(
            self,
            "IngestExtractStep",
            lambda_function=ingest_extract_handler,
            payload_response_only=True,
        )
        ingest_start_textract_step = sfn_tasks.LambdaInvoke(
            self,
            "IngestStartTextractStep",
            lambda_function=ingest_start_textract_handler,
            payload_response_only=True,
        )
        ingest_initial_wait_step = sfn.Wait(
            self,
            "IngestInitialWaitForTextract",
            time=sfn.WaitTime.duration(Duration.seconds(20)),
        )
        ingest_poll_wait_step = sfn.Wait(
            self,
            "IngestPollWaitForTextract",
            time=sfn.WaitTime.duration(Duration.seconds(20)),
        )
        ingest_poll_textract_entry_step = sfn_tasks.LambdaInvoke(
            self,
            "IngestPollTextractEntryStep",
            lambda_function=ingest_poll_textract_handler,
            payload_response_only=True,
        )
        ingest_poll_textract_step = sfn_tasks.LambdaInvoke(
            self,
            "IngestPollTextractStep",
            lambda_function=ingest_poll_textract_handler,
            payload_response_only=True,
        )
        ingest_finalize_step = sfn_tasks.LambdaInvoke(
            self,
            "IngestFinalizeStep",
            lambda_function=ingest_finalize_handler,
            payload_response_only=True,
        )

        ingest_poll_choice = sfn.Choice(self, "IngestPollDone")
        ingest_poll_choice.when(
            sfn.Condition.boolean_equals("$.done", True),
            ingest_finalize_step,
        ).otherwise(ingest_poll_wait_step.next(ingest_poll_textract_step).next(ingest_poll_choice))

        ingest_choice = sfn.Choice(self, "IngestNeedsTextract")
        ingest_choice.when(
            sfn.Condition.boolean_equals("$.needsTextract", True),
            ingest_start_textract_step
            .next(ingest_initial_wait_step)
            .next(ingest_poll_textract_entry_step)
            .next(ingest_poll_choice),
        ).otherwise(ingest_finalize_step)

        ingest_definition = ingest_extract_step.next(ingest_choice)

        ingest_state_machine = sfn.StateMachine(
            self,
            "DocsIngestStateMachine",
            definition_body=sfn.DefinitionBody.from_chainable(ingest_definition),
            timeout=Duration.minutes(20),
        )
        ingest_state_machine.grant_start_execution(app_api_handler)
        app_api_handler.add_environment("INGEST_STATE_MACHINE_ARN", ingest_state_machine.state_machine_arn)


        app_api_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                    "bedrock:Retrieve",
                    "bedrock:StartIngestionJob",
                    "bedrock:RetrieveAndGenerate",
                    "bedrock:GetInferenceProfile",
                ],
                resources=["*"],
            )
        )

        self.rest_api = apigateway.RestApi(
            self,
            "StudyBuddyApi",
            rest_api_name="studybuddy-demo-api",
            deploy_options=apigateway.StageOptions(stage_name=stage_name),
            default_cors_preflight_options=apigateway.CorsOptions(
                allow_origins=apigateway.Cors.ALL_ORIGINS,
                allow_methods=["GET", "POST", "OPTIONS"],
                allow_headers=[
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Api-Key",
                    "X-Amz-Security-Token",
                ],
            ),
        )
        self.rest_api.add_gateway_response(
            "Default4xxCors",
            type=apigateway.ResponseType.DEFAULT_4_XX,
            response_headers={
                "Access-Control-Allow-Origin": "'*'",
                "Access-Control-Allow-Headers": "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
                "Access-Control-Allow-Methods": "'GET,POST,OPTIONS'",
            },
        )
        self.rest_api.add_gateway_response(
            "Default5xxCors",
            type=apigateway.ResponseType.DEFAULT_5_XX,
            response_headers={
                "Access-Control-Allow-Origin": "'*'",
                "Access-Control-Allow-Headers": "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
                "Access-Control-Allow-Methods": "'GET,POST,OPTIONS'",
            },
        )

        app_integration = apigateway.LambdaIntegration(app_api_handler)
        uploads_integration = apigateway.LambdaIntegration(uploads_handler)

        health = self.rest_api.root.add_resource("health")
        health.add_method("GET", app_integration)

        courses = self.rest_api.root.add_resource("courses")
        courses.add_method("GET", app_integration)
        course_id = courses.add_resource("{courseId}")
        course_items = course_id.add_resource("items")
        course_items.add_method("GET", app_integration)

        canvas = self.rest_api.root.add_resource("canvas")
        canvas_connect = canvas.add_resource("connect")
        canvas_connect.add_method("POST", app_integration, authorization_type=apigateway.AuthorizationType.NONE)
        canvas_sync = canvas.add_resource("sync")
        canvas_sync.add_method("POST", app_integration, authorization_type=apigateway.AuthorizationType.NONE)

        uploads = self.rest_api.root.add_resource("uploads")
        uploads.add_method("POST", uploads_integration)

        docs = self.rest_api.root.add_resource("docs")
        docs_ingest = docs.add_resource("ingest")
        docs_ingest.add_method("POST", app_integration, authorization_type=apigateway.AuthorizationType.NONE)
        docs_ingest_job = docs_ingest.add_resource("{jobId}")
        docs_ingest_job.add_method("GET", app_integration, authorization_type=apigateway.AuthorizationType.NONE)

        generate = self.rest_api.root.add_resource("generate")
        generate_flashcards = generate.add_resource("flashcards")
        generate_flashcards.add_method("POST", app_integration, authorization_type=apigateway.AuthorizationType.NONE)
        generate_practice_exam = generate.add_resource("practice-exam")
        generate_practice_exam.add_method(
            "POST",
            app_integration,
            authorization_type=apigateway.AuthorizationType.NONE,
        )

        chat = self.rest_api.root.add_resource("chat")
        chat.add_method("POST", app_integration, authorization_type=apigateway.AuthorizationType.NONE)

        study = self.rest_api.root.add_resource("study")
        study_today = study.add_resource("today")
        study_today.add_method("GET", app_integration)
        study_review = study.add_resource("review")
        study_review.add_method("POST", app_integration)
        study_mastery = study.add_resource("mastery")
        study_mastery.add_method("GET", app_integration)

        calendar = self.rest_api.root.add_resource("calendar")
        calendar_token = calendar.add_resource("token")
        calendar_token.add_method(
            "POST",
            app_integration,
            authorization_type=apigateway.AuthorizationType.NONE,
        )
        calendar_feed = calendar.add_resource("{token_ics}")
        calendar_feed.add_method("GET", app_integration)

        sync_rule = events.Rule(
            self,
            "CanvasPeriodicSyncRule",
            schedule=events.Schedule.rate(Duration.hours(canvas_sync_schedule_hours)),
            description="Periodic Canvas sync for all users with stored Canvas connections.",
        )
        sync_rule.add_target(targets.LambdaFunction(app_api_handler))

        api_base_url = self.rest_api.url.rstrip("/")
        CfnOutput(
            self,
            "ApiBaseUrl",
            value=api_base_url,
            description="Base URL for smoke tests and frontend API wiring",
        )
        CfnOutput(
            self,
            "SuggestedSmokeBaseUrlSecret",
            value=api_base_url,
            description="Suggested value for DEV_BASE_URL",
        )
        CfnOutput(
            self,
            "CalendarTokenMintEndpoint",
            value=f"{api_base_url}/calendar/token",
            description="Mint endpoint for obtaining DEV_CALENDAR_TOKEN",
        )
        CfnOutput(
            self,
            "SuggestedSmokeCalendarTokenSecret",
            value=(
                calendar_token
                if calendar_token_minting_path.strip().lower() == "env"
                else "mint-via-POST-/calendar/token"
            ),
            description=(
                "Suggested value for DEV_CALENDAR_TOKEN (or mint one via POST /calendar/token)"
            ),
        )
        CfnOutput(
            self,
            "SuggestedSmokeCourseIdSecret",
            value="course-psych-101",
            description="Suggested value for DEV_COURSE_ID",
        )
        CfnOutput(
            self,
            "CanvasSyncScheduleHours",
            value=str(canvas_sync_schedule_hours),
            description="EventBridge cadence in hours for periodic Canvas sync",
        )
