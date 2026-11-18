import { readFileSync } from "node:fs";

// Normalize only checkout line endings; source-contract assertions stay exact.
export function readSourceText(url) {
  return readFileSync(url, "utf8").replace(/\r\n/g, "\n");
}
