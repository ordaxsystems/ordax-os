import { proxyPublicAccountRequest } from "../lib/account-proxy-core.mjs";

export const ORDAX_WEB_PUBLIC_ORIGIN = "https://web.ordax.com.br";

export function proxyWebAccountRequest(request) {
  return proxyPublicAccountRequest(request, {
    publicOrigin: ORDAX_WEB_PUBLIC_ORIGIN,
  });
}

export default {
  fetch(request) {
    return proxyWebAccountRequest(request);
  },
};
