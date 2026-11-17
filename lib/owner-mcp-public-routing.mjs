// Vercel Routing Middleware transport adapter for the existing Account proxy.
// Preserve the FULL public URL query, including duplicate or forbidden keys.
// The canonical lib/account-proxy-core.mjs is the only Owner query validator;
// this layer must not choose a device, discard ambiguity or grant authority.
export function ownerMcpRewriteDestination(requestUrl) {
  if (typeof requestUrl !== "string" || requestUrl.length > 8192) return null;
  let original;
  try { original = new URL(requestUrl); } catch { return null; }
  if (!original.pathname.startsWith("/account/mcp/")) return null;
  // This parameter belongs exclusively to the Vercel -> Account adapter.
  // Never allow a public caller to preselect or override an internal target.
  if (original.searchParams.has("ordax_path")) return null;
  const target = new URL("/api/account-proxy", original.origin);
  target.search = original.search;
  target.searchParams.append("ordax_path", original.pathname);
  return target;
}
