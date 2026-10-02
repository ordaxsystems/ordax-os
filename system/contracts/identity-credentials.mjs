export const IDENTITY_CREDENTIALS_SCHEMA = "ordax.identity-credentials/1";
export const REGISTRATION_POLICY_SCHEMA = "prototype-ordax.registration-legal-policy/1";

function validEmail(value) {
  return (
    typeof value === "string"
    && value.length >= 3
    && value.length <= 320
    && value.includes("@")
    && !value.includes("\n")
    && !value.includes("\r")
  );
}

function validHttpsDocumentUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
    );
  } catch {
    return false;
  }
}

function validLegalDocument(value) {
  return (
    value
    && typeof value === "object"
    && typeof value.version === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.version)
    && typeof value.effectiveDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate)
    && typeof value.sha256 === "string"
    && /^[0-9a-f]{64}$/.test(value.sha256)
    && validHttpsDocumentUrl(value.url)
  );
}

export function validateRegistrationPolicy(value) {
  if (
    !value
    || typeof value !== "object"
    || value.$schema !== REGISTRATION_POLICY_SCHEMA
    || value.active !== true
    || typeof value.policyId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.policyId)
    || !validLegalDocument(value.privacy)
    || !validLegalDocument(value.terms)
  ) {
    throw new TypeError("Registration legal policy is invalid");
  }
  return Object.freeze({
    schema: REGISTRATION_POLICY_SCHEMA,
    policyId: value.policyId.toLowerCase(),
    privacy: Object.freeze({ ...value.privacy }),
    terms: Object.freeze({ ...value.terms }),
  });
}

export function validateIdentityCredentialInput(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Identity credentials are required");
  }
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const password = value.password;
  if (!validEmail(email)) {
    throw new TypeError("Identity email is invalid");
  }
  if (typeof password !== "string" || password.length < 1 || password.length > 1024 || password.includes("\0")) {
    throw new TypeError("Identity password is invalid");
  }
  return Object.freeze({ email, password });
}

export function validateIdentityRegistrationInput(value) {
  const credentials = validateIdentityCredentialInput(value);
  if (value.legalAccepted !== true) {
    throw new TypeError("Registration legal acceptance is required");
  }
  return Object.freeze({ ...credentials, legalAccepted: true });
}

export function assertIdentityCredentialsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== IDENTITY_CREDENTIALS_SCHEMA) {
    throw new TypeError("A compatible identity credentials port is required");
  }
  if (typeof port.signIn !== "function" || typeof port.register !== "function") {
    throw new TypeError("Identity credentials port must implement signIn() and register()");
  }
  if (port.registrationPolicy !== undefined && typeof port.registrationPolicy !== "function") {
    throw new TypeError("Identity credentials registrationPolicy must be a function when present");
  }
  return port;
}
