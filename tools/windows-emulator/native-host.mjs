// Development host for Native contracts. Account authority stays in the HTTPS gateway.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { readDesktopNetworkStatus } from "../../system/adapters/desktop/network-status.mjs";
import { readDesktopSystemMetrics } from "../../system/adapters/desktop/system-metrics.mjs";
import { readDesktopPowerStatus } from "../../system/adapters/desktop/power-status.mjs";
import { readDesktopUpdateStatus, readDesktopUpdateHistory } from "../../system/adapters/desktop/update-observation.mjs";
import { readDesktopRecovery } from "../../system/adapters/desktop/recovery-observation.mjs";
import { createDesktopBuiltAssetsMiddleware } from "./desktop-built-assets.mjs";
import { createDesktopFileSpaceMiddleware } from "../../system/adapters/desktop/file-space-host.mjs";
import { createDesktopAccountCookieVault } from "../../system/adapters/desktop/account-cookie-vault.mjs";
import { createDesktopLocalSessionMiddleware } from "../../system/adapters/desktop/local-session-host.mjs";
import { createInitialFirstRunState, validateFirstRunState } from "../../system/contracts/first-run-state-store.mjs";
import { validatePreferenceRecord } from "../../system/contracts/preference-store.mjs";
import { FIRST_RUN_CURSOR_SCHEMA, validateFirstRunCursor } from "../../system/contracts/first-run-cursor.mjs";
import { createEmulatorAccountGateway } from "./account-gateway.mjs";

export function createEmulatorNativeHost({
  stateDirectory, accountGatewayOrigin = "", fetchImpl = globalThis.fetch,
  cookieVault = null, sessionLocked = null,
}) {
  const accountMiddleware = createEmulatorAccountGateway({
    origin: accountGatewayOrigin, fetchImpl, cookieVault,
  });
  const file = join(stateDirectory, "native-state.json");
  const initialCursor = () => ({ schema: FIRST_RUN_CURSOR_SCHEMA, step: "welcome" });
  const defaults = () => ({ firstRun: createInitialFirstRunState(), preferences: validatePreferenceRecord({}), cursor: initialCursor() });
  const load = async () => {
    try {
      const saved = JSON.parse(await readFile(file, "utf8"));
      return { firstRun: validateFirstRunState(saved.firstRun), preferences: validatePreferenceRecord(saved.preferences), cursor: validateFirstRunCursor(saved.cursor) };
    } catch (error) {
      if (error.code === "ENOENT") return defaults();
      throw new Error("Saved development state is unreadable", { cause: error });
    }
  };
  let queue = Promise.resolve();
  const change = operation => {
    const result = queue.then(async () => {
      const state = await load();
      operation(state);
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(file + ".tmp", JSON.stringify(state), "utf8");
      await rename(file + ".tmp", file);
      return state;
    });
    queue = result.catch(() => {});
    return result;
  };
  const routes = new Map([
    ["/__ordax/native/first-run", ["firstRun", validateFirstRunState]],
    ["/__ordax/native/preferences", ["preferences", validatePreferenceRecord]],
    ["/__ordax/native/first-run-cursor", ["cursor", validateFirstRunCursor]],
  ]);
  return async function middleware(request, response, next) {
    const path = request.url.split("?")[0];
    if (sessionLocked && /^(\/auth\/|\/account\/|\/sync\/|\/network\/)/.test(path)) {
      try {
        if (await sessionLocked()) {
          response.writeHead(423, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ error: "OrdaX Desktop session locked" }));
          return;
        }
      } catch {
        response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Desktop local session unavailable" }));
        return;
      }
    }
    if (await accountMiddleware(request, response)) return;
    if (!path.startsWith("/__ordax/")) return next();
    const reply = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    const route = routes.get(path);
    const reset = path === "/__ordax/emulator/reset-first-run";
    if (!route && !reset) return reply(503, { error: "Capability unavailable in Windows development host" });
    try {
      if (request.method === "GET" && route) {
        await queue;
        return reply(200, (await load())[route[0]]);
      }
      if (request.method !== "POST") return reply(405, { error: "Method unavailable" });
      if (request.headers.origin !== "http://" + request.headers.host) return reply(403, { error: "Same-origin writes required" });
      if (reset) {
        await change(state => { state.firstRun = createInitialFirstRunState(); state.cursor = initialCursor(); });
        return reply(200, { reset: true });
      }
      if (!request.headers["content-type"]?.startsWith("application/json")) return reply(415, { error: "JSON required" });
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65536) return reply(413, { error: "State too large" });
        chunks.push(chunk);
      }
      const validated = route[1](JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const state = await change(state => {
        if (route[0] === "firstRun" && state.firstRun.completed
            && JSON.stringify(state.firstRun) !== JSON.stringify(validated)) {
          const conflict = new Error("Completed development receipt cannot be replaced");
          conflict.status = 409;
          throw conflict;
        }
        state[route[0]] = validated;
      });
      return reply(200, state[route[0]]);
    } catch (error) {
      return reply(error.status === 409 ? 409 : error instanceof TypeError || error instanceof SyntaxError ? 400 : 503, { error: "Development state could not be read or saved" });
    }
  };
}

