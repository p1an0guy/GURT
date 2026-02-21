"""Knowledge base infrastructure stack for Bedrock RAG resources."""

from __future__ import annotations

import json
import re

from aws_cdk import CfnOutput, Stack
from aws_cdk import aws_bedrock as bedrock
from aws_cdk import aws_iam as iam
from aws_cdk import aws_opensearchserverless as aoss
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
        collection_name = _safe_name(f"{prefix}-collection")
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

        encryption_policy = aoss.CfnSecurityPolicy(
            self,
            "KbCollectionEncryptionPolicy",
            name=_safe_name(f"{prefix}-enc"),
            type="encryption",
            policy=json.dumps(
                {
                    "Rules": [
                        {
                            "ResourceType": "collection",
                            "Resource": [f"collection/{collection_name}"],
                        }
                    ],
                    "AWSOwnedKey": True,
                }
            ),
            description="Encryption policy for Knowledge Base OpenSearch Serverless collection.",
        )

        network_policy = aoss.CfnSecurityPolicy(
            self,
            "KbCollectionNetworkPolicy",
            name=_safe_name(f"{prefix}-net"),
            type="network",
            policy=json.dumps(
                [
                    {
                        "Description": "Allow public API and dashboard access for hackathon demo.",
                        "Rules": [
                            {
                                "ResourceType": "collection",
                                "Resource": [f"collection/{collection_name}"],
                            },
                            {
                                "ResourceType": "dashboard",
                                "Resource": [f"collection/{collection_name}"],
                            },
                        ],
                        "AllowFromPublic": True,
                    }
                ]
            ),
            description="Network policy for Knowledge Base OpenSearch Serverless collection.",
        )

        collection = aoss.CfnCollection(
            self,
            "KbVectorCollection",
            name=collection_name,
            type="VECTORSEARCH",
            description="Vector collection for StudyBuddy Bedrock Knowledge Base.",
        )
        collection.add_dependency(encryption_policy)
        collection.add_dependency(network_policy)

        data_access_policy = aoss.CfnAccessPolicy(
            self,
            "KbCollectionDataAccessPolicy",
            name=_safe_name(f"{prefix}-data"),
            type="data",
            policy=json.dumps(
                [
                    {
                        "Description": "Allow Bedrock KB role to read/write vectors.",
                        "Rules": [
                            {
                                "ResourceType": "collection",
                                "Resource": [f"collection/{collection_name}"],
                                "Permission": ["aoss:DescribeCollectionItems"],
                            },
                            {
                                "ResourceType": "index",
                                "Resource": [f"index/{collection_name}/*"],
                                "Permission": [
                                    "aoss:CreateIndex",
                                    "aoss:DeleteIndex",
                                    "aoss:UpdateIndex",
                                    "aoss:DescribeIndex",
                                    "aoss:ReadDocument",
                                    "aoss:WriteDocument",
                                ],
                            },
                        ],
                        "Principal": [kb_service_role.role_arn],
                    }
                ]
            ),
            description="Data access policy for Bedrock KB service role.",
        )
        data_access_policy.add_dependency(collection)

        kb_service_role.add_to_policy(
            iam.PolicyStatement(
                actions=["aoss:APIAccessAll"],
                resources=["*"],
            )
        )

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
                ),
            ),
            storage_configuration=bedrock.CfnKnowledgeBase.StorageConfigurationProperty(
                type="OPENSEARCH_SERVERLESS",
                opensearch_serverless_configuration=(
                    bedrock.CfnKnowledgeBase.OpenSearchServerlessConfigurationProperty(
                        collection_arn=collection.attr_arn,
                        vector_index_name=vector_index_name,
                        field_mapping=bedrock.CfnKnowledgeBase.OpenSearchServerlessFieldMappingProperty(
                            metadata_field="metadata",
                            text_field="text",
                            vector_field="vector",
                        ),
                    )
                ),
            ),
        )
        knowledge_base.add_dependency(data_access_policy)
        # IAM role policies are synthesized as a separate resource from the role.
        # Force policy attachment before Bedrock attempts to use the service role.
        default_policy = kb_service_role.node.try_find_child("DefaultPolicy")
        if default_policy is not None:
            knowledge_base.add_dependency(default_policy.node.default_child)  # type: ignore[arg-type]

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
                    inclusion_prefixes=["uploads/", "canvas-materials/"],
                ),
            ),
            vector_ingestion_configuration=bedrock.CfnDataSource.VectorIngestionConfigurationProperty(
                chunking_configuration=bedrock.CfnDataSource.ChunkingConfigurationProperty(
                    chunking_strategy="FIXED_SIZE",
                    fixed_size_chunking_configuration=(
                        bedrock.CfnDataSource.FixedSizeChunkingConfigurationProperty(
                            max_tokens=300,
                            overlap_percentage=20,
                        )
                    ),
                )
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
        CfnOutput(
            self,
            "KnowledgeBaseCollectionArn",
            value=collection.attr_arn,
            description="OpenSearch Serverless collection ARN used by the Knowledge Base.",
        )
