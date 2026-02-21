"""Apply required status-check branch protection for a GitHub repository branch.

Usage:
  GITHUB_TOKEN=<admin-token> python scripts/enforce_branch_protection.py

Optional flags:
  --owner <owner>
  --repo <repo>
  --branch <branch>
  --check <status-check-context> (repeatable)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Iterable
from urllib.error import HTTPError
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class RepoRef:
    owner: str
    repo: str


def _parse_remote_repo_ref(remote_url: str) -> RepoRef:
    https_match = re.match(r"^https://github\.com/([^/]+)/([^/.]+?)(?:\.git)?$", remote_url.strip())
    if https_match:
        return RepoRef(owner=https_match.group(1), repo=https_match.group(2))

    ssh_match = re.match(r"^git@github\.com:([^/]+)/([^/.]+?)(?:\.git)?$", remote_url.strip())
    if ssh_match:
        return RepoRef(owner=ssh_match.group(1), repo=ssh_match.group(2))

    raise ValueError(f"unable to parse GitHub remote URL: {remote_url}")


def _run_git(args: list[str]) -> str:
    import subprocess

    result = subprocess.run(["git", *args], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def _default_repo_ref() -> RepoRef:
    origin_url = _run_git(["remote", "get-url", "origin"])
    return _parse_remote_repo_ref(origin_url)


def _github_request(*, method: str, url: str, token: str, payload: dict | None = None) -> dict:
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    req = Request(
        url=url,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )

    try:
        with urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content) if content else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"github api {method} {url} failed ({exc.code}): {detail}") from exc


def _ensure_unique(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Enforce required status checks for branch protection.")
    parser.add_argument("--owner", default="", help="GitHub owner/org")
    parser.add_argument("--repo", default="", help="GitHub repository name")
    parser.add_argument("--branch", default="main", help="Branch to protect (default: main)")
    parser.add_argument(
        "--check",
        action="append",
        default=[],
        help="Required status check context (repeatable). Default: contracts-and-tests",
    )
    args = parser.parse_args()

    token = os.getenv("GITHUB_TOKEN", "").strip()
    if not token:
        print("error: GITHUB_TOKEN is required (must have admin access to branch protection).", file=sys.stderr)
        return 2

    repo_ref = _default_repo_ref()
    owner = args.owner.strip() or repo_ref.owner
    repo = args.repo.strip() or repo_ref.repo
    branch = args.branch.strip()
    checks = _ensure_unique(args.check or ["contracts-and-tests"])
    if not checks:
        print("error: at least one --check is required.", file=sys.stderr)
        return 2

    api_base = f"https://api.github.com/repos/{owner}/{repo}/branches/{branch}/protection"

    payload = {
        "required_status_checks": {
            "strict": True,
            "contexts": checks,
        },
        "enforce_admins": True,
        "required_pull_request_reviews": None,
        "restrictions": None,
        "required_linear_history": True,
        "allow_force_pushes": False,
        "allow_deletions": False,
        "block_creations": False,
        "required_conversation_resolution": True,
        "lock_branch": False,
        "allow_fork_syncing": False,
    }

    _github_request(method="PUT", url=api_base, token=token, payload=payload)
    protection = _github_request(method="GET", url=api_base, token=token)

    required_status = protection.get("required_status_checks") or {}
    actual_checks = [str(row.get("context", "")) for row in required_status.get("checks") or []]
    if not actual_checks:
        actual_checks = [str(value) for value in required_status.get("contexts") or []]

    missing = [check for check in checks if check not in actual_checks]
    if missing:
        print(f"error: branch protection applied but missing required checks: {missing}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "owner": owner,
                "repo": repo,
                "branch": branch,
                "requiredChecks": actual_checks,
                "strict": bool(required_status.get("strict")),
                "enforceAdmins": bool((protection.get("enforce_admins") or {}).get("enabled")),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
