"""Read-only commercial presentation from the existing entitlement authority.

Reference prices/capacity never issue grants or enable purchases. This renderer
is shared by the landing page and Account; neither keeps its own offer table.
"""
from __future__ import annotations

from html import escape
import json
from pathlib import Path

CONTRACT = Path(__file__).resolve().parents[2] / "docs/contracts/entitlements.json"
PLAN_IDS = ("free", "personal", "professional", "team")


def load_catalog(path: Path = CONTRACT) -> dict:
    contract = json.loads(path.read_text(encoding="utf-8"))
    catalog = contract["plan_catalog"]
    plans = catalog["plans"]
    if tuple(plan["id"] for plan in plans) != PLAN_IDS:
        raise ValueError("commercial catalog requires the canonical four plans")
    if catalog["purchasable_paid_plans_enabled"] is not False:
        raise ValueError("reference catalog cannot enable purchases")
    if contract["commercial_policy"]["billing_implemented"] is not False:
        raise ValueError("reference catalog requires a separate billing activation change")
    if catalog["commercial_capacity_allocation_enabled"] is not False:
        raise ValueError("reference capacities cannot allocate paid quotas")
    ids = set(PLAN_IDS)
    for offer in [plan["commercial_offer"] for plan in plans] + catalog["additional_offers"]:
        if offer["status"] != "reference-not-purchasable":
            raise ValueError("offer must declare its reference-only status")
        amount = offer.get("monthly_price_minor")
        if amount is not None and (type(amount) is not int or not 0 <= amount <= 100_000_000):
            raise ValueError("reference price must use bounded integer minor units")
        if offer["currency"] != "BRL":
            raise ValueError("reference catalog currency must be BRL")
        if not set(offer.get("included_in", [])).issubset(ids):
            raise ValueError("offer includes an unknown plan")
        capacity = offer.get("reference_capacity", {})
        for key, value in capacity.items():
            if type(value) is not int or not 0 <= value <= 1_000_000_000_000_000:
                raise ValueError("reference capacity must use bounded nonnegative integers")
    additional_ids = [offer["id"] for offer in catalog["additional_offers"]]
    if len(additional_ids) != len(set(additional_ids)) or set(additional_ids) & ids:
        raise ValueError("additional offer IDs must be unique")
    return catalog


def money(amount: int | None) -> str:
    if amount is None:
        return "Preço a definir"
    if amount == 0:
        return "Sem mensalidade"
    return "R$ " + f"{amount // 100:,}".replace(",", ".") + f",{amount % 100:02d}"


def row(label: str, value: object) -> str:
    return "<li><span>" + escape(label) + '</span><strong translate="no">' + escape(str(value)) + "</strong></li>"


def render_catalog(catalog: dict, *, include_additional: bool = True) -> str:
    cards = []
    for plan in catalog["plans"]:
        offer = plan["commercial_offer"]
        limits = plan["baseline_entitlements"]
        capacity = offer["reference_capacity"]
        features = [row("Spaces ativos", limits["spaces.active.max"])]
        if plan["id"] != "free":
            features.extend([
                row("Armazenamento previsto (GB)", capacity["storage_bytes"] // 1_000_000_000),
                row("Chamadas MCP por mês", capacity["mcp_calls_monthly"]),
                row("Histórico previsto (dias)", capacity["history_days"]),
                row("Conectores gerenciados", limits["connectors.max"]),
                row("Automações ativas", limits["automations.max"]),
                row("Capacidade de membros por Space", limits["spaces.members.max"]),
            ])
        cards.append('<li class="commercial-plan" data-plan-id="' + escape(plan["id"], quote=True) + '">'
            '<span class="status-tag">' + ("Experiência local" if plan["id"] == "free" else "Em preparação") + "</span>"
            '<h3 translate="no">' + escape(plan["display_name"]) + "</h3>"
            '<p class="plan-price">' + (escape(money(offer["monthly_price_minor"])) if plan["id"] == "free" else '<span translate="no">' + money(offer["monthly_price_minor"]) + '</span> <small>' + ("por organização / mês" if plan["id"] == "team" else "por mês") + "</small>") + "</p>"
            '<p class="plan-detail">' + escape(offer["summary"]) + "</p>"
            '<ul class="commercial-features">' + "".join(features) + "</ul>"
            '<p class="commercial-availability">' + ("Uso local conforme a disponibilidade do produto." if plan["id"] == "free" else "Benefícios online previstos; contratação indisponível.") + "</p></li>")
    result = '<div class="commercial-catalog"><p class="commercial-notice">Planos em preparação. Valores e capacidades de referência; nenhuma cobrança é realizada.</p><ul class="plan-catalog">' + "".join(cards) + "</ul>"
    result += '<p class="commercial-note">IA paga pelo cliente ou por créditos separados. Versões e backups pessoais compartilham a capacidade de arquivos. Assentos e cotas de memória serão definidos antes da contratação.</p>'
    if include_additional:
        result += '<h3>Produtos e adicionais</h3><ul class="commercial-additions">'
        for offer in catalog["additional_offers"]:
            result += '<li data-offer-id="' + escape(offer["id"], quote=True) + '"><h4>' + escape(offer["display_name"]) + '</h4><p class="plan-price">' + escape(money(offer["monthly_price_minor"])) + '</p><p>' + escape(offer["summary"]) + '</p><span class="status-tag">Em preparação</span></li>'
        result += "</ul>"
    return result + "</div>"
