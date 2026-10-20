"""Rechnungen der Läden aus Stripe: Übersicht für "Mein Tarif" und E-Rechnung (XRechnung 3.0, Syntax CII).

Stripe stellt die Rechnungen aus (Nummernkreis, PDF, E-Mail). Eine E-Rechnung nach EN 16931, wie sie das
Umsatzsteuergesetz im Inland ab 2027/2028 verlangt, liefert Stripe nicht. Sie entsteht hier aus denselben
Rechnungsdaten wie das Stripe-PDF, damit beide inhaltsgleich sind. Rechtslage: deploy/README.md "Rechnungen".

Stripe-Objekte kommen als dict an (Invoice mit total_taxes.tax_rate_details.tax_rate aufgeklappt).
Beträge rechnet Stripe in Cent; die Steuer übernehmen wir von Stripe und rechnen sie nicht neu.
"""

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

# Rechnungsaussteller. Gleich wie frontend/src/constants/legal.ts und wie im Stripe-Dashboard
# (Einstellungen -> Öffentliche Unternehmensinformationen), sonst weichen PDF und E-Rechnung voneinander ab.
SELLER = {
    "name": "ITEBV GmbH",
    "trading_name": "Dranzeit",
    "street": "Zehntwerderweg 201A",
    "postal_code": "13469",
    "city": "Berlin",
    "country": "DE",
    "managing_director": "Stefan Tittmann",
    "register_court": "Amtsgericht Berlin-Charlottenburg",
    "register_number": "HRB 236012 B",
    "vat_id": "DE348787952",
    "email": "st@mes-beratung.de",
    "phone": "+49 152 51874784",
}

XRECHNUNG_ID = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
BUSINESS_PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01.0"  # BT-23, verlangt die XRechnung (PEPPOL-EN16931-R001)
BERLIN = ZoneInfo("Europe/Berlin")
FINAL = ("open", "paid", "uncollectible", "void")  # Entwürfe haben noch keine Nummer und sind keine Rechnung
STATUS_DE = {"open": "offen", "paid": "bezahlt", "uncollectible": "uneinbringlich", "void": "storniert"}


class NotSupported(Exception):
    """Für diese Rechnung gibt es keine E-Rechnung (Grund im Text, für den Inhaber verständlich)."""


def _day(ts: int | None) -> date | None:
    return datetime.fromtimestamp(ts, tz=BERLIN).date() if ts else None


def _eur(cents: int) -> Decimal:
    return (Decimal(cents) / 100).quantize(Decimal("0.01"))


def issue_date(inv: dict) -> date | None:
    """Rechnungsdatum wie auf dem Stripe-PDF ("Rechnungsdatum")."""
    return _day(inv.get("effective_at") or (inv.get("status_transitions") or {}).get("finalized_at") or inv.get("created"))


def _lines(inv: dict) -> list[dict]:
    return (inv.get("lines") or {}).get("data") or []


def service_period(inv: dict) -> tuple[date | None, date | None]:
    """Leistungszeitraum: von der frühesten bis zur spätesten Position (Abo-Zeitraum, Anteile bei Wechsel)."""
    periods = [line.get("period") or {} for line in _lines(inv)]
    starts = [p["start"] for p in periods if p.get("start")]
    ends = [p["end"] for p in periods if p.get("end")]
    return _day(min(starts) if starts else None), _day(max(ends) if ends else None)


def _tax_total(inv: dict) -> int:
    return sum(t.get("amount") or 0 for t in inv.get("total_taxes") or [])


def summary(inv: dict) -> dict:
    """Eine Zeile der Rechnungsliste unter "Mein Tarif"."""
    start, end = service_period(inv)
    try:
        einvoice_check(inv)
        einvoice, why_not = True, None
    except NotSupported as e:
        einvoice, why_not = False, str(e)
    net = inv.get("total_excluding_tax")
    return {
        "id": inv["id"],
        "number": inv.get("number"),
        "date": (issue_date(inv) or date.today()).isoformat(),
        "periodStart": start.isoformat() if start else None,
        "periodEnd": end.isoformat() if end else None,
        "net": net if net is not None else (inv.get("total") or 0) - _tax_total(inv),
        "tax": _tax_total(inv),
        "total": inv.get("total") or 0,
        "currency": inv.get("currency") or "eur",
        "status": inv.get("status"),
        "statusText": STATUS_DE.get(inv.get("status"), inv.get("status")),
        "pdf": bool(inv.get("invoice_pdf")),
        "einvoice": einvoice,
        "einvoiceMissing": why_not,
    }


# ---------------------------------------------------------------- E-Rechnung


def _rate_percent(tax: dict) -> Decimal | None:
    rate = (tax.get("tax_rate_details") or {}).get("tax_rate")
    if isinstance(rate, dict) and rate.get("percentage") is not None:
        return Decimal(str(rate["percentage"])).quantize(Decimal("0.01"))
    return None


def _rate_id(tax: dict) -> str | None:
    rate = (tax.get("tax_rate_details") or {}).get("tax_rate")
    return rate.get("id") if isinstance(rate, dict) else rate


