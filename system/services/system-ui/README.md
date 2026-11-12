# System interfaces: Surface-owned

Account, Settings, System and the built-in Store are integrated Surface interfaces, not installable first-party packages.

- Source of truth for presentation descriptors: `system/services/system-ui/{account,settings,system,store}`. The visual implementations remain in `system/surface/ui/`.
- Their UI descriptors continue to use the existing, validated Surface application contract for window/navigation compatibility. This does **not** grant Store install/uninstall authority.
- They are delivered and updated with OrdaX OS, not by the third-party/component-slot app lifecycle.
- Identity, storage, updates, permissions and diagnostics remain host-owned in their existing services and contracts, independently of these interfaces.
- User-installable products are owned by `ordax-apps` and become visible only after Native signed-slot verification.
- Source ownership is distinct from UI navigation: a system interface may be opened in a window without being a removable package.

No second source of these descriptors belongs in `system/apps/` or `ordax-apps/apps/`.
