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


def normalize_base_url(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().rstrip("/")


def find_frontend_url(outputs: dict[str, object]) -> str:
    stack = outputs.get("GurtFrontendStack")
    if isinstance(stack, dict):
        normalized = normalize_base_url(stack.get("FrontendCloudFrontUrl"))
        if normalized:
            return normalized

    for value in outputs.values():
        if isinstance(value, dict):
            normalized = normalize_base_url(value.get("FrontendCloudFrontUrl"))
            if normalized:
                return normalized

    return ""


def find_api_base_url(outputs: dict[str, object]) -> str:
    stack = outputs.get("GurtApiStack")
    if isinstance(stack, dict):
        normalized = normalize_base_url(stack.get("ApiBaseUrl"))
        if normalized:
            return normalized

    for value in outputs.values():
        if isinstance(value, dict):
            normalized = normalize_base_url(value.get("ApiBaseUrl"))
            if normalized:
                return normalized

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
    api_base_url = find_api_base_url(outputs)
    if not api_base_url:
        raise SystemExit(
            f"Could not find ApiBaseUrl in {outputs_path}. "
            "Deploy GurtApiStack first."
        )

    payload = {
        "webAppBaseUrl": frontend_url,
        "apiBaseUrl": api_base_url,
    }
    target_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(f"Updated extension web app URL: {frontend_url}")
    print(f"Updated extension API base URL: {api_base_url}")
    print(f"Wrote: {target_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