def _category(tax: dict, percent: Decimal | None) -> tuple[str, Decimal]:
    """Steuerkategorie nach EN 16931 (UNTDID 5305) aus Stripes Begründung."""
    reason = tax.get("taxability_reason")
    if reason == "reverse_charge":
        return "AE", Decimal("0.00")
    if reason in ("standard_rated", "reduced_rated") and percent is not None and percent > 0:
        return "S", percent
    raise NotSupported(f"Steuerfall „{reason}“ wird als E-Rechnung nicht unterstützt.")


def _buyer_vat_id(inv: dict) -> str | None:
    for tax_id in inv.get("customer_tax_ids") or []:
        if tax_id.get("type") == "eu_vat" and tax_id.get("value"):
            return tax_id["value"].replace(" ", "").upper()
    return None


def einvoice_check(inv: dict) -> None:
    """NotSupported, wenn aus dieser Rechnung keine gültige E-Rechnung entstehen kann."""
    if inv.get("status") not in ("open", "paid", "uncollectible"):
        raise NotSupported("Die Rechnung ist storniert oder noch nicht ausgestellt.")
    if not inv.get("number"):
        raise NotSupported("Die Rechnung hat noch keine Nummer.")
    if (inv.get("currency") or "").lower() != "eur":
        raise NotSupported("Nur Rechnungen in Euro.")
    if not inv.get("total"):
        raise NotSupported("Rechnung über 0 € (Testphase), dafür gibt es keine E-Rechnung.")
    address = inv.get("customer_address") or {}
    if not (inv.get("customer_name") and address.get("line1") and address.get("postal_code") and address.get("city") and address.get("country")):
        raise NotSupported("Name oder Anschrift fehlen auf der Rechnung.")
    if not _lines(inv) or (inv.get("lines") or {}).get("has_more"):
        raise NotSupported("Die Rechnungspositionen fehlen.")
    for line in _lines(inv):
        taxes = line.get("taxes") or []
        if len(taxes) != 1:
            raise NotSupported("Auf einer Position fehlt die Umsatzsteuer.")
        if taxes[0].get("tax_behavior") != "exclusive":
            raise NotSupported("Nur Nettopreise werden unterstützt.")
    rates = {_rate_id(t): _rate_percent(t) for t in inv.get("total_taxes") or []}
    categories = {_category(t, rates.get(_rate_id(t))) for line in _lines(inv) for t in line["taxes"]}
    if any(cat == "AE" for cat, _ in categories) and not _buyer_vat_id(inv):
        raise NotSupported("Für das Reverse-Charge-Verfahren fehlt die USt-IdNr. des Kunden.")


def _net_of(line: dict) -> int:
    """Nettobetrag der Position nach Rabatten (in Cent)."""
    credits = line.get("pretax_credit_amounts")
    if credits is None:
        credits = line.get("discount_amounts") or []
    return (line.get("amount") or 0) - sum(c.get("amount") or 0 for c in credits)


