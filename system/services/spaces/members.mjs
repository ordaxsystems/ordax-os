import { assertSpacesPort } from "../../contracts/spaces.mjs";
import {
  assertSpaceMembersReadPort,
  validateSpaceMembersListRequest,
  validateSpaceMembersPage,
} from "../../contracts/space-members.mjs";

export function createSpaceMembersReader({ spaces, members }) {
  const spacesPort = assertSpacesPort(spaces);
  const membersPort = assertSpaceMembersReadPort(members);

  return Object.freeze({
    async list(requestValue) {
      const request = validateSpaceMembersListRequest(requestValue);
      const spacesSnapshot = spacesPort.getSnapshot();
      if (spacesSnapshot.state !== "ready") {
        throw new Error("Space members are unavailable while the Spaces catalog is not ready");
      }
      if (!spacesSnapshot.spaces.some((space) => space.id === request.spaceId)) {
        throw new Error("Space members target is not present in the current authorized Spaces catalog");
      }

      const page = validateSpaceMembersPage(await membersPort.listMembers(request));
      if (page.spaceId !== request.spaceId) {
        throw new Error("Space members provider returned a page for another Space");
      }
      return page;
    },
  });
}
