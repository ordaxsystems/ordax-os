import { readDesktopDevUpdateState } from "./update-observation.mjs";
import { projectDesktopRecovery } from "../../contracts/desktop-recovery.mjs";
export async function readDesktopRecovery(userData, options = {}) {
  try {
    const journal = await readDesktopDevUpdateState(userData, options);
    return projectDesktopRecovery(journal);
  } catch {
    return Object.freeze({
      ...projectDesktopRecovery(null),
      runningKind: "unavailable",
      reason: "Desktop recovery journal unavailable or untrusted",
    });
  }
}
