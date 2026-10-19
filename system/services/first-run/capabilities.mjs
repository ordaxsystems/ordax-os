import { assertDeviceProfilePort } from "../../contracts/device-profile.mjs";
import { assertIdentityCredentialsPort } from "../../contracts/identity-credentials.mjs";
import { isIdentityActionSupported, validateIdentityActionsSnapshot } from "../../contracts/identity-actions.mjs";
import { assertLocalSessionPort } from "../../contracts/local-session.mjs";
import { assertNetworkManagementPort } from "../../contracts/network-management.mjs";

export const FIRST_RUN_CAPABILITIES_SCHEMA = "ordax.first-run-capabilities/1";

export function deriveFirstRunCapabilities({
  networkManagement = null,
  localSession = null,
  deviceProfile = null,
  identityCredentials = null,
  identityActionsSnapshot,
}) {
  const actions = validateIdentityActionsSnapshot(identityActionsSnapshot);
  const network = networkManagement === null ? null : assertNetworkManagementPort(networkManagement);
  const local = localSession === null ? null : assertLocalSessionPort(localSession);
  const device = deviceProfile === null ? null : assertDeviceProfilePort(deviceProfile);
  const credentials = identityCredentials === null ? null : assertIdentityCredentialsPort(identityCredentials);
  const signInAction = isIdentityActionSupported(actions, "sign-in");
  const registerAction = isIdentityActionSupported(actions, "register");

  return Object.freeze({
    schema: FIRST_RUN_CAPABILITIES_SCHEMA,
    networkManagement: network !== null,
    localSession: local !== null,
    deviceProfile: device !== null,
    identityCredentials: credentials !== null,
    identitySignIn: credentials !== null && signInAction,
    identityRegister: credentials !== null && registerAction,
    registrationPolicy: (
      credentials !== null
      && registerAction
      && typeof credentials.registrationPolicy === "function"
    ),
  });
}
