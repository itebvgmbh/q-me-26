"""Tarife von Dranzeit – gleiche Regeln wie frontend/src/utils/plans.ts. Änderungen immer an beiden Stellen.

Wirksamer Tarif eines Ladens:
1. Bezahltes Abo (billing.status active/trialing/past_due) → dessen Tarif
2. Testphase (trialEndsAt in der Zukunft) → alles wie "team"
3. sonst "gratis"
Läden von vor der Einführung der Tarife testen ab TARIFF_LAUNCH 30 Tage.
"""

from datetime import datetime, timedelta, timezone

PLANS = {
    "gratis": {"name": "Gratis", "monthly": 0, "yearly": 0, "max_staff": 1, "max_customers_per_month": 100, "features": set()},
    "solo": {"name": "Solo", "monthly": 19, "yearly": 190, "max_staff": 1, "max_customers_per_month": None,
             "features": {"termine", "frueherDran", "benachrichtigung", "erinnerung"}},
    "laden": {"name": "Laden", "monthly": 39, "yearly": 390, "max_staff": 4, "max_customers_per_month": None,
              "features": {"termine", "frueherDran", "benachrichtigung", "erinnerung", "team", "bildschirm", "auswertung"}},
    "team": {"name": "Team", "monthly": 59, "yearly": 590, "max_staff": 10, "max_customers_per_month": None,
             "features": {"termine", "frueherDran", "benachrichtigung", "erinnerung", "team", "bildschirm", "auswertung"}},
}
PAID_PLANS = ("solo", "laden", "team")
ACTIVE_BILLING = ("active", "trialing", "past_due")
TRIAL_DAYS = 30
FOUNDER_LIMIT = 100
FOUNDER_TRIAL_DAYS = 90
TARIFF_LAUNCH = datetime(2026, 10, 19, 22, 0, tzinfo=timezone.utc)  # 20.10.2026 00:00 deutscher Zeit


def _aware(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def trial_end(shop: dict) -> datetime:
    explicit = _aware(shop.get("trialEndsAt"))
    if explicit:
        return explicit
    created = _aware(shop.get("createdAt")) or TARIFF_LAUNCH
    return max(created, TARIFF_LAUNCH) + timedelta(days=TRIAL_DAYS)


def effective_plan(shop: dict | None, now: datetime | None = None) -> str:
    """Name des wirksamen Tarifs: gratis | solo | laden | team."""
    if shop is None:
        return "gratis"
    now = now or datetime.now(timezone.utc)
    billing = shop.get("billing") or {}
    if billing.get("plan") in PAID_PLANS and billing.get("status") in ACTIVE_BILLING:
        return billing["plan"]
    if trial_end(shop) > now:
        return "team"
    return "gratis"


def has_feature(shop: dict | None, feature: str, now: datetime | None = None) -> bool:
    return feature in PLANS[effective_plan(shop, now)]["features"]