export function nativeEmulatorPlugin(stateDirectory, { desktopHost = false, accountGatewayOrigin = "" } = {}) {
  return {
    name: "ordax-native-emulator-host",
    configureServer(server) {
      const userData=process.env.ORDAX_DESKTOP_UPDATE_USER_DATA;
      const localSession=desktopHost && process.platform==="win32" && userData
        ? createDesktopLocalSessionMiddleware(userData, {
            token:process.env.ORDAX_DESKTOP_LOCAL_SESSION_TOKEN,
          }) : null;
      if (desktopHost && process.env.ORDAX_DESKTOP_ASSETS_ROOT) {
        // Same compiled Native composition, served before Vite source transforms.
        server.middlewares.use(createDesktopBuiltAssetsMiddleware(process.env.ORDAX_DESKTOP_ASSETS_ROOT));
      }
      if (localSession)server.middlewares.use(localSession.middleware);
      if (desktopHost && process.env.ORDAX_DESKTOP_UPDATE_USER_DATA) {
        // Logical "/" is a private, persistent Windows user-data file-space,
        // not the host drive root. This precedes the emulator 503 fallback.
        server.middlewares.use(createDesktopFileSpaceMiddleware(
          join(process.env.ORDAX_DESKTOP_UPDATE_USER_DATA,"Files"),
          {token:process.env.ORDAX_DESKTOP_FILE_TOKEN,
           sessionLocked:localSession?.readLocked??null}
        ));
      }
      if (desktopHost) {
        // Genuine Windows host observation under the canonical Native port.
        server.middlewares.use((request, response, next) => {
          const path = request.url.split("?")[0];
          if (!["/__ordax/native/network-status", "/__ordax/native/metrics", "/__ordax/native/update", "/__ordax/native/update-history", "/__ordax/desktop/recovery", "/__ordax/native/power-status"].includes(path)) return next();
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          if (request.method !== "GET") {
            response.statusCode = 405;
            return response.end(JSON.stringify({ error: "Read-only Desktop capability" }));
          }
          const respond = (payload) => {
            response.statusCode = 200;
            response.end(JSON.stringify(payload));
          };
          try {
            if (path === "/__ordax/native/network-status") return respond(readDesktopNetworkStatus());
            if (path === "/__ordax/native/power-status") {
              void readDesktopPowerStatus().then(respond).catch(() => {
                response.statusCode = 503;
                response.end(JSON.stringify({error:"Windows power status unavailable"}));
              });
              return;
            }
            if (path === "/__ordax/native/metrics") {
              const root = process.env.ORDAX_DESKTOP_UPDATE_USER_DATA;
              if (!root) { response.statusCode=503; return response.end(JSON.stringify({error:"User profile path unavailable"})); }
              void readDesktopSystemMetrics(root).then(respond).catch(() => {
                response.statusCode=503;
                response.end(JSON.stringify({error:"Windows host metrics unavailable"}));
              });
              return;
            }
            if (path === "/__ordax/native/update-history") return respond(readDesktopUpdateHistory());
            if (path === "/__ordax/desktop/recovery") {
              const directory = process.env.ORDAX_DESKTOP_UPDATE_USER_DATA;
              if (!directory) {
                response.statusCode = 503;
                return response.end(JSON.stringify({ error: "Desktop recovery profile unavailable" }));
              }
              void readDesktopRecovery(directory).then(respond).catch(() => {
                response.statusCode = 503;
                response.end(JSON.stringify({ error: "Desktop recovery observation unavailable" }));
              });
              return;
            }
            const directory = process.env.ORDAX_DESKTOP_UPDATE_USER_DATA;
            if (!directory) {
              response.statusCode = 503;
              return response.end(JSON.stringify({ error: "Desktop update journal path was not configured" }));
            }
            void readDesktopUpdateStatus(directory).then(respond).catch(() => {
              response.statusCode = 503;
              response.end(JSON.stringify({ error: "Desktop update observation failed" }));
            });
          } catch {
            response.statusCode = 503;
            return response.end(JSON.stringify({ error: "Desktop capability unavailable" }));
          }
        });
      }
      const cookieVault = desktopHost && process.platform === "win32" && userData
        ? createDesktopAccountCookieVault(userData, accountGatewayOrigin) : null;
      server.middlewares.use(createEmulatorNativeHost({
        stateDirectory, accountGatewayOrigin, cookieVault,
        sessionLocked:localSession?.readLocked??null,
      }));
      // Native's real host serves system/ as its static root.
      server.middlewares.use((request, _response, next) => {
        if (/^\/(?:surface|apps|contracts|services|profile-packs|adapters|composition)\//.test(request.url)) request.url = "/system" + request.url;
        next();
      });
    },
  };
}
