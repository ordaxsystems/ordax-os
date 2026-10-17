import {
  SPACE_MEMBERS_READ_SCHEMA,
  validateSpaceMembersListRequest,
  validateSpaceMembersPage,
} from "../../contracts/space-members.mjs";
import { createWebJsonReader } from "./json-read.mjs";

export function createWebSpaceMembersRead(windowRef = globalThis.window) {
  const reader = createWebJsonReader(windowRef);
  let disposed = false;

  return Object.freeze({
    schema: SPACE_MEMBERS_READ_SCHEMA,
    async listMembers(requestValue) {
      if (disposed) throw new Error("Space members adapter is disposed");
      const request = validateSpaceMembersListRequest(requestValue);
      const query = new URLSearchParams({ spaceId: request.spaceId });
      if (request.cursor !== null) query.set("cursor", request.cursor);
      const response = await reader.read(`/account/space-members?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Space members read failed: ${response.status}`);
      }
      return validateSpaceMembersPage(response.value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reader.dispose();
    },
  });
}
