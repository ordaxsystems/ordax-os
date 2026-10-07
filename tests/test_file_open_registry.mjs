import assert from "node:assert/strict";
import test from "node:test";
import { createFileOpenRegistry } from "../system/services/files/file-open-registry.mjs";

const image = {
  schema: "ordax.file-association-manifest/1",
  appId: "image-viewer",
  appVersion: "0.1.0",
  authority: "none",
  role: "viewer",
  extensions: ["jpg", "png"],
};
const pdf = {
  schema: "ordax.file-association-manifest/1",
  appId: "pdf-viewer",
  appVersion: "0.1.0",
  authority: "none",
  role: "viewer",
  extensions: ["pdf"],
};

test("file-open registry distinguishes known handler from launchable handler", () => {
  const registry = createFileOpenRegistry({
    manifests: [image, pdf],
    isAppAvailable: (appId) => appId === "image-viewer",
  });
  assert.deepEqual(registry.resolve("/Imagens/Teste.PNG"), {
    state: "ready",
    extension: "png",
    appId: "image-viewer",
    role: "viewer",
  });
  assert.deepEqual(registry.resolve("/Docs/manual.pdf"), {
    state: "handler-unavailable",
    extension: "pdf",
    appId: "pdf-viewer",
    role: "viewer",
  });
});

test("file-open registry fails closed for unsupported paths", () => {
  const registry = createFileOpenRegistry({ manifests: [image] });
  assert.equal(registry.resolve("/arquivo").state, "unsupported");
  assert.equal(registry.resolve("/arquivo.zip").state, "unsupported");
});

test("file-open registry rejects duplicate extension ownership", () => {
  assert.throws(
    () => createFileOpenRegistry({
      manifests: [
        image,
        { ...pdf, appId: "other-viewer", extensions: ["png"] },
      ],
    }),
    /File association conflict/,
  );
});
