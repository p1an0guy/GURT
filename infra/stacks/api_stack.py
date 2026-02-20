"""API infrastructure stack for Lambda + API Gateway wiring."""

from __future__ import annotations

from pathlib import Path

from aws_cdk import CfnOutput, Duration, Stack
from aws_cdk import aws_apigateway as apigateway
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
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
        calendar_token_minting_path: str,
        calendar_token: str,
        calendar_token_user_id: str,
        calendar_fixture_fallback: str,
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
            timeout=Duration.seconds(15),
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

        data_stack.uploads_bucket.grant_read_write(app_api_handler)
        data_stack.uploads_bucket.grant_put(uploads_handler)

        data_stack.canvas_data_table.grant_read_write_data(app_api_handler)
        data_stack.calendar_tokens_table.grant_read_write_data(app_api_handler)
        data_stack.docs_table.grant_read_write_data(app_api_handler)
        data_stack.cards_table.grant_read_write_data(app_api_handler)

        # Bedrock integration is implemented in later handlers, but grant now so
        # those code paths can be added without reshaping IAM in a follow-up.
        app_api_handler.add_to_role_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
                resources=["*"],
            )
        )

        self.rest_api = apigateway.RestApi(
            self,
            "StudyBuddyApi",
            rest_api_name="studybuddy-demo-api",
            deploy_options=apigateway.StageOptions(stage_name=stage_name),
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

        uploads = self.rest_api.root.add_resource("uploads")
        uploads.add_method("POST", uploads_integration)

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
            authorization_type=apigateway.AuthorizationType.IAM,
        )
        calendar_feed = calendar.add_resource("{token_ics}")
        calendar_feed.add_method("GET", app_integration)

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
