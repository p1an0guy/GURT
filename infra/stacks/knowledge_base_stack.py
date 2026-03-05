"""Knowledge base infrastructure stack for Bedrock RAG resources."""

from __future__ import annotations

import re

from aws_cdk import CfnOutput, Stack
from aws_cdk import aws_bedrock as bedrock
from aws_cdk import aws_iam as iam
from constructs import Construct

from stacks.data_stack import DataStack


def _safe_name(raw: str, *, max_length: int = 32) -> str:
    sanitized = re.sub(r"[^a-z0-9-]", "-", raw.lower()).strip("-")
    if not sanitized:
        sanitized = "gurt"
    trimmed = sanitized[:max_length].rstrip("-")
    return trimmed or "gurt"


class KnowledgeBaseStack(Stack):
    """Owns Bedrock Knowledge Base + vector store resources."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        data_stack: DataStack,
        stage_name: str,
        embedding_model_id: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        prefix = _safe_name(f"gurt-{stage_name}-kb")
        vector_index_name = _safe_name(f"{prefix}-index", max_length=64)
        knowledge_base_name = _safe_name(f"{prefix}-bedrock", max_length=100)
        data_source_name = _safe_name(f"{prefix}-uploads", max_length=100)
        embedding_model_arn = f"arn:aws:bedrock:{self.region}::foundation-model/{embedding_model_id}"

        kb_service_role = iam.Role(
            self,
            "KnowledgeBaseServiceRole",
            assumed_by=iam.ServicePrincipal("bedrock.amazonaws.com"),
            description="Service role for Bedrock Knowledge Base ingestion and retrieval.",
        )
        data_stack.uploads_bucket.grant_read(kb_service_role)
        kb_service_role.add_to_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=[embedding_model_arn],
            )
        )

        parsed_content_uri = f"s3://{data_stack.uploads_bucket.bucket_name}/kb-parsed/"

        knowledge_base = bedrock.CfnKnowledgeBase(
            self,
            "KnowledgeBase",
            name=knowledge_base_name,
            role_arn=kb_service_role.role_arn,
            description="StudyBuddy Bedrock Knowledge Base over uploaded course materials.",
            knowledge_base_configuration=bedrock.CfnKnowledgeBase.KnowledgeBaseConfigurationProperty(
                type="VECTOR",
                vector_knowledge_base_configuration=bedrock.CfnKnowledgeBase.VectorKnowledgeBaseConfigurationProperty(
                    embedding_model_arn=embedding_model_arn,
                    supplemental_data_storage_configuration=(
                        bedrock.CfnKnowledgeBase.SupplementalDataStorageConfigurationProperty(
                            supplemental_data_storage_locations=[
                                bedrock.CfnKnowledgeBase.SupplementalDataStorageLocationProperty(
                                    supplemental_data_storage_location_type="S3",
                                    s3_location=bedrock.CfnKnowledgeBase.S3LocationProperty(
                                        uri=parsed_content_uri,
                                    ),
                                )
                            ],
                        )
                    ),
                ),
            ),
            storage_configuration=bedrock.CfnKnowledgeBase.StorageConfigurationProperty(
                type="S3_VECTORS",
                s3_vectors_configuration=(
                    bedrock.CfnKnowledgeBase.S3VectorsConfigurationProperty(
                        index_name=vector_index_name,
                        vector_bucket_arn=data_stack.uploads_bucket.bucket_arn,
                    )
                ),
            ),
        )
        # IAM role policies are synthesized as a separate resource from the role.
        # Force policy attachment before Bedrock attempts to use the service role.
        default_policy = kb_service_role.node.try_find_child("DefaultPolicy")
        if default_policy is not None:
            knowledge_base.add_dependency(default_policy.node.default_child)  # type: ignore[arg-type]

        parsing_model_arn = (
            f"arn:aws:bedrock:{self.region}::foundation-model/"
            "anthropic.claude-3-5-haiku-20241022-v1:0"
        )
        kb_service_role.add_to_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=[parsing_model_arn],
            )
        )

        data_source = bedrock.CfnDataSource(
            self,
            "KnowledgeBaseUploadsDataSource",
            name=data_source_name,
            knowledge_base_id=knowledge_base.attr_knowledge_base_id,
            description="Ingests uploaded S3 course files into the Bedrock Knowledge Base.",
            data_source_configuration=bedrock.CfnDataSource.DataSourceConfigurationProperty(
                type="S3",
                s3_configuration=bedrock.CfnDataSource.S3DataSourceConfigurationProperty(
                    bucket_arn=data_stack.uploads_bucket.bucket_arn,
                    inclusion_prefixes=["uploads/"],
                ),
            ),
            vector_ingestion_configuration=bedrock.CfnDataSource.VectorIngestionConfigurationProperty(
                chunking_configuration=bedrock.CfnDataSource.ChunkingConfigurationProperty(
                    chunking_strategy="SEMANTIC",
                    semantic_chunking_configuration=(
                        bedrock.CfnDataSource.SemanticChunkingConfigurationProperty(
                            max_tokens=1000,
                            buffer_size=1,
                            breakpoint_percentile_threshold=90,
                        )
                    ),
                ),
                parsing_configuration=bedrock.CfnDataSource.ParsingConfigurationProperty(
                    parsing_strategy="BEDROCK_FOUNDATION_MODEL",
                    bedrock_foundation_model_configuration=(
                        bedrock.CfnDataSource.BedrockFoundationModelConfigurationProperty(
                            model_arn=parsing_model_arn,
                            parsing_modality="MULTIMODAL",
                        )
                    ),
                ),
            ),
        )
        data_source.add_dependency(knowledge_base)

        self.knowledge_base_id = knowledge_base.attr_knowledge_base_id
        self.data_source_id = data_source.attr_data_source_id

        CfnOutput(
            self,
            "KnowledgeBaseId",
            value=self.knowledge_base_id,
            description="Bedrock Knowledge Base ID for generation and chat retrieval.",
        )
        CfnOutput(
            self,
            "KnowledgeBaseDataSourceId",
            value=self.data_source_id,
            description="Bedrock Knowledge Base S3 data source ID.",
        )
