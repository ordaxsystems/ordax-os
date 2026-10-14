# GENERATED FILE. DO NOT EDIT BY HAND.
# Source of truth: docs/contracts/runtime-component-package.json
# Generator: tools/app-policy/render_native_store_metadata_policy.py
# Metadata queries, verified executable file reads and health mutations have DISTINCT scopes.

from types import MappingProxyType

STORE_METADATA_COMPONENT_IDS = frozenset({
    "activity",
    "calculator",
    "calendar",
    "character-map",
    "clock",
    "colors",
    "converter",
    "image-viewer",
    "media-player",
    "network",
    "notes",
    "paint",
    "pdf-viewer",
    "projects",
    "studio",
    "text-viewer",
    "toolbox",
})

NATIVE_MODULE_READ_COMPONENT_IDS = frozenset({
    "calculator",
    "notes",
    "studio",
})

NATIVE_HEALTH_MUTATION_COMPONENT_IDS = frozenset({
    "notes",
})

NATIVE_PROBATION_COMPONENT_IDS = frozenset({
    "notes",
})

NATIVE_PROBATION_PROBE_MODE_BY_COMPONENT = MappingProxyType({
    "notes": "import-contract",
})
