# Meridian sidebar validation — 2026-10-21

The shared Native sidebar now measures actual rendered geometry, handles font loading and fractional scaling, preserves keyboard focus, and keeps overflow reachable. Optional account registration-policy refresh now runs after surface mounting.

Validated: 35 sidebar tests; 16 Chromium scenarios (expanded/collapsed at 1024×600, 1280×720, 1366×768, 1440×900, Full HD, QHD, 4K and 8K); official isolated Windows emulator first-use/reload smoke; 6 Native account contract tests; TypeScript, syntax and foundation checks. Canonical public artifacts regenerated; targeted public/runtime Python recheck: 93 passed. GPG signature recheck: 6 passed.

Full Linux JavaScript: 2507 tests, 2499 passed, 7 failed, 1 skipped. The same seven failures reproduced on the unmodified main baseline: four assistant presentation modules, component update presentation, first-party identity inventory and an expired grant timing case.

Full Linux Python: 3563 tests, 6 failures, 22 errors, 4 skipped. Targeted rechecks resolved stale public artifacts, temporary checkout modes and missing GPG/XZ. Remaining findings include publication workflow assertions, automation outbox scheduling, Native app-data/file operations and a process-death timeout. Release CLI requires Go >=1.27; the available Linux environment has 1.24.13.

The complete repository suite is not green. Physical USB rendering and a real account session were not validated by isolated browser checks. No USB was written. Extra footer-only browser checks did not produce confirmed evidence and are not counted as passed.

## Follow-up: inventory and test reconciliation

The component presentation test now checks the actual bundled catalog (including
Store and Studio) and verifies that Git delivery does not claim independent
production updates. A separate fixture covers bundled, Git and signed-slot
presentation without changing production activation gates. Update nomenclature
documentation was reconciled with the component catalog.

The bundled identity inventory no longer lists Activity, Assistant, Internet or
Projects after their payload removal. This follows the existing exact catalog
membership requirement in `docs/contracts/verified-app-install-identity.json`;
product discovery and external app identity are separate and remain intact.

The live grant expiry test now controls `Date.now` as well as the injected grant
authority clock, preserving the expiry assertion independently of the real date.

Follow-up checks: 9 JavaScript tests passed and 45 Linux Python tests passed
(update nomenclature, install identity, bootstrap, producer and runtime wiring).
The Python filesystem tests require POSIX APIs and failed on Windows before being
rerun successfully in Linux. The full repository suites were not rerun for this
follow-up; the earlier full-run counts above remain historical evidence.
