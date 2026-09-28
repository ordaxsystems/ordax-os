import assert from "node:assert/strict";
import test from "node:test";

import { createProjectsPresentation } from "../system/apps/projects/ui/workspace-controls.mjs";

const SPACE_A = "11111111-1111-4111-8111-111111111111";
const CLOUD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "Projeto local",
    path: "/Documentos/Projeto",
    createdAt: 10,
    lastOpenedAt: 20,
    lastFilePath: null,
    ...overrides,
  };
}

test("Projects presentation is honest when no local project catalog exists", () => {
  const presentation = createProjectsPresentation();
  assert.equal(presentation.available, false);
  assert.equal(presentation.persistence, "session");
  assert.deepEqual(presentation.items, []);
  assert.equal(presentation.linkedCount, 0);
});

test("Projects presentation preserves local identity and reports local-only state", () => {
  const presentation = createProjectsPresentation({
    projects: {
      persistence: "device",
      projects: [project()],
    },
  });

  assert.equal(presentation.available, true);
  assert.equal(presentation.persistence, "device");
  assert.equal(presentation.items.length, 1);
  assert.deepEqual(presentation.items[0], {
    id: "project-1",
    name: "Projeto local",
    path: "/Documentos/Projeto",
    lastOpenedAt: 20,
    linked: false,
    cloudProjectId: null,
    spaceId: null,
    referenceCount: 0,
  });
  assert.equal(presentation.linkedCount, 0);
});

test("Projects presentation overlays optional cloud identity without replacing local identity", () => {
  const presentation = createProjectsPresentation({
    projects: {
      persistence: "device",
      projects: [project()],
    },
    cloudLinks: {
      persistence: "device",
      links: [{
        localProjectId: "project-1",
        cloudProjectId: CLOUD_A,
        spaceId: SPACE_A,
        linkedAt: 30,
      }],
    },
  });

  assert.equal(presentation.items[0].id, "project-1");
  assert.equal(presentation.items[0].path, "/Documentos/Projeto");
  assert.equal(presentation.items[0].linked, true);
  assert.equal(presentation.items[0].cloudProjectId, CLOUD_A);
  assert.equal(presentation.items[0].spaceId, SPACE_A);
  assert.equal(presentation.items[0].referenceCount, 0);
  assert.equal(presentation.linkedCount, 1);
});

test("stale cloud links never fabricate local projects", () => {
  const presentation = createProjectsPresentation({
    projects: {
      persistence: "device",
      projects: [project()],
    },
    cloudLinks: {
      persistence: "session",
      links: [{
        localProjectId: "project-99",
        cloudProjectId: CLOUD_A,
        spaceId: SPACE_A,
        linkedAt: 30,
      }],
    },
  });

  assert.equal(presentation.items.length, 1);
  assert.equal(presentation.items[0].id, "project-1");
  assert.equal(presentation.items[0].linked, false);
  assert.equal(presentation.items[0].referenceCount, 0);
  assert.equal(presentation.linkedCount, 0);
});
