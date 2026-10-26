import { test } from "node:test";
import assert from "node:assert/strict";
import { hasNativeHostBridge } from "../system/adapters/native/host-bridge.mjs";
import { hasBrowserHostTransport, hasDesktopBrowserTransport, postBrowserHostCommand } from "../system/adapters/native/browser-host-transport.mjs";

function host(protocol = "http:", hostname = "127.0.0.1") {
  const commands = [];
  const windowRef = {
    location: { protocol, hostname, origin: protocol + "//" + hostname + ":4202" },
    document: { documentElement: { getAttribute: () => null } },
    ordaxDesktopBrowser: { postMessage(value) { commands.push(JSON.parse(value)); return true; } },
  };
  return { windowRef, commands };
}
test("Desktop browser uses canonical Native command schema without privileged host", () => {
  const { windowRef, commands } = host();
  assert.equal(hasNativeHostBridge(windowRef), false);
  assert.equal(hasBrowserHostTransport(windowRef), true);
  assert.equal(postBrowserHostCommand(windowRef, {type:"tab.open",tabId:"tab-1",url:"https://example.com/"}), true);
  assert.deepEqual(commands, [{type:"tab.open",tabId:"tab-1",url:"https://example.com/"}]);
});
test("Desktop browser rejects remote origins, arrays and oversized payloads", () => {
  for (const [protocol,hostname] of [["https:","example.com"],["http:","example.com"],["file:",""]]) {
    const { windowRef } = host(protocol, hostname);
    assert.equal(hasBrowserHostTransport(windowRef), false);
    assert.throws(() => postBrowserHostCommand(windowRef, {type:"snapshot.request"}), /unavailable/);
  }
  const { windowRef } = host();
  assert.throws(() => postBrowserHostCommand(windowRef, []), /object/);
  assert.throws(() => postBrowserHostCommand(windowRef, {type:"tab.navigate",url:"x".repeat(13000)}), /exceeds/);
});

test("installed Windows transport is distinguished from USB Native and arbitrary web origins", () => {
  const { windowRef } = host();
  assert.equal(hasDesktopBrowserTransport(windowRef), true);
  for (const [protocol,hostname] of [["https:","127.0.0.1"],["http:","example.com"],["file:",""]]) {
    assert.equal(hasDesktopBrowserTransport(host(protocol,hostname).windowRef),false);
  }
  const linuxNative={location:{protocol:"http:",hostname:"127.0.0.1"},navigator:{},
    document:{documentElement:{getAttribute:()=>null}}};
  assert.equal(hasDesktopBrowserTransport(linuxNative),false,
    "Linux Native must retain its USB keyboard and recovery probes");
});

test("Native composition only probes USB keyboard and recovery when Windows transport is absent", async () => {
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../system/composition/native/main.mjs",import.meta.url),"utf8");
  assert.match(source,/const windowsDesktopHost = hasDesktopBrowserTransport\\(window\\)/);
  assert.match(source,/windowsDesktopHost \\? Promise\\.resolve\\(null\\) : optionalNativeProbe\\(\\s*"OrdaX native keyboard layout unavailable"/);
  assert.match(source,/windowsDesktopHost \\? Promise\\.resolve\\(null\\) : optionalNativeProbe\\(\\s*"OrdaX native recovery status unavailable"/);
  assert.ok(source.includes('() => createNativeNetworkStatus(window)'),
    "Windows network observation must remain enabled");
  assert.ok(source.includes('() => createNativePowerStatus(window)'),
    "Windows power observation must remain enabled");
});
