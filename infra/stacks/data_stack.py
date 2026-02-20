"""Data infrastructure stack for demo storage resources."""

from __future__ import annotations

from aws_cdk import CfnOutput, RemovalPolicy, Stack
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_s3 as s3
from constructs import Construct


class DataStack(Stack):
    """Owns S3 and DynamoDB resources used by the API stack."""

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self.uploads_bucket = s3.Bucket(
            self,
            "UploadsBucket",
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            auto_delete_objects=True,
            removal_policy=RemovalPolicy.DESTROY,
        )

        table_kwargs = {
            "billing_mode": dynamodb.BillingMode.PAY_PER_REQUEST,
            "removal_policy": RemovalPolicy.DESTROY,
        }

        self.canvas_data_table = dynamodb.Table(
            self,
            "CanvasDataTable",
            partition_key=dynamodb.Attribute(name="pk", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="sk", type=dynamodb.AttributeType.STRING),
            **table_kwargs,
        )

        self.calendar_tokens_table = dynamodb.Table(
            self,
            "CalendarTokensTable",
            partition_key=dynamodb.Attribute(name="token", type=dynamodb.AttributeType.STRING),
            **table_kwargs,
        )

        self.docs_table = dynamodb.Table(
            self,
            "DocsTable",
            partition_key=dynamodb.Attribute(name="docId", type=dynamodb.AttributeType.STRING),
            **table_kwargs,
        )

        self.cards_table = dynamodb.Table(
            self,
            "CardsTable",
            partition_key=dynamodb.Attribute(name="cardId", type=dynamodb.AttributeType.STRING),
            **table_kwargs,
        )

        CfnOutput(
            self,
            "UploadsBucketName",
            value=self.uploads_bucket.bucket_name,
            description="Demo uploads bucket name",
        )
        CfnOutput(
            self,
            "CanvasDataTableName",
            value=self.canvas_data_table.table_name,
            description="Canvas data table name",
        )
        CfnOutput(
            self,
            "CalendarTokensTableName",
            value=self.calendar_tokens_table.table_name,
            description="Calendar token table name",
        )
        CfnOutput(
            self,
            "DocsTableName",
            value=self.docs_table.table_name,
            description="Document metadata table name",
        )
        CfnOutput(
            self,
            "CardsTableName",
            value=self.cards_table.table_name,
            description="Cards table name",
        )
