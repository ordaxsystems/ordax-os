# System Foundation

Shared root primitives for capability availability, service lifecycle, bounded operational events and restrictive policy composition.

This service does **not** execute actions and cannot create authority. Apps and orchestration layers consume it through `system/contracts/system-foundation.mjs`; Action Gateway/grants remain separate.

Scheduler/background ownership is documented at system level but intentionally not enabled here.
