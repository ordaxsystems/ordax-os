import assert from "node:assert/strict";
import test from "node:test";

import { parseIntelligenceHandoffTarget } from "../system/contracts/intelligence-handoff.mjs";
import { createIntelligenceContextGrantBroker } from "../system/services/intelligence/context-grants.mjs";
import { createIntelligenceContextShare } from "../system/services/intelligence/context-share.mjs";
import {
  FILE_SELECTION_CONTEXT_SOURCE_ID,
  createFileSelectionIntelligenceHandoff,
  offerFileSelectionToIntelligence,
} from "../system/services/intelligence/file-selection-share.mjs";

function runtime() {
  let ordinal = 0;
  const grants = createIntelligenceContextGrantBroker({
    now: () => 2_000_000,
    createGrantId: () => `grant-${String(++ordinal).padStart(16, "0")}`,
  });
  return { grants, share: createIntelligenceContextShare(grants) };
}

test("Files shares only bounded selected text through a one-shot authorization", () => {
  const { grants, share } = runtime();
  const privatePath = "/Documentos/cliente-secreto/plano.txt";
  const text = "A".repeat(20_000);

  const offered = offerFileSelectionToIntelligence(share, {
    name: "plano.txt",
    size: 20_000,
    modifiedAt: 1_700_000_000_000,
    text,
    path: privatePath,
  });

  assert.equal(offered.sourceAppId, "files");
  assert.equal(offered.sourceId, FILE_SELECTION_CONTEXT_SOURCE_ID);
  assert.equal(offered.target.kind, "document");
  assert.equal(offered.displayLabel, "plano.txt");
  assert.equal(JSON.stringify(offered).includes(privatePath), false);

  const authorization = share.take({
    sourceAppId: "files",
    target: offered.target,
  });
  assert.ok(authorization);
  const context = grants.consume(authorization.grantId, {
    sourceId: authorization.sourceId,
    target: authorization.target,
  });

  assert.equal(context.length, 1);
  assert.equal(context[0].scope, "document");
  assert.equal(context[0].provenance, "ordax:files:user-authorized-selection");
  assert.ok(context[0].text.length <= 8192);
  assert.equal(context[0].text.includes(privatePath), false);
  assert.throws(
    () => grants.consume(authorization.grantId, {
      sourceId: authorization.sourceId,
      target: authorization.target,
    }),
    /unavailable or already consumed/,
  );

  share.dispose();
  grants.dispose();
});

test("Files handoff carries identity and intent but never the grant token or file contents", () => {
  const { grants, share } = runtime();
  const secret = "conteudo muito privado que nao pode entrar na URL";
  const offered = offerFileSelectionToIntelligence(share, {
    name: "ideias.md",
    size: secret.length,
    modifiedAt: 1_700_000_123_456,
    text: secret,
  });
  const authorization = share.take({ sourceAppId: "files", target: offered.target });
  assert.ok(authorization);

  const encoded = createFileSelectionIntelligenceHandoff(offered, {
    mode: "plan",
    suggestedPrompt: "Planeje os próximos passos a partir deste arquivo.",
  });
  const parsed = parseIntelligenceHandoffTarget(encoded);

  assert.equal(parsed.sourceAppId, "files");
  assert.equal(parsed.mode, "plan");
  assert.deepEqual(parsed.target, offered.target);
  assert.equal(parsed.displayLabel, "ideias.md");
  assert.equal(encoded.includes(authorization.grantId), false);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes("grantId"), false);

  grants.revoke(authorization.grantId);
  share.dispose();
  grants.dispose();
});

test("Files sharing rejects malformed metadata instead of inventing a target", () => {
  const { grants, share } = runtime();
  assert.throws(
    () => offerFileSelectionToIntelligence(share, {
      name: "arquivo.txt",
      size: -1,
      modifiedAt: 1,
      text: "conteudo",
    }),
    /non-negative safe integer/,
  );
  assert.throws(
    () => offerFileSelectionToIntelligence(share, {
      name: "arquivo.txt",
      size: 1,
      modifiedAt: 1,
      text: " ",
    }),
    /outside its allowed bounds/,
  );
  share.dispose();
  grants.dispose();
});
