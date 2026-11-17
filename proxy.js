// Native Vercel Routing Middleware: one ingress codec, no parallel auth.
// It runs before the declarative rewrites for /account/mcp/* and passes every
// original query occurrence to the canonical Account proxy unchanged.
import { rewrite } from "@vercel/functions";
import { ownerMcpRewriteDestination } from "./lib/owner-mcp-public-routing.mjs";

export default function proxy(request) {
  const target = ownerMcpRewriteDestination(request.url);
  if (!target) {
    return Response.json({
      $schema: "prototype-ordax.public-site-proxy-error/1",
      error: "unsupported-account-route",
    }, {status:404,headers:{"cache-control":"no-store"}});
  }
  return rewrite(target);
}
