export const BROWSER_DOWNLOAD_PORT_SCHEMA = "ordax.browser-download-port/1";
const IDENTIFIER = /^download-[0-9a-f]{16}$/;
const STATES = new Set(["pending", "downloading", "saved", "failed", "cancelled"]);
const FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,119}$/;

export function validateBrowserDownloadEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "fileName,id,status,type"
      || value.type !== "browser-download" || !STATES.has(value.status)
      || typeof value.id !== "string" || !IDENTIFIER.test(value.id)
      || typeof value.fileName !== "string" || !FILE_NAME.test(value.fileName)
      || value.fileName === "." || value.fileName === "..") {
    throw new TypeError("Browser download event is invalid");
  }
  return Object.freeze({
    type: "browser-download",
    id: value.id,
    status: value.status,
    fileName: value.fileName,
  });
}

export function validateBrowserDownloadId(value) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new TypeError("Browser download id is invalid");
  }
  return value;
}

export function assertBrowserDownloadPort(value) {
  if (!value || value.schema !== BROWSER_DOWNLOAD_PORT_SCHEMA
      || ["approve", "cancel", "subscribe", "dispose"].some((name) => typeof value[name] !== "function")) {
    throw new TypeError("Compatible browser download port required");
  }
  return value;
}
