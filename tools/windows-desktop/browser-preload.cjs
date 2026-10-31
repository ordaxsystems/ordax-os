'use strict';
// Electron sandbox preload. Only exposes a typed message bridge to the
// canonical OrdaX browser-session contract. Remote pages never load it.
const { contextBridge, ipcRenderer } = require('electron');
const COMMAND_CHANNEL = 'ordax:desktop-browser:command';
const EVENT_CHANNEL = 'ordax:desktop-browser:event';
const LIMIT = 12000;

contextBridge.exposeInMainWorld('ordaxDesktopBrowser', Object.freeze({
  postMessage(value) {
    if (typeof value !== 'string' || value.length > LIMIT) return false;
    ipcRenderer.send(COMMAND_CHANNEL, value);
    return true;
  },
}));

ipcRenderer.on(EVENT_CHANNEL, (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  // Cross the isolated-world boundary via a DOM event; browser data is
  // untrusted and all consumers validate the canonical snapshot shape.
  window.dispatchEvent(new CustomEvent('ordax-browser-host', { detail: payload }));
});
