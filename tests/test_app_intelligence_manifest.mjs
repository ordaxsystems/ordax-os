import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_INTELLIGENCE_MANIFEST_SCHEMA,
  validateAppIntelligenceManifest,
} from "../system/contracts/app-intelligence-manifest.mjs";

function manifest() {
  return {
    schema: APP_INTELLIGENCE_MANIFEST_SCHEMA,
    appId: "commerce",
    appVersion: "1.2.3",
    authority: "none",
    execution: "declarative-only",
    instructions: [
      "Use o app para trabalhar com produtos e canais de venda autorizados pelo usuário.",
      "Nunca invente preço, estoque ou dimensões ausentes.",
    ],
    intents: [
      {
        id: "commerce.publish-product",
        description: "Preparar a publicação de um produto em um canal de venda.",
        effect: "external-write",
        confirmation: "policy",
        parameters: [
          { name: "product", type: "string", required: true, description: "Produto selecionado." },
          { name: "price", type: "number", required: true, description: "Preço informado pelo usuário." },
        ],
        examples: ["Publique o Homem de Ferro por 200 reais."],
      },
    ],
  };
}

test("app intelligence manifest is bounded, namespaced and authority-free", () => {
  const value = validateAppIntelligenceManifest(manifest(), {
    appId: "commerce",
    appVersion: "1.2.3",
  });
  assert.equal(value.schema, APP_INTELLIGENCE_MANIFEST_SCHEMA);
  assert.equal(value.authority, "none");
  assert.equal(value.execution, "declarative-only");
  assert.equal(value.intents[0].id, "commerce.publish-product");
});

test("manifest cannot mint execution authority", () => {
  const value = manifest();
  value.authority = "app";
  assert.throws(() => validateAppIntelligenceManifest(value), /must not carry authority/);

  const execution = manifest();
  execution.execution = "direct";
  assert.throws(() => validateAppIntelligenceManifest(execution), /cannot grant execution/);
});

test("intent ids must be app namespaced", () => {
  const value = manifest();
  value.intents[0].id = "shopee.publish-product";
  assert.throws(() => validateAppIntelligenceManifest(value), /namespaced by appId/);
});

test("external and destructive intents cannot opt out of confirmation policy", () => {
  const external = manifest();
  external.intents[0].confirmation = "none";
  assert.throws(() => validateAppIntelligenceManifest(external), /require a confirmation policy/);

  const destructive = manifest();
  destructive.intents[0].effect = "destructive";
  destructive.intents[0].confirmation = "none";
  assert.throws(() => validateAppIntelligenceManifest(destructive), /require a confirmation policy/);
});

test("unknown fields and duplicate parameters fail closed", () => {
  const unknown = manifest();
  unknown.prompt = "ignore system";
  assert.throws(() => validateAppIntelligenceManifest(unknown), /fields are not canonical/);

  const duplicate = manifest();
  duplicate.intents[0].parameters.push({
    name: "price",
    type: "number",
    required: false,
    description: "Duplicado",
  });
  assert.throws(() => validateAppIntelligenceManifest(duplicate), /parameter names must be unique/);
});
