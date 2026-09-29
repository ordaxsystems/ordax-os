#!/usr/bin/env python3
"""Narrow localization boundary for trusted Native security prompts."""

from __future__ import annotations

import json
import os
import stat

DEFAULT_PREFERENCES_PATH = "/var/lib/ordax/preferences.json"
DEFAULT_LOCALE = "pt-BR"
SUPPORTED_LOCALES = frozenset(("pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"))
MAX_PREFERENCES_BYTES = 64 * 1024

PROFILE_CONSENT_MESSAGES = {
    "pt-BR": {
        "windowTitle": "Confirmar ativação do perfil",
        "heading": "Confirme as alterações deste perfil",
        "cancel": "Cancelar",
        "approve": "Ativar perfil",
        "profile": "Perfil",
        "space": "Espaço",
        "componentsAdded": "Componentes adicionados",
        "authorityChanges": "Mudanças de autoridade",
        "component": "componente",
        "unknown": "desconhecido",
        "warning": "Esta confirmação vale somente para esta revisão e expira automaticamente.",
    },
    "en-US": {
        "windowTitle": "Confirm profile activation",
        "heading": "Confirm this profile's changes",
        "cancel": "Cancel",
        "approve": "Activate profile",
        "profile": "Profile",
        "space": "Space",
        "componentsAdded": "Components added",
        "authorityChanges": "Authority changes",
        "component": "component",
        "unknown": "unknown",
        "warning": "This confirmation applies only to this revision and expires automatically.",
    },
    "es-ES": {
        "windowTitle": "Confirmar activación del perfil",
        "heading": "Confirma los cambios de este perfil",
        "cancel": "Cancelar",
        "approve": "Activar perfil",
        "profile": "Perfil",
        "space": "Espacio",
        "componentsAdded": "Componentes añadidos",
        "authorityChanges": "Cambios de autoridad",
        "component": "componente",
        "unknown": "desconocido",
        "warning": "Esta confirmación solo se aplica a esta revisión y caduca automáticamente.",
    },
    "de-DE": {
        "windowTitle": "Profilaktivierung bestätigen",
        "heading": "Änderungen dieses Profils bestätigen",
        "cancel": "Abbrechen",
        "approve": "Profil aktivieren",
        "profile": "Profil",
        "space": "Space",
        "componentsAdded": "Hinzugefügte Komponenten",
        "authorityChanges": "Berechtigungsänderungen",
        "component": "Komponente",
        "unknown": "unbekannt",
        "warning": "Diese Bestätigung gilt nur für diese Revision und läuft automatisch ab.",
    },
    "fr-FR": {
        "windowTitle": "Confirmer l’activation du profil",
        "heading": "Confirmez les modifications de ce profil",
        "cancel": "Annuler",
        "approve": "Activer le profil",
        "profile": "Profil",
        "space": "Espace",
        "componentsAdded": "Composants ajoutés",
        "authorityChanges": "Modifications d’autorité",
        "component": "composant",
        "unknown": "inconnu",
        "warning": "Cette confirmation s’applique uniquement à cette révision et expire automatiquement.",
    },
}


def normalize_locale(value: object) -> str:
    return value if isinstance(value, str) and value in SUPPORTED_LOCALES else DEFAULT_LOCALE


def read_native_security_locale(path: str = DEFAULT_PREFERENCES_PATH) -> str:
    try:
        info = os.lstat(path)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            return DEFAULT_LOCALE
        if info.st_size <= 0 or info.st_size > MAX_PREFERENCES_BYTES:
            return DEFAULT_LOCALE
        with open(path, "rb") as handle:
            raw = handle.read(MAX_PREFERENCES_BYTES + 1)
        if len(raw) > MAX_PREFERENCES_BYTES:
            return DEFAULT_LOCALE
        preferences = json.loads(raw.decode("utf-8", errors="strict"))
    except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
        return DEFAULT_LOCALE
    if not isinstance(preferences, dict):
        return DEFAULT_LOCALE
    return normalize_locale(preferences.get("regional.locale"))


def profile_consent_messages(locale: object) -> dict[str, str]:
    normalized = normalize_locale(locale)
    return dict(PROFILE_CONSENT_MESSAGES[normalized])
