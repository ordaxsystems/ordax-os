// Real consumer entrypoints imported from an isolated OS tree after Intelligence cutover.
// This is NOT a signed release or proof of physical inference.
import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const root = process.env.ORDAX_INTELLIGENCE_COMPOSED_ROOT ?? null;
const skip = root === null ? "Disposable Intelligence composition is not available" : false;
const file = relative => pathToFileURL(join(resolve(root), "system", relative)).href;

test("staged Native-facing component exports use one external Intelligence implementation", { skip }, async () => {
  const a = await import(file("services/intelligence/runtime.mjs"));
  const b = await import(file("services/local-ai/runtime.mjs"));
  const c = await import(file("services/intelligence/model-router.mjs"));
  const cs = await import(file("components/ordax-intelligence/runtime.mjs"));
  const ls = await import(file("components/local-ai-service/runtime.mjs"));
  assert.strictEqual(cs.componentRuntime.createRuntime, a.createIntelligenceRuntime);
  assert.strictEqual(ls.componentRuntime.createRuntime, b.createLocalAiRuntime);
  assert.equal(typeof c.createModelRouterRuntime, "function");
  const receipt = JSON.parse(readFileSync(join(root,"system/intelligence-source/source-provenance.json"), "utf8"));
  assert.equal(receipt.legacy_implementation_bytes_packaged, false);
  assert.equal(receipt.activation_authorized, false);
  assert.equal(receipt.replaced_services.length, 5);
  const surface = JSON.parse(readFileSync(join(root, "system/surface/source-provenance.json"), "utf8"));
  assert.equal(surface.user_interface_owner, "ordaxsystems/ordax-surface");
  assert.equal(surface.old_os_visual_source_packaged, false);
  assert.ok(readFileSync(join(root, "system/surface/ui/surface.mjs"), "utf8").length > 0);
  for (const p of receipt.replaced_services) {
    const body = readFileSync(join(root,p),"utf8");
    assert.match(body,/intelligence-source\/src\/index.mjs/);
    assert.ok(Buffer.byteLength(body)<1050);
    assert.doesNotMatch(body,/You are Ordax Intelligence/);
  }
});

test("composed OS bridges consultative inference without private or implicit execution", { skip }, async () => {
  const { createIntelligenceRuntime } = await import(file("services/intelligence/runtime.mjs"));
  const { createLocalAiRuntime } = await import(file("services/local-ai/runtime.mjs"));
  const { assessBundledLocalAiModel } = await import(file("services/local-ai/model-compatibility.mjs"));
  const preview=assessBundledLocalAiModel();
  assert.equal(preview.installedOrUpdateVerified,false);
  let generated=0;
  const local = createLocalAiRuntime({
    modelId:"fixture-model",
    fetchImpl:async url=>{
      if(url.endsWith("/health"))return new Response("",{status:200});
      generated++;
      return new Response(JSON.stringify({
        model:"fixture-model",choices:[{message:{content:"resposta de teste"}}]
      }),{status:200});
    }
  });
  await local.probe();
  const core=createIntelligenceRuntime({inferencePort:local});
  const answer=await core.respond({intent:"ask",prompt:"Examine sem usar ferramentas."});
  assert.equal(answer.text,"resposta de teste");
  assert.equal(answer.authority,"none");
  assert.equal(core.getSnapshot().toolExecution,false);
  assert.equal(generated,1);
  core.dispose();
  local.dispose();
});
