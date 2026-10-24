"""Contract proof for an independent, pinned Site checkout. No network used."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "ordax_external_public_site_source", ROOT / "tools/vercel/site_source.py"
)
SOURCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SOURCE)


def run_git(path: Path, *args: str) -> str:
    completed = subprocess.run(
        ("git", "-C", str(path), *args), capture_output=True, text=True, check=True,
    )
    return completed.stdout.strip()


class ExternalSiteSourceTests(unittest.TestCase):
    def test_source_pin_contract_matches_independent_development_main(self):
        record = SOURCE.contract()
        self.assertEqual(record["repository"], "ordaxsystems/ordax-site")
        self.assertEqual(record["source_subdirectory"], "site")
        self.assertFalse(record["production_deployment_activated"])

    def test_no_duplicate_site_presentation_can_return_to_os(self):
        """After #2229, the OS is a consumer, never the Site source owner."""
        public_site = json.loads(
            (ROOT / "docs/contracts/public-site.json").read_text(encoding="utf-8")
        )
        self.assertEqual(public_site["source_root"], "ordaxsystems/ordax-site:site")
        self.assertEqual(
            public_site["build_recipe"], "ordaxsystems/ordax-site:scripts/build.py"
        )
        self.assertFalse(
            (ROOT / "sites/public").exists(),
            "Site presentation directory must not return to ordax-os",
        )
        # Keep OS-owned Identity/legal tools. Reject only the migrated UI build,
        # preview and presentation tools that were retired in #2229.
        legacy_presentation_tools = (
            "build.py",
            "public_html_render.py",
            "plan_catalog.py",
            "deployment.py",
            "playground_fixture.py",
            "preview_server.py",
            "browser-smoke.mjs",
        )
        for filename in legacy_presentation_tools:
            with self.subTest(path=filename):
                self.assertFalse(
                    (ROOT / "tools/public-site" / filename).exists(),
                    f"duplicate Site presentation tool reintroduced: {filename}",
                )

    def test_exact_pinned_source_and_dirty_checkout_are_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            upstream = root / "upstream"
            upstream.mkdir()
            run_git(upstream, "init", "-q")
            run_git(upstream, "config", "user.name", "Site Source Proof")
            run_git(upstream, "config", "user.email", "site-proof@example.invalid")
            for name in SOURCE.CLOSURE:
                file = upstream / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("site-source-proof", encoding="utf-8")
            run_git(upstream, "add", "-A")
            run_git(upstream, "commit", "-qm", "site fixture")
            pinned = run_git(upstream, "rev-parse", "HEAD")
            pinfile = root / "public-site-source.json"
            doc = dict(SOURCE.contract())
            doc["commit"] = pinned
            pinfile.write_text(json.dumps(doc), encoding="utf-8")
            with (
                patch.object(SOURCE, "CONTRACT", pinfile),
                patch.object(SOURCE, "STAGE", root / "stage"),
                patch.object(SOURCE, "SOURCE_URL", str(upstream)),
            ):
                location, sha = SOURCE.resolve()
                self.assertEqual(sha, pinned)
                self.assertEqual(run_git(location, "rev-parse", "HEAD"), pinned)
                self.assertEqual(SOURCE.resolve(), (location, pinned))
                (location / "site/assets/site.js").write_text("tampered", encoding="utf-8")
                with self.assertRaisesRegex(SOURCE.SiteSourceError, "uncommitted"):
                    SOURCE.resolve()
                run_git(location, "checkout", "--", "site/assets/site.js")
                pinfile.write_text(json.dumps({**doc, "commit": "f" * 40}),
                                   encoding="utf-8")
                with self.assertRaises(SOURCE.SiteSourceError):
                    SOURCE.validate_checkout(location, "f" * 40)

    def test_contract_must_not_expand_production_authority(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "source.json"
            original = SOURCE.contract()
            for key, bad in (
                ("repository", "ordaxsystems/ordax-os"),
                ("commit", "main"),
                ("production_deployment_activated", True),
                ("source_subdirectory", "sites/public"),
            ):
                with self.subTest(key=key), patch.object(SOURCE, "CONTRACT", file):
                    file.write_text(json.dumps({**original, key: bad}), encoding="utf-8")
                    with self.assertRaises(SOURCE.SiteSourceError):
                        SOURCE.contract()


if __name__ == "__main__":
    unittest.main()
