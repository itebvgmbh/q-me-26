"""Rechnungen eines Ladens für "Mein Tarif": Liste, PDF (von Stripe) und E-Rechnung (XRechnung).

Nur Inhaber des Ladens (Betreiber dürfen alles). Jede Rechnung muss zum Stripe-Kunden des Ladens gehören,
sonst gibt es 404 – auch für Betreiber, damit nie eine fremde Rechnung unter einem Laden erscheint.
Rechtslage und Einstellungen im Stripe-Dashboard: deploy/README.md "Rechnungen".
"""

import re
from urllib.parse import urlparse

import requests
import stripe
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.apis.billing import _require_stripe, _shop, stripe_errors
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.libs.invoices import FINAL, NotSupported, build_xrechnung, summary
from app.libs.stripe_billing import client

router = APIRouter()

MAX_INVOICES = 120  # zehn Jahre Monatsrechnungen; reicht für die Aufbewahrungsfrist von acht Jahren
MAX_PDF_BYTES = 15 * 1024 * 1024
EXPAND = ["total_taxes.tax_rate_details.tax_rate"]  # Steuersatz in Prozent für die E-Rechnung


def _customer_id(shop_id: str) -> str | None:
    return (_shop(shop_id).get("billing") or {}).get("customerId")


def _stripe_host(url: str) -> bool:
    parts = urlparse(url)
    host = parts.hostname or ""
    return parts.scheme == "https" and (host == "stripe.com" or host.endswith(".stripe.com"))


def fetch_pdf(url: str) -> bytes:
    """PDF der Rechnung von Stripe holen (Link aus invoice_pdf, gilt nur kurz und nur für diese Rechnung)."""
    if not _stripe_host(url):
        raise HTTPException(status_code=502, detail="Die Rechnung lässt sich gerade nicht laden.")
    try:
        with requests.get(url, timeout=20, stream=True) as r:
            r.raise_for_status()
            if not _stripe_host(r.url):
                raise HTTPException(status_code=502, detail="Die Rechnung lässt sich gerade nicht laden.")
            data = b""
            for chunk in r.iter_content(64 * 1024):
                data += chunk
                if len(data) > MAX_PDF_BYTES:
                    raise HTTPException(status_code=502, detail="Die Rechnung lässt sich gerade nicht laden.")
    except requests.RequestException as e:
        print(f"Rechnungs-PDF nicht geladen: {e}")
        raise HTTPException(status_code=502, detail="Die Rechnung lässt sich gerade nicht laden. Bitte versuch es gleich noch einmal.") from e
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=502, detail="Die Rechnung lässt sich gerade nicht laden.")
    return data


def _invoice_of_shop(user, shop_id: str, invoice_id: str) -> dict:
    require_shop_of_owner(user, shop_id)
    if not re.fullmatch(r"in_[A-Za-z0-9]+", invoice_id or ""):
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden.")
    customer_id = _customer_id(shop_id)
    if not customer_id:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden.")
    _require_stripe()
    c = client()
    try:
        inv = c.v1.invoices.retrieve(invoice_id, params={"expand": EXPAND}).to_dict()
    except stripe.InvalidRequestError:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden.")
    if inv.get("customer") != customer_id or inv.get("status") not in FINAL:
        raise HTTPException(status_code=404, detail="Rechnung nicht gefunden.")
    lines = inv.get("lines") or {}
    if lines.get("has_more"):  # Stripe liefert die ersten 10 Positionen mit, den Rest nachladen
        rows = c.v1.invoices.line_items.list(invoice_id, params={"limit": 100}).auto_paging_iter()
        inv["lines"] = {"object": "list", "has_more": False, "data": [row.to_dict() for row in rows]}
    return inv


def _download(content: bytes, media_type: str, filename: str) -> Response:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
    return Response(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe}"', "Cache-Control": "private, no-store"},
    )


@router.get("/invoices/list")
@stripe_errors
def list_invoices(shop_id: str, user: AuthorizedUser) -> dict:
    """Ausgestellte Rechnungen des Ladens, neueste zuerst (ohne Entwürfe)."""
    require_shop_of_owner(user, shop_id)
    customer_id = _customer_id(shop_id)
    if not customer_id:
        return {"invoices": []}
    _require_stripe()
    page = client().v1.invoices.list(params={"customer": customer_id, "limit": 100, "expand": [f"data.{e}" for e in EXPAND]})
    rows = []
    for inv in page.auto_paging_iter():
        inv = inv.to_dict()
        if inv.get("status") in FINAL and inv.get("customer") == customer_id:
            rows.append(summary(inv))
        if len(rows) >= MAX_INVOICES:
            break
    return {"invoices": rows}


@router.get("/invoices/pdf")
@stripe_errors
def invoice_pdf(shop_id: str, invoice_id: str, user: AuthorizedUser) -> Response:
    """Die Rechnung als PDF, so wie Stripe sie ausgestellt und per E-Mail verschickt hat."""
    inv = _invoice_of_shop(user, shop_id, invoice_id)
    if not inv.get("invoice_pdf"):
        raise HTTPException(status_code=409, detail="Für diese Rechnung gibt es noch kein PDF.")
    return _download(fetch_pdf(inv["invoice_pdf"]), "application/pdf", f"Dranzeit-Rechnung-{inv['number']}.pdf")


@router.get("/invoices/xrechnung")
@stripe_errors
def invoice_xrechnung(shop_id: str, invoice_id: str, user: AuthorizedUser) -> Response:
    """Dieselbe Rechnung als E-Rechnung (XRechnung 3.0, CII) für Buchhaltungsprogramme."""
    inv = _invoice_of_shop(user, shop_id, invoice_id)
    try:
        xml = build_xrechnung(inv, buyer_reference=shop_id)
    except NotSupported as e:
        raise HTTPException(status_code=409, detail=f"Für diese Rechnung gibt es keine E-Rechnung: {e}") from e
    return _download(xml, "application/xml", f"Dranzeit-Rechnung-{inv['number']}-XRechnung.xml")
