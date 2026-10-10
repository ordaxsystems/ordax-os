import {
  assertFileSpacePort,
  validateFileListing,
  validateFileSpacePath,
} from "../../../../contracts/file-space.mjs";
import {
  validateApplicationActionProvider,
  validateApplicationActionProviderInvocation,
  validateApplicationActionProviderResult,
} from "../../../../contracts/application-action-provider.mjs";

export const FILES_NATIVE_ACTIONS = Object.freeze(["files.browse"]);
const MAX_LIST_RESULTS = 64;

function response(status, summary, output = null) {
  return validateApplicationActionProviderResult({
    schema: "ordax.application-action-provider-result/1",
    status, summary, output, artifactRefs: [],
  });
}

function logicalLocation(value) {
  if (value === undefined || value === null || value === "") return "/";
  if (typeof value !== "string" || value.length > 1024 || value.includes("\\")
      || value.includes("://")) {
    throw new TypeError("Invalid Files logical location");
  }
  const known = { Documentos: "/Documentos", Downloads: "/Downloads", Imagens: "/Imagens" };
  return validateFileSpacePath(known[value] ?? value);
}

export function createFilesApplicationActionProvider(fileSpace) {
  // The only data authority is the scoped File Space supplied by the host.
  const port = assertFileSpacePort(fileSpace);
  return validateApplicationActionProvider({
    schema: "ordax.application-action-provider/1",
    appId: "files",
    adapterId: "files-native",
    revision: "1",
    actions: FILES_NATIVE_ACTIONS,
    async invoke(invocation) {
      let checked;
      try {
        checked = validateApplicationActionProviderInvocation(invocation, {
          appId: "files", actionIds: FILES_NATIVE_ACTIONS,
        });
      } catch {
        return response("failed", "Solicitação de Arquivos incompatível");
      }
      try {
        const args = checked.arguments;
        if (Object.keys(args).some((key) => key !== "location")) {
          return response("failed", "Parâmetros de Arquivos não permitidos");
        }
        const requested = logicalLocation(args.location);
        const listing = validateFileListing(await port.list(requested));
        if (listing.path !== requested) {
          throw new TypeError("Files response has mismatched logical location");
        }
        return response("succeeded", "Arquivos consultados", {
          location: requested,
          entries: listing.entries.slice(0, MAX_LIST_RESULTS).map(({ name, kind, size }) => (
            { name, kind, size }
          )),
          truncated: listing.entries.length > MAX_LIST_RESULTS,
        });
      } catch {
        return response("failed", "Não foi possível consultar a localização autorizada");
      }
    },
  });
}

export const applicationActionProviderArtifact = Object.freeze({
  schema: "ordax.application-action-provider-artifact/1",
  appId: "files",
  adapterId: "files-native",
  revision: "1",
  authority: "none",
  execution: "unavailable",
});
