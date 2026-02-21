#!/usr/bin/env python3
"""Validate OpenAPI syntax and validate example payloads against JSON schemas."""

from __future__ import annotations

import json
from pathlib import Path

from schema_utils import SchemaValidationError, validate_instance

ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = ROOT / "contracts"
SCHEMAS_DIR = CONTRACTS_DIR / "schemas"
EXAMPLES_DIR = CONTRACTS_DIR / "examples"
OPENAPI_PATH = CONTRACTS_DIR / "openapi.yaml"

EXAMPLE_SCHEMA_MAP = {
    "Course.example.json": "Course.json",
    "CanvasItem.example.json": "CanvasItem.json",
    "Topic.example.json": "Topic.json",
    "Card.example.json": "Card.json",
    "ReviewEvent.example.json": "ReviewEvent.json",
    "TopicMastery.example.json": "TopicMastery.json",
    "PracticeExam.example.json": "PracticeExam.json",
    "CalendarFeedMetadata.example.json": "CalendarFeedMetadata.json",
    "CalendarTokenResponse.example.json": "CalendarTokenResponse.json",
    "CanvasConnectRequest.example.json": "CanvasConnectRequest.json",
    "CanvasConnectResponse.example.json": "CanvasConnectResponse.json",
    "CanvasSyncResponse.example.json": "CanvasSyncResponse.json",
    "UploadRequest.example.json": "UploadRequest.json",
    "UploadResponse.example.json": "UploadResponse.json",
    "IngestStartRequest.example.json": "IngestStartRequest.json",
    "IngestStartResponse.example.json": "IngestStartResponse.json",
    "IngestStatusResponse.example.json": "IngestStatusResponse.json",
    "GenerateFlashcardsRequest.example.json": "GenerateFlashcardsRequest.json",
    "GenerateFlashcardsResponse.example.json": "GenerateFlashcardsResponse.json",
    "GeneratePracticeExamRequest.example.json": "GeneratePracticeExamRequest.json",
    "ChatRequest.example.json": "ChatRequest.json",
    "ChatResponse.example.json": "ChatResponse.json",
}


def validate_openapi() -> None:
    """Load the OpenAPI document and perform basic structural checks."""
    spec = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))

    required_top_keys = {"openapi", "info", "paths", "components"}
    missing = required_top_keys - set(spec.keys())
    if missing:
        raise ValueError(f"OpenAPI missing required top-level keys: {sorted(missing)}")

    if not str(spec["openapi"]).startswith("3."):
        raise ValueError("OpenAPI version must be 3.x")

    if "/health" not in spec["paths"]:
        raise ValueError("OpenAPI paths must include /health")

    print(f"PASS OpenAPI parse + structure: {OPENAPI_PATH}")


def validate_examples() -> None:
    """Validate all example payloads against their corresponding schema."""
    for example_name, schema_name in EXAMPLE_SCHEMA_MAP.items():
        schema_path = SCHEMAS_DIR / schema_name
        example_path = EXAMPLES_DIR / example_name

        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        instance = json.loads(example_path.read_text(encoding="utf-8"))

        validate_instance(instance, schema)
        print(f"PASS Example validation: {example_path.name} -> {schema_path.name}")


def main() -> None:
    """Run all contract validations with deterministic output."""
    try:
        validate_openapi()
        validate_examples()
    except (ValueError, SchemaValidationError) as exc:
        raise SystemExit(f"Contract validation failed: {exc}") from exc

    print("All contract checks passed.")


if __name__ == "__main__":
    main()
