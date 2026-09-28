import assert from "node:assert/strict";
import test from "node:test";

import { parseIntelligenceHandoffTarget } from "../system/contracts/intelligence-handoff.mjs";
import { createIntelligenceContextGrantBroker } from "../system/services/intelligence/context-grants.mjs";
import { createIntelligenceContextShare } from "../system/services/intelligence/context-share.mjs";
import {
  WORKSPACE_SELECTION_CONTEXT_SOURCE_ID,
  createWorkspaceSelectionIntelligenceContext,
  createWorkspaceSelectionIntelligenceHandoff,
  offerWorkspaceSelectionToIntelligence,
} from "../system/services/intelligence/workspace-selection-share.mjs";

function runtime() {
  let ordinal = 0;
  const grants = createIntelligenceContextGrantBroker({
    now: () => 3_000_000,
    createGrantId: () => `grant-${String(++ordinal).padStart(16, "0")}`,
  });
  return { grants, share: createIntelligenceContextShare(grants) };
}

function workspaceRecord() {
  return {
    activeAreaId: "area-3",
    nextAreaOrdinal: 5,
    areas: [
      {
        id: "area-3",
        ordinal: 3,
        activeWindowId: "notes:2",
        nextWindowOrdinal: 4,
        windows: [
          {
            id: "files:1",
            appId: "files",
            minimized: true,
            maximized: false,
            placementOrdinal: 1,
            positionX: 120,
            positionY: 80,
            target: "/Documentos/cliente-secreto/plano.txt",
          },
          {
            id: "notes:2",
            appId: "notes",
            minimized: false,
            maximized: true,
            placementOrdinal: 2,
            positionX: 16,
            positionY: 24,
            target: "nota-ultrassecreta-123",
          },
          {
            id: "internet:3",
            appId: "internet",
            minimized: false,
            maximized: false,
            placementOrdinal: 3,
            positionX: 320,
            positionY: 96,
            target: "https://example.invalid/private?q=secret",
          },
        ],
      },
      {
        id: "area-4",
        ordinal: 4,
        activeWindowId: null,
        nextWindowOrdinal: 1,
        windows: [],
      },
    ],
  };
}

test("workspace selection exposes only scrubbed structural metadata", () => {
  const privateValues = [
    "/Documentos/cliente-secreto/plano.txt",
    "nota-ultrassecreta-123",
    "https://example.invalid/private?q=secret",
    "files:1",
    "notes:2",
    "internet:3",
  ];
  const selection = createWorkspaceSelectionIntelligenceContext(workspaceRecord());

  assert.deepEqual(selection.target, { kind: "workspace", id: "area-3" });
  assert.equal(selection.displayLabel, "Área 3");
  assert.equal(selection.context.length, 1);
  assert.equal(selection.context[0].scope, "workspace");
  assert.equal(
    selection.context[0].provenance,
    "ordax:system:user-authorized-workspace-selection",
  );
  assert.deepEqual(JSON.parse(selection.context[0].text), {
    areaOrdinal: 3,
    windowCount: 3,
    visibleWindowCount: 2,
    activeAppId: "notes",
    appIds: ["files", "internet", "notes"],
    visibleAppIds: ["internet", "notes"],
  });
  for (const privateValue of privateValues) {
    assert.equal(JSON.stringify(selection).includes(privateValue), false);
  }
});

test("workspace selection uses one-shot authorization and keeps targets out of model context", () => {
  const { grants, share } = runtime();
  const offered = offerWorkspaceSelectionToIntelligence(share, workspaceRecord());

  assert.equal(offered.sourceAppId, "system");
  assert.equal(offered.sourceId, WORKSPACE_SELECTION_CONTEXT_SOURCE_ID);
  assert.deepEqual(offered.target, { kind: "workspace", id: "area-3" });

  const authorization = share.take({
    sourceAppId: "system",
    target: offered.target,
  });
  assert.ok(authorization);
  const context = grants.consume(authorization.grantId, {
    sourceId: authorization.sourceId,
    target: authorization.target,
  });
  assert.equal(context.length, 1);
  assert.equal(context[0].text.includes("cliente-secreto"), false);
  assert.equal(context[0].text.includes("nota-ultrassecreta"), false);
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

test("workspace handoff carries structural identity but no grant or private window target", () => {
  const { grants, share } = runtime();
  const offered = offerWorkspaceSelectionToIntelligence(share, workspaceRecord());
  const authorization = share.take({ sourceAppId: "system", target: offered.target });
  assert.ok(authorization);

  const encoded = createWorkspaceSelectionIntelligenceHandoff(offered);
  const parsed = parseIntelligenceHandoffTarget(encoded);
  assert.equal(parsed.sourceAppId, "system");
  assert.equal(parsed.mode, "plan");
  assert.deepEqual(parsed.target, { kind: "workspace", id: "area-3" });
  assert.equal(parsed.displayLabel, "Área 3");
  assert.equal(encoded.includes(authorization.grantId), false);
  assert.equal(encoded.includes("cliente-secreto"), false);
  assert.equal(encoded.includes("nota-ultrassecreta"), false);
  assert.equal(encoded.includes("grantId"), false);

  grants.revoke(authorization.grantId);
  share.dispose();
  grants.dispose();
});

test("workspace selection rejects invalid workspace state instead of guessing", () => {
  assert.throws(
    () => createWorkspaceSelectionIntelligenceContext({
      activeAreaId: "area-9",
      nextAreaOrdinal: 3,
      areas: [{
        id: "area-1",
        ordinal: 1,
        activeWindowId: null,
        nextWindowOrdinal: 1,
        windows: [],
      }],
    }),
    /activeAreaId/,
  );
});
