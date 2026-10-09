# OrdaX Public Legal Readiness

Status: NOT READY FOR LIVE ACCOUNT ACTIVATION

This document defines a technical gate around the public portal's future account activation. It does not replace legal review and it does not publish final terms or a final privacy notice.

## Current baseline

The public portal currently:

- has a dedicated OrdaX account backend/gateway deployed, but public same-origin browser activation remains disabled and fail-closed;
- does not expose a live public password form;
- keeps login/register targets disabled;
- has no first-party analytics or advertising runtime in `sites/public/`;
- reads only same-origin public configuration and release catalog data;
- does not expose direct browser authority over the product database; public account access remains behind the disabled server-side gateway boundary.

The pages under `/privacidade/` and `/termos/` are therefore readiness pages, not final legal documents.

The backend receipt mechanism is already implemented without activating registration. It stores no plaintext email in the short-lived intent, trusts no client-supplied document version, and can only create a registration receipt from the server-owned active policy in the same database transaction that creates the product account. A service-role-only projection now supplies the active/effective policy metadata to the gateway; Web and Native source display that same metadata and send only affirmative acceptance. There is deliberately no active legal policy yet and the registration switches remain off, so this mechanism cannot be used to claim that consent has been collected.

## Why creating users directly in the Supabase Dashboard fails

The canonical destination is recorded in
`infra/supabase/product/account_destination_migration_plan.json`.
The Auth trigger `private.handle_ordax_account_created()` requires
`raw_user_meta_data.ordax_registration_intent_id` to point to an unexpired,
affirmatively accepted intent for a current, active legal policy. The dashboard
**Add user** form does not execute this OrdaX pre-registration flow and may
surface `Database error creating new user`. The underlying Auth/Postgres logs
identify the expected failure as `ordax-registration-legal-intent-required`
(`23514`).

This must not be fixed by disabling the trigger, inserting directly into
`auth.users`, granting browser access to privileged RPCs or fabricating a
legal acceptance. The correct order is:

1. Obtain independently reviewed, final public privacy and terms documents.
2. Mark the exact documents, versions and dates ready in the reviewed source;
   activate their hashed policy only with the manually confirmed workflow.
3. Verify the account gateway and Web/Native registration E2E, with explicit
   user acceptance, service-only intent creation, and metadata binding in
   the **same** Auth user transaction that produces the immutable receipt.
4. Enable public or administrative onboarding only after readiness checks.
   Administrative onboarding must capture real acceptance too, or use a
   separately reviewed quarantine/invitation process with no account access
   before acceptance.

The manual legal activation workflow now resolves its Supabase destination
from the migration plan, not from the legacy provider project. It is still
**blocked** while the documents remain drafts and must never be run with
an old-project service credential.

## Account activation gate

A live account entry point must remain disabled until all of the following are true:

1. a production identity provider/gateway is deployed behind the same origin;
2. a final privacy notice has been reviewed and published;
3. final terms applicable to account creation have been reviewed and published;
4. both documents have stable version identifiers and effective dates;
5. the source-ready Web and Native flows have been E2E-proven against the final active policy and server-authoritative receipt so the reviewed document versions actually presented/accepted are the canonical active versions;
6. account deletion/export/support ownership is defined;
7. production redirects, cookies, mail templates and data processors are reviewed.

## Machine-readable state

The gate is represented by:

- `docs/contracts/public-legal-readiness.json`;
- `sites/public/config/public-site.json`;
- build validation in `tools/public-site/build.py`.

If the legal gate is not ready, setting a live login/register URL causes the public-site build to fail.

## What the readiness pages may say now

They may explain the current technical state and what still needs to be finalized. They must not claim:

- final legal terms are in force;
- consent has been collected;
- public browser account activation is live when it is not;
- a retention period that has not been adopted;
- a controller/entity identity that has not been finalized;
- cross-border processing details that have not been reviewed.

## Future activation

When legal review is complete, replace the readiness copy with approved documents, update the stable versions/effective dates in the contract, then enable the identity routes through deployment configuration.

The gate should be changed in the same reviewed change that publishes the final documents so account activation cannot drift ahead of them.
