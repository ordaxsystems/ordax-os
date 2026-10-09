import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_SEARCH_PROVIDER,
  MAX_BROWSER_ADDRESS_INPUT,
  MAX_BROWSER_SEARCH_QUERY,
  resolveBrowserNavigation,
} from "../system/contracts/browser-navigation.mjs";

test("browser navigation resolves absolute and bare public URLs", () => {
  assert.deepEqual(resolveBrowserNavigation(" https://example.com/path?q=1 "), {
    kind: "url", url: "https://example.com/path?q=1",
  });
  assert.deepEqual(resolveBrowserNavigation("example.org/docs"), {
    kind: "url", url: "https://example.org/docs",
  });
  assert.equal(resolveBrowserNavigation("example.com:8443/docs").url, "https://example.com:8443/docs");
  assert.equal(resolveBrowserNavigation("HTTP://EXAMPLE.COM").url, "http://example.com/");
  assert.equal(resolveBrowserNavigation(""), null);
  assert.equal(resolveBrowserNavigation("  "), null);
  assert.equal(resolveBrowserNavigation("https://bücher.de").kind, "url");
  assert.equal(resolveBrowserNavigation("https://8.8.8.8/").url, "https://8.8.8.8/");
  assert.equal(resolveBrowserNavigation("https://[2001:4860:4860::8888]/").kind, "url");
});

test("address bar searches words and preserves query semantics without executing text", () => {
  assert.equal(BROWSER_SEARCH_PROVIDER.id, "duckduckgo");
  for (const phrase of ["ordax os navegador", "documentação do Blender", "what is a browser?", "github"]) {
    const result = resolveBrowserNavigation(phrase);
    assert.equal(result.kind, "search");
    const url = new URL(result.url);
    assert.equal(url.origin, "https://duckduckgo.com");
    assert.equal(url.searchParams.get("q"), phrase);
  }
  assert.equal(resolveBrowserNavigation("dois    espaços").query, "dois espaços");
  const encoded = resolveBrowserNavigation("test &? =#");
  assert.equal(new URL(encoded.url).searchParams.get("q"), "test &? =#");
});

test("app-provided navigation targets are URL-only", () => {
  assert.equal(resolveBrowserNavigation("example.org", { allowSearch: false }).kind, "url");
  assert.throws(() => resolveBrowserNavigation("search arbitrary words", { allowSearch: false }));
  assert.throws(() => resolveBrowserNavigation("github", { allowSearch: false }));
});

test("reject unsafe or ambiguous browser targets instead of treating schemes as searches", () => {
  const invalid = [
    "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd",
    "about:blank", "chrome://settings", "mailto:test@example.com",
    "http:example.com", "https:///example.com",
    "https://user:pass@example.com/path",
    "https://user@example.com", "example.com:99999",
    "//example.com", "https://example.com\\@evil.example/",
    "https://example.com/path with spaces", "https://printer",
    "http://127.0.0.1\\evil.example",
    "http://127.0.0.1", "127.1", "http://0x7f000001",
    "https://192.168.1.1/", "https://10.20.30.40/",
    "http://172.16.0.9/", "http://100.64.5.1/",
    "http://169.254.10.20/", "http://224.0.0.1/",
    "http://0.0.0.0/", "http://localhost/",
    "https://printer.local/", "https://gateway.home.arpa/",
    "https://127。0.0.1/", "http://[::1]/",
    "http://[fd00::abcd]/", "http://[fe80::1]/",
    "https://192.0.2.4/", "http://198.51.100.9/",
    "http://203.0.113.8/",
    "hello\u0000world", "evil\u202ereversed",
    "x".repeat(MAX_BROWSER_ADDRESS_INPUT + 1),
    "q".repeat(MAX_BROWSER_SEARCH_QUERY + 1),
  ];
  for (const candidate of invalid) {
    assert.throws(() => resolveBrowserNavigation(candidate), { name: "TypeError" }, candidate);
  }
  assert.throws(() => resolveBrowserNavigation(123), TypeError);
});
