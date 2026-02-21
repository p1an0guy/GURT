"""Bedrock Knowledge Base-backed generation helpers."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class GenerationError(RuntimeError):
    """Raised for retrieval or model generation failures."""


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise GenerationError(f"server misconfiguration: {name} missing")
    return value


def _bedrock_agent_runtime() -> Any:
    import boto3

    return boto3.client("bedrock-agent-runtime")


def _bedrock_runtime() -> Any:
    import boto3

    return boto3.client("bedrock-runtime")


def _utc_now_rfc3339() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _extract_source(location: Any) -> str:
    if isinstance(location, str):
        return location.strip()
    if not isinstance(location, dict):
        return ""

    s3_location = location.get("s3Location")
    if isinstance(s3_location, dict):
        uri = s3_location.get("uri")
        if isinstance(uri, str):
            return uri.strip()

    web_location = location.get("webLocation")
    if isinstance(web_location, dict):
        url = web_location.get("url")
        if isinstance(url, str):
            return url.strip()

    uri = location.get("uri")
    if isinstance(uri, str):
        return uri.strip()

    url = location.get("url")
    if isinstance(url, str):
        return url.strip()

    return ""


def _s3_key_from_source(source: str) -> str | None:
    parsed = urlparse(source)
    if parsed.scheme != "s3":
        return None
    return unquote(parsed.path.lstrip("/"))


def _source_in_course_scope(*, source: str, course_id: str) -> bool:
    key = _s3_key_from_source(source)
    if not key:
        return False

    parts = [part for part in key.split("/") if part]
    if not parts:
        return False

    # Strip optional "uploads" prefix – the KB data source root may omit it.
    if parts[0] == "uploads":
        parts = parts[1:]
    if not parts:
        return False

    # Canvas materials: [uploads/]canvas-materials/{userId}/{courseId}/...
    if parts[0] == "canvas-materials":
        return len(parts) >= 3 and parts[2] == course_id

    # User uploads: [uploads/]{courseId}/{docId}/{filename}
    return parts[0] == course_id


def _retrieve_response_with_fallback(*, client: Any, kb_id: str, query: str, num_results: int, course_id: str) -> dict[str, Any]:
    filtered_config = {
        "vectorSearchConfiguration": {
            "numberOfResults": num_results,
            "filter": {"equals": {"key": "courseId", "value": course_id}},
        }
    }
    unfiltered_config = {
        "vectorSearchConfiguration": {
            "numberOfResults": num_results,
        }
    }
    try:
        result = client.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": f"course:{course_id}\n{query}"},
            retrievalConfiguration=filtered_config,
        )
        if result.get("retrievalResults"):
            print(f"[KB-DEBUG] filtered query returned {len(result['retrievalResults'])} results for course_id={course_id}")
            return result
        print(f"[KB-DEBUG] filtered query returned 0 results for course_id={course_id}, falling back to unfiltered")
    except Exception as exc:
        print(f"[KB-DEBUG] filtered query FAILED for course_id={course_id}, falling back: {exc}")

    result = client.retrieve(
        knowledgeBaseId=kb_id,
        retrievalQuery={"text": f"course:{course_id}\n{query}"},
        retrievalConfiguration=unfiltered_config,
    )
    print(f"[KB-DEBUG] unfiltered query returned {len(result.get('retrievalResults', []))} results")
    return result


def _retrieve_context(*, course_id: str, query: str, k: int = 8) -> list[dict[str, str]]:
    kb_id = _require_env("KNOWLEDGE_BASE_ID")
    client = _bedrock_agent_runtime()
    num_results = max(k * 4, k)
    try:
        response = _retrieve_response_with_fallback(
            client=client,
            kb_id=kb_id,
            query=query,
            num_results=num_results,
            course_id=course_id,
        )
    except Exception as exc:  # pragma: no cover - boto3 service failure path
        raise GenerationError(f"knowledge base retrieval failed: {exc}") from exc

    results = response.get("retrievalResults", [])
    print(f"[KB-DEBUG] course_id={course_id} raw_results={len(results)}")
    context: list[dict[str, str]] = []
    for row in results:
        content = row.get("content")
        text = content.get("text") if isinstance(content, dict) else None
        if not isinstance(text, str) or not text.strip():
            print(f"[KB-DEBUG] skipped result: empty text")
            continue
        source = _extract_source(row.get("location"))
        if not _source_in_course_scope(source=source, course_id=course_id):
            print(f"[KB-DEBUG] filtered out: source={source} course_id={course_id}")
            continue
        context.append({"text": text.strip(), "source": source})
    print(f"[KB-DEBUG] course_id={course_id} after_filter={len(context)} from_raw={len(results)}")
    return context[:k]


def _invoke_model_json(prompt: str, *, max_tokens: int = 1800) -> Any:
    model_id = _require_env("BEDROCK_MODEL_ID")
    client = _bedrock_runtime()
    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
    }
    try:
        response = client.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body).encode("utf-8"),
        )
    except Exception as exc:  # pragma: no cover - boto3 service failure path
        raise GenerationError(f"model invocation failed: {exc}") from exc

    try:
        payload = json.loads(response["body"].read().decode("utf-8"))
    except (json.JSONDecodeError, KeyError, AttributeError) as exc:
        raise GenerationError("model returned unreadable response") from exc

    chunks = payload.get("content", [])
    if not isinstance(chunks, list) or not chunks:
        raise GenerationError("model returned empty response")
    text = chunks[0].get("text")
    if not isinstance(text, str) or not text.strip():
        raise GenerationError("model returned non-text response")
    # Try direct parse first, then strip markdown fences if needed
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    import re
    md_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if md_match:
        try:
            return json.loads(md_match.group(1).strip())
        except json.JSONDecodeError:
            pass
    raise GenerationError("model returned invalid JSON payload")


def _normalize_citations(raw: Any, fallback: list[str]) -> list[str]:
    if not isinstance(raw, list):
        return list(fallback)
    citations = [str(value).strip() for value in raw if isinstance(value, str) and value.strip()]
    return citations or list(fallback)


def generate_flashcards(*, course_id: str, num_cards: int) -> list[dict[str, Any]]:
    context = _retrieve_context(
        course_id=course_id,
        query=f"Generate {num_cards} flashcards for key concepts.",
    )
    if not context:
        raise GenerationError("no knowledge base context available for flashcard generation")

    context_block = "\n\n".join(row["text"] for row in context[:8])
    prompt = (
        "Return ONLY JSON array. No markdown.\n"
        f"Create exactly {num_cards} flashcards using this schema: "
        '[{"id":"card-1","courseId":"...","topicId":"topic-...","prompt":"...","answer":"...",'
        '"citations":["s3://..."]}].\n'
        f"courseId must be {course_id}.\n"
        "Use grounded facts only from context.\n"
        f"Context:\n{context_block}"
    )
    payload = _invoke_model_json(prompt)
    if not isinstance(payload, list):
        raise GenerationError("flashcard model response must be an array")

    default_citations = [
        str(row.get("source", "")).strip() for row in context[:3] if str(row.get("source", "")).strip()
    ]
    cards: list[dict[str, Any]] = []
    for index, row in enumerate(payload, start=1):
        if not isinstance(row, dict):
            continue
        card = {
            "id": str(row.get("id", f"card-{index}")).strip() or f"card-{index}",
            "courseId": str(row.get("courseId", course_id)).strip() or course_id,
            "topicId": str(row.get("topicId", "topic-unknown")).strip() or "topic-unknown",
            "prompt": str(row.get("prompt", "")).strip(),
            "answer": str(row.get("answer", "")).strip(),
            "citations": _normalize_citations(row.get("citations"), default_citations),
        }
        if not card["prompt"] or not card["answer"]:
            continue
        cards.append(card)

    if not cards:
        raise GenerationError("flashcard model response did not contain valid cards")
    return cards[:num_cards]


def generate_practice_exam(*, course_id: str, num_questions: int) -> dict[str, Any]:
    context = _retrieve_context(
        course_id=course_id,
        query=f"Generate {num_questions} practice exam questions.",
    )
    if not context:
        raise GenerationError("no knowledge base context available for practice exam generation")

    context_block = "\n\n".join(row["text"] for row in context[:8])
    prompt = (
        "Return ONLY JSON object. No markdown.\n"
        "Schema: {\"courseId\":\"...\",\"generatedAt\":\"RFC3339Z\",\"questions\":["
        "{\"id\":\"q1\",\"prompt\":\"...\",\"choices\":[\"...\",\"...\"],\"answerIndex\":0,"
        "\"citations\":[\"s3://...\"]}"
        "]}\n"
        f"courseId must be {course_id}. Use exactly {num_questions} questions.\n"
        f"generatedAt must be {_utc_now_rfc3339()} format.\n"
        "Use grounded facts only from context.\n"
        f"Context:\n{context_block}"
    )
    payload = _invoke_model_json(prompt)
    if not isinstance(payload, dict):
        raise GenerationError("practice exam model response must be an object")

    questions_raw = payload.get("questions")
    if not isinstance(questions_raw, list):
        raise GenerationError("practice exam must include questions array")

    default_citations = [
        str(row.get("source", "")).strip() for row in context[:3] if str(row.get("source", "")).strip()
    ]
    questions: list[dict[str, Any]] = []
    for index, row in enumerate(questions_raw, start=1):
        if not isinstance(row, dict):
            continue
        prompt_text = str(row.get("prompt", "")).strip()
        choices_raw = row.get("choices")
        if not prompt_text or not isinstance(choices_raw, list):
            continue
        choices = [str(choice).strip() for choice in choices_raw if str(choice).strip()]
        answer_index = row.get("answerIndex")
        if len(choices) < 2 or not isinstance(answer_index, int) or answer_index < 0:
            continue

        questions.append(
            {
                "id": str(row.get("id", f"q-{index}")).strip() or f"q-{index}",
                "prompt": prompt_text,
                "choices": choices,
                "answerIndex": answer_index,
                "citations": _normalize_citations(row.get("citations"), default_citations),
            }
        )

    if not questions:
        raise GenerationError("practice exam model response did not contain valid questions")

    generated_at = payload.get("generatedAt")
    generated_at_str = str(generated_at).strip() if generated_at is not None else _utc_now_rfc3339()
    if not generated_at_str:
        generated_at_str = _utc_now_rfc3339()

    return {
        "courseId": str(payload.get("courseId", course_id)).strip() or course_id,
        "generatedAt": generated_at_str,
        "questions": questions[:num_questions],
    }


def format_canvas_items(items: list[dict[str, Any]]) -> str | None:
    if not items:
        return None
    lines = []
    for item in items:
        title = item.get("title", "Untitled")
        item_type = item.get("itemType", "unknown")
        due_at = item.get("dueAt", "no due date")
        points = item.get("pointsPossible")
        pts_str = f"{points} pts" if points is not None else "ungraded"
        lines.append(f"{item_type} | {title} | due {due_at} | {pts_str}")
    return "\n".join(lines)


def chat_answer(*, course_id: str, question: str, canvas_context: str | None = None) -> dict[str, Any]:
    context = _retrieve_context(course_id=course_id, query=question, k=10)
    if not context:
        raise GenerationError("no knowledge base context available for chat")

    context_block = "\n\n".join(row["text"] for row in context[:10])
    canvas_section = ""
    if canvas_context:
        canvas_section = f"\n\nCanvas assignment data:\n{canvas_context}"
    prompt = (
        "You are GURT (Generative Uni Revision Tool) 🍦 — a friendly, concise AI study buddy "
        "for a student at Cal Poly (California Polytechnic State University, San Luis Obispo). "
        "You have a fun yogurt-themed personality — upbeat, encouraging, and to the point. "
        "Occasionally use yogurt/frozen treat puns or the 🍦 emoji, but keep it subtle and natural.\n\n"
        "Rules:\n"
        "- Be CONCISE. Answer the question directly first, then add brief context only if needed.\n"
        "- Do math and calculations when asked (grades, averages, projections). Show the key numbers, not every step.\n"
        "- Use Cal Poly grading scale: A ≥ 93%, A- ≥ 90%, B+ ≥ 87%, B ≥ 83%, B- ≥ 80%, "
        "C+ ≥ 77%, C ≥ 73%, C- ≥ 70%, D+ ≥ 67%, D ≥ 63%, D- ≥ 60%, F < 60% "
        "unless the syllabus specifies a different scale.\n"
        "- Use the provided course context AND your general knowledge.\n"
        "- Use markdown: **bold** for emphasis, bullet lists for multiple items. Keep answers short.\n"
        "- Use emojis where they add clarity (✅ ❌ 📅 📊 etc.) but don't overdo it.\n"
        "- Only say you don't know if truly unanswerable.\n\n"
        "Return ONLY a JSON object: "
        '{"answer":"...","citations":["source1","source2"]}\n\n'
        f"Question: {question}\n\n"
        f"Course context:\n{context_block}"
        f"{canvas_section}"
    )
    payload = _invoke_model_json(prompt, max_tokens=4096)
    if not isinstance(payload, dict):
        raise GenerationError("chat model response must be an object")

    answer = str(payload.get("answer", "")).strip()
    if not answer:
        raise GenerationError("chat model response missing answer")

    default_citations = [
        str(row.get("source", "")).strip() for row in context[:4] if str(row.get("source", "")).strip()
    ]
    citations = _normalize_citations(payload.get("citations"), default_citations)

    return {"answer": answer, "citations": citations}
