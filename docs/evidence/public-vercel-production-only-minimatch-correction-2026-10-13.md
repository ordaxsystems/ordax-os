# OrdaX public site — production-only Git deployment minimatch correction (2026-10-13)

## Observation

The initial production-only policy used:

```json
"git": {
  "deploymentEnabled": {
    "*": false,
    "main": true
  }
}
```

A real pull-request branch containing a slash (`feat/account-original-lovable-source-20261010`) still created Vercel Git deployment `7032114852` for commit `c8e90ca35d41dd54d5413b9323177f5d0a3f71c3`. GitHub recorded the environment as `Preview – ordax-os-public` with `production_environment=false`.

This disproved the claim that `*` disabled every non-`main` branch.

## Root cause

Vercel documents `git.deploymentEnabled` branch rules as minimatch patterns. A single `*` does not span `/`-separated branch segments, while an unspecified branch defaults to deployments enabled. Branch names such as `feat/...`, `fix/...` and `docs/...` therefore escaped the intended fallback.

## Canonical correction

```json
"git": {
  "deploymentEnabled": {
    "**": false,
    "main": true
  }
}
```

`**` is the catch-all minimatch rule, including slash-bearing branch names. `main` also matches `**`, but Vercel enables a deployment when at least one matching rule is `true`; therefore the explicit `main: true` keeps the production branch enabled while every other branch remains disabled.

The machine-readable deployment contract records both the minimatch syntax and the exact disabled-branch pattern so the policy cannot regress to an ambiguous wildcard.

## Verification

After the corrected policy was pushed on slash-bearing branch `fix/vercel-production-only-minimatch-20261013` at commit `1a9cf6aa3ddcf404e546fd31c065e4eb0e35f0b6`, the GitHub Deployments API query scoped to that SHA returned an empty list. No Vercel deployment record was created for that commit.

This is the direct negative-control counterpart to deployment `7032114852`: with `"*": false`, a slash-bearing branch escaped and produced a Preview; with `"**": false`, a slash-bearing branch produced no Vercel deployment while GitHub Actions validation continued normally.

## Boundaries

- The canonical Vercel project remains `ordax-os-public` under `ordaxsystems`.
- The canonical public origin remains `https://ordax.com.br`.
- Pull requests are validated by GitHub Actions `Public Site Candidate`, not by a parallel hosting project.
- No alternate domain, account, token, deploy hook or shadow release pipeline is introduced.
- This correction changes automatic Git deployment selection only; it does not promote the React Account candidate or alter authentication/session authority.
- Historical Preview deployments remain evidence only and are not production authorization.
