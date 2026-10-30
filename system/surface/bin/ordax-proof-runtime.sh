#!/bin/sh

# Shared resolver for read-only physical proof harnesses.
# The running Surface publishes the authoritative ephemeral runtime context.
# Harnesses must not infer a canonical Stable/MVP runtime from filesystem shape.
resolve_ordax_proof_runtime_root() {
    state_root=${ORDAX_STATE_DIR:-/state/ordax}
    context_file=${ORDAX_SURFACE_RUNTIME_PROOF_CONTEXT:-/run/ordax-surface/runtime-proof-context}
    stable_root=/run/ordax/runtime/native-surface/rootfs
    runtime_id=alpine-v3.22-cage-webkitgtk-v1
    development_root=$state_root/runtime/native-surface/$runtime_id/rootfs

    [ -f "$context_file" ] && [ ! -L "$context_file" ] || {
        echo "ordax-proof-runtime: active Surface runtime proof context unavailable: $context_file" >&2
        return 1
    }

    proof_profile=
    proof_runtime_mode=
    proof_evidence_scope=
    proof_runtime_sha256=
    seen_profile=0
    seen_mode=0
    seen_scope=0
    seen_digest=0

    while IFS='=' read -r key value || [ -n "$key$value" ]; do
        case "$key" in
            distribution_profile)
                [ "$seen_profile" -eq 0 ] || {
                    echo "ordax-proof-runtime: duplicate distribution profile in runtime proof context" >&2
                    return 1
                }
                proof_profile=$value
                seen_profile=1
                ;;
            runtime_mode)
                [ "$seen_mode" -eq 0 ] || {
                    echo "ordax-proof-runtime: duplicate runtime mode in runtime proof context" >&2
                    return 1
                }
                proof_runtime_mode=$value
                seen_mode=1
                ;;
            evidence_scope)
                [ "$seen_scope" -eq 0 ] || {
                    echo "ordax-proof-runtime: duplicate evidence scope in runtime proof context" >&2
                    return 1
                }
                proof_evidence_scope=$value
                seen_scope=1
                ;;
            runtime_sha256)
                [ "$seen_digest" -eq 0 ] || {
                    echo "ordax-proof-runtime: duplicate runtime digest in runtime proof context" >&2
                    return 1
                }
                proof_runtime_sha256=$value
                seen_digest=1
                ;;
            "")
                ;;
            *)
                echo "ordax-proof-runtime: unknown field in runtime proof context: $key" >&2
                return 1
                ;;
        esac
    done <"$context_file"

    [ "$seen_profile" -eq 1 ] &&
    [ "$seen_mode" -eq 1 ] &&
    [ "$seen_scope" -eq 1 ] &&
    [ "$seen_digest" -eq 1 ] || {
        echo "ordax-proof-runtime: active Surface runtime proof context is incomplete" >&2
        return 1
    }

    case "$proof_profile:$proof_runtime_mode:$proof_evidence_scope" in
        owner-development:dynamic-native-runtime:development)
            [ -z "$proof_runtime_sha256" ] || {
                echo "ordax-proof-runtime: development runtime context unexpectedly contains a verified digest" >&2
                return 1
            }
            candidate=$development_root
            ;;
        owner-development:verified-erofs-overlay:development|stable-mvp:verified-erofs-overlay:canonical-stable-mvp)
            [ "${#proof_runtime_sha256}" -eq 64 ] || {
                echo "ordax-proof-runtime: verified runtime digest is invalid" >&2
                return 1
            }
            case "$proof_runtime_sha256" in
                *[!0-9a-f]*)
                    echo "ordax-proof-runtime: verified runtime digest is invalid" >&2
                    return 1
                    ;;
            esac
            candidate=$stable_root
            ;;
        *)
            echo "ordax-proof-runtime: active Surface runtime proof context is invalid" >&2
            return 1
            ;;
    esac

    [ -d "$candidate" ] || {
        echo "ordax-proof-runtime: active Surface runtime root unavailable: $candidate" >&2
        return 1
    }

    RUNTIME_ROOT=$candidate
    ORDAX_PROOF_PROFILE=$proof_profile
    ORDAX_PROOF_RUNTIME_MODE=$proof_runtime_mode
    ORDAX_PROOF_EVIDENCE_SCOPE=$proof_evidence_scope
    ORDAX_PROOF_RUNTIME_SHA256=$proof_runtime_sha256
    export RUNTIME_ROOT ORDAX_PROOF_PROFILE ORDAX_PROOF_RUNTIME_MODE
    export ORDAX_PROOF_EVIDENCE_SCOPE ORDAX_PROOF_RUNTIME_SHA256
}