def build_xrechnung(inv: dict, buyer_reference: str) -> bytes:
    """XRechnung 3.0 (CII) aus einer finalen Stripe-Rechnung. Prüft gegen das XML-Schema (drafthorse).

    buyer_reference: Pflichtfeld der XRechnung (BT-10); hier die Kundennummer bei Dranzeit.
    """
    from drafthorse.models.accounting import ApplicableTradeTax, TradeAllowanceCharge
    from drafthorse.models.document import Document
    from drafthorse.models.note import IncludedNote
    from drafthorse.models.party import TaxRegistration
    from drafthorse.models.payment import PaymentMeans, PaymentTerms
    from drafthorse.models.tradelines import LineItem

    einvoice_check(inv)
    rates = {_rate_id(t): _rate_percent(t) for t in inv.get("total_taxes") or []}

    doc = Document()
    doc.context.business_parameter.id = BUSINESS_PROCESS
    doc.context.guideline_parameter.id = XRECHNUNG_ID
    doc.header.id = inv["number"]
    doc.header.type_code = "380"  # Rechnung
    doc.header.issue_date_time = issue_date(inv)
    doc.header.notes.add(
        IncludedNote(
            subject_code="REG",
            content=(
                f"{SELLER['name']}, Sitz {SELLER['city']}, {SELLER['register_court']} {SELLER['register_number']}, "
                f"Geschäftsführer: {SELLER['managing_director']}, USt-IdNr. {SELLER['vat_id']}"
            ),
        )
    )

    agreement = doc.trade.agreement
    agreement.buyer_reference = buyer_reference

    seller = agreement.seller
    seller.name = SELLER["name"]
    seller.description = f"{SELLER['register_court']} {SELLER['register_number']}, Geschäftsführer: {SELLER['managing_director']}"
    seller.legal_organization.id = SELLER["register_number"]
    seller.legal_organization.trade_name = SELLER["trading_name"]
    seller.contact.person_name = SELLER["managing_director"]
    seller.contact.telephone.number = SELLER["phone"]
    seller.contact.email.address = SELLER["email"]
    seller.address.line_one = SELLER["street"]
    seller.address.postcode = SELLER["postal_code"]
    seller.address.city_name = SELLER["city"]
    seller.address.country_id = SELLER["country"]
    seller.electronic_address.uri_ID = ("EM", SELLER["email"])
    seller.tax_registrations.add(TaxRegistration(id=("VA", SELLER["vat_id"])))

    address = inv["customer_address"]
    buyer = agreement.buyer
    buyer.name = inv["customer_name"]
    buyer.address.line_one = address["line1"]
    if address.get("line2"):
        buyer.address.line_two = address["line2"]
    buyer.address.postcode = address["postal_code"]
    buyer.address.city_name = address["city"]
    buyer.address.country_id = address["country"].upper()
    if inv.get("customer_email"):
        buyer.electronic_address.uri_ID = ("EM", inv["customer_email"])
    if _buyer_vat_id(inv):
        buyer.tax_registrations.add(TaxRegistration(id=("VA", _buyer_vat_id(inv))))

    settlement = doc.trade.settlement
    settlement.currency_code = "EUR"
    means = PaymentMeans(type_code="ZZZ")  # vereinbart: Stripe zieht ein (Karte oder SEPA-Lastschrift)
    means.information.add("Zahlung über Stripe per Karte oder SEPA-Lastschrift, wird automatisch eingezogen")
    settlement.payment_means.add(means)

    breakdown: dict[tuple[str, Decimal], dict] = {}
    line_total = 0
    for n, line in enumerate(_lines(inv), start=1):
        tax = line["taxes"][0]
        category, percent = _category(tax, rates.get(_rate_id(tax)))
        amount = line.get("amount") or 0
        quantity = Decimal(str(line.get("quantity_decimal") or line.get("quantity") or 1))
        if amount < 0:  # Gutschrift für nicht genutzte Zeit beim Tarifwechsel: Menge negativ, Preis positiv (BR-27)
            quantity = -quantity
        net = _net_of(line)
        discount = amount - net

        item = LineItem()
        item.document.line_id = str(n)
        item.product.name = line.get("description") or "Dranzeit-Abo"
        price = (_eur(amount) / quantity).quantize(Decimal("0.0001"))
        item.agreement.gross.amount = price
        item.agreement.net.amount = price
        item.delivery.billed_quantity = (quantity, "C62")  # C62 = Stück
        item.settlement.trade_tax.type_code = "VAT"
        item.settlement.trade_tax.category_code = category
        item.settlement.trade_tax.rate_applicable_percent = percent
        period = line.get("period") or {}
        if period.get("start") and period.get("end"):
            item.settlement.period.start = _day(period["start"])
            item.settlement.period.end = _day(period["end"])
        if discount:
            item.settlement.allowance_charge.add(TradeAllowanceCharge(indicator=False, actual_amount=_eur(discount), reason="Rabatt"))
        item.settlement.monetary_summation.total_amount = _eur(net)
        doc.trade.items.add(item)

        group = breakdown.setdefault((category, percent), {"basis": 0, "tax": 0})
        group["basis"] += net
        group["tax"] += tax.get("amount") or 0
        line_total += net

    for (category, percent), group in breakdown.items():
        trade_tax = ApplicableTradeTax()
        trade_tax.calculated_amount = _eur(group["tax"])
        trade_tax.basis_amount = _eur(group["basis"])
        trade_tax.type_code = "VAT"
        trade_tax.category_code = category
        if category == "AE":
            trade_tax.exemption_reason = "Steuerschuldnerschaft des Leistungsempfängers"
            trade_tax.exemption_reason_code = "VATEX-EU-AE"
        trade_tax.rate_applicable_percent = percent
        settlement.trade_tax.add(trade_tax)

    if any(category == "AE" for category, _ in breakdown):
        doc.header.notes.add(IncludedNote(content="Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)."))

    start, end = service_period(inv)
    if start and end:
        settlement.period.start = start
        settlement.period.end = end

    tax_total = sum(group["tax"] for group in breakdown.values())
    total = inv.get("total") or 0
    if line_total + tax_total != total:
        raise NotSupported("Die Beträge der Rechnung gehen nicht auf.")
    # Zu zahlen ist, was Stripe beim Ausstellen festgelegt hat (Guthaben aus Tarifwechseln schon abgezogen).
    # Bewusst nicht der Zahlungsstand: Die E-Rechnung soll nach dem Ausstellen immer gleich aussehen.
    due = inv.get("amount_due")
    if due is None:
        due = total
    terms = PaymentTerms()
    terms.description = "Wird automatisch per Karte oder SEPA-Lastschrift eingezogen."
    if inv.get("due_date"):
        terms.due = _day(inv["due_date"])
    settlement.terms.add(terms)

    sums = settlement.monetary_summation
    sums.line_total = _eur(line_total)
    sums.charge_total = Decimal("0.00")
    sums.allowance_total = Decimal("0.00")
    sums.tax_basis_total = _eur(line_total)
    sums.tax_total = (_eur(tax_total), "EUR")
    sums.grand_total = _eur(total)
    sums.prepaid_total = _eur(total - due)
    sums.due_amount = _eur(due)

    return doc.serialize(schema="FACTUR-X_EN16931")
