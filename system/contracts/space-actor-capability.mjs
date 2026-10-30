import { validateSpaceMembership } from "./spaces.mjs";

export const SPACE_ACTOR_CAPABILITY_READ_SCHEMA = "ordax.space-actor-capability-read/1";
export const SPACE_ACTOR_CAPABILITY_SCHEMA = "ordax.space-actor-capability/1";
const STATES = new Set(["active", "suspended"]);
const FORBIDDEN = ["changeMemberRole","suspendMember","reactivateMember","removeMember","inviteMember","addMember","transferOwnership"];
function boundedText(value,label,max=160){if(typeof value!=="string"||value.includes("\0"))throw new TypeError(label+" must be a string");const normalized=value.trim();if(!normalized||normalized.length>max)throw new TypeError(label+" is outside its allowed bounds");return normalized;}
export function validateSpaceActorCapability(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("Space actor capability must be an object");
  const allowed=new Set(["schema","spaceId","userId","role","state","canManageMembers"]);
  for(const key of Object.keys(value))if(!allowed.has(key))throw new TypeError("Space actor capability contains unsupported field "+key);
  if(value.schema!==SPACE_ACTOR_CAPABILITY_SCHEMA)throw new TypeError("Space actor capability schema is invalid");
  const membership=validateSpaceMembership(value);
  if(!STATES.has(value.state))throw new TypeError("Space actor capability state is invalid");
  if(typeof value.canManageMembers!=="boolean")throw new TypeError("Space actor capability manage-members flag is invalid");
  return Object.freeze({schema:SPACE_ACTOR_CAPABILITY_SCHEMA,spaceId:membership.spaceId,userId:membership.userId,role:membership.role,state:value.state,canManageMembers:value.canManageMembers});
}
export function validateSpaceActorCapabilityRequest(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("Space actor capability request must be an object");
  for(const key of Object.keys(value))if(key!=="spaceId")throw new TypeError("Space actor capability request contains unsupported field "+key);
  return Object.freeze({spaceId:boundedText(value.spaceId,"Space actor capability spaceId")});
}
export function assertSpaceActorCapabilityReadPort(port){
  if(!port||typeof port!=="object"||port.schema!==SPACE_ACTOR_CAPABILITY_READ_SCHEMA)throw new TypeError("A compatible Space actor capability read port is required");
  if(typeof port.readCapability!=="function")throw new TypeError("Space actor capability read port must implement readCapability()");
  for(const method of FORBIDDEN)if(method in port)throw new TypeError("Space actor capability read port must not implement "+method+"()");
  return port;
}
