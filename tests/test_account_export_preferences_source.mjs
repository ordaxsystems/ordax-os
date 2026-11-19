import test from "node:test";
import assert from "node:assert/strict";
import { readSourceText } from "./read-source-text.mjs";

const root=new URL("../",import.meta.url);
const prior=readSourceText(new URL("infra/supabase/product/migrations/20261015153000_space_semantics_v1.sql",root));
const next=readSourceText(new URL("infra/supabase/product/migrations/20261118163000_account_export_preferences_v1.sql",root));
const gateway=readSourceText(new URL("infra/supabase/functions/ordax-account-gateway/index.ts",root));
const functionSource=(s)=>{
  const start=s.indexOf("create or replace function public.ordax_account_export_v1()");
  const end=s.indexOf("\n$$;",start);
  assert.ok(start>=0&&end>start,"canonical export function required");
  return s.slice(start,end+4);
};
const oldSource=functionSource(prior);
const newSource=functionSource(next);
const newAccountEntries=[
  "          'preferred_locale', a.preferred_locale,\n",
  "          'communications_product_digest', a.communications_product_digest,\n",
  "          'communications_news', a.communications_news,\n",
];

test("Account export is the original own-subject function with only three new Account fields",()=>{
  const stripped=newAccountEntries.reduce((s,line)=>{
    assert.equal(s.split(line).length,2,"field must be added exactly once");
    return s.replace(line,"");
  },newSource);
  assert.equal(stripped,oldSource,"export must preserve all other scopes, ordering and schema");
  for(const line of newAccountEntries)assert.ok(newSource.includes(line));
  assert.match(newSource,/'\$schema', 'prototype-ordax\.account-export\/1'/);
  assert.match(newSource,/where a\.user_id = \(select user_id from me\)/);
  assert.match(newSource,/public\.ordax_request_subject_v1\(\)/);
});
test("replacement preserves existing security-definer executor and grants",()=>{
  assert.match(next,/alter function public\.ordax_account_export_v1\(\) owner to postgres;/);
  assert.match(next,/alter function public\.ordax_account_export_v1\(\) owner to ordax_account_export_executor;/);
  assert.match(next,/revoke create on schema public from ordax_account_export_executor;/);
  assert.match(next,/revoke all on function public\.ordax_account_export_v1\(\)[\s\S]*?from public, anon, authenticated, service_role;/);
  assert.match(next,/grant execute on function public\.ordax_account_export_v1\(\) to authenticated;/);
  assert.doesNotMatch(next,/create\s+table|create\s+policy|grant\s+execute[^;]*to\s+anon/i);
  assert.match(newSource,/security definer/);
  assert.match(newSource,/set search_path = ''/);
});
test("gateway reuses existing own-subject RPC and unchanged browser schema",()=>{
  const start=gateway.indexOf('if (path === "/account/export" && req.method === "GET")');
  const end=gateway.indexOf("// Owner devices/grants use the same Supabase Account session",start);
  assert.ok(start>=0&&end>start);
  const route=gateway.slice(start,end);
  assert.match(route,/const session = await authenticated\(req\)/);
  assert.match(route,/if \(!session\.user \|\| !session\.access\)/);
  assert.match(route,/\.rpc\("ordax_account_export_v1"\)/);
  assert.doesNotMatch(route,/adminConfig|service_role|user_metadata/);
});
