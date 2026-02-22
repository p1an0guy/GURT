"""Frontend infrastructure stack for static web hosting via CloudFront."""

from __future__ import annotations

from pathlib import Path

from aws_cdk import CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_cloudfront as cloudfront
from aws_cdk import aws_cloudfront_origins as origins
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_s3_deployment as s3_deployment
from constructs import Construct


class FrontendStack(Stack):
    """Deploys exported frontend assets to S3 and serves them via CloudFront."""

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        stage_name: str,
        frontend_asset_path: str,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        asset_path = Path(frontend_asset_path).resolve()
        if not asset_path.is_dir():
            raise ValueError(
                f"Frontend asset path does not exist: {asset_path}. "
                "Run scripts/build-frontend.sh before CDK synth/deploy."
            )

        site_bucket = s3.Bucket(
            self,
            "FrontendSiteBucket",
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            enforce_ssl=True,
            auto_delete_objects=True,
            removal_policy=RemovalPolicy.DESTROY,
        )

        uri_rewrite_function = cloudfront.Function(
            self,
            "FrontendUriRewriteFunction",
            code=cloudfront.FunctionCode.from_inline(
                """
function handler(event) {
  var request = event.request;
  var uri = request.uri || "/";

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
    return request;
  }

  if (!uri.includes(".")) {
    request.uri = uri + "/index.html";
    return request;
  }

  return request;
}
                """.strip()
            ),
        )

        distribution = cloudfront.Distribution(
            self,
            "FrontendDistribution",
            default_root_object="index.html",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin(site_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                function_associations=[
                    cloudfront.FunctionAssociation(
                        event_type=cloudfront.FunctionEventType.VIEWER_REQUEST,
                        function=uri_rewrite_function,
                    )
                ],
            ),
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.minutes(5),
                ),
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.minutes(5),
                ),
            ],
        )

        s3_deployment.BucketDeployment(
            self,
            "DeployFrontendAssets",
            destination_bucket=site_bucket,
            sources=[s3_deployment.Source.asset(str(asset_path))],
            distribution=distribution,
            distribution_paths=["/*"],
            prune=True,
        )

        frontend_url = f"https://{distribution.distribution_domain_name}"
        CfnOutput(
            self,
            "FrontendCloudFrontDomainName",
            value=distribution.distribution_domain_name,
            description=f"CloudFront domain name for {stage_name} frontend",
        )
        CfnOutput(
            self,
            "FrontendCloudFrontUrl",
            value=frontend_url,
            description=f"Public URL for {stage_name} frontend",
        )
