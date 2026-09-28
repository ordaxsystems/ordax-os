// GENERATED FILE. Source of truth: system/profile-packs/*/manifest.json
// Regenerate with: python tools/profile-pack-manifests/generate.py build

export const LOCAL_PROFILE_PACK_MANIFESTS = Object.freeze([
  {
    "$schema": "ordax.profile-pack/1",
    "slug": "developer",
    "version": 1,
    "state": "draft",
    "title": "Developer",
    "category": "development",
    "space_kind": "professional",
    "apps": [],
    "templates": [],
    "knowledge": {
      "jurisdiction": null,
      "source_classes": [
        "project-source",
        "project-docs",
        "user-authorized-repository"
      ],
      "refresh_policy": "project-owned"
    },
    "intelligence": {
      "memory_scopes": [
        "space",
        "project"
      ],
      "preferred_purpose": "code",
      "external_provider_required": false
    },
    "security": {
      "auto_grant_privileges": false,
      "allow_unsigned_apps": false,
      "generic_shell_implied": false
    }
  },
  {
    "$schema": "ordax.profile-pack/1",
    "slug": "legal-br",
    "version": 1,
    "state": "draft",
    "title": "Advocacia Brasil",
    "category": "legal",
    "space_kind": "professional",
    "jurisdiction": "BR",
    "apps": [],
    "templates": [],
    "knowledge": {
      "source_classes": [
        "official-legislation",
        "official-regulator",
        "official-court-or-tribunal",
        "user-authorized-firm-material"
      ],
      "source_date_required": true,
      "jurisdiction_required": true,
      "citation_required_for_retrieved_authority": true,
      "stale_knowledge_must_be_identified": true,
      "refresh_policy": "source-specific-versioned"
    },
    "intelligence": {
      "memory_scopes": [
        "space",
        "project"
      ],
      "external_provider_required": false,
      "model_output_is_authoritative_source": false,
      "professional_judgment_replaced": false
    },
    "security": {
      "auto_grant_privileges": false,
      "allow_unsigned_apps": false,
      "cross_space_memory": false
    },
    "activation": {
      "publicly_available": false,
      "reason": "knowledge ingestion/update pipeline and professional-domain validation not implemented"
    }
  }
].map((entry) => Object.freeze(entry)));
