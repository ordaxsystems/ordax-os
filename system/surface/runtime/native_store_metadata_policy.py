# GENERATED FILE. DO NOT EDIT BY HAND.
# Source of truth: docs/contracts/runtime-component-package.json
# Generator: tools/app-policy/render_native_store_metadata_policy.py
# Metadata queries, verified executable file reads and health mutations have DISTINCT scopes.

STORE_METADATA_COMPONENT_IDS = frozenset({
    "calculator",
    "calendar",
    "character-map",
    "clock",
    "colors",
    "converter",
    "image-viewer",
    "internet",
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
    "internet",
    "network",
    "notes",
    "projects",
    "studio",
})

NATIVE_HEALTH_MUTATION_COMPONENT_IDS = frozenset({
    "internet",
    "notes",
})
