import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { activityApp } from "../system/apps/activity/app.mjs";
import { activityComponent } from "../system/apps/activity/component.mjs";
import { projectPersonalActivitySnapshot } from "../system/apps/activity/view-model.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

function identitySession() {
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return { state: "signed-out", subjectId: null, displayName: null };
    },
    subscribe() {
      return () => {};
    },
  };
}

function intelligence() {
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return {
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
        toolExecution: false,
      };
    },
    subscribe() {
      return () => {};
    },
    async respond() {
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "resultado visivel",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
}

test("Activity is a first-party app that owns no separate persistence capability", () => {
  assert.equal(activityApp.id, "activity");
  assert.equal(activityApp.panels[0].extensionId, "personal-activity");
  assert.deepEqual(activityApp.requiredCapabilities, []);
  assert.equal(activityComponent.owner, "system/apps/activity");
  assert.deepEqual(activityComponent.dependencies, ["surface-shell"]);
});

test("Activity projection reads Work, Activity and Result from the canonical Personal OrdaX snapshot", async () => {
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySession(),
    intelligencePort: intelligence(),
  });
  const work = runtime.create("Produzir resultado");
  await runtime.run(work.id);

  const view = projectPersonalActivitySnapshot(runtime.getSnapshot());
  assert.equal(view.ownerKind, "device");
  assert.equal(view.work.length, 1);
  assert.equal(view.work[0].item.id, work.id);
  assert.equal(view.work[0].item.state, "completed");
  assert.equal(view.work[0].result.text, "resultado visivel");
  assert.equal(view.work[0].result.authority, "none");
  assert.equal(view.work[0].activities.at(-1).type, "completed");
  runtime.dispose();
});

test("Activity Surface creates Work only from its explicit user action and does not own a task store", async () => {
  const source = await readFile(
    new URL("../system/apps/activity/ui/workspace-controls.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /dataset\.personalWorkCreate/);
  assert.match(source, /personalOrdax\.create\(goal\)/);
  assert.match(source, /personalOrdax\.run\(id\)/);
  assert.match(source, /approvalConsent\.canApprove\(item\.id, entry\.pendingApproval\.id\)/);
  assert.match(source, /entry\.pendingApproval\.resourceRef/);
  assert.match(source, /approvalConsent\.approve\(workItemId, approvalId\)/);
  assert.match(source, /approvalConsent\.deny\(workItemId, approvalId\)/);
  assert.match(source, /dataset\.personalApprovalAction/);
  assert.match(source, /dataset\.personalApprovedActionExecute/);
  assert.match(source, /personalOrdax\.canExecuteApprovedAction\(item\.id, approved\.id\)/);
  assert.match(source, /personalOrdax\.executeApprovedAction\(workItemId, approvalId\)/);
  assert.match(source, /personalOrdax\.listAvailableActions\(\)/);
  assert.match(source, /personalOrdax\.requestAvailableAction\(actionWorkId, actionEntryId/);
  assert.match(source, /dataset\.personalActionResource/);
  assert.match(source, /dataset\.personalActionRequest/);
  assert.match(source, /entry\.latestAttempt/);
  assert.match(source, /activity\.attempt\.status/);
  assert.match(source, /activity\.attempt\.uncertain\.detail/);
  assert.match(source, /dataset\.personalActivityExport/);
  assert.match(source, /dataset\.personalRecoveryInput/);
  assert.match(source, /dataset\.personalRecoveryFind/);
  assert.match(source, /personalOrdax\.recoverWorkForRequest\(request\)/);
  assert.match(source, /personalOrdax\.acceptRecoveredWork\(recoveryState\.value\)/);
  assert.match(source, /createPersonalActivityExportDocument\(personalOrdax\.getSnapshot\(\)\)/);
  assert.match(source, /activityExport\.save\(document\)/);
  assert.match(source, /dataset\.personalProposalSuggest/);
  assert.match(source, /personalOrdax\.proposeActionForWork\(workItemId\)/);
  assert.match(source, /dataset\.personalProposalAction/);
  assert.match(source, /personalOrdax\.requestProposedAction\(proposalState\.value\)/);
  assert.match(source, /proposal\.authority/);
  assert.match(source, /dataset\.personalApplicationProposalSuggest/);
  assert.match(source, /personalOrdax\.suggestApplicationActionForWork\(workItemId\)/);
  assert.match(source, /personalOrdax\.prepareSuggestedApplicationAction\(proposalWorkId, proposed\.value\)/);
  assert.match(source, /personalOrdax\.listApplicationActionPreparations\(item\.id\)/);
  assert.match(source, /personalOrdax\.revokeApplicationActionPreparation\(revokePreparation\)/);
  assert.match(source, /activity\.applicationProposal\.notAuthorized/);
  assert.doesNotMatch(source, /personalOrdax\.executeApplicationAction\(/);

  assert.equal(source.includes("file-space:"), false);
  // The same canonical snapshot must feed both the Activity projection and
  // the authorization fence for a targeted Work; separate reads can race.
  assert.match(source, /const source = personalOrdax\\.getSnapshot\\(\\);/);
  assert.match(source, /projectPersonalActivitySnapshot\\(source\\)/);
  assert.match(source, /resolvePersonalActivityWorkTarget\\([\\s\\S]*?appTarget, source,/);
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|createPersonalOrdaxRuntime|conversation\.send|grantIssuer|\.issue\(/,
  );
  assert.doesNotMatch(source, /spaceId\s*:|projectId\s*:/);
});

test("Native composition passes the one mounted Personal OrdaX runtime into Activity", async () => {
  const source = await readFile(
    new URL("../system/composition/native/main.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /componentId:\s*"activity"/);
  assert.match(source, /import\("\.\.\/\.\.\/apps\/activity\/runtime\.mjs"\)/);
  assert.match(source, /createNativePersonalActivityExport\(fileSpace\)/);
  assert.match(source, /context:\s*\{[\s\S]*?personalOrdax,[\s\S]*?activityExport:\s*personalActivityExport,[\s\S]*?\}/);
  assert.match(source, /activityComponent\?\.destroy\(\)/);
});
