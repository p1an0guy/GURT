"""Knowledge base infrastructure stack for Bedrock RAG resources."""

from __future__ import annotations

import json
import re
import textwrap

from aws_cdk import CfnOutput, CustomResource, Duration, Stack
from aws_cdk import aws_bedrock as bedrock
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_opensearchserverless as aoss
from constructs import Construct

from stacks.data_stack import DataStack


def _safe_name(raw: str, *, max_length: int = 32) -> str:
    sanitized = re.sub(r"[^a-z0-9-]", "-", raw.lower()).strip("-")
    if not sanitized:
        sanitized = "gurt"
    trimmed = sanitized[:max_length].rstrip("-")
    return trimmed or "gurt"


# Inline Lambda code that creates the OpenSearch Serverless vector index.
# This runs as a CloudFormation custom resource after the collection is ready.
_INDEX_CREATOR_CODE = textwrap.dedent("""\
    import json
    import os
    import time
    import urllib.request
    import urllib.error

    import boto3
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    from botocore.credentials import Credentials

    import cfnresponse


    def handler(event, context):
        try:
            request_type = event["RequestType"]
            props = event["ResourceProperties"]
            endpoint = props["CollectionEndpoint"]
            index_name = props["IndexName"]
            vector_dimension = int(props.get("VectorDimension", "1024"))

            if request_type in ("Create", "Update"):
                _create_index(endpoint, index_name, vector_dimension)

            cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                "IndexName": index_name,
            })
        except Exception as exc:
            print(f"Error: {exc}")
            cfnresponse.send(event, context, cfnresponse.FAILED, {
                "Error": str(exc),
            })


    def _create_index(endpoint, index_name, vector_dimension):
        url = f"{endpoint}/{index_name}"
        body = json.dumps({
            "settings": {
                "index": {
                    "knn": True,
                    "knn.algo_param.ef_search": 512,
                }
            },
            "mappings": {
                "properties": {
                    "vector": {
                        "type": "knn_vector",
                        "dimension": vector_dimension,
                        "method": {
                            "engine": "faiss",
                            "name": "hnsw",
                            "parameters": {},
                            "space_type": "l2",
                        },
                    },
                    "text": {"type": "text"},
                    "metadata": {"type": "text"},
                }
            },
        }).encode()

        session = boto3.Session()
        credentials = session.get_credentials().get_frozen_credentials()
        region = os.environ.get("AWS_REGION", "us-west-2")

        # Retry a few times since the collection may take a moment to become active.
        last_error = None
        for attempt in range(5):
            try:
                req = AWSRequest(method="PUT", url=url, data=body,
                                 headers={"Content-Type": "application/json"})
                SigV4Auth(credentials, "aoss", region).add_auth(req)

                http_req = urllib.request.Request(
                    url, data=body, method="PUT",
                    headers=dict(req.headers),
                )
                with urllib.request.urlopen(http_req, timeout=30) as resp:
                    resp_body = resp.read().decode()
                    print(f"Index created: {resp_body}")
                    return
            except urllib.error.HTTPError as exc:
                resp_body = exc.read().decode()
                if "resource_already_exists_exception" in resp_body:
                    print(f"Index already exists: {index_name}")
                    return
                last_error = f"HTTP {exc.code}: {resp_body}"
                print(f"Attempt {attempt+1} failed: {last_error}")
            except Exception as exc:
                last_error = str(exc)
                print(f"Attempt {attempt+1} failed: {last_error}")
            time.sleep(10)

        raise RuntimeError(f"Failed to create index after retries: {last_error}")
""")


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

        # --- Custom resource Lambda to create the vector index ---

        index_creator_fn = lambda_.Function(
            self,
            "IndexCreatorFunction",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="index.handler",
            code=lambda_.Code.from_inline(_INDEX_CREATOR_CODE),
            timeout=Duration.minutes(5),
            memory_size=256,
        )
        index_creator_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["aoss:APIAccessAll"],
                resources=["*"],
            )
        )

        # Data access policy must grant both the KB service role AND the
        # index creator Lambda role permission to interact with the collection.
        data_access_policy = aoss.CfnAccessPolicy(
            self,
            "KbCollectionDataAccessPolicy",
            name=_safe_name(f"{prefix}-data"),
            type="data",
            policy=json.dumps(
                [
                    {
                        "Description": "Allow Bedrock KB role and index creator to read/write vectors.",
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
                        "Principal": [
                            kb_service_role.role_arn,
                            index_creator_fn.role.role_arn,
                        ],
                    }
                ]
            ),
            description="Data access policy for Bedrock KB service role and index creator.",
        )
        data_access_policy.add_dependency(collection)

        index_custom_resource = CustomResource(
            self,
            "VectorIndexCustomResource",
            service_token=index_creator_fn.function_arn,
            properties={
                "CollectionEndpoint": collection.attr_collection_endpoint,
                "IndexName": vector_index_name,
                "VectorDimension": "1024",
            },
        )
        index_custom_resource.node.add_dependency(data_access_policy)
        index_custom_resource.node.add_dependency(collection)

        # --- Knowledge Base ---

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
        knowledge_base.node.add_dependency(index_custom_resource)
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
                    inclusion_prefixes=["uploads/"],
                ),
            ),
            vector_ingestion_configuration=bedrock.CfnDataSource.VectorIngestionConfigurationProperty(
                chunking_configuration=bedrock.CfnDataSource.ChunkingConfigurationProperty(
                    chunking_strategy="FIXED_SIZE",
                    fixed_size_chunking_configuration=(
                        bedrock.CfnDataSource.FixedSizeChunkingConfigurationProperty(
                            max_tokens=800,
                            overlap_percentage=15,
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
