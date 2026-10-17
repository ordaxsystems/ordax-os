import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const contract = JSON.parse(await readFile(new URL("../docs/contracts/first-run.json", import.meta.url), "utf8"));
const firstRunSource = await readFile(new URL("../system/surface/ui/first-run.mjs", import.meta.url), "utf8");
const assistantCaptureSource = await readFile(new URL("../system/services/memory/assistant-auto-capture.mjs", import.meta.url), "utf8");
const captureSource = await readFile(new URL("../system/services/memory/capture.mjs", import.meta.url), "utf8");
const preUsbAuditSource = await readFile(new URL("../tools/creator/pre_usb_nova_ordax_audit.py", import.meta.url), "utf8");

test("First Run privacy uses the canonical preference runtime", () => {
  assert.equal(contract.privacy.owner, "preference-runtime");
  assert.equal(contract.privacy.preference_contract, "system/contracts/preference-runtime.mjs");
  assert.equal(contract.privacy.preference_definition, "system/services/preferences/memory.mjs");
  assert.equal(contract.privacy.memory_auto_capture_preference, "memory.auto-capture");
  assert.equal(contract.privacy.must_not_enter_first_run_state, true);
  assert.equal(contract.privacy.memory_service_consumes_runtime_preference, true);
  assert.equal(contract.privacy.cloud_sync_enabled_by_this_step, false);
  assert.match(firstRunSource, /MEMORY_AUTO_CAPTURE_PREFERENCE_ID/);
  assert.match(firstRunSource, /memoryAutoCaptureEnabled\(preferencePort\.getSnapshot\(\)\)/);
  assert.match(firstRunSource, /preferencePort\.set\([\s\S]*?MEMORY_AUTO_CAPTURE_PREFERENCE_ID/);
  assert.doesNotMatch(firstRunSource, /draft\.memoryAutoCapture\s*=/);
});

test("memory services and pre-USB audit consume the same runtime privacy authority", () => {
  assert.match(assistantCaptureSource, /memoryAutoCaptureEnabled\(preferences\.getSnapshot\(\)\)/);
  assert.match(captureSource, /memoryAutoCaptureEnabled/);
  assert.ok(preUsbAuditSource.includes('privacy.get("owner") == "preference-runtime"'));
  assert.ok(preUsbAuditSource.includes('privacy.get("memory_auto_capture_preference") == "memory.auto-capture"'));
  assert.ok(preUsbAuditSource.includes('memoryAutoCaptureEnabled(preferencePort.getSnapshot())'));
  assert.ok(preUsbAuditSource.includes('preferences.getSnapshot()'));
});
