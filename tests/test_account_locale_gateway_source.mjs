import test from "node:test";
import assert from "node:assert/strict";
import { readSourceText } from "./read-source-text.mjs";

const root = new URL("../",import.meta.url);
const gateway=readSourceText(new URL("infra/supabase/functions/ordax-account-gateway/index.ts",root));
const transport=readSourceText(new URL("infra/supabase/functions/_shared/account_transport_admission.mjs",root));
const migration=readSourceText(new URL("infra/supabase/product/migrations/20261118074500_account_preferred_locale_v1.sql",root));
test("one account owner, one RLS profile read for both name and locale",()=>{
  const a=gateway.indexOf("async function readAccountProfile(");
  const b=gateway.indexOf("\n}\n\n",a);
  assert.ok(a>=0 && b>a);
  const owner=gateway.slice(a,b);
  assert.match(owner,/client\(access\)/);
  assert.match(owner,/\.from\("ordax_accounts"\)/);
  assert.match(owner,/\.select\("display_name,preferred_locale,communications_product_digest,communications_news"\)/);
  assert.match(owner,/\.eq\("user_id", userId\)/);
  assert.match(owner,/\.maybeSingle\(\)/);
  assert.doesNotMatch(owner,/adminConfig|service_role|app_metadata|user_metadata/);
});
test("session only projects verified locale with public activation capability gate",()=>{
  assert.match(gateway,/safeAccountPreferredLocale\(value: unknown\)/);
  assert.match(gateway,/value === "pt-BR" \|\| value === "en-US"/);
  assert.match(gateway,/\.\.\.\(profile\?\.preferredLocale \? \{ preferredLocale: profile\.preferredLocale \} : \{\}\)/);
  assert.match(gateway,/localePreferenceEditEnabled: !publicSiteRequest\(req\) \|\| PUBLIC_SITE_ACCOUNT_ENABLED/);
});
test("write is exact path, exact JSON, verified user session and column-only RLS",()=>{
  assert.match(transport,/\["\/account\/preferences\/locale", Object\.freeze\(\{ method: "POST", preActivation: false \}\)\]/);
  const a=gateway.indexOf('if (path === "/account/preferences/locale")');
  const b=gateway.indexOf("// The Account table already owns display_name",a);
  assert.ok(a>=0 && b>a);
  const route=gateway.slice(a,b);
  assert.match(route,/authenticated\(req\)/);
  assert.match(route,/if \(!session\.user \|\| !session\.access\)/);
  assert.match(route,/exactObjectKeys\(payload, \["preferred_locale"\]\)/);
  assert.match(route,/safeAccountPreferredLocale\(payload\.preferred_locale\)/);
  assert.match(route,/client\(session\.access\)/);
  assert.match(route,/\.update\(\{ preferred_locale: locale \}\)/);
  assert.match(route,/\.eq\("user_id", session\.user\.id\)/);
  assert.match(route,/data\.preferred_locale !== locale/);
  assert.doesNotMatch(route,/service_role|adminConfig|user_metadata|provider_token/);
});
test("SQL adds only optional supported locale and preserves existing display-name ACL",()=>{
  assert.match(migration,/add column preferred_locale text/);
  assert.match(migration,/preferred_locale in \('pt-BR', 'en-US'\)/);
  assert.match(migration,/grant update\(preferred_locale\).*authenticated/i);
  assert.match(migration,/has_column_privilege\('authenticated','public\.ordax_accounts','display_name','UPDATE'\)/);
  assert.match(migration,/ordax_accounts_update_own/);
  assert.doesNotMatch(migration,/create\s+table|create\s+policy|revoke update on public\.ordax_accounts/i);
});
