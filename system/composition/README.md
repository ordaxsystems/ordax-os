# Runtime Composition

`system/composition/` is the thin outer wiring layer that joins the shared Surface to exactly one environment adapter.

It exists to keep both sides honest:

- `system/surface/` never imports Web/Mobile/Desktop/native implementations;
- adapters never import or own shared screens;
- composition may import both because its only responsibility is selecting and wiring implementations;
- product/domain policy must not live here;
- visual assets, design tokens and reusable interaction behavior remain in `system/surface/`;
- a target-specific composition entry may contain bootstrap/wiring code, not a target-specific product fork.

The first executable target is `composition/web`. Future Desktop/Mobile/native hosts may use different thin composition entries while consuming the same Surface and contracts.

## Canonical Web presentation cutover — 2026-10-10

The approved workspace presentation lives under system/surface/workspace and
uses the official Web build. One composition, one root dependency lock and
shared symbol/font sources remain, with no evaluation route or redirect.
Pending app interfaces are preserved. Real service wiring is the next phase:
presentation asserts no authenticated session, user files, inference, sync,
package installation or remote-device access. Native operational UI, services,
contracts and public Account are preserved. See docs/DESKTOP-IDENTITY.md and
migration ledger 007. This is a source/candidate change, not production activation.
