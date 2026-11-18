import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateway=readFileSync(new URL("../infra/supabase/functions/ordax-account-gateway/index.ts",import.meta.url),"utf8");
const transport=readFileSync(new URL("../infra/supabase/functions/_shared/account_transport_admission.mjs",import.meta.url),"utf8");

test("Account export is advertised only under the public Account release gate",()=>{
  assert.match(gateway,/dataExportEnabled: !publicSiteRequest\(req\) \|\| PUBLIC_SITE_ACCOUNT_ENABLED/);
  assert.match(gateway,/if \(path === "\/auth\/session" && req\.method === "GET"\)/);
  assert.match(gateway,/if \(path === "\/account\/export" && req\.method === "GET"\)/);
  assert.match(transport,/\["\/account\/export", Object\.freeze\(\{ method: "GET", preActivation: false \}\)\]/);
});
test("export owner remains existing authenticated own-subject RPC, no new authority",()=>{
  const start=gateway.indexOf('if (path === "/account/export" && req.method === "GET")');
  const end=gateway.indexOf("// Owner devices/grants use the same Supabase Account session",start);
  assert.ok(start>=0&&end>start);
  const route=gateway.slice(start,end);
  assert.match(route,/const session = await authenticated\(req\)/);
  assert.match(route,/if \(!session\.user \|\| !session\.access\)/);
  assert.match(route,/const supabase = client\(session\.access\)/);
  assert.match(route,/\.rpc\("ordax_account_export_v1"\)/);
  assert.doesNotMatch(route,/adminConfig\(\)|service_role|access_token|refresh_token/);
});
