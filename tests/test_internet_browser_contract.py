import ast
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "system" / "apps" / "catalog.mjs"
CONTRACT = ROOT / "system" / "contracts" / "browser-session.mjs"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "browser-session.mjs"
NATIVE_ADAPTER = ROOT / "system" / "adapters" / "native" / "browser-session.mjs"
NATIVE_HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
SURFACE_LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
WEB_COMPOSITION = ROOT / "system" / "composition" / "web"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"


class InternetBrowserContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def browser_uri_policy(self):
        source = self.text(NATIVE_HOST)
        tree = ast.parse(source)
        names = {
            "MAX_URI_LENGTH",
            "TOP_LEVEL_NETWORK_SCHEMES",
            "RESOURCE_NETWORK_SCHEMES",
            "INTERNAL_RESOURCE_SCHEMES",
            "LOCAL_HOST_SUFFIXES",
        }
        functions = {
            "public_network_uri",
            "allowed_external_uri",
            "allowed_external_resource_uri",
        }
        selected = []
        for node in tree.body:
            if isinstance(node, ast.Import) and any(
                alias.name in {"ipaddress", "socket"} for alias in node.names
            ):
                selected.append(node)
            elif isinstance(node, ast.ImportFrom) and node.module == "urllib.parse":
                selected.append(node)
            elif isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in names for target in node.targets
            ):
                selected.append(node)
            elif isinstance(node, ast.FunctionDef) and node.name in functions:
                selected.append(node)
        namespace = {}
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(NATIVE_HOST), "exec"), namespace)
        return namespace

    def test_removed_internet_product_is_absent_while_browser_host_survives(self):
        self.assertFalse((ROOT / "system/apps/internet").exists())
        self.assertFalse((ROOT / "system/services/i18n/catalog/internet.mjs").exists())
        for path in (CONTRACT, WEB_ADAPTER, NATIVE_ADAPTER, NATIVE_HOST):
            self.assertTrue(path.is_file(), path)
        catalog = self.text(CATALOG)
        self.assertNotIn('./internet/app.mjs', catalog)
        native = self.text(NATIVE_COMPOSITION / "main.mjs")
        self.assertIn("createNativeBrowserSession", native)
        self.assertNotIn('componentId: "internet"', native)

    def test_shared_navigation_policy_is_pure_and_host_owned(self):
        policy = self.text(ROOT / "system/contracts/browser-navigation.mjs")
        self.assertIn('BROWSER_SEARCH_PROVIDERS = Object.freeze([', policy)
        self.assertIn('BROWSER_SEARCH_PROVIDER = BROWSER_SEARCH_PROVIDERS[0]', policy)
        self.assertIn('new URL(provider.origin)', policy)
        self.assertNotIn('window.', policy)
        self.assertNotIn('fetch(', policy)

    def test_web_mode_fails_closed_instead_of_claiming_embedded_navigation(self):
        adapter = self.text(WEB_ADAPTER)
        contract = self.text(CONTRACT)
        self.assertIn('createUnavailableBrowserSession', adapter)
        self.assertIn('BROWSER_UNAVAILABLE_REASONS.WEB_EMBEDDING_DISABLED', adapter)
        self.assertIn('WEB_EMBEDDING_DISABLED: "web-embedding-disabled"', contract)
        self.assertNotIn('não incorpora sites arbitrários', adapter.lower())
        self.assertNotIn('iframe', adapter.lower())

    def test_native_adapter_uses_one_explicit_browser_bridge(self):
        adapter = self.text(NATIVE_ADAPTER)
        self.assertIn('hasNativeHostBridge(windowRef)', adapter)
        self.assertIn('postNativeHostMessage(windowRef, command)', adapter)
        self.assertIn('ordax-browser-host', adapter)
        for command in (
            'tab.open',
            'tab.close',
            'tab.activate',
            'tab.navigate',
            'tab.back',
            'tab.forward',
            'tab.reload',
            'viewport.set',
        ):
            self.assertIn(command, adapter)

    def test_native_bridge_origin_builder_is_canonical_and_fails_closed(self):
        source = self.text(NATIVE_HOST)
        tree = ast.parse(source)
        names = {
            "BRIDGE_NAME",
            "BRIDGE_WORLD_NAME",
            "BRIDGE_READY_ATTRIBUTE",
            "BRIDGE_READY_VALUE",
            "BRIDGE_MAX_MESSAGE_CHARS",
            "NATIVE_HOST_BRIDGE_SCRIPT",
        }
        selected = []
        for node in tree.body:
            if isinstance(node, ast.Import) and any(alias.name == "json" for alias in node.names):
                selected.append(node)
            elif isinstance(node, ast.ImportFrom) and node.module == "urllib.parse":
                selected.append(node)
            elif isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in names for target in node.targets
            ):
                selected.append(node)
            elif isinstance(node, ast.FunctionDef) and node.name in {
                "native_surface_origin",
                "native_host_bridge_user_script",
            }:
                selected.append(node)
        namespace = {}
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(NATIVE_HOST), "exec"), namespace)
        self.assertEqual(
            namespace["native_surface_origin"]("http://127.0.0.1:43177/system/"),
            "http://127.0.0.1:43177",
        )
        script = namespace["native_host_bridge_user_script"]("http://127.0.0.1:43177")
        self.assertIn('const expectedOrigin = "http://127.0.0.1:43177";', script)
        self.assertIn('root.setAttribute("data-ordax-native-host-bridge", "v1")', script)
        self.assertIn("event.data.length > 131072", script)
        self.assertNotIn("__ORDAX_NATIVE_HOST_", script)
        for invalid in (
            "https://127.0.0.1:43177",
            "http://localhost:43177",
            "http://127.0.0.1.evil:43177",
            "http://user@127.0.0.1:43177",
            "http://127.0.0.1:0",
        ):
            with self.assertRaises(ValueError):
                namespace["native_surface_origin"](invalid)
        with self.assertRaises(ValueError):
            namespace["native_host_bridge_user_script"]("http://127.0.0.1:43177/path")

    def test_native_bridge_isolated_to_surface_origin_and_top_frame(self):
        host = self.text(NATIVE_HOST)
        bridge = self.text(ROOT / "system" / "adapters" / "native" / "host-bridge.mjs")
        self.assertRegex(
            host,
            r"register_script_message_handler_in_world\(\s*BRIDGE_NAME,\s*BRIDGE_WORLD_NAME",
        )
        self.assertNotIn("register_script_message_handler(BRIDGE_NAME)", host)
        self.assertIn("WebKit2.UserScript.new_for_world", host)
        self.assertIn("WebKit2.UserContentInjectedFrames.TOP_FRAME", host)
        self.assertIn("WebKit2.UserScriptInjectionTime.START", host)
        self.assertIn('[f"{self.surface_origin}/*"]', host)
        self.assertIn("event.source !== window", host)
        self.assertIn("event.origin !== expectedOrigin", host)
        self.assertIn("native_surface_origin(start_uri)", host)
        self.assertIn("windowRef.postMessage(serialized, targetOrigin)", bridge)
        self.assertNotIn("windowRef?.webkit", bridge)

    def test_native_host_separates_privileged_surface_from_external_webviews(self):
        host = self.text(NATIVE_HOST)
        self.assertIn('WebView.new_with_context(self.surface_context)', host)
        self.assertIn('self.manager = self.surface_view.get_user_content_manager()', host)
        self.assertIn('base_data_directory=surface_profile_data', host)
        self.assertIn('os.path.join(self.profile_root, "surface", "data")', host)
        self.assertIn('WebsiteDataManager(', host)
        self.assertIn('WebContext.new_with_website_data_manager', host)
        self.assertIn('WebView.new_with_context(self.external_context)', host)
        self.assertIn('host == "localhost"', host)
        self.assertIn('TOP_LEVEL_NETWORK_SCHEMES = frozenset({"http", "https"})', host)
        self.assertIn('socket.inet_aton(host)', host)
        self.assertIn('return address.is_global', host)
        self.assertIn('resource-load-started', host)
        self.assertIn('resource.connect("send-request"', host)
        self.assertIn('request.set_uri("about:blank")', host)
        self.assertIn('request.deny()', host)
        self.assertIn('download.cancel()', host)
        self.assertNotIn('new_with_user_content_manager(self.manager)', host.split('def create_external_view', 1)[1])
        ast.parse(host)

    def test_external_uri_policy_rejects_local_and_non_public_targets(self):
        policy = self.browser_uri_policy()
        allowed_navigation = policy["allowed_external_uri"]
        allowed_resource = policy["allowed_external_resource_uri"]

        self.assertTrue(allowed_navigation("https://example.com/path"))
        self.assertTrue(allowed_navigation("https://bücher.de/docs"))
        self.assertTrue(allowed_navigation("https://example。com/docs"))
        self.assertTrue(allowed_navigation("https://8.8.8.8/"))
        self.assertTrue(allowed_resource("wss://example.com/socket"))
        self.assertTrue(allowed_resource("data:text/plain,ok"))
        self.assertTrue(allowed_resource("about:blank"))

        rejected = (
            "http://localhost/",
            "http://service.local/",
            "http://router.home.arpa/",
            "http://printer/",
            "http://127.0.0.1/",
            "http://0.0.0.0/",
            "http://10.0.0.1/",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/",
            "http://[::1]/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
            "http://0177.0.0.1/",
            "http://127.1/",
            "http://0x7f.0.0.1/",
            "http://2130706433/",
            # WHATWG/IDNA host normalization must not expose loopback or LAN.
            "http://%31%32%37.0.0.1/",
            "http://%6cocalhost/",
            "http://127%2e0.0.1/",
            "http://127。0.0.1/",
            "http://127．0.0.1/",
            "http://127｡0.0.1/",
            "http://router。local/",
            "http://printer．home.arpa/",
            "http://192。168.0.1/",
            "http://127%EF%BC%8E0.0.1/",

            "http://0300.0250.0001.0001/",
            "http://0xc0.0xa8.0x1.0x1/",
        )
        for uri in rejected:
            with self.subTest(uri=uri):
                self.assertFalse(allowed_navigation(uri))
                self.assertFalse(allowed_resource(uri))

    def test_native_policy_rejects_credential_and_parser_ambiguity(self):
        navigation = self.browser_uri_policy()["allowed_external_uri"]
        resource = self.browser_uri_policy()["allowed_external_resource_uri"]
        rejected = (
            "https://user:password@example.com/",
            "https://user@example.com/",
            "https://@example.com/",
            "https://example.com\\@internal.example/",
            "https://example.com/\\internal.example/",
            "https://example.com/\x00admin",
            "https://example.com/\nheader",
            "https://example.com/\tpath",
        )
        for url in rejected:
            with self.subTest(url=repr(url)):
                self.assertFalse(navigation(url))
                self.assertFalse(resource(url))

    def test_invalid_native_target_fails_before_tab_creation_or_activation(self):
        host = self.text(NATIVE_HOST)
        open_tab = host.split("    def open_tab(", 1)[1].split("    def close_tab(", 1)[0]
        validation = open_tab.index("not allowed_external_uri(url_value)")
        self.assertLess(validation, open_tab.index("if tab_id in self.tabs:"))
        self.assertLess(validation, open_tab.index("self.create_external_view(tab_id)"))

    def test_native_surface_runtime_owns_webkit_dependencies_directly(self):
        launcher = self.text(SURFACE_LAUNCHER)
        self.assertIn('VERIFIED_RUNTIME_MODE=${ORDAX_SURFACE_RUNTIME_MODE:-}', launcher)
        self.assertIn('RUNTIME_ROOT=$VERIFIED_RUNTIME_ROOT', launcher)
        self.assertIn('verified-erofs-overlay', launcher)
        self.assertNotIn('alpine-v3.22', launcher)
        self.assertNotIn('/sbin/apk', launcher)
        buildroot_config = (ROOT / 'bootstrap/independent-surface-runtime/configs/ordax_surface_defconfig').read_text()
        for required in ('BR2_PACKAGE_CAGE=y', 'BR2_PACKAGE_WEBKITGTK=y', 'BR2_PACKAGE_LIBGTK3_WAYLAND=y'):
            self.assertIn(required, buildroot_config)
        self.assertIn('/srv/ordax-system/surface/runtime/ordax_browser_host.py', launcher)
        self.assertIn('--profile-root /var/lib/ordax-user/browser', launcher)
        self.assertNotIn('barkery-browser', launcher)
        self.assertNotIn('/usr/bin/barkery', launcher)
        subprocess.run(["sh", "-n", str(SURFACE_LAUNCHER)], check=True)

    def test_browser_capability_is_native_and_isolated(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        browser = capabilities["browser.web-content"]
        self.assertEqual(browser["owner"], "system/adapters")
        self.assertEqual(browser["security_boundary"], "isolated-unprivileged-web-content")
        modes = {mode["id"]: mode for mode in contract["modes"]}
        for mode_id in ("usb", "native-disk"):
            self.assertIn("browser.web-content", modes[mode_id]["baseline_capabilities"])
        for mode_id in ("web", "mobile", "desktop"):
            self.assertNotIn("browser.web-content", modes[mode_id]["baseline_capabilities"])


if __name__ == "__main__":
    unittest.main()
