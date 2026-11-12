import { assertSpacesPort } from "../../contracts/spaces.mjs";
import { assertSpaceActorCapabilityReadPort, validateSpaceActorCapability, validateSpaceActorCapabilityRequest } from "../../contracts/space-actor-capability.mjs";
export function createSpaceActorCapabilityReader({spaces,actorCapability}){
  const spacesPort=assertSpacesPort(spaces);const port=assertSpaceActorCapabilityReadPort(actorCapability);
  return Object.freeze({async read(value){const request=validateSpaceActorCapabilityRequest(value);const snapshot=spacesPort.getSnapshot();if(snapshot.state!=="ready")throw new Error("Space actor capability is unavailable while the Spaces catalog is not ready");if(!snapshot.spaces.some(space=>space.id===request.spaceId))throw new Error("Space actor capability target is not present in the current authorized Spaces catalog");const result=validateSpaceActorCapability(await port.readCapability(request));if(result.spaceId!==request.spaceId)throw new Error("Space actor capability provider returned another Space");return result;}});
}
