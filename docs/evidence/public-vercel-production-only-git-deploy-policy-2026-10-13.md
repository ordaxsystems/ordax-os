# OrdaX public site ? production-only Git deployment policy (2026-10-13)

> **Correction recorded later on 2026-10-13:** this evidence captured the initial `"*": false` rule. A live `feat/...` branch still produced a Vercel Preview deployment because Vercel evaluates branch rules with minimatch and `*` does not cover `/`-separated branch segments. The canonical correction is `"**": false` plus `"main": true`; see `docs/evidence/public-vercel-production-only-minimatch-correction-2026-10-13.md`.

## Decision

The canonical Vercel project remains `ordax-os-public` under the `ordaxsystems` team and the canonical public origin remains `https://ordax.com.br`. There is no second project, alternate auth origin or parallel release pipeline.

Automatic Git deployments are restricted to the canonical production branch:

```json
"git": {
  "deploymentEnabled": {
    "*": false,
    "main": true
  }
}
```

Vercel documents `git.deploymentEnabled` branch rules as minimatch patterns. When a branch matches multiple rules, a deployment is enabled if at least one matching rule is `true`; therefore `main` remains enabled while every other branch is disabled. Source: Vercel Project Configuration / Git Configuration.

## Why this is the canonical policy

Pull requests already have an authoritative repository-side validation owner: `.github/workflows/public-site-candidate.yml`. That candidate performs source/contract validation, deterministic public-site build, Account viewport and keyboard interaction proof, and publishes the candidate/evidence artifacts. Preview identity is independently required to remain disabled. A second automatic Vercel build for every feature branch is therefore not a release authority.

The Vercel project hit its build/deployment rate limit on 2026-10-13 and rejected a production publication with `Deployment rate limited ? retry in 24 hours`. Removing legitimate public-site dependencies from `tools/public-site/should_skip_vercel_build.sh` would make the dependency graph incorrect, so that filter is preserved. The structural correction is to stop creating redundant automatic preview deployments while preserving automatic production deployment from `main`.

## Boundaries

- `main` remains the only automatic Git deployment branch for the canonical Vercel project.
- `tools/public-site/should_skip_vercel_build.sh` remains the change filter and fail-safe build decision for affected production inputs.
- PR validation remains GitHub Actions `Public Site Candidate`; this does not create another hosting or auth boundary.
- Preview identity remains disabled.
- No Vercel token, alternate account, alternate domain, deploy hook or manual shadow pipeline is introduced.
- Historical preview deployment IDs remain historical evidence and do not imply previews are still automatically created.

## Non-claim

This policy prevents future automatic preview consumption; it does not clear the provider's current rate limit and does not by itself publish pending Account UX changes to production. Source readiness and canonical production publication remain separate gates.
