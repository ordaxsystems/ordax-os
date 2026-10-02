import {
  IDENTITY_CREDENTIALS_SCHEMA,
  validateIdentityCredentialInput,
  validateIdentityRegistrationInput,
  validateRegistrationPolicy,
} from "../../contracts/identity-credentials.mjs";

async function submit(windowRef, path, credentials, { registration = false } = {}) {
  const value = registration
    ? validateIdentityRegistrationInput(credentials)
    : validateIdentityCredentialInput(credentials);
  const body = new URLSearchParams();
  body.set("email", value.email);
  body.set("password", value.password);
  if (registration) body.set("legal_acceptance", "accepted");
  const response = await windowRef.fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
  });
  if (response.status === 202) {
    return Object.freeze({ authenticated: false, confirmationRequired: true });
  }
  if (!(response.ok || response.status === 303 || response.status === 0)) {
    throw new Error(`Identity credential request failed: ${response.status}`);
  }
  return Object.freeze({ authenticated: true, confirmationRequired: false });
}

export function createSameOriginIdentityCredentials(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Identity credentials adapter requires window.fetch");
  }
  return Object.freeze({
    schema: IDENTITY_CREDENTIALS_SCHEMA,
    async registrationPolicy() {
      const response = await windowRef.fetch("/auth/registration-policy", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Registration policy request failed: ${response.status}`);
      }
      return validateRegistrationPolicy(await response.json());
    },
    signIn(credentials) {
      return submit(windowRef, "/auth/login", credentials);
    },
    register(credentials) {
      return submit(windowRef, "/auth/register", credentials, { registration: true });
    },
  });
}
