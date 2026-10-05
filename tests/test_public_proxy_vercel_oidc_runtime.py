import json
import subprocess
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROXY = ROOT / "api" / "account-proxy.mjs"
PACKAGE = ROOT / "package.json"


class PublicProxyVercelOidcRuntimeTests(unittest.TestCase):
    def test_vercel_oidc_dependency_is_exact_pinned(self):
        manifest = json.loads(PACKAGE.read_text(encoding="utf-8"))
        self.assertTrue(manifest.get("private"))
        self.assertEqual(manifest.get("type"), "module")
        self.assertEqual(manifest.get("dependencies", {}).get("@vercel/oidc"), "4.0.0")

    def test_proxy_uses_runtime_helper_instead_of_direct_oidc_env_read(self):
        source = PROXY.read_text(encoding="utf-8")
        self.assertIn('import("@vercel/oidc")', source)
        self.assertIn("runtime.getVercelOidcToken", source)
        self.assertNotIn("oidcToken = process.env.VERCEL_OIDC_TOKEN", source)
        self.assertIn('error(503, "public-proxy-identity-unavailable")', source)

    def test_runtime_resolution_is_injectable_and_fail_closed(self):
        script = textwrap.dedent(
            """
            import assert from "node:assert/strict";
            import { resolveVercelOidcToken } from "./api/account-proxy.mjs";

            const token = `${"a".repeat(24)}.${"b".repeat(32)}.${"c".repeat(32)}`;
            let calls = 0;

            assert.equal(
              await resolveVercelOidcToken(undefined, async () => {
                calls += 1;
                return token;
              }),
              token,
            );
            assert.equal(calls, 1);

            calls = 0;
            assert.equal(
              await resolveVercelOidcToken("", async () => {
                calls += 1;
                return token;
              }),
              null,
            );
            assert.equal(calls, 0);

            assert.equal(
              await resolveVercelOidcToken(undefined, async () => {
                throw new Error("runtime-context-unavailable");
              }),
              null,
            );
            assert.equal(await resolveVercelOidcToken(undefined, null), null);
            """
        )
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
