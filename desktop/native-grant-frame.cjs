'use strict';

// A WebContents is a container, not a security principal for every iframe.
// Native grants belong only to the currently loaded canonical main frame.
// Electron 40 supplies details.frame but not the later initiatorOrigin API.
function isTrustedNativeRequest({
  details,contentsId,mainFrame,activeUrl,allowedOrigin,
}={}) {
  if(!details || !Number.isInteger(contentsId) ||
     details.webContentsId!==contentsId ||
     !mainFrame || details.frame!==mainFrame ||
     typeof allowedOrigin!=='string' || !allowedOrigin)
    return false;
  try {
    const destination=new URL(details.url);
    const current=new URL(activeUrl);
    const requestingFrame=new URL(mainFrame.url);
    return destination.origin===allowedOrigin &&
      current.origin===allowedOrigin &&
      requestingFrame.origin===allowedOrigin;
  }catch{
    // During navigation or frame destruction, denying grants is safe.
    return false;
  }
}
// One Electron-owned state grant also covers the two canonical Native
// account continuity stores. They are not new authorities or credentials.
const NATIVE_STATE_ROUTES=Object.freeze([
  '/__ordax/native/first-run',
  '/__ordax/native/preferences',
  '/__ordax/native/first-run-cursor',
  '/__ordax/native/sync-state',
  '/__ordax/native/sync-checkpoint',
]);
function isNativeStateRoute(path){
  return typeof path==='string' && NATIVE_STATE_ROUTES.includes(path);
}
module.exports={isTrustedNativeRequest,isNativeStateRoute};