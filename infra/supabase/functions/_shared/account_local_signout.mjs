// One Supabase Auth owner for local refresh-session revocation. A server
// gateway has no browser-stored SDK session: auth.signOut() on a stateless
// createClient() can succeed locally without making a remote logout call.
// Use the canonical Supabase Auth endpoint with the verified user's JWT.
export async function revokeSupabaseLocalSession({
  url, key, accessToken, send = fetch,
} = {}) {
  if (typeof url !== "string" || typeof key !== "string"
      || typeof accessToken !== "string" || !url || !key || !accessToken
      || /[\r\n]/.test(key) || /[\r\n]/.test(accessToken)
      || typeof send !== "function") return false;
  let endpoint;
  try {
    const base = new URL(url);
    const local = base.hostname === "localhost" || base.hostname === "127.0.0.1"
      || base.hostname === "[::1]";
    if ((base.protocol !== "https:" && !(local && base.protocol === "http:"))
        || base.username || base.password || base.search || base.hash
        || !["", "/"].includes(base.pathname)) return false;
    endpoint = new URL("/auth/v1/logout?scope=local", base.origin);
  } catch {
    return false;
  }
  try {
    const response = await send(endpoint.href, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: "Bearer " + accessToken,
        accept: "application/json",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    // Never infer remote revocation from an SDK's local storage cleanup,
    // a redirect, or an Auth response containing an error status.
    return Boolean(response && response.ok === true
      && response.status >= 200 && response.status < 300
      && response.redirected !== true);
  } catch {
    return false;
  }
}
