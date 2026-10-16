import { proxyPublicAccountRequest } from "../lib/account-proxy-core.mjs";

export const ORDAX_WEB_PUBLIC_ORIGIN = "https://web.ordax.com.br";

function repeatedRewritePath(request) {
  try {
    const values = new URL(request.url).searchParams.getAll("ordax_path");
    if (values.length < 1 || values.some(value => value !== values[0])) return null;
    return values[0];
  } catch {
    return null;
  }
}

export function mapWebAccountResponse(request, response) {
  if (!(response instanceof Response)) throw new TypeError("Web account proxy requires a Response");
  const productPath = repeatedRewritePath(request);
  if (
    request?.method === "POST"
    && productPath === "/auth/login"
    && response.status === 303
    && response.headers.get("location") === "/conta/"
  ) {
    const headers = new Headers(response.headers);
    headers.set("location", "/");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

export async function proxyWebAccountRequest(request) {
  const response = await proxyPublicAccountRequest(request, {
    publicOrigin: ORDAX_WEB_PUBLIC_ORIGIN,
  });
  return mapWebAccountResponse(request, response);
}

export default {
  fetch(request) {
    return proxyWebAccountRequest(request);
  },
};
