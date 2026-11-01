// The standalone Store preview has simulated inventory and lifecycle.
// Only local development may mount these fixtures; this is not a product auth gate.
export function isLocalStorePreviewOrigin(location) {
  if (!location || typeof location !== 'object') return false;
  return location.protocol === 'http:'
    && (location.hostname === 'localhost'
      || location.hostname === '127.0.0.1'
      || location.hostname === '[::1]');
}
