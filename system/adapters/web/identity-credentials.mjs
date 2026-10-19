import {
  IDENTITY_CREDENTIALS_SCHEMA,
  validateIdentityCredentialInput,
  validateIdentityRegistrationInput,
  validateRegistrationPolicy,
} from "../../contracts/identity-credentials.mjs";
import { createWebJsonReader } from "./json-read.mjs";

// Read-only lifecycle extension. The gateway owns activation and legal metadata.
export function createWebRegistrationPolicyReader(windowRef = globalThis.window) {
  const reader = createWebJsonReader(windowRef);
  return Object.freeze({
    async read() {
      const response = await reader.read("/auth/registration-policy");
      if (!response.ok) throw new Error(`Registration policy request failed: ${response.status}`);
      return validateRegistrationPolicy(response.value);
    },
    cancel: reader.cancel,
    dispose: reader.dispose,
  });
}

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
  if (registration && response.status === 202) {
    return Object.freeze({ authenticated: false, confirmationRequired: true });
  }
  if (response.status !== 200 && response.status !== 303) {
    // An opaque redirect (status 0), empty success, or transport error is
    // never account activation. Do not report a signed-in identity without
    // an independently verified same-origin session.
    throw new Error(`Identity credential request failed: ${response.status}`);
  }
  const sessionResponse = await windowRef.fetch("/auth/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!sessionResponse.ok || sessionResponse.status !== 200) {
    throw new Error("Identity session verification unavailable");
  }
  const session = await sessionResponse.json();
  if (!session || session.$schema !== "prototype-ordax.public-identity-session/1") {
    throw new Error("Identity session verification invalid");
  }
  if (
    session.authenticated === true
    && session.status === "authenticated"
    && session.provider !== "unconfigured"
    && session.provider !== "gated"
    && typeof session.subject === "string"
    && session.subject.length > 0
    && typeof session.email === "string"
    && session.email.length > 0
  ) {
    return Object.freeze({ authenticated: true, confirmationRequired: false });
  }
  if (
    registration
    && session.authenticated === false
    && session.status === "anonymous"
  ) {
    return Object.freeze({ authenticated: false, confirmationRequired: true });
  }
  throw new Error("Identity session was not activated");

}

export function createSameOriginIdentityCredentials(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Identity credentials adapter requires window.fetch");
  }
  const policy = createWebRegistrationPolicyReader(windowRef);
  return Object.freeze({
    schema: IDENTITY_CREDENTIALS_SCHEMA,
    registrationPolicy: policy.read,
    signIn(credentials) {
      return submit(windowRef, "/auth/login", credentials);
    },
    register(credentials) {
      return submit(windowRef, "/auth/register", credentials, { registration: true });
    },
  });
}
