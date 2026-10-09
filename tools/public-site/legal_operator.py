"""One source of truth for identifying the legally responsible OrdaX operator.

A declaration of operation as a natural person does NOT prove their identity.
These checks guard publication and activation; no personal secret is logged.
"""

import re

_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+\Z")


def operator_blockers(value: object) -> list[str]:
    if not isinstance(value, dict):
        return ["legal-operator-form", "legal-operator-identity-review",
                "legal-operator-contact-verification", "legal-operator-name",
                "legal-operator-contact"]
    blockers = []
    if value.get("legal_form") != "natural_person":
        blockers.append("legal-operator-form")
    if value.get("identity_reviewed") is not True:
        blockers.append("legal-operator-identity-review")
    if value.get("privacy_contact_verified") is not True:
        blockers.append("legal-operator-contact-verification")
    name = value.get("legal_name")
    if not isinstance(name, str) or not name.strip():
        blockers.append("legal-operator-name")
    contact = value.get("privacy_contact_email")
    if not isinstance(contact, str) or _EMAIL_RE.fullmatch(contact) is None:
        blockers.append("legal-operator-contact")
    return blockers
