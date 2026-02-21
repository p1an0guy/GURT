"""Unit tests for Bedrock generation helpers."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend import generation


class RetrieveContextTests(unittest.TestCase):
    def test_source_scope_matches_supported_upload_layouts(self) -> None:
        self.assertTrue(
            generation._source_in_course_scope(
                source="s3://bucket/uploads/170880/doc-1/syllabus.pdf",
                course_id="170880",
            )
        )
        self.assertTrue(
            generation._source_in_course_scope(
                source="s3://bucket/uploads/canvas-materials/user-123/170880/file-1/ch1.pdf",
                course_id="170880",
            )
        )
        self.assertFalse(
            generation._source_in_course_scope(
                source="s3://bucket/uploads/999999/doc-1/syllabus.pdf",
                course_id="170880",
            )
        )

    @patch.dict("os.environ", {"KNOWLEDGE_BASE_ID": "kb-test"}, clear=False)
    def test_retrieve_context_keeps_only_rows_for_requested_course(self) -> None:
        client = MagicMock()
        client.retrieve.return_value = {
            "retrievalResults": [
                {
                    "content": {"text": "POLS textbook details"},
                    "location": {"s3Location": {"uri": "s3://bucket/uploads/170880/doc-a/syllabus.pdf"}},
                },
                {
                    "content": {"text": "C++ syllabus details"},
                    "location": {"s3Location": {"uri": "s3://bucket/uploads/424242/doc-b/syllabus.pdf"}},
                },
                {
                    "content": {"text": "POLS module notes"},
                    "location": {
                        "s3Location": {
                            "uri": "s3://bucket/uploads/canvas-materials/user-1/170880/file-2/module-notes.pdf"
                        }
                    },
                },
            ]
        }

        with patch("backend.generation._bedrock_agent_runtime", return_value=client):
            rows = generation._retrieve_context(course_id="170880", query="textbook", k=2)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["text"], "POLS textbook details")
        self.assertEqual(rows[1]["text"], "POLS module notes")
        self.assertTrue(all("170880" in row["source"] for row in rows))

        retrieve_call = client.retrieve.call_args.kwargs
        vector_config = retrieve_call["retrievalConfiguration"]["vectorSearchConfiguration"]
        self.assertEqual(vector_config["numberOfResults"], 8)
        self.assertEqual(
            vector_config["filter"],
            {"equals": {"key": "courseId", "value": "170880"}},
        )

    @patch.dict("os.environ", {"KNOWLEDGE_BASE_ID": "kb-test"}, clear=False)
    def test_retrieve_context_falls_back_when_filter_query_is_rejected(self) -> None:
        client = MagicMock()
        client.retrieve.side_effect = [
            RuntimeError("unknown filter key courseId"),
            {
                "retrievalResults": [
                    {
                        "content": {"text": "POLS textbook details"},
                        "location": {"s3Location": {"uri": "s3://bucket/uploads/170880/doc-a/syllabus.pdf"}},
                    }
                ]
            },
        ]

        with patch("backend.generation._bedrock_agent_runtime", return_value=client):
            rows = generation._retrieve_context(course_id="170880", query="textbook", k=1)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["text"], "POLS textbook details")
        self.assertEqual(client.retrieve.call_count, 2)

        first_call = client.retrieve.call_args_list[0].kwargs
        second_call = client.retrieve.call_args_list[1].kwargs
        first_vector = first_call["retrievalConfiguration"]["vectorSearchConfiguration"]
        second_vector = second_call["retrievalConfiguration"]["vectorSearchConfiguration"]
        self.assertIn("filter", first_vector)
        self.assertNotIn("filter", second_vector)


if __name__ == "__main__":
    unittest.main()
