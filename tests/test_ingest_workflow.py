"""Unit tests for document ingest workflow and Bedrock KB trigger."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from backend.ingest_workflow import extract_handler, finalize_handler, start_textract_handler


def _finish_event(
    job_id: str = "ingest-test-123",
    doc_id: str = "doc-abc",
    course_id: str = "course-psych-101",
    source_key: str = "uploads/course-psych-101/doc-abc/syllabus.pdf",
    text: str = "Sample extracted text",
    used_textract: bool = False,
    error: str = "",
) -> dict:
    return {
        "jobId": job_id,
        "docId": doc_id,
        "courseId": course_id,
        "key": source_key,
        "text": text,
        "usedTextract": used_textract,
        "error": error,
    }


class FinalizeHandlerTests(unittest.TestCase):
    def setUp(self) -> None:
        self._table = mock.MagicMock()
        self._table.put_item = mock.MagicMock(return_value=None)
        self._table.update_item = mock.MagicMock(return_value=None)
        self._emit_metric_patcher = mock.patch(
            "backend.ingest_workflow._emit_operational_metric"
        )
        self._emit_metric = self._emit_metric_patcher.start()
        self.addCleanup(self._emit_metric_patcher.stop)

    def _patch_dynamodb(self) -> mock._patch:
        return mock.patch(
            "backend.ingest_workflow._dynamodb_table",
            return_value=self._table,
        )

    def _emitted_metric_names(self) -> list[str]:
        return [call.args[0] for call in self._emit_metric.call_args_list]

    def test_successful_finalize_triggers_kb_ingestion(self) -> None:
        """When status is FINISHED and KB ids are set, StartIngestionJob is called."""
        mock_bedrock = mock.MagicMock()
        mock_bedrock.start_ingestion_job.return_value = {
            "ingestionJob": {"ingestionJobId": "kb-ingest-xyz"},
        }
        event = _finish_event()

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {
                    "DOCS_TABLE": "test-docs",
                    "KNOWLEDGE_BASE_ID": "kb-123",
                    "KNOWLEDGE_BASE_DATA_SOURCE_ID": "ds-456",
                },
                clear=True,
            ):
                with mock.patch(
                    "backend.ingest_workflow._bedrock_agent_client",
                    return_value=mock_bedrock,
                ):
                    result = finalize_handler(event, None)

        self.assertEqual(result["status"], "FINISHED")
        self.assertEqual(result["jobId"], "ingest-test-123")
        mock_bedrock.start_ingestion_job.assert_called_once()
        call_kw = mock_bedrock.start_ingestion_job.call_args.kwargs
        self.assertEqual(call_kw["knowledgeBaseId"], "kb-123")
        self.assertEqual(call_kw["dataSourceId"], "ds-456")
        self.assertIn("clientToken", call_kw)
        self._table.update_item.assert_called()
        values = self._table.update_item.call_args.kwargs.get("ExpressionAttributeValues", {})
        self.assertEqual(values.get(":jid"), "kb-ingest-xyz")
        self.assertEqual(
            self._emitted_metric_names(),
            [
                "IngestFinalizeSuccess",
                "IngestKbTriggerStarted",
                "IngestKbTriggerSucceeded",
            ],
        )

    def test_trigger_failure_path_surfaced_with_actionable_error(self) -> None:
        """When StartIngestionJob fails, error is persisted and handler still returns FINISHED."""
        mock_bedrock = mock.MagicMock()
        mock_bedrock.start_ingestion_job.side_effect = Exception("bedrock:RateExceeded")
        event = _finish_event()

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {
                    "DOCS_TABLE": "test-docs",
                    "KNOWLEDGE_BASE_ID": "kb-123",
                    "DATA_SOURCE_ID": "ds-456",
                },
                clear=True,
            ):
                with mock.patch(
                    "backend.ingest_workflow._bedrock_agent_client",
                    return_value=mock_bedrock,
                ):
                    result = finalize_handler(event, None)

        self.assertEqual(result["status"], "FINISHED")
        self._table.update_item.assert_called()
        values = self._table.update_item.call_args.kwargs.get("ExpressionAttributeValues", {})
        err_val = values.get(":err", "")
        self.assertIn("KB ingestion trigger failed", str(err_val))
        self.assertIn("RateExceeded", str(err_val))
        self.assertEqual(
            self._emitted_metric_names(),
            [
                "IngestFinalizeSuccess",
                "IngestKbTriggerStarted",
                "IngestKbTriggerFailed",
            ],
        )

    def test_idempotent_client_token_for_same_source_revision(self) -> None:
        """Repeated finalize for same source_key and text length yields same clientToken."""
        mock_bedrock = mock.MagicMock()
        mock_bedrock.start_ingestion_job.return_value = {
            "ingestionJob": {"ingestionJobId": "kb-ingest-1"},
        }
        event = _finish_event(text="Same content length x")

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {
                    "DOCS_TABLE": "test-docs",
                    "KNOWLEDGE_BASE_ID": "kb-123",
                    "DATA_SOURCE_ID": "ds-456",
                },
                clear=True,
            ):
                with mock.patch(
                    "backend.ingest_workflow._bedrock_agent_client",
                    return_value=mock_bedrock,
                ):
                    finalize_handler(event, None)
                    first_token = mock_bedrock.start_ingestion_job.call_args.kwargs["clientToken"]
                    finalize_handler(event, None)
                    second_token = mock_bedrock.start_ingestion_job.call_args.kwargs["clientToken"]

        self.assertEqual(first_token, second_token)

    def test_missing_kb_ids_persists_actionable_error(self) -> None:
        """When KB ids are missing, error is persisted; handler still returns FINISHED."""
        event = _finish_event()

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {"DOCS_TABLE": "test-docs"},
                clear=True,
            ):
                result = finalize_handler(event, None)

        self.assertEqual(result["status"], "FINISHED")
        self._table.update_item.assert_called_once()
        values = self._table.update_item.call_args.kwargs.get("ExpressionAttributeValues", {})
        self.assertIn("KNOWLEDGE_BASE_ID", str(values.get(":err", "")))
        self.assertIn("DATA_SOURCE_ID", str(values.get(":err", "")))
        self.assertEqual(
            self._emitted_metric_names(),
            [
                "IngestFinalizeSuccess",
                "IngestKbTriggerMissingConfig",
            ],
        )

    def test_failed_status_skips_kb_ingestion(self) -> None:
        """When error is present, status is FAILED and KB ingestion is NOT triggered."""
        event = _finish_event(error="Textract failed")

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {
                    "DOCS_TABLE": "test-docs",
                    "KNOWLEDGE_BASE_ID": "kb-123",
                    "DATA_SOURCE_ID": "ds-456",
                },
                clear=True,
            ):
                with mock.patch(
                    "backend.ingest_workflow._bedrock_agent_client",
                    return_value=mock.MagicMock(),
                ) as mock_bedrock:
                    result = finalize_handler(event, None)

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"], "Textract failed")
        mock_bedrock.return_value.start_ingestion_job.assert_not_called()
        self._table.put_item.assert_called_once()
        item = self._table.put_item.call_args.kwargs["Item"]
        self.assertEqual(item["status"], "FAILED")
        self._table.update_item.assert_not_called()
        self.assertEqual(self._emitted_metric_names(), ["IngestFinalizeFailure"])

    def test_invalid_event_non_dict_raises_value_error(self) -> None:
        """Non-dict event raises ValueError."""
        with self.assertRaises(ValueError) as ctx:
            finalize_handler([], None)
        self.assertIn("event must be a JSON object", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx2:
            finalize_handler("not a dict", None)
        self.assertIn("event must be a JSON object", str(ctx2.exception))

    def test_missing_job_id_raises_value_error(self) -> None:
        """Missing jobId raises ValueError."""
        event = _finish_event(job_id="")

        with self._patch_dynamodb():
            with mock.patch.dict(os.environ, {"DOCS_TABLE": "test-docs"}, clear=True):
                with self.assertRaises(ValueError) as ctx:
                    finalize_handler(event, None)
        self.assertIn("jobId", str(ctx.exception))

    def test_missing_doc_id_raises_value_error(self) -> None:
        """Missing docId raises ValueError."""
        event = _finish_event(doc_id="")

        with self._patch_dynamodb():
            with mock.patch.dict(os.environ, {"DOCS_TABLE": "test-docs"}, clear=True):
                with self.assertRaises(ValueError) as ctx:
                    finalize_handler(event, None)
        self.assertIn("docId", str(ctx.exception))

    def test_missing_course_id_raises_value_error(self) -> None:
        """Missing courseId raises ValueError."""
        event = _finish_event(course_id="")

        with self._patch_dynamodb():
            with mock.patch.dict(os.environ, {"DOCS_TABLE": "test-docs"}, clear=True):
                with self.assertRaises(ValueError) as ctx:
                    finalize_handler(event, None)
        self.assertIn("courseId", str(ctx.exception))

    def test_missing_key_raises_value_error(self) -> None:
        """Missing key raises ValueError."""
        event = _finish_event(source_key="")

        with self._patch_dynamodb():
            with mock.patch.dict(os.environ, {"DOCS_TABLE": "test-docs"}, clear=True):
                with self.assertRaises(ValueError) as ctx:
                    finalize_handler(event, None)
        self.assertIn("key", str(ctx.exception))

    def test_different_inputs_yield_different_client_tokens(self) -> None:
        """Different source_key or text length yields different clientToken."""
        mock_bedrock = mock.MagicMock()
        mock_bedrock.start_ingestion_job.return_value = {
            "ingestionJob": {"ingestionJobId": "kb-ingest-1"},
        }

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {
                    "DOCS_TABLE": "test-docs",
                    "KNOWLEDGE_BASE_ID": "kb-123",
                    "DATA_SOURCE_ID": "ds-456",
                },
                clear=True,
            ):
                with mock.patch(
                    "backend.ingest_workflow._bedrock_agent_client",
                    return_value=mock_bedrock,
                ):
                    finalize_handler(_finish_event(source_key="path/a.pdf", text="x"), None)
                    token_a = mock_bedrock.start_ingestion_job.call_args.kwargs["clientToken"]

                    finalize_handler(_finish_event(source_key="path/b.pdf", text="x"), None)
                    token_b = mock_bedrock.start_ingestion_job.call_args.kwargs["clientToken"]

                    finalize_handler(_finish_event(source_key="path/a.pdf", text="xy"), None)
                    token_c = mock_bedrock.start_ingestion_job.call_args.kwargs["clientToken"]

        self.assertNotEqual(token_a, token_b)
        self.assertNotEqual(token_a, token_c)

    def test_successful_finalize_persists_status_via_put_item(self) -> None:
        """Successful finalize persists initial status via put_item before KB update."""
        mock_bedrock = mock.MagicMock()
        mock_bedrock.start_ingestion_job.return_value = {
            "ingestionJob": {"ingestionJobId": "kb-ingest-xyz"},
        }
        event = _finish_event(
            job_id="job-99",
            doc_id="doc-99",
            course_id="course-99",
            source_key="uploads/course-99/doc-99/notes.pdf",
            text="Extracted content",
            used_textract=True,
        )

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {
                    "DOCS_TABLE": "test-docs",
                    "KNOWLEDGE_BASE_ID": "kb-123",
                    "DATA_SOURCE_ID": "ds-456",
                },
                clear=True,
            ):
                with mock.patch(
                    "backend.ingest_workflow._bedrock_agent_client",
                    return_value=mock_bedrock,
                ):
                    finalize_handler(event, None)

        self._table.put_item.assert_called_once()
        item = self._table.put_item.call_args.kwargs["Item"]
        self.assertEqual(item["docId"], "job-99")
        self.assertEqual(item["entityType"], "IngestJob")
        self.assertEqual(item["jobId"], "job-99")
        self.assertEqual(item["sourceDocId"], "doc-99")
        self.assertEqual(item["courseId"], "course-99")
        self.assertEqual(item["sourceKey"], "uploads/course-99/doc-99/notes.pdf")
        self.assertEqual(item["status"], "FINISHED")
        self.assertEqual(item["textLength"], len("Extracted content"))
        self.assertEqual(item["usedTextract"], True)
        self.assertEqual(item["error"], "")

    def test_docs_table_missing_raises_runtime_error(self) -> None:
        """When DOCS_TABLE is missing, handler propagates RuntimeError from table layer."""
        event = _finish_event()
        table_error = RuntimeError("server misconfiguration: DOCS_TABLE missing")

        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch(
                "backend.ingest_workflow._dynamodb_table",
                side_effect=table_error,
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    finalize_handler(event, None)
        self.assertIs(ctx.exception, table_error)

    def test_only_knowledge_base_id_missing_persists_error(self) -> None:
        """When only DATA_SOURCE_ID is set, error is persisted."""
        event = _finish_event()

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {"DOCS_TABLE": "test-docs", "DATA_SOURCE_ID": "ds-456"},
                clear=True,
            ):
                result = finalize_handler(event, None)

        self.assertEqual(result["status"], "FINISHED")
        values = self._table.update_item.call_args.kwargs.get("ExpressionAttributeValues", {})
        self.assertIn("KNOWLEDGE_BASE_ID", str(values.get(":err", "")))

    def test_only_data_source_id_missing_persists_error(self) -> None:
        """When only KNOWLEDGE_BASE_ID is set, error is persisted."""
        event = _finish_event()

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {"DOCS_TABLE": "test-docs", "KNOWLEDGE_BASE_ID": "kb-123"},
                clear=True,
            ):
                result = finalize_handler(event, None)

        self.assertEqual(result["status"], "FINISHED")
        values = self._table.update_item.call_args.kwargs.get("ExpressionAttributeValues", {})
        self.assertIn("DATA_SOURCE_ID", str(values.get(":err", "")))

    def test_whitespace_only_error_treated_as_finished(self) -> None:
        """Whitespace-only error is stripped; status is FINISHED and KB is triggered."""
        mock_bedrock = mock.MagicMock()
        mock_bedrock.start_ingestion_job.return_value = {
            "ingestionJob": {"ingestionJobId": "kb-ingest-xyz"},
        }
        event = _finish_event(error="   ")

        with self._patch_dynamodb():
            with mock.patch.dict(
                os.environ,
                {
                    "DOCS_TABLE": "test-docs",
                    "KNOWLEDGE_BASE_ID": "kb-123",
                    "DATA_SOURCE_ID": "ds-456",
                },
                clear=True,
            ):
                with mock.patch(
                    "backend.ingest_workflow._bedrock_agent_client",
                    return_value=mock_bedrock,
                ):
                    result = finalize_handler(event, None)

        self.assertEqual(result["status"], "FINISHED")
        mock_bedrock.start_ingestion_job.assert_called_once()


class ExtractAndTextractRoutingTests(unittest.TestCase):
    def test_extract_handler_converts_pptx_and_sets_textract_key(self) -> None:
        event = {
            "bucket": "uploads-bucket",
            "key": "uploads/course-1/doc-1/week-1-slides.pptx",
            "threshold": 200,
        }
        with mock.patch(
            "backend.ingest_workflow._read_s3_bytes",
            return_value=b"pptx-bytes",
        ):
            with mock.patch(
                "backend.ingest_workflow._convert_pptx_to_pdf",
                return_value=b"%PDF-1.7 fake",
            ) as convert_mock:
                with mock.patch("backend.ingest_workflow._write_s3_bytes") as write_mock:
                    with mock.patch(
                        "backend.ingest_workflow._extract_text_with_pymupdf",
                        return_value="slide text",
                    ) as extract_mock:
                        result = extract_handler(event, None)

        convert_mock.assert_called_once_with(b"pptx-bytes")
        write_mock.assert_called_once()
        self.assertEqual(result["text"], "slide text")
        self.assertEqual(
            result["textractKey"],
            "uploads/course-1/doc-1/week-1-slides.converted.pdf",
        )
        extract_mock.assert_called_once_with(
            b"%PDF-1.7 fake",
            "uploads/course-1/doc-1/week-1-slides.converted.pdf",
        )

    def test_extract_handler_rejects_oversized_pptx(self) -> None:
        event = {
            "bucket": "uploads-bucket",
            "key": "uploads/course-1/doc-1/week-1-slides.pptx",
            "threshold": 200,
        }
        oversized = b"a" * (50 * 1024 * 1024 + 1)
        with mock.patch("backend.ingest_workflow._read_s3_bytes", return_value=oversized):
            with self.assertRaisesRegex(ValueError, "50MB"):
                extract_handler(event, None)

    def test_extract_handler_converts_docx_and_sets_textract_key(self) -> None:
        event = {
            "bucket": "uploads-bucket",
            "key": "uploads/course-1/doc-1/week-1-notes.docx",
            "threshold": 200,
        }
        with mock.patch(
            "backend.ingest_workflow._read_s3_bytes",
            return_value=b"docx-bytes",
        ):
            with mock.patch(
                "backend.ingest_workflow._convert_docx_to_pdf",
                return_value=b"%PDF-1.7 fake",
            ) as convert_mock:
                with mock.patch("backend.ingest_workflow._write_s3_bytes") as write_mock:
                    with mock.patch(
                        "backend.ingest_workflow._extract_text_with_pymupdf",
                        return_value="doc text",
                    ) as extract_mock:
                        result = extract_handler(event, None)

        convert_mock.assert_called_once_with(b"docx-bytes")
        write_mock.assert_called_once()
        self.assertEqual(result["text"], "doc text")
        self.assertEqual(
            result["textractKey"],
            "uploads/course-1/doc-1/week-1-notes.converted.pdf",
        )
        extract_mock.assert_called_once_with(
            b"%PDF-1.7 fake",
            "uploads/course-1/doc-1/week-1-notes.converted.pdf",
        )

    def test_extract_handler_rejects_oversized_docx(self) -> None:
        event = {
            "bucket": "uploads-bucket",
            "key": "uploads/course-1/doc-1/week-1-notes.docx",
            "threshold": 200,
        }
        oversized = b"a" * (50 * 1024 * 1024 + 1)
        with mock.patch("backend.ingest_workflow._read_s3_bytes", return_value=oversized):
            with self.assertRaisesRegex(ValueError, "50MB"):
                extract_handler(event, None)

    def test_extract_handler_converts_doc_and_sets_textract_key(self) -> None:
        event = {
            "bucket": "uploads-bucket",
            "key": "uploads/course-1/doc-1/week-1-notes.doc",
            "threshold": 200,
        }
        with mock.patch(
            "backend.ingest_workflow._read_s3_bytes",
            return_value=b"doc-bytes",
        ):
            with mock.patch(
                "backend.ingest_workflow._convert_doc_to_pdf",
                return_value=b"%PDF-1.7 fake",
            ) as convert_mock:
                with mock.patch("backend.ingest_workflow._write_s3_bytes") as write_mock:
                    with mock.patch(
                        "backend.ingest_workflow._extract_text_with_pymupdf",
                        return_value="doc text",
                    ) as extract_mock:
                        result = extract_handler(event, None)

        convert_mock.assert_called_once_with(b"doc-bytes")
        write_mock.assert_called_once()
        self.assertEqual(result["text"], "doc text")
        self.assertEqual(
            result["textractKey"],
            "uploads/course-1/doc-1/week-1-notes.converted.pdf",
        )
        extract_mock.assert_called_once_with(
            b"%PDF-1.7 fake",
            "uploads/course-1/doc-1/week-1-notes.converted.pdf",
        )

    def test_extract_handler_rejects_oversized_doc(self) -> None:
        event = {
            "bucket": "uploads-bucket",
            "key": "uploads/course-1/doc-1/week-1-notes.doc",
            "threshold": 200,
        }
        oversized = b"a" * (50 * 1024 * 1024 + 1)
        with mock.patch("backend.ingest_workflow._read_s3_bytes", return_value=oversized):
            with self.assertRaisesRegex(ValueError, "50MB"):
                extract_handler(event, None)

    def test_start_textract_uses_textract_key_when_present(self) -> None:
        event = {
            "bucket": "uploads-bucket",
            "key": "uploads/course-1/doc-1/week-1-slides.pptx",
            "textractKey": "uploads/course-1/doc-1/week-1-slides.converted.pdf",
        }
        fake_client = mock.MagicMock()
        fake_client.start_document_text_detection.return_value = {"JobId": "textract-job-1"}
        with mock.patch("backend.ingest_workflow._textract_client", return_value=fake_client):
            result = start_textract_handler(event, None)

        kwargs = fake_client.start_document_text_detection.call_args.kwargs
        self.assertEqual(
            kwargs["DocumentLocation"]["S3Object"]["Name"],
            "uploads/course-1/doc-1/week-1-slides.converted.pdf",
        )
        self.assertEqual(result["textractJobId"], "textract-job-1")
