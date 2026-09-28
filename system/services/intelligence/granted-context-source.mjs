import { assertIntelligenceContextGrantBroker } from "../../contracts/intelligence-context-grant.mjs";
import { defineIntelligenceContextSource } from "../../contracts/intelligence-context.mjs";

export function createGrantedIntelligenceContextSource({
  id,
  title,
  grants: grantsValue,
} = {}) {
  const grants = assertIntelligenceContextGrantBroker(grantsValue);

  return defineIntelligenceContextSource({
    id,
    title,
    activation: "explicit",
    collect({ authorization = null } = {}) {
      if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) {
        throw new Error(`Intelligence context source ${id} requires an explicit grant`);
      }
      if (authorization.sourceId !== id) {
        throw new Error(`Intelligence context source ${id} grant source does not match`);
      }
      return grants.consume(authorization.grantId, {
        sourceId: id,
        target: authorization.target,
      });
    },
  });
}
