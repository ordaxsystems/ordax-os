import {
  IDENTITY_CREDENTIALS_SCHEMA,
  validateIdentityCredentialInput,
  validateIdentityRegistrationInput,
  validateRegistrationPolicy,
} from "../../contracts/identity-credentials.mjs";
import { createWebJsonReader, runWebRequestWithinDeadline } from "./json-read.mjs";
import { configuredWebSessionProvider } from "./identity.mjs";
import { rememberVerifiedLoginEmail } from "../../services/account/remembered-login-email.mjs";

// Read-only lifecycle extension. The gateway owns activation and legal metadata.
// Transport status is bounded; never expose provider response bodies or credentials.
export class IdentityCredentialRequestError extends Error {
  constructor(status) {
    const parsed = Number(status);
    const safeStatus = Number.isInteger(parsed) && parsed >= 400 && parsed <= 599 ? parsed : null;
    // Existing contract consumers can read the bounded HTTP code in the
    // error message; never include provider response bodies or credentials.
    super(`Identity credential request failed: ${safeStatus ?? "unknown"}`);
    this.name = "IdentityCredentialRequestError";
    this.status = safeStatus;
  }
}
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
  // The credential POST has the same bounded fetch lifecycle as the
  // canonical session GET. A timeout means the server outcome is unknown:
  // never replay the POST or claim authentication without session proof.
  const response = await runWebRequestWithinDeadline(
    windowRef,
    new AbortController(),
    (signal) => windowRef.fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
      signal,
    }),
    "Web credential request",
  );
  if (registration && response.status === 202) {
    return Object.freeze({ authenticated: false, confirmationRequired: true });
  }
  if (response.status !== 200 && response.status !== 303) {
    // An opaque redirect (status 0), empty success, or transport error is
    // never account activation. Do not report a signed-in identity without
    // an independently verified same-origin session.
    throw new IdentityCredentialRequestError(response.status);
  }
  // Reuse the one Web GET boundary for the post-credential session proof:
  // same-origin, no-store, redirect rejection and a deadline for fetch+JSON.
  // No credential POST is retried; a failed proof never activates an account.
  const reader = createWebJsonReader(windowRef);
  let session;
  try {
    const verification = await reader.read("/auth/session");
    if (!verification.ok || verification.status !== 200) {
      throw new Error("Identity session verification unavailable");
    }
    session = verification.value;
  } finally {
    reader.dispose();
  }
  if (!session || session.$schema !== "prototype-ordax.public-identity-session/1") {
    throw new Error("Identity session verification invalid");
  }
  if (
    session.authenticated === true
    && session.status === "authenticated"
    && configuredWebSessionProvider(session.provider)
    && typeof session.subject === "string"
    && session.subject.length > 0
    && typeof session.email === "string"
    && session.email.length > 0
  ) {
    if (!registration) rememberVerifiedLoginEmail(windowRef, session.email);
    return Object.freeze({ authenticated: true, confirmationRequired: false });
  }
  if (
    registration
    && configuredWebSessionProvider(session.provider)
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
  // A single browser adapter must not send overlapping credential commands.
  // No password, request body or result is retained; the flag covers both
  // the POST and its independently verified session read.
  let submissionPending = false;
  const execute = (path, credentials, options) => {
    if (submissionPending) {
      return Promise.reject(new Error("Identity credential submission is already in progress"));
    }
    submissionPending = true;
    return submit(windowRef, path, credentials, options).finally(() => {
      submissionPending = false;
    });
  };
  return Object.freeze({
    schema: IDENTITY_CREDENTIALS_SCHEMA,
    registrationPolicy: policy.read,
    signIn(credentials) {
      return execute("/auth/login", credentials);
    },
    register(credentials) {
      return execute("/auth/register", credentials, { registration: true });
    },
  });
}
