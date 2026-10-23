# GENERATED FILE. DO NOT EDIT BY HAND.
# Source of truth: docs/contracts/runtime-component-package.json
# Generator: tools/app-policy/render_native_store_metadata_policy.py
# Metadata, runtime reads, health writes and pending decisions have DISTINCT gates.

from types import MappingProxyType

STORE_METADATA_COMPONENT_IDS = frozenset({
    "activity",
    "assistant",
    "calculator",
    "calendar",
    "character-map",
    "clock",
    "colors",
    "converter",
    "files",
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
    "files",
    "notes",
    "studio",
})

NATIVE_HEALTH_MUTATION_COMPONENT_IDS = frozenset({
    "files",
    "notes",
})

NATIVE_PROBATION_COMPONENT_IDS = frozenset({
    "files",
    "notes",
})

NATIVE_PENDING_DECISION_COMPONENT_IDS = frozenset({
    "notes",
})

NATIVE_PROBATION_PROBE_MODE_BY_COMPONENT = MappingProxyType({
    "files": "mount-contract",
    "notes": "import-contract",
})

NATIVE_PENDING_DECISION_EXECUTION_ENABLED = False
NATIVE_CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED = False
NATIVE_SLOT_ACTIVATION_AVAILABLE = False
NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE = False
