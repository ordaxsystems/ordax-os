import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root=new URL("../",import.meta.url);
const gateway=readFileSync(new URL("infra/supabase/functions/ordax-account-gateway/index.ts",root),"utf8");
const transport=readFileSync(new URL("infra/supabase/functions/_shared/account_transport_admission.mjs",root),"utf8");
const migration=readFileSync(new URL("infra/supabase/product/migrations/20261118151000_account_optional_communications_v1.sql",root),"utf8");

test("paired optional choices are optional, never inferred as marketing consent",()=>{
  assert.match(migration,/add column communications_product_digest boolean/);
  assert.match(migration,/add column communications_news boolean/);
  assert.match(migration,/communications_product_digest is null and communications_news is null/);
  assert.match(migration,/communications_product_digest is not null and communications_news is not null/);
  assert.doesNotMatch(migration,/default true|create table|create policy|marketing_consent_at/i);
});
test("one owner-RLS Account reader projects the two optional flags or none",()=>{
  const pos=gateway.indexOf("async function readAccountProfile(");
  const end=gateway.indexOf("\n}\n\n",pos);
  assert.ok(pos>0&&end>pos);
  const reader=gateway.slice(pos,end);
  assert.match(reader,/client\(access\)/);
  assert.match(reader,/\.from\("ordax_accounts"\)/);
  assert.match(reader,/\.select\("display_name,preferred_locale,communications_product_digest,communications_news"\)/);
  assert.match(reader,/\.eq\("user_id", userId\)/);
  assert.match(reader,/safeAccountOptionalCommunications\(/);
  assert.match(gateway,/\.\.\.\(profile\?\.optionalCommunications/);
  assert.match(gateway,/communicationsPreferenceEditEnabled: !publicSiteRequest\(req\) \|\| PUBLIC_SITE_ACCOUNT_ENABLED/);
});
test("public transport and owner endpoint reject broader methods and writes",()=>{
  assert.match(transport,/\["\/account\/preferences\/communications", Object\.freeze\(\{ method: "POST", preActivation: false \}\)\]/);
  const start=gateway.indexOf('if (path === "/account/preferences/communications")');
  const end=gateway.indexOf("// Locale is a preference",start);
  assert.ok(start>0 && end>start);
  const path=gateway.slice(start,end);
  assert.match(path,/authenticated\(req\)/);
  assert.match(path,/if \(!session\.user \|\| !session\.access\)/);
  assert.match(path,/exactObjectKeys\(payload, \["product_digest", "news"\]\)/);
  assert.match(path,/safeAccountOptionalCommunications\(payload\.product_digest, payload\.news\)/);
  assert.match(path,/client\(session\.access\)/);
  assert.match(path,/\.eq\("user_id", session\.user\.id\)/);
  assert.match(path,/\.select\("communications_product_digest,communications_news"\)/);
  assert.match(path,/data\.communications_product_digest !== choices\.productDigest/);
  assert.match(path,/data\.communications_news !== choices\.news/);
  assert.doesNotMatch(path,/sendEmail|resend|supabaseAdmin|service_role|marketingConsent|user_metadata/);
});
test("column-only grants retain existing profile authority and never grant anon writes",()=>{
  assert.match(migration,/grant update\(communications_product_digest, communications_news\)/);
  assert.match(migration,/has_column_privilege\('authenticated','public\.ordax_accounts','display_name','UPDATE'\)/);
  assert.match(migration,/has_column_privilege\('authenticated','public\.ordax_accounts','preferred_locale','UPDATE'\)/);
  assert.match(migration,/has_column_privilege\('authenticated','public\.ordax_accounts','user_id','UPDATE'\)/);
  assert.match(migration,/has_column_privilege\('anon','public\.ordax_accounts','communications_news','UPDATE'\)/);
});
