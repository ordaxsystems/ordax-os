import { isAppAvailable } from "../contracts/first-party-app.mjs";
import { accountApp } from "../services/system-ui/account/app.mjs";
import { filesApp } from "./files/app.mjs";
import { settingsApp } from "../services/system-ui/settings/app.mjs";
import { studioApp } from "./studio/app.mjs";
import { storeApp } from "../services/system-ui/store/app.mjs";
import { systemApp } from "../services/system-ui/system/app.mjs";
const APPS = Object.freeze([
  filesApp,
  studioApp,
  settingsApp,
  accountApp,
  storeApp,
  systemApp,
]);
const APP_BY_ID = new Map(APPS.map((app) => [app.id, app]));
if (APP_BY_ID.size !== APPS.length) {
  throw new TypeError("First-party app ids must be unique");
}
export { isAppAvailable };
export function listFirstPartyApps() {
  return APPS;
}
export function getFirstPartyApp(appId) {
  return APP_BY_ID.get(appId) ?? null;
}
