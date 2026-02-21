#!/usr/bin/env python3
"""Unit tests for RAG upload foundation flow."""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.uploads import UploadValidationError, create_upload, lambda_handler, parse_upload_request


class FakeS3Client:
    """Minimal fake for boto3 S3 presign calls."""

    def __init__(self, upload_url: str = "https://s3.example.com/presigned") -> None:
        self.upload_url = upload_url
        self.calls = []

    def generate_presigned_url(self, ClientMethod, Params, ExpiresIn, HttpMethod=None):  # noqa: N803
        self.calls.append(
            {
                "ClientMethod": ClientMethod,
                "Params": Params,
                "ExpiresIn": ExpiresIn,
                "HttpMethod": HttpMethod,
            }
        )
        return self.upload_url


class UploadFlowTests(unittest.TestCase):
    def test_parse_upload_request_rejects_unsupported_content_type(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "notes.md",
            "contentType": "text/markdown",
        }

        with self.assertRaisesRegex(UploadValidationError, "contentType"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_path_like_filename(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "nested/notes.pdf",
            "contentType": "application/pdf",
        }

        with self.assertRaisesRegex(UploadValidationError, "filename"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_pdf_content_type_with_non_pdf_filename(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.txt",
            "contentType": "application/pdf",
        }

        with self.assertRaisesRegex(UploadValidationError, "\\.pdf"):
            parse_upload_request(payload)

    def test_parse_upload_request_accepts_pptx_with_valid_extension_and_size(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-slides.pptx",
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "contentLengthBytes": 1024,
        }
        parsed = parse_upload_request(payload)
        self.assertEqual(parsed.filename, "week-1-slides.pptx")

    def test_parse_upload_request_rejects_pptx_without_size(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-slides.pptx",
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }
        with self.assertRaisesRegex(UploadValidationError, "contentLengthBytes"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_pptx_over_size_limit(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-slides.pptx",
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "contentLengthBytes": 50 * 1024 * 1024 + 1,
        }
        with self.assertRaisesRegex(UploadValidationError, "50MB"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_pptx_content_type_with_non_pptx_filename(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-slides.pdf",
            "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "contentLengthBytes": 1024,
        }
        with self.assertRaisesRegex(UploadValidationError, "\\.pptx"):
            parse_upload_request(payload)

    def test_parse_upload_request_accepts_docx_with_valid_extension_and_size(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.docx",
            "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "contentLengthBytes": 1024,
        }
        parsed = parse_upload_request(payload)
        self.assertEqual(parsed.filename, "week-1-notes.docx")

    def test_parse_upload_request_rejects_docx_without_size(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.docx",
            "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
        with self.assertRaisesRegex(UploadValidationError, "contentLengthBytes"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_docx_over_size_limit(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.docx",
            "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "contentLengthBytes": 50 * 1024 * 1024 + 1,
        }
        with self.assertRaisesRegex(UploadValidationError, "50MB"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_docx_content_type_with_non_docx_filename(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.pdf",
            "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "contentLengthBytes": 1024,
        }
        with self.assertRaisesRegex(UploadValidationError, "\\.docx"):
            parse_upload_request(payload)

    def test_parse_upload_request_accepts_doc_with_valid_extension_and_size(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.doc",
            "contentType": "application/msword",
            "contentLengthBytes": 1024,
        }
        parsed = parse_upload_request(payload)
        self.assertEqual(parsed.filename, "week-1-notes.doc")

    def test_parse_upload_request_rejects_doc_without_size(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.doc",
            "contentType": "application/msword",
        }
        with self.assertRaisesRegex(UploadValidationError, "contentLengthBytes"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_doc_over_size_limit(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.doc",
            "contentType": "application/msword",
            "contentLengthBytes": 50 * 1024 * 1024 + 1,
        }
        with self.assertRaisesRegex(UploadValidationError, "50MB"):
            parse_upload_request(payload)

    def test_parse_upload_request_rejects_doc_content_type_with_non_doc_filename(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.pdf",
            "contentType": "application/msword",
            "contentLengthBytes": 1024,
        }
        with self.assertRaisesRegex(UploadValidationError, "\\.doc"):
            parse_upload_request(payload)

    def test_create_upload_happy_path_wires_presign_and_returns_doc_id_and_key(self) -> None:
        s3_client = FakeS3Client()
        payload = {
            "courseId": "course-psych-101",
            "filename": "week-1-notes.pdf",
            "contentType": "application/pdf",
        }

        response = create_upload(
            payload,
            uploads_bucket="studybuddy-rag-upload-bucket",
            s3_client=s3_client,
            doc_id_factory=lambda: "doc-1234",
        )

        self.assertEqual(response["docId"], "doc-1234")
        self.assertEqual(response["key"], "uploads/course-psych-101/doc-1234/week-1-notes.pdf")
        self.assertEqual(response["uploadUrl"], "https://s3.example.com/presigned")
        self.assertEqual(response["contentType"], "application/pdf")
        self.assertEqual(response["expiresInSeconds"], 900)

        self.assertEqual(
            s3_client.calls,
            [
                {
                    "ClientMethod": "put_object",
                    "Params": {
                        "Bucket": "studybuddy-rag-upload-bucket",
                        "Key": "uploads/course-psych-101/doc-1234/week-1-notes.pdf",
                        "ContentType": "application/pdf",
                    },
                    "ExpiresIn": 900,
                    "HttpMethod": "PUT",
                }
            ],
        )

    def test_lambda_handler_happy_path_returns_200_and_payload(self) -> None:
        previous_bucket = os.environ.get("UPLOADS_BUCKET")
        os.environ["UPLOADS_BUCKET"] = "studybuddy-rag-upload-bucket"
        self.addCleanup(self._restore_bucket_env, previous_bucket)

        s3_client = FakeS3Client()
        event = {
            "body": json.dumps(
                {
                    "courseId": "course-psych-101",
                    "filename": "week-1-notes.pdf",
                    "contentType": "application/pdf",
                }
            )
        }

        response = lambda_handler(event, None, s3_client=s3_client)
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(body["docId"].startswith("doc-"))
        self.assertTrue(body["key"].startswith("uploads/course-psych-101/"))
        self.assertEqual(body["contentType"], "application/pdf")

    def test_lambda_handler_returns_400_for_validation_errors(self) -> None:
        previous_bucket = os.environ.get("UPLOADS_BUCKET")
        os.environ["UPLOADS_BUCKET"] = "studybuddy-rag-upload-bucket"
        self.addCleanup(self._restore_bucket_env, previous_bucket)

        event = {"body": json.dumps({"courseId": "", "filename": "notes.pdf", "contentType": "application/pdf"})}
        response = lambda_handler(event, None, s3_client=FakeS3Client())
        body = json.loads(response["body"])

        self.assertEqual(response["statusCode"], 400)
        self.assertIn("error", body)

    def test_parse_upload_request_error_lists_supported_content_types(self) -> None:
        payload = {
            "courseId": "course-psych-101",
            "filename": "notes.md",
            "contentType": "text/markdown",
        }
        with self.assertRaisesRegex(
            UploadValidationError,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ):
            parse_upload_request(payload)
        with self.assertRaisesRegex(
            UploadValidationError,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ):
            parse_upload_request(payload)
        with self.assertRaisesRegex(
            UploadValidationError,
            "application/msword",
        ):
            parse_upload_request(payload)

    @staticmethod
    def _restore_bucket_env(previous_bucket: str | None) -> None:
        if previous_bucket is None:
            os.environ.pop("UPLOADS_BUCKET", None)
            return
        os.environ["UPLOADS_BUCKET"] = previous_bucket


if __name__ == "__main__":
    unittest.main()
