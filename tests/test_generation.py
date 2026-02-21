"""Unit tests for Bedrock generation helpers."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend import generation


class RetrieveContextTests(unittest.TestCase):
    def test_source_scope_matches_supported_upload_layouts(self) -> None:
        # With uploads/ prefix
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

    def test_source_scope_matches_without_uploads_prefix(self) -> None:
        # KB data source may strip the uploads/ prefix from S3 URIs
        self.assertTrue(
            generation._source_in_course_scope(
                source="s3://bucket/canvas-materials/user-123/170880/file-1/ch1.pdf",
                course_id="170880",
            )
        )
        self.assertTrue(
            generation._source_in_course_scope(
                source="s3://bucket/170880/doc-1/syllabus.pdf",
                course_id="170880",
            )
        )
        self.assertFalse(
            generation._source_in_course_scope(
                source="s3://bucket/canvas-materials/user-123/999999/file-1/ch1.pdf",
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


class GenerationCitationTests(unittest.TestCase):
    def test_generate_flashcards_falls_back_to_context_citations(self) -> None:
        with (
            patch(
                "backend.generation._retrieve_context",
                return_value=[
                    {"text": "Context row 1", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1"},
                    {"text": "Context row 2", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-2"},
                ],
            ),
            patch(
                "backend.generation._invoke_model_json",
                return_value=[
                    {
                        "id": "card-1",
                        "courseId": "170880",
                        "topicId": "topic-a",
                        "prompt": "What is federalism?",
                        "answer": "A division of powers.",
                    }
                ],
            ),
        ):
            cards = generation.generate_flashcards(course_id="170880", num_cards=1)

        self.assertEqual(len(cards), 1)
        self.assertEqual(
            cards[0]["citations"],
            [
                "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1",
                "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-2",
            ],
        )

    def test_generate_practice_exam_prefers_model_citations(self) -> None:
        with (
            patch(
                "backend.generation._retrieve_context",
                return_value=[
                    {"text": "Context row 1", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1"},
                ],
            ),
            patch(
                "backend.generation._invoke_model_json",
                return_value={
                    "courseId": "170880",
                    "generatedAt": "2026-09-02T08:30:00Z",
                    "questions": [
                        {
                            "id": "q-1",
                            "prompt": "Which branch interprets laws?",
                            "choices": ["Judicial", "Executive"],
                            "answerIndex": 0,
                            "citations": ["s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-9"],
                        }
                    ],
                },
            ),
        ):
            exam = generation.generate_practice_exam(course_id="170880", num_questions=1)

        self.assertEqual(exam["courseId"], "170880")
        self.assertEqual(len(exam["questions"]), 1)
        self.assertEqual(
            exam["questions"][0]["citations"],
            ["s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-9"],
        )


class FormatCanvasItemsTests(unittest.TestCase):
    def test_format_canvas_items_returns_none_for_empty_list(self) -> None:
        self.assertIsNone(generation.format_canvas_items([]))

    def test_format_canvas_items_produces_compact_lines(self) -> None:
        items = [
            {
                "title": "Midterm Exam",
                "itemType": "exam",
                "dueAt": "2026-10-15T17:00:00Z",
                "pointsPossible": 100,
            },
            {
                "title": "Reading 1",
                "itemType": "assignment",
                "dueAt": "2026-09-05T23:59:00Z",
                "pointsPossible": None,
            },
        ]
        result = generation.format_canvas_items(items)
        self.assertIsNotNone(result)
        lines = result.split("\n")
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0], "exam | Midterm Exam | due 2026-10-15T17:00:00Z | 100 pts")
        self.assertEqual(lines[1], "assignment | Reading 1 | due 2026-09-05T23:59:00Z | ungraded")

    def test_format_canvas_items_handles_missing_fields(self) -> None:
        items = [{}]
        result = generation.format_canvas_items(items)
        self.assertIsNotNone(result)
        self.assertEqual(result, "unknown | Untitled | due no due date | ungraded")


class ChatCanvasContextTests(unittest.TestCase):
    def test_chat_answer_includes_canvas_context_in_prompt(self) -> None:
        canvas_ctx = "exam | Midterm | due 2026-10-15T17:00:00Z | 100 pts"
        with (
            patch(
                "backend.generation._retrieve_context",
                return_value=[
                    {"text": "Context row 1", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1"},
                ],
            ),
            patch(
                "backend.generation._invoke_model_json",
                return_value={"answer": "The midterm is on October 15.", "citations": []},
            ) as invoke_mock,
        ):
            response = generation.chat_answer(course_id="170880", question="When is the midterm?", canvas_context=canvas_ctx)

        self.assertEqual(response["answer"], "The midterm is on October 15.")
        prompt_text = invoke_mock.call_args.args[0]
        self.assertIn("Canvas assignment data:", prompt_text)
        self.assertIn("Midterm", prompt_text)
        self.assertIn("assignment data", prompt_text)

    def test_chat_answer_works_without_canvas_context(self) -> None:
        with (
            patch(
                "backend.generation._retrieve_context",
                return_value=[
                    {"text": "Context row 1", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1"},
                ],
            ),
            patch(
                "backend.generation._invoke_model_json",
                return_value={"answer": "Some answer.", "citations": []},
            ) as invoke_mock,
        ):
            response = generation.chat_answer(course_id="170880", question="What is this?")

        self.assertEqual(response["answer"], "Some answer.")
        prompt_text = invoke_mock.call_args.args[0]
        self.assertNotIn("Canvas assignment data:", prompt_text)


class ChatCitationTests(unittest.TestCase):
    def test_chat_falls_back_to_context_citations_when_model_omits_citations(self) -> None:
        with (
            patch(
                "backend.generation._retrieve_context",
                return_value=[
                    {"text": "Context row 1", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1"},
                    {"text": "Context row 2", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-2"},
                ],
            ),
            patch(
                "backend.generation._invoke_model_json",
                return_value={"answer": "The judicial branch interprets laws."},
            ),
        ):
            response = generation.chat_answer(course_id="170880", question="Who interprets laws?")

        self.assertEqual(response["answer"], "The judicial branch interprets laws.")
        self.assertEqual(
            response["citations"],
            [
                "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1",
                "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-2",
            ],
        )

    def test_chat_prefers_model_citations_when_present(self) -> None:
        with (
            patch(
                "backend.generation._retrieve_context",
                return_value=[
                    {"text": "Context row 1", "source": "s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-1"},
                ],
            ),
            patch(
                "backend.generation._invoke_model_json",
                return_value={
                    "answer": "Federalism divides powers.",
                    "citations": ["s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-9"],
                },
            ),
        ):
            response = generation.chat_answer(course_id="170880", question="What is federalism?")

        self.assertEqual(response["answer"], "Federalism divides powers.")
        self.assertEqual(
            response["citations"],
            ["s3://bucket/uploads/170880/doc-a/ch1.pdf#chunk-9"],
        )


if __name__ == "__main__":
    unittest.main()
