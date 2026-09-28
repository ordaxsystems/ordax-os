import assert from "node:assert/strict";
import test from "node:test";

import { defineFirstPartyApp } from "../system/apps/app-contract.mjs";
import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { accountApp } from "../system/apps/account/app.mjs";
import { filesApp } from "../system/apps/files/app.mjs";
import { notesApp } from "../system/apps/notes/app.mjs";
import { projectsApp } from "../system/apps/projects/app.mjs";
import { systemApp } from "../system/apps/system/app.mjs";
import { listFirstPartyGrantedIntelligenceContextSources } from "../system/services/intelligence/first-party-context-sources.mjs";
import { createIntelligenceToolRegistry } from "../system/services/intelligence/tool-registry.mjs";

function redefine(app, intelligence) {
  return defineFirstPartyApp({
    id: app.id,
    title: app.title,
    description: app.description,
    monogram: app.monogram,
    singleton: app.singleton,
    component: app.component,
    requiredCapabilities: [...app.requiredCapabilities],
    optionalCapabilities: [...app.optionalCapabilities],
    intelligence,
    panels: [...app.panels],
  });
}

test("first-party apps own bounded Intelligence integration metadata", () => {
  assert.deepEqual(filesApp.intelligence, {
    contextSourceIds: ["file-selection"],
    toolIds: [],
  });
  assert.deepEqual(projectsApp.intelligence, {
    contextSourceIds: ["project-selection", "project-evidence-selection"],
    toolIds: [],
  });
  assert.deepEqual(notesApp.intelligence, {
    contextSourceIds: ["note-selection"],
    toolIds: [],
  });
  assert.deepEqual(systemApp.intelligence, {
    contextSourceIds: ["workspace-selection"],
    toolIds: [
      "observe-system-metrics",
      "observe-network-status",
      "observe-power-status",
    ],
  });
  assert.deepEqual(accountApp.intelligence, {
    contextSourceIds: [],
    toolIds: [],
  });
  for (const app of [filesApp, projectsApp, notesApp, systemApp, accountApp]) {
    assert.ok(Object.isFrozen(app.intelligence));
    assert.ok(Object.isFrozen(app.intelligence.contextSourceIds));
    assert.ok(Object.isFrozen(app.intelligence.toolIds));
  }
});

test("canonical app Intelligence integrations resolve against canonical context and tool registries", () => {
  const sourceSpecs = listFirstPartyGrantedIntelligenceContextSources();
  const sourceIds = new Set(sourceSpecs.map((source) => source.id));
  const tools = createIntelligenceToolRegistry();
  const declaredContextOwners = new Map();

  for (const app of listFirstPartyApps()) {
    for (const sourceId of app.intelligence.contextSourceIds) {
      assert.ok(sourceIds.has(sourceId), `${app.id} declares unknown Intelligence context source ${sourceId}`);
      assert.equal(declaredContextOwners.has(sourceId), false, `Intelligence context source ${sourceId} has multiple app owners`);
      declaredContextOwners.set(sourceId, app.id);
    }
    for (const toolId of app.intelligence.toolIds) {
      const tool = tools.get(toolId);
      assert.ok(tool, `${app.id} declares unknown Intelligence tool ${toolId}`);
      assert.equal(tool.readOnly, true, `${app.id} Intelligence tool ${toolId} must remain read-only`);
      assert.equal(tool.authority, "none", `${app.id} Intelligence tool ${toolId} must not grant authority`);
    }
  }

  assert.deepEqual(
    [...declaredContextOwners.keys()].sort(),
    [...sourceIds].sort(),
    "every canonical explicit Intelligence context source must have exactly one first-party app owner",
  );
});

test("app Intelligence metadata rejects duplicates, malformed ids and hidden authority fields", () => {
  assert.throws(
    () => redefine(projectsApp, {
      contextSourceIds: ["project-selection", "project-selection"],
    }),
    /invalid Intelligence context source ids/,
  );
  assert.throws(
    () => redefine(projectsApp, {
      contextSourceIds: ["Project.Selection"],
    }),
    /invalid Intelligence context source ids/,
  );
  assert.throws(
    () => redefine(projectsApp, {
      contextSourceIds: ["project-selection"],
      authority: "filesystem",
    }),
    /Intelligence field authority is not allowed/,
  );
});

test("declared tool ids remain metadata and do not create an invocation API", () => {
  const app = redefine(projectsApp, {
    contextSourceIds: ["project-selection"],
    toolIds: ["observe-project-status"],
  });
  assert.deepEqual(app.intelligence.toolIds, ["observe-project-status"]);
  assert.equal(typeof app.intelligence.invoke, "undefined");
  assert.equal(typeof app.intelligence.execute, "undefined");
  assert.equal(typeof app.intelligence.grant, "undefined");
});
