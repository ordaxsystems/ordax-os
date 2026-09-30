import { ACTION_ADAPTER_SCHEMA } from "../../contracts/action-executor.mjs";
import {
  assertFileSpacePort,
  validateFileSpacePath,
} from "../../contracts/file-space.mjs";
import { defineIntelligenceTool } from "../../contracts/intelligence-tool.mjs";
import { readNativeToolArtifactSha256 } from "./tool-artifact-identity.mjs";

export const NATIVE_FILE_ACTION_TOOL_ID = "ordax-native-file-space";
export const NATIVE_FILE_ENSURE_DIRECTORY_ACTION = "files.directory.ensure";

export function validateNativeFileDirectoryResourceRef(resourceRef) {
  const prefix = "file-space:";
  if (typeof resourceRef !== "string" || !resourceRef.startsWith(prefix)) {
    throw new TypeError("Native file action requires a file-space resource reference");
  }
  const path = validateFileSpacePath(resourceRef.slice(prefix.length));
  if (path === "/") {
    throw new TypeError("Native file action cannot create the file-space root");
  }
  const parts = path.split("/").slice(1);
  const name = parts.at(-1);
  const parentPath = parts.length === 1 ? "/" : `/${parts.slice(0, -1).join("/")}`;
  validateFileSpacePath(parentPath);
  return `file-space:${path}`;
}

function parseDirectoryResource(resourceRef) {
  const normalized = validateNativeFileDirectoryResourceRef(resourceRef);
  const path = normalized.slice("file-space:".length);
  const parts = path.split("/").slice(1);
  const name = parts.at(-1);
  const parentPath = parts.length === 1 ? "/" : `/${parts.slice(0, -1).join("/")}`;
  return Object.freeze({ path, parentPath, name });
}

export async function createNativePersonalOrdaxFileActions({
  windowRef = globalThis.window,
  fileSpace: fileSpaceValue,
  artifactIdentity = readNativeToolArtifactSha256,
} = {}) {
  const fileSpace = assertFileSpacePort(fileSpaceValue);
  if (typeof artifactIdentity !== "function") {
    throw new TypeError("Native file action requires an artifact identity provider");
  }
  const artifactSha256 = await artifactIdentity(windowRef, import.meta.url);

  const tool = defineIntelligenceTool({
    id: NATIVE_FILE_ACTION_TOOL_ID,
    version: "1.0.0",
    artifactSha256,
    sandbox: "native-broker",
    actions: [{
      id: NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
      mode: "write",
      approval: "per-use",
      scopes: ["user-file-space"],
    }],
    network: {
      allowed: false,
      destinations: [],
    },
    filesystem: {
      allowed: true,
      scopes: ["user-file-space"],
    },
    limits: {
      timeoutMs: 5000,
      maxOutputBytes: 16384,
    },
  });

  const createDirectoryAdapter = Object.freeze({
    schema: ACTION_ADAPTER_SCHEMA,
    toolId: tool.id,
    artifactSha256: tool.artifactSha256,
    actionId: NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
    effect: "write",
    async execute(request) {
      const resource = parseDirectoryResource(request.resourceRef);
      const before = await fileSpace.list(resource.parentPath);
      const existing = before.entries.find((entry) => entry.name === resource.name);
      if (existing?.kind === "directory") {
        return Object.freeze({
          status: "succeeded",
          summary: `Directory already exists in the bounded user file-space: ${resource.path}`,
          artifactRefs: Object.freeze([request.resourceRef]),
        });
      }
      if (existing) {
        throw new Error("Native file action target already exists and is not a directory");
      }
      const listing = await fileSpace.createDirectory(resource.parentPath, resource.name);
      if (
        listing.path !== resource.parentPath
        || !listing.entries.some((entry) =>
          entry.name === resource.name && entry.kind === "directory"
        )
      ) {
        throw new Error("Native file action could not verify the created directory");
      }
      return Object.freeze({
        status: "succeeded",
        summary: `Directory created in the bounded user file-space: ${resource.path}`,
        artifactRefs: Object.freeze([request.resourceRef]),
      });
    },
  });

  const actionRegistrations = Object.freeze([Object.freeze({
    entry: Object.freeze({
      id: "native-file.ensure-directory",
      toolId: tool.id,
      toolArtifactSha256: tool.artifactSha256,
      actionId: NATIVE_FILE_ENSURE_DIRECTORY_ACTION,
      effect: "write",
      inputKind: "resource-value",
      resourceScheme: "file-space",
    }),
    toResourceRef(resourceValue) {
      if (typeof resourceValue !== "string" || resourceValue.includes("\0")) {
        throw new TypeError("Native file action directory input must be text");
      }
      const path = resourceValue.trim();
      return validateNativeFileDirectoryResourceRef(`file-space:${path}`);
    },
    reason: "Ensure the explicitly selected directory exists inside the canonical user file-space.",
  })]);

  return Object.freeze({
    tool,
    actionRegistrations,
    toolResolver(toolId) {
      return toolId === tool.id ? tool : null;
    },
    adapterResolver(toolId, actionId) {
      return toolId === tool.id && actionId === createDirectoryAdapter.actionId
        ? createDirectoryAdapter
        : null;
    },
  });
}
