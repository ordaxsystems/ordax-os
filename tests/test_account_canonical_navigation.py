from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = ROOT / "system" / "surface" / "ui" / "account-overview-controls.mjs"
ACCOUNT_CATALOG = ROOT / "system" / "services" / "i18n" / "catalog" / "account.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "account.css"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.mjs"


class AccountCanonicalNavigationTests(unittest.TestCase):
    def test_account_exposes_only_real_current_sections(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertIn('id: "overview"', controls)
        self.assertIn('id: "spaces"', controls)
        self.assertIn('id: "profiles"', controls)
        self.assertIn('id: "memory"', controls)
        self.assertIn('id: "sync"', controls)
        self.assertIn("validAccountSection", controls)
        self.assertIn('activeSection === "overview"', controls)
        self.assertIn('activeSection === "spaces"', controls)
        self.assertIn('activeSection === "profiles"', controls)
        self.assertIn('activeSection === "memory"', controls)
        self.assertIn('activeSection === "sync"', controls)
        for unavailable in ("security", "sessions", "plan"):
            self.assertNotIn(f'id: "{unavailable}"', controls)
        self.assertNotIn("sectionId", controls)
        self.assertNotIn("detailId", controls)

    def test_app_activation_is_bounded_to_account_owned_targets(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertIn("assertAppActivationPort", controls)
        self.assertIn('activation.appId === "account"', controls)
        self.assertIn("validAccountSection(activation.target)", controls)
        self.assertIn("unsubscribeActivation?.()", controls)
        self.assertIn('lifecycle.getAppTarget("account")', controls)
        self.assertIn('activationPort.publish({ appId: "account", target: nextSection })', controls)

    def test_sync_copy_does_not_claim_cloud_transport_from_capability_only(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        catalog = ACCOUNT_CATALOG.read_text(encoding="utf-8")
        self.assertNotIn('"Sincronização segura"', controls)
        self.assertNotIn('"Ativa"', controls)
        self.assertNotIn("SYNC_CORE_STATUS", controls)
        self.assertIn("account.continuity.subtitle", controls)
        self.assertIn('syncSnapshot?.accountContinuity === "active"', controls)
        self.assertIn('syncSnapshot?.transport === "available"', controls)
        self.assertIn('syncSnapshot.transport === "host-required"', controls)
        self.assertIn("account.card.accountContinuity", controls)
        self.assertIn("account.card.continuityActive.detail", controls)
        self.assertIn("account.card.continuityHostRequired.detail", controls)
        self.assertIn("account.card.continuityInactive.detail", controls)
        self.assertIn("account.card.noPending.detail", controls)
        self.assertIn("account.card.pending.detail", controls)
        self.assertIn(
            "Nada é chamado de sincronizado sem confirmação de um transporte autenticado.",
            catalog,
        )
        self.assertIn(
            "A fila local está vazia; isso não prova que exista uma conta ou nuvem sincronizada.",
            catalog,
        )
        self.assertIn(
            "A sessão autenticada concluiu a reconciliação inicial das classes suportadas neste dispositivo.",
            catalog,
        )
        self.assertIn(
            "Isso não substitui a prova física nem o rollout público.",
            catalog,
        )
        self.assertIn("nada foi anunciado como enviado à nuvem", catalog)

    def test_spaces_section_uses_real_read_only_catalog_and_clears_on_sign_out(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        catalog = ACCOUNT_CATALOG.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")

        self.assertIn("assertSpacesPort", controls)
        self.assertIn("validateSpacesSnapshot", controls)
        self.assertIn("dataset.accountSpacesRefresh", controls)
        self.assertIn('sessionSnapshot.state !== "signed-in"', controls)
        self.assertIn("spacesPort?.reset()", controls)
        self.assertIn("account.spaces.card.detailPack", controls)
        self.assertIn('"account.section.spaces": "Spaces"', catalog)
        self.assertIn('"account.spaces.title": "Seus Spaces"', catalog)
        self.assertIn("Nenhum Space local fictício é criado.", catalog)
        self.assertIn("No fake local Space is created.", catalog)
        for composition in (native, web):
            self.assertIn("createWebSpacesCatalog", composition)
            self.assertIn("const spaces = createWebSpacesCatalog(window);", composition)
            self.assertIn("spaces,", composition)
            self.assertIn("spaces.dispose()", composition)

    def test_profiles_section_uses_local_fail_closed_provisioning_in_both_compositions(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        catalog = ACCOUNT_CATALOG.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")

        self.assertIn("assertProfileProvisioningPort", controls)
        self.assertIn("renderProfiles", controls)
        self.assertIn("account.profiles.state.${plan.state}", controls)
        self.assertIn('"account.profiles.state.blocked": "Em breve"', catalog)
        self.assertIn('"account.profiles.state.blocked": "Coming soon"', catalog)
        self.assertIn('"account.section.profiles": "Perfis"', catalog)
        self.assertIn('"account.section.profiles": "Profiles"', catalog)
        self.assertIn("nenhuma instalação é simulada", catalog)
        self.assertIn("installation is never simulated", catalog)
        for composition in (native, web):
            self.assertIn("createProfileProvisioningRuntime", composition)
            self.assertIn("createLocalProfileDistributions", composition)
            self.assertIn("loadBundledProfilePacks", composition)
            self.assertIn("inventory: profileComponentInventory", composition)
            self.assertIn("profileProvisioning,", composition)
            self.assertIn("profileProvisioning.dispose()", composition)
            self.assertIn("profileComponentInventory.dispose()", composition)
        self.assertIn("createNativeProfileComponentInventory", native)
        self.assertIn("optionalNativeProbe", native)
        self.assertIn("createSessionProfileComponentInventory", native)
        self.assertIn("createSessionProfileComponentInventory", web)
        self.assertIn("continuing without Profiles", web)
        self.assertIn("continuing without Profiles", native)
        self.assertNotIn("LOCAL_PROFILE_DISTRIBUTIONS", native)
        self.assertNotIn("LOCAL_PROFILE_DISTRIBUTIONS", web)
        self.assertNotIn("adapters/native/profile-component-inventory.mjs", web)

    def test_bundled_profile_taxonomy_filters_only_real_published_profiles(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        catalog = ACCOUNT_CATALOG.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")
        profile_catalog = (
            ROOT / "system/services/profile-packs/catalog.mjs"
        ).read_text(encoding="utf-8")

        for composition in (native, web):
            self.assertIn("createProfilePackCatalogFromPacks", composition)
            self.assertIn("loadBundledProfileTaxonomy", composition)
            self.assertIn("createProfileTaxonomyView", composition)
            self.assertIn("profileTaxonomy = null;", composition)
            self.assertIn("profileTaxonomy,", composition)
            self.assertIn("preserving ungrouped catalog", composition)

        self.assertIn("assertValidatedProfilePackCatalog(packs)", profile_catalog)
        self.assertIn('pack.state === "active"', profile_catalog)
        self.assertIn("category: pack.category", profile_catalog)
        self.assertIn("apps: pack.apps", profile_catalog)
        self.assertIn("profileTaxonomy = null", controls)
        self.assertIn("createProfileTaxonomyView({", controls)
        self.assertIn("profileCategoryCatalog.get(plan.profile.slug, plan.profile.version)", controls)
        self.assertIn("if (published === null) return false", controls)
        self.assertIn("category.ancestorIds.includes(selectedProfileCategory)", controls)
        self.assertIn("chooser.dataset.accountProfileCategory", controls)
        self.assertIn('chooser.setAttribute("aria-label"', controls)
        self.assertIn('chooser.value = selectedProfileCategory ?? ""', controls)
        self.assertIn('root.addEventListener("change", onChange)', controls)
        self.assertIn('root.removeEventListener("change", onChange)', controls)
        self.assertIn('"account.profiles.categories.label": "Filtrar perfis por categoria ou nicho"', catalog)
        self.assertIn('"account.profiles.categories.label": "Filter Profiles by category or niche"', catalog)

    def test_native_profiles_bind_selected_space_to_persistent_activation_state(self):
        ui = (ROOT / "system/surface/ui/account-overview-controls.mjs").read_text(encoding="utf-8")
        native = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        catalog = (ROOT / "system/services/i18n/catalog/account.mjs").read_text(encoding="utf-8")

        self.assertIn("assertMutableProfileActivationStatePort", ui)
        self.assertIn("profileActivationState = null", ui)
        self.assertIn("profileActivationPort.activate({", ui)
        self.assertIn("profileActivationPort.deactivate(selectedSpace.id)", ui)
        # Identity matching now belongs to the shared read-only Space projection,
        # not a duplicated condition inside the Account UI.
        projection = (
            ROOT / "system/services/spaces/authorized-view.mjs"
        ).read_text(encoding="utf-8")
        self.assertIn("deriveAuthorizedSpaces", ui)
        self.assertIn("authorizedSpaces().activeSpace", ui)
        self.assertIn("selection?.subjectId === identity?.subjectId", projection)
        self.assertIn("space.kind === selection.selectedSpace?.kind", projection)
        self.assertIn("priorSubject !== currentSubject", ui)
        self.assertIn("spacesPort?.reset()", ui)
        self.assertIn('data-account-profile-action', ui)
        self.assertIn("profileActivationState,", native)
        self.assertIn('"account.profiles.name.pizzaria-br": "Pizzaria"', catalog)
        self.assertIn('"account.profiles.name.impressao-3d-br": "Impressão 3D"', catalog)


    def test_memory_section_is_local_first_and_native_only_when_durable(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        catalog = ACCOUNT_CATALOG.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")

        self.assertIn("mountMemoryReviewControls", controls)
        self.assertIn("account.memory.review.description", controls)
        self.assertIn("dataset.accountMemoryAutoCapture", controls)
        self.assertIn("MEMORY_AUTO_CAPTURE_PREFERENCE_ID", controls)
        self.assertIn("memoryAutoCaptureEnabled", controls)
        self.assertIn("memoryReviewControls?.dispose()", controls)
        self.assertIn('"account.section.memory": "Memória"', catalog)
        self.assertIn('"account.section.memory": "Memory"', catalog)
        self.assertIn('"account.memory.autoCapture.label": "Memória automática"', catalog)
        self.assertIn('"account.memory.autoCapture.label": "Automatic memory"', catalog)
        self.assertIn("não envia memória automaticamente para a IA", catalog)
        self.assertIn("does not automatically send memory to AI", catalog)
        self.assertIn('"account.memory.review.removePrompt": "Apagar esta memória?"', catalog)
        self.assertIn('"account.memory.review.removeConfirm": "Confirmar exclusão"', catalog)
        self.assertIn('"account.memory.review.removeCancel": "Cancelar"', catalog)
        self.assertIn('"account.memory.review.clearAll": "Apagar todas"', catalog)
        self.assertIn('"account.memory.review.clearAllPrompt": "Apagar todas as memórias da origem selecionada?"', catalog)
        self.assertIn('"account.memory.review.clearAllConfirm": "Confirmar limpeza"', catalog)
        self.assertIn('"account.memory.review.removePrompt": "Delete this memory?"', catalog)
        self.assertIn('"account.memory.review.removeConfirm": "Confirm delete"', catalog)
        self.assertIn('"account.memory.review.removeCancel": "Cancel"', catalog)
        self.assertIn('"account.memory.review.clearAll": "Delete all"', catalog)
        self.assertIn('"account.memory.review.clearAllPrompt": "Delete all memory for the selected owner?"', catalog)
        self.assertIn('"account.memory.review.clearAllConfirm": "Confirm clear"', catalog)
        memory_controls = (ROOT / "system" / "surface" / "ui" / "memory-review-controls.mjs").read_text(encoding="utf-8")
        self.assertIn("pendingRemovalId", memory_controls)
        self.assertIn("dataset.memoryReviewRemoveConfirm", memory_controls)
        self.assertIn("dataset.memoryReviewRemoveCancel", memory_controls)
        self.assertIn("findItemActionButton", memory_controls)
        self.assertIn('"memoryReviewRemoveConfirm"', memory_controls)
        self.assertIn('?.focus({ preventScroll: true })', memory_controls)
        self.assertIn("viewModel.remove(id)", memory_controls)
        self.assertIn(".ordax-memory-review-remove-confirm", css)
        self.assertIn(".ordax-memory-review-remove-cancel", css)
        self.assertIn(".ordax-memory-review-clear", css)
        self.assertIn(".ordax-memory-review-clear-confirm", css)
        self.assertIn(".ordax-memory-review-clear-cancel", css)
        self.assertIn(".ordax-memory-review-create {", css)
        self.assertIn(".ordax-memory-review-create textarea", css)
        self.assertIn(".ordax-memory-review-create-button:focus-visible", css)
        self.assertIn(".ordax-memory-review-export:focus-visible", css)
        self.assertIn(".ordax-memory-review-clear-confirm:disabled", css)
        self.assertIn(".ordax-memory-review-remove-confirm:disabled", css)
        self.assertIn(".ordax-memory-review-create textarea:disabled", css)
        self.assertIn(".ordax-memory-review-host", css)
        self.assertIn("createMemoryReviewSession", native)
        self.assertIn("createMemoryReviewViewModel", native)
        self.assertIn("identitySessionPort: identitySession", native)
        self.assertIn("memoryReview,", native)
        self.assertIn("spaceSelection,\n    surface.preferences,", native)
        self.assertIn("memoryReview?.dispose()", native)
        self.assertIn("memoryReviewSession?.dispose()", native)
        self.assertNotIn("createMemoryReviewSession", web)
        self.assertNotIn("createMemoryReviewViewModel", web)
        self.assertIn("profileProvisioning,\n  null,\n  null,\n  surface.preferences,", web)

    def test_account_no_longer_consumes_host_capability_inventory(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertNotIn("contracts/surface-host.mjs", controls)
        self.assertNotIn("assertSurfaceHost", controls)
        self.assertNotIn("hostSnapshot", controls)
        self.assertNotIn('"Identidade do host"', controls)
        self.assertNotIn('"Protocolo de sync"', controls)
        self.assertNotIn('"Segredos de dispositivo"', controls)

    def test_signed_in_account_exposes_same_origin_data_export(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        catalog = ACCOUNT_CATALOG.read_text(encoding="utf-8")
        self.assertIn('sessionSnapshot.state === "signed-in"', controls)
        self.assertIn('exportLink.href = "/account/export"', controls)
        self.assertIn('exportLink.download = "ordax-account-export.json"', controls)
        self.assertIn('exportLink.dataset.accountExport = ""', controls)
        self.assertIn('"account.action.exportData"', catalog)
        self.assertIn('"Exportar meus dados"', catalog)
        self.assertIn('"Export my data"', catalog)

    def test_account_close_surface_is_server_capability_gated_and_transient(self):
        controls = ACCOUNT.read_text(encoding="utf-8")
        catalog = ACCOUNT_CATALOG.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")

        self.assertIn("assertAccountLifecyclePort", controls)
        self.assertIn(
            'isAccountLifecycleActionSupported(accountLifecycleSnapshot, "close-account")',
            controls,
        )
        self.assertIn('dataset.accountClosePassword = ""', controls)
        self.assertIn('dataset.accountCloseConfirmation = ""', controls)
        self.assertIn('dataset.accountCloseAction = ""', controls)
        self.assertIn('confirmation: "close-account"', controls)
        self.assertIn('closePasswordDraft = ""', controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)
        self.assertIn('"account.lifecycle.close.title": "Fechar Conta OrdaX"', catalog)
        self.assertIn('"account.lifecycle.close.title": "Close OrdaX Account"', catalog)
        for composition in (native, web):
            self.assertIn("createSameOriginAccountLifecycle", composition)
            self.assertIn("accountLifecycle,", composition)
            self.assertIn("accountLifecycle.dispose()", composition)

    def test_navigation_is_responsive_and_privacy_debug_list_was_removed(self):
        css = CSS.read_text(encoding="utf-8")
        controls = ACCOUNT.read_text(encoding="utf-8")
        self.assertIn(".ordax-account-navigation {", css)
        self.assertIn(".ordax-account-navigation-item", css)
        self.assertIn("overflow-x: auto", css)
        self.assertIn("@media (max-width: 760px)", css)
        self.assertNotIn("ordax-account-facts", css)
        self.assertNotIn("renderPrivacy", controls)

    def test_both_compositions_wire_same_account_activation_channel(self):
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")
        expected = (
            "root,\n"
            "    identitySession,\n"
            "    identityActions,\n"
            "    surface,\n"
            "    accountSync,\n"
            "    workspaceMetadata.source,\n"
            "    appActivation,"
        )
        self.assertIn(expected, native)
        self.assertIn("const accountSync = createNativeAccountSyncRuntime({", native)
        self.assertIn("accountMemoryFoundation,", native)
        self.assertIn("checkpointStore: syncCheckpointStore", native)
        self.assertIn("createNativeAccountSyncRuntime({", native)
        expected_web = (
            "root,\n"
            "  identitySession,\n"
            "  identityActions,\n"
            "  surface,\n"
            "  accountSync,\n"
            "  workspaceMetadata.source,\n"
            "  appActivation,"
        )
        self.assertIn(expected_web, web)
        self.assertIn("const accountSync = createAccountSyncRuntime({", web)
        self.assertIn("checkpointStore: syncCheckpointStore", web)
        self.assertIn("createAccountSyncRuntime({", web)
        self.assertNotIn(
            "root,\n    host,\n    identitySession,",
            native,
        )
        self.assertNotIn(
            "root,\n  host,\n  identitySession,",
            web,
        )


if __name__ == "__main__":
    unittest.main()
