import assert from "node:assert/strict";
import test from "node:test";
import {
  createProjectBindingReviewRuntime,
} from "../system/services/projects/binding-review.mjs";
import {
  PROJECT_CATALOG_SCHEMA,
} from "../system/contracts/project-catalog.mjs";
import {
  PROJECT_CLOUD_LINKS_SCHEMA,
} from "../system/contracts/project-cloud-links.mjs";

const DEVICE = "14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5";
const SPACE = "11111111-1111-4111-8111-111111111111";
const CLOUD = "22222222-2222-4222-8222-222222222222";
const CLOUD_READY = "33333333-3333-4333-8333-333333333333";

function projectCatalog() {
  const snapshot = Object.freeze({
    persistence: "device",
    projects: Object.freeze([
      Object.freeze({
        id: "project-1",
        name: "Forge",
        path: "/Projects/Forge",
        createdAt: 1,
        lastOpenedAt: 1,
        lastFilePath: null,
      }),
    ]),
  });
  return Object.freeze({
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe() { return () => {}; },
  });
}

function cloudLinks() {
  let links = [];
  const listeners = new Set();
  const port = {
    schema: PROJECT_CLOUD_LINKS_SCHEMA,
    getSnapshot() { return { persistence: "device", links }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    link(localProjectId, {cloudProjectId, spaceId}) {
      links = [...links, {localProjectId, cloudProjectId, spaceId, linkedAt: 10}];
      for (const listener of listeners) listener(port.getSnapshot());
      return port.getSnapshot();
    },
    unlink(localProjectId) {
      links = links.filter((link) => link.localProjectId !== localProjectId);
      return port.getSnapshot();
    },
    destroy() { listeners.clear(); },
  };
  return Object.freeze(port);
}

function onboardingProject(projectId, nextState, bound = false) {
  return {
    project_id: projectId,
    space_id: SPACE,
    name: projectId === CLOUD ? "Forge Cloud" : "Already Ready",
    kind: "software",
    state: "active",
    github_connection_count: 1,
    repository_full_name: "ordaxsystems/ordax-apps",
    space_device_execute: true,
    project_device_bound: bound,
    next_state: nextState,
  };
}

test("Project binding review links only explicit eligible Project authority for the enrolled device", async () => {
  let requested = null;
  const windowRef = {
    fetch: async (url, init) => {
      requested = {url, init};
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            schema: "ordax.owner-project-onboarding-view/1",
            device_id: DEVICE,
            spaces: [{space_id: SPACE, name: "Dev", kind: "personal", state: "active"}],
            projects: [
              onboardingProject(CLOUD, "needs_device_binding", false),
              onboardingProject(CLOUD_READY, "ready", true),
            ],
            next_state: null,
          };
        },
      };
    },
  };
  const links = cloudLinks();
  const runtime = createProjectBindingReviewRuntime({
    windowRef,
    productRuntimeStatus: { read: async () => ({enrolled: true, deviceId: DEVICE}) },
    projects: projectCatalog(),
    projectCloudLinks: links,
  });

  const ready = await runtime.refresh();
  assert.equal(ready.state, "ready");
  assert.equal(requested.url, `/account/mcp/project-onboarding?device_id=${DEVICE}`);
  assert.equal(requested.init.credentials, "same-origin");
  assert.deepEqual(ready.localProjects.map((entry) => entry.id), ["project-1"]);

  await runtime.link("project-1", CLOUD);
  assert.deepEqual(links.getSnapshot().links.map(({localProjectId, cloudProjectId, spaceId}) =>
    ({localProjectId, cloudProjectId, spaceId})), [{
      localProjectId: "project-1",
      cloudProjectId: CLOUD,
      spaceId: SPACE,
    }]);

  assert.throws(() => runtime.link("project-1", CLOUD_READY),
    /not eligible/);
  runtime.dispose();
});

test("Project binding review stays fail-closed without an enrolled local device id", async () => {
  let fetched = false;
  const runtime = createProjectBindingReviewRuntime({
    windowRef: { fetch: async () => { fetched = true; throw new Error("unexpected"); } },
    productRuntimeStatus: { read: async () => ({enrolled: false, deviceId: null}) },
    projects: projectCatalog(),
    projectCloudLinks: cloudLinks(),
  });
  const result = await runtime.refresh();
  assert.equal(result.state, "unavailable");
  assert.equal(fetched, false);
  runtime.dispose();
});
