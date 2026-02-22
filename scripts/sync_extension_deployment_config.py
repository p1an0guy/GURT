#!/usr/bin/env python3
"""Sync browser extension deployment config from CDK outputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outputs-file", required=True, help="Path to outputs.<stage>.json")
    parser.add_argument(
        "--target-file",
        required=True,
        help="Path to browser extension deployment_config.json",
    )
    return parser.parse_args()


def find_frontend_url(outputs: dict[str, object]) -> str:
    stack = outputs.get("GurtFrontendStack")
    if isinstance(stack, dict):
        value = stack.get("FrontendCloudFrontUrl")
        if isinstance(value, str) and value.strip():
            return value.strip().rstrip("/")

    for value in outputs.values():
        if isinstance(value, dict):
            candidate = value.get("FrontendCloudFrontUrl")
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip().rstrip("/")

    return ""


def main() -> int:
    args = parse_args()
    outputs_path = Path(args.outputs_file).resolve()
    target_path = Path(args.target_file).resolve()

    outputs = json.loads(outputs_path.read_text(encoding="utf-8"))
    frontend_url = find_frontend_url(outputs)
    if not frontend_url:
        raise SystemExit(
            f"Could not find FrontendCloudFrontUrl in {outputs_path}. "
            "Deploy GurtFrontendStack first."
        )

    payload = {"webAppBaseUrl": frontend_url}
    target_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(f"Updated extension redirect base URL: {frontend_url}")
    print(f"Wrote: {target_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
