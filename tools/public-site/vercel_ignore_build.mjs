import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_RE = /^[0-9a-f]{40}$/i;

export const PUBLIC_SITE_CHANGE_PATHS = Object.freeze([
  "sites/public",
  "api/account-proxy.mjs",
  "infra/supabase/functions/ordax-public-account-gateway/public_request_context.mjs",
  "platform/releases/publications.json",
  "tools/public-site",
  "vercel.json",
]);

function gitDiffStatus(before, after) {
  return spawnSync(
    "git",
    ["diff", "--quiet", before, after, "--", ...PUBLIC_SITE_CHANGE_PATHS],
    { stdio: "ignore" },
  );
}

// Vercel: exit 0 skips build; exit 1 builds. Unknown diffs must build, not fail with git exit 128.
export function assessPublicSiteBuild(previousSha, currentSha, diff = gitDiffStatus) {
  if (!SHA_RE.test(previousSha ?? "") || !SHA_RE.test(currentSha ?? "")) {
    return { skip: false, reason: "missing-or-invalid-commit-pair" };
  }
  try {
    const result = diff(previousSha, currentSha);
    if (result.status === 0) return { skip: true, reason: "no-public-site-changes" };
    if (result.status === 1) return { skip: false, reason: "public-site-changed" };
  } catch {
    // Fail safe: do not silently skip a build when repository history cannot be compared.
  }
  return { skip: false, reason: "git-diff-unavailable" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const decision = assessPublicSiteBuild(
    process.env.VERCEL_GIT_PREVIOUS_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
  );
  process.stdout.write(`Public site: ${decision.reason}; ${decision.skip ? "skip" : "build"}\n`);
  process.exitCode = decision.skip ? 0 : 1;
}
