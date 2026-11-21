"""One canonical HTML rendering transform for the public-site bundle and legal digests.

CSS values are compiled by the established brand owner. This helper owns only
the deterministic link injection already performed by the public-site builder.
Legal-policy attestation hashes the exact emitted HTML, never an unrendered
source document with different bytes.
"""

BRAND_TOKENS_LINK = '<link rel="stylesheet" href="/assets/ordax-design-tokens.css">'


def render_public_html(markup: str) -> str:
    if not isinstance(markup, str):
        raise ValueError("public HTML must be text")
    if BRAND_TOKENS_LINK in markup:
        raise ValueError("brand tokens link already authored; use the build bridge")
    if markup.count("</head>") != 1:
        raise ValueError("public page requires one head for design tokens")
    return markup.replace("</head>", f"  {BRAND_TOKENS_LINK}\n</head>")
