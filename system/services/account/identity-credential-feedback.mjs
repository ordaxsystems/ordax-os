// The single UI feedback policy for account credential HTTP failures.
// No response body, provider diagnostics, session secrets or raw credentials.
export function identityCredentialFailureMessageId(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  switch (status) {
    case 401: return "account.credentials.invalid";
    case 429: return "account.credentials.rateLimited";
    case 503: return "account.credentials.unavailable";
    default: return "account.action.failed";
  }
}
