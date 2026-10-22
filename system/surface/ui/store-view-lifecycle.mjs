import { SURFACE_RENDER_LIFECYCLE_SCHEMA } from '../../contracts/surface-render-lifecycle.mjs';
import { assertLocalizationPort } from '../../contracts/localization.mjs';

// An embedded Web view owns only ephemeral navigation. This grants no host action.
export function createStoreViewLifecycle(localization) {
  assertLocalizationPort(localization);
  const listeners = new Set();
  let target = 'discover';
  return Object.freeze({
    schema: SURFACE_RENDER_LIFECYCLE_SCHEMA, localization,
    getAppTarget(appId) {return appId === 'store' ? target : null;},
    setAppTarget(appId, next) {if (appId === 'store') {target = next;for (const listener of [...listeners]) listener();}},
    subscribeRender(listener) {listeners.add(listener);return () => listeners.delete(listener);},
  });
}
