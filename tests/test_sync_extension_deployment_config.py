from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = ROOT / "scripts" / "sync_extension_deployment_config.py"
BACKGROUND_JS_PATH = ROOT / "browserextention" / "background.js"


class SyncExtensionDeploymentConfigTests(unittest.TestCase):
    def run_sync(
        self,
        outputs_payload: dict[str, object],
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        temp_root = Path(temp_dir.name)

        outputs_path = temp_root / "outputs.dev.json"
        target_path = temp_root / "deployment_config.json"
        outputs_path.write_text(json.dumps(outputs_payload), encoding="utf-8")

        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--outputs-file",
                str(outputs_path),
                "--target-file",
                str(target_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return result, target_path

    def test_writes_both_urls_and_normalizes_trailing_slashes(self) -> None:
        result, target_path = self.run_sync(
            {
                "GurtApiStack": {"ApiBaseUrl": "https://api.example.com/dev/"},
                "GurtFrontendStack": {"FrontendCloudFrontUrl": "https://d111111abcdef8.cloudfront.net/"},
            }
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)

        payload = json.loads(target_path.read_text(encoding="utf-8"))
        self.assertEqual(
            payload,
            {
                "webAppBaseUrl": "https://d111111abcdef8.cloudfront.net",
                "apiBaseUrl": "https://api.example.com/dev",
            },
        )

    def test_fails_when_api_base_url_is_missing(self) -> None:
        result, target_path = self.run_sync(
            {
                "GurtFrontendStack": {"FrontendCloudFrontUrl": "https://d111111abcdef8.cloudfront.net"},
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Could not find ApiBaseUrl", result.stderr)
        self.assertFalse(target_path.exists())

    def test_fails_when_frontend_url_is_missing(self) -> None:
        result, target_path = self.run_sync(
            {
                "GurtApiStack": {"ApiBaseUrl": "https://api.example.com/dev"},
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Could not find FrontendCloudFrontUrl", result.stderr)
        self.assertFalse(target_path.exists())

    def test_extension_background_no_longer_has_hardcoded_chat_api_constant(self) -> None:
        source = BACKGROUND_JS_PATH.read_text(encoding="utf-8")
        self.assertNotIn("const CHAT_API_URL =", source)
        self.assertNotIn("const API_BASE_URL =", source)
        self.assertNotIn("hpthlfk5ql.execute-api.us-west-2.amazonaws.com/dev/chat", source)


if __name__ == "__main__":
    unittest.main()
