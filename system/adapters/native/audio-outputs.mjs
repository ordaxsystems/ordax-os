import { readNativeSession } from "./session-read.mjs";
import {
  AUDIO_OUTPUTS_SCHEMA,
  assertAudioOutputsPort,
  validateAudioOutputsSnapshot,
} from "../../contracts/audio-outputs.mjs";


const AUDIO_ENDPOINT = "/__ordax/native/audio-outputs";
const TOKEN_HEADER = "X-OrdaX-Audio-Token";

export async function createNativeAudioOutputs(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native audio outputs adapter requires window.fetch");
  }
  const session = await readNativeSession(windowRef);
  if (!session.ok) throw new Error(`Native audio session failed: ${session.status}`);
  const token = session.payload.audioOutputsToken;
  if (typeof token !== "string" || token.length < 16) {
    throw new Error("Native audio output token is unavailable");
  }

  const request = async (method, action = null, payload = {}) => {
    const options = {
      method,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: { [TOKEN_HEADER]: token },
    };
    if (method === "POST") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ action, ...payload });
    }
    const response = await windowRef.fetch(AUDIO_ENDPOINT, options);
    if (!response.ok) {
      const error = new Error(`Native audio outputs request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return validateAudioOutputsSnapshot(await response.json());
  };
  const port = {
    schema: AUDIO_OUTPUTS_SCHEMA,
    read() { return request("GET"); },
    setDefaultOutput(outputId) { return request("POST", "set-default-output", { outputId }); },
    setVolume(outputId, volumePercent) {
      return request("POST", "set-volume", { outputId, volumePercent });
    },
    setMuted(outputId, muted) { return request("POST", "set-muted", { outputId, muted }); },
  };
  assertAudioOutputsPort(port);
  await port.read();
  return Object.freeze(port);
}
