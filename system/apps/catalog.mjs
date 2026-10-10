import { isAppAvailable } from "../contracts/first-party-app.mjs";
import { accountApp } from "./account/app.mjs";
import { activityApp } from "./activity/app.mjs";
import { assistantApp } from "./assistant/app.mjs";
import { internetApp } from "./internet/app.mjs";
import { filesApp } from "./files/app.mjs";
import { projectsApp } from "./projects/app.mjs";
import { networkApp } from "./network/app.mjs";
import { settingsApp } from "./settings/app.mjs";
import { studioApp } from "./studio/app.mjs";
import { storeApp } from "./store/app.mjs";
import { systemApp } from "./system/app.mjs";
const APPS = Object.freeze([
  filesApp,
  projectsApp,
  studioApp,
  networkApp,
  assistantApp,
  activityApp,
  internetApp,
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
