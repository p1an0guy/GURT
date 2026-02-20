#!/usr/bin/env python3
"""Small dependency-free JSON schema validator for deterministic scaffold checks."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict


class SchemaValidationError(ValueError):
    """Raised when a payload violates the expected schema."""


def _expect(condition: bool, message: str) -> None:
    """Raise a schema error with a clear message."""
    if not condition:
        raise SchemaValidationError(message)


def _is_date_time(value: str) -> bool:
    """Validate RFC3339-like timestamp with trailing Z."""
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
        return True
    except ValueError:
        return False


def validate_instance(instance: Any, schema: Dict[str, Any], path: str = "$") -> None:
    """Validate a JSON instance against supported schema keywords used in this repo."""
    if "$ref" in schema:
        raise SchemaValidationError(f"{path}: external refs are not supported in this validator")

    schema_type = schema.get("type")

    if schema_type == "object":
        _expect(isinstance(instance, dict), f"{path}: expected object")

        required = schema.get("required", [])
        for key in required:
            _expect(key in instance, f"{path}: missing required field '{key}'")

        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = set(instance.keys()) - set(properties.keys())
            _expect(not unknown, f"{path}: unknown fields {sorted(unknown)}")

        for key, value in instance.items():
            if key in properties:
                validate_instance(value, properties[key], f"{path}.{key}")
        return

    if schema_type == "array":
        _expect(isinstance(instance, list), f"{path}: expected array")
        _expect(len(instance) >= schema.get("minItems", 0), f"{path}: minItems violation")
        item_schema = schema.get("items")
        if item_schema:
            for idx, item in enumerate(instance):
                validate_instance(item, item_schema, f"{path}[{idx}]")
        return

    if schema_type == "string":
        _expect(isinstance(instance, str), f"{path}: expected string")
        min_len = schema.get("minLength")
        if min_len is not None:
            _expect(len(instance) >= min_len, f"{path}: minLength violation")

        pattern = schema.get("pattern")
        if pattern:
            _expect(re.match(pattern, instance) is not None, f"{path}: pattern mismatch")

        if schema.get("format") == "date-time":
            _expect(_is_date_time(instance), f"{path}: invalid date-time format")

        if "enum" in schema:
            _expect(instance in schema["enum"], f"{path}: unexpected enum value '{instance}'")
        return

    if schema_type == "integer":
        _expect(isinstance(instance, int) and not isinstance(instance, bool), f"{path}: expected integer")
        if "minimum" in schema:
            _expect(instance >= schema["minimum"], f"{path}: minimum violation")
        if "maximum" in schema:
            _expect(instance <= schema["maximum"], f"{path}: maximum violation")
        return

    if schema_type == "number":
        _expect(isinstance(instance, (int, float)) and not isinstance(instance, bool), f"{path}: expected number")
        if "minimum" in schema:
            _expect(instance >= schema["minimum"], f"{path}: minimum violation")
        if "maximum" in schema:
            _expect(instance <= schema["maximum"], f"{path}: maximum violation")
        return

    if schema_type == "boolean":
        _expect(isinstance(instance, bool), f"{path}: expected boolean")
        return

    raise SchemaValidationError(f"{path}: unsupported schema type '{schema_type}'")
