#!/usr/bin/env python3
"""Invoke finalize_handler locally with a mock event to inspect payload structure."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DOCS_TABLE", "fake-table-for-local-test")

# Mock DynamoDB so we don't hit AWS
with mock.patch("backend.ingest_workflow._dynamodb_table") as mocked_table:
    mocked_table.return_value.put_item = lambda **kw: None  # no-op
    mocked_table.return_value.update_item = lambda **kw: None  # no-op

    from backend.ingest_workflow import finalize_handler

    event = {
        "jobId": "ingest-test-123",
        "docId": "doc-abc",
        "courseId": "course-psych-101",
        "key": "uploads/course-psych-101/doc-abc/syllabus.pdf",
        "text": "Sample extracted text from PDF...",
        "usedTextract": False,
    }
    result = finalize_handler(event, None)
    print("\n--- Handler result ---")
    print(result)
