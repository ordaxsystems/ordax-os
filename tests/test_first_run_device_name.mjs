import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createNativeDeviceProfile } from "../system/adapters/native/device-profile.mjs";

const contract = JSON.parse(await readFile(new URL("../docs/contracts/first-run.json", import.meta.url), "utf8"));
const firstRunSource = await readFile(new URL("../system/surface/ui/first-run.mjs", import.meta.url), "utf8");
const nativeMainSource = await readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8");

test("First Run device name remains owned by device-profile", () => {
  assert.equal(contract.device_name.owner, "device-profile");
  assert.equal(contract.device_name.rename_must_be_confirmed_before_advancing, true);
  assert.equal(contract.device_name.must_not_enter_first_run_state, true);
  assert.equal(contract.device_name.owner_unavailable_must_not_block_boot, true);
  assert.equal(contract.device_name.windows_read_deadline_ms, 5000);
  assert.equal(contract.owners.device_profile_contract, "system/contracts/device-profile.mjs");
  assert.equal(contract.owners.device_profile_adapter, "system/adapters/native/device-profile.mjs");
});

test("Native composition supplies the real device-profile port to First Run", () => {
  assert.match(nativeMainSource, /createNativeDeviceProfile/);
  assert.match(nativeMainSource, /OrdaX native device profile unavailable/);
  assert.match(nativeMainSource, /mountFirstRunExperience\(root, \{[\s\S]*?deviceProfile,/);
});

test("First Run confirms rename through the owner instead of mutating its receipt", () => {
  assert.match(firstRunSource, /await deviceProfilePort\.rename\(nextName\)/);
  assert.match(firstRunSource, /deviceProfileSnapshot = await deviceProfilePort\.rename/);
  assert.match(firstRunSource, /!STEPS\.includes\("name"\)/);
  assert.match(firstRunSource, /deviceNameDraft\.trim\(\)/);
  assert.doesNotMatch(firstRunSource, /draft\.displayName\s*=/);
  assert.doesNotMatch(firstRunSource, /draft\.deviceName\s*=/);
  const capabilityDerivations = firstRunSource.match(/deriveFirstRunCapabilities\(\{[\s\S]*?\}\);/g) ?? [];
  assert.ok(capabilityDerivations.length >= 2);
  for (const derivation of capabilityDerivations) {
    assert.match(derivation, /deviceProfile: deviceProfilePort/);
  }
});

test("optional Windows device-profile bootstrap GET can be cancelled without changing rename authority", async () => {
  const controller = new AbortController();
  let initialRead = null;
  const pending = createNativeDeviceProfile({
    fetch(path, options) {
      initialRead = { path, options };
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    },
  }, { signal: controller.signal });
  assert.equal(initialRead?.path, "/__ordax/native/device-profile");
  assert.equal(initialRead.options.method, "GET");
  assert.equal(initialRead.options.signal, controller.signal);
  controller.abort(new Error("Optional Native profile read deadline"));
  await assert.rejects(pending, /Optional Native profile read deadline/);
});

test("native device-profile adapter updates its confirmed snapshot after rename", async () => {
  const calls = [];
  const windowRef = {
    async fetch(url, init) {
      calls.push({ url, init });
      const displayName = init?.method === "POST"
        ? JSON.parse(init.body).displayName
        : "OrdaX inicial";
      return {
        ok: true,
        async json() {
          return {
            schema: "ordax.device-profile/1",
            devicePublicId: "ordax-12345678",
            displayName,
          };
        },
      };
    },
  };

  const port = await createNativeDeviceProfile(windowRef);
  assert.equal(port.getSnapshot().displayName, "OrdaX inicial");
  const renamed = await port.rename("  Meu   OrdaX  ");
  assert.equal(renamed.displayName, "Meu OrdaX");
  assert.equal(port.getSnapshot().displayName, "Meu OrdaX");
  assert.equal(calls[1].url, "/__ordax/native/device-profile");
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), { displayName: "Meu OrdaX" });
  assert.equal(calls[1].init.signal, undefined, "rename writes must not reuse expired bootstrap deadlines");
});
