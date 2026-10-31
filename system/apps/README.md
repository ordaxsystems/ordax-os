# Application ownership and verified delivery

The system/apps directory owns application presentation, component and runtime catalogs only.
It contains no first-party product implementation. The OS owns built-in system
interfaces via system/services/system-ui, with rendering in system/surface.

Removable product sources, including Files and Studio, belong exclusively to
ordaxsystems/ordax-apps. Product code must not be copied into the OS.
Installed state comes solely from canonical Native verified signed-component slots.
An empty slot inventory is valid: the OS boots and offers structural Ajustes,
Conta, Sistema and Loja without a single optional app.
The Store does not sign, verify, activate, remove or authorize packages directly.

Shared host contracts and runtime services remain OS-owned, including File Space,
project continuity, identity, secure app-data, updater, trusted execution and recovery.
Removed application UI must not be hidden by a fallback under Surface or bootstrap.
