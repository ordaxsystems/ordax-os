// Development host for Native contracts. Account authority stays in the HTTPS gateway.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createInitialFirstRunState, validateFirstRunState } from "../../system/contracts/first-run-state-store.mjs";
import { validatePreferenceRecord } from "../../system/contracts/preference-store.mjs";
import { FIRST_RUN_CURSOR_SCHEMA, validateFirstRunCursor } from "../../system/contracts/first-run-cursor.mjs";
import { createEmulatorAccountGateway } from "./account-gateway.mjs";

export function createEmulatorNativeHost({ stateDirectory, accountGatewayOrigin = "", fetchImpl = globalThis.fetch }) {
  const accountMiddleware = createEmulatorAccountGateway({ origin: accountGatewayOrigin, fetchImpl });
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

export function nativeEmulatorPlugin(stateDirectory, { accountGatewayOrigin = "" } = {}) {
  return {
    name: "ordax-native-emulator-host",
    configureServer(server) {
      server.middlewares.use(createEmulatorNativeHost({ stateDirectory, accountGatewayOrigin }));
      // Native's real host serves system/ as its static root.
      server.middlewares.use((request, _response, next) => {
        if (/^\/(?:surface|apps|contracts|services|profile-packs|adapters|composition)\//.test(request.url)) request.url = "/system" + request.url;
        next();
      });
    },
  };
}
