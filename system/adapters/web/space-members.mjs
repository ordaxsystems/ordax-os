import { SPACE_MEMBERS_READ_SCHEMA, validateSpaceMembersListRequest, validateSpaceMembersPage } from "../../contracts/space-members.mjs";
import { createWebJsonReader } from "./json-read.mjs";
export function createWebSpaceMembersReader(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") throw new TypeError("Web Space members reader requires window.fetch");
  const reader=createWebJsonReader(windowRef); let disposed=false;
  return Object.freeze({schema:SPACE_MEMBERS_READ_SCHEMA,async listMembers(value){if(disposed)throw new Error("Web Space members reader is disposed");const request=validateSpaceMembersListRequest(value);const query=new URLSearchParams({spaceId:request.spaceId});if(request.cursor!==null)query.set("cursor",request.cursor);const response=await reader.read(`/account/space-members?${query.toString()}`);if(response.status===401||response.status===403)throw new Error("Space members are unavailable for the current account session");if(!response.ok)throw new Error(`Space members read failed: ${response.status}`);const page=validateSpaceMembersPage(response.value);if(page.spaceId!==request.spaceId)throw new Error("Space members response targets another Space");return page;},dispose(){if(disposed)return;disposed=true;reader.dispose();}});
}
