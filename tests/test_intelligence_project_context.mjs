import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectIntelligenceContext,
  createProjectsPresentation,
} from "../system/apps/projects/ui/workspace-controls.mjs";

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "OrdaX Studio",
    path: "/Documentos/ordax-studio",
    createdAt: 1_000,
    lastOpenedAt: 2_000,
    lastFilePath: "/Documentos/ordax-studio/README.md",
    ...overrides,
  };
}

function reference(ordinal, overrides = {}) {
  return {
    id: `project-ref-${ordinal}`,
    projectId: "project-1",
    url: `https://example.com/private/project?token=secret-${ordinal}`,
    title: `Reference ${ordinal}`,
    note: `Evidence note ${ordinal}`,
    createdAt: 1_000 + ordinal,
    updatedAt: 2_000 + ordinal,
    ...overrides,
  };
}

test("project context exposes bounded authorized evidence without local paths or reference URLs", () => {
  const references = Array.from({ length: 10 }, (_, index) => reference(index + 1));
  const [context] = createProjectIntelligenceContext(project(), {
    cloudLinked: true,
    catalogPersistence: "device",
    webReferences: references,
  });

  assert.equal(context.scope, "workspace");
  assert.equal(context.provenance, "ordax:projects:user-authorized-selection:catalog-cloud-reference-metadata");
  const payload = JSON.parse(context.text);
  assert.equal(payload.name, "OrdaX Studio");
  assert.equal(payload.lastOpenedAt, 2_000);
  assert.equal(payload.catalogPersistence, "device");
  assert.equal(payload.cloudLinked, true);
  assert.equal(payload.referenceCount, 10);
  assert.equal(payload.referencesIncluded, 8);
  assert.equal(payload.references.length, 8);
  assert.deepEqual(payload.references[0], {
    title: "Reference 1",
    note: "Evidence note 1",
    updatedAt: 2_001,
  });

  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("/Documentos/ordax-studio"), false);
  assert.equal(serialized.includes("README.md"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("token=secret"), false);
});

test("project presentation correlates cloud continuity and saved-reference counts", () => {
  const presentation = createProjectsPresentation({
    projects: {
      persistence: "device",
      projects: [project()],
    },
    cloudLinks: {
      schema: "ordax.project-cloud-links/1",
      persistence: "device",
      links: [{
        localProjectId: "project-1",
        cloudProjectId: "11111111-1111-4111-8111-111111111111",
        spaceId: "22222222-2222-4222-8222-222222222222",
        linkedAt: 2_100,
      }],
    },
    webReferences: {
      persistence: "device",
      references: [reference(1), reference(2)],
    },
  });

  assert.equal(presentation.available, true);
  assert.equal(presentation.persistence, "device");
  assert.equal(presentation.linkedCount, 1);
  assert.equal(presentation.items[0].linked, true);
  assert.equal(presentation.items[0].referenceCount, 2);
});

test("project context validates metadata policy instead of silently widening it", () => {
  assert.throws(
    () => createProjectIntelligenceContext(project(), { cloudLinked: "yes" }),
    /cloud linkage must be boolean/,
  );
  assert.throws(
    () => createProjectIntelligenceContext(project(), { catalogPersistence: "cloud" }),
    /catalog persistence is invalid/,
  );
  assert.throws(
    () => createProjectIntelligenceContext(project(), { webReferences: {} }),
    /web references must be an array/,
  );
});
