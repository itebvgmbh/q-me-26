"""
Tests für die Rechnungen unter "Mein Tarif": Liste, PDF, E-Rechnung (XRechnung), Zugriff nur für den Inhaber.
Ohne Firebase und ohne Stripe-Konto lauffähig (Stripe-Rechnungen als dict wie aus der API):

    cd backend && .venv/bin/python tests/test_invoices.py

Gegen die offiziellen Prüfregeln (EN 16931, XRechnung) prüft dev/e-rechnung-pruefen.py dieselben Beispiele.
"""
import copy
import os
import sys
from xml.etree import ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.libs.invoices import NotSupported, build_xrechnung, einvoice_check, summary  # noqa: E402

NS = {
    "rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
    "ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
    "udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
}
OKT_20 = 1792483200  # 20.10.2026 10:00 Uhr in Berlin
NOV_20 = 1795165200  # 20.11.2026 10:00 Uhr in Berlin
NOV_05 = 1793869200  # 05.11.2026 10:00 Uhr in Berlin
DEZ_20 = 1797757200  # 20.12.2026 10:00 Uhr in Berlin
OKT_20_2027 = 1824019200
RATE_19 = {"id": "txr_de19", "object": "tax_rate", "percentage": 19.0, "country": "DE", "tax_type": "vat"}
RATE_RC = {"id": "txr_rc", "object": "tax_rate", "percentage": 0.0, "country": "AT", "tax_type": "vat"}


def tax(amount, base, rate="txr_de19", reason="standard_rated"):
    return {"amount": amount, "tax_behavior": "exclusive", "taxability_reason": reason, "taxable_amount": base,
            "type": "tax_rate_details", "tax_rate_details": {"tax_rate": rate}}


def line(amount, description, start, end, taxes, discount=0):
    credits = [{"amount": discount, "type": "discount", "discount": "di_1"}] if discount else []
    return {"id": f"il_{abs(amount)}_{start}", "object": "line_item", "amount": amount, "subtotal": amount, "currency": "eur",
            "description": description, "quantity": 1, "period": {"start": start, "end": end},
            "discount_amounts": [{"amount": discount, "discount": "di_1"}] if discount else [], "pretax_credit_amounts": credits,
            "taxes": taxes}


def invoice(lines, total_taxes, status="paid", number="DZ-0001", **extra):
    net = sum(item["amount"] - sum(c["amount"] for c in item["pretax_credit_amounts"]) for item in lines)
    tax_sum = sum(t["amount"] for t in total_taxes)
    inv = {
        "id": "in_" + number.replace("-", ""), "object": "invoice", "number": number, "status": status, "currency": "eur",
        "created": OKT_20, "effective_at": OKT_20, "status_transitions": {"finalized_at": OKT_20},
        "customer": "cus_laden1", "customer_name": "Barbershop Kaya", "customer_email": "inhaber@example.com",
        "customer_address": {"line1": "Hauptstraße 1", "line2": None, "postal_code": "10115", "city": "Berlin", "country": "DE", "state": None},
        "customer_tax_ids": [], "total": net + tax_sum, "subtotal": net, "total_excluding_tax": net,
        "amount_due": net + tax_sum, "amount_paid": net + tax_sum if status == "paid" else 0,
        "amount_remaining": 0 if status == "paid" else net + tax_sum, "due_date": None,
        "total_taxes": total_taxes, "invoice_pdf": f"https://pay.stripe.com/invoice/acct_1/test_{number}/pdf?s=ap",
        "lines": {"object": "list", "has_more": False, "data": lines},
    }
    inv.update(extra)
    return inv


def samples() -> dict:
    """Typische Rechnungen eines Ladens, wie Stripe sie liefert (total_taxes mit aufgeklapptem Steuersatz)."""
    return {
        "monat-bezahlt": invoice(
            [line(3900, "1 × Dranzeit Laden (zu 39,00 € / Monat)", OKT_20, NOV_20, [tax(741, 3900)])],
            [{**tax(741, 3900), "tax_rate_details": {"tax_rate": RATE_19}}],
        ),
        "jahr-offen": invoice(
            [line(59000, "1 × Dranzeit Team (zu 590,00 € / Jahr)", OKT_20, OKT_20_2027, [tax(11210, 59000)])],
            [{**tax(11210, 59000), "tax_rate_details": {"tax_rate": RATE_19}}],
            status="open", number="DZ-0002",
        ),
        "jahr-mit-guthaben": invoice(  # 100 € Guthaben aus einem früheren Tarifwechsel verrechnet
            [line(59000, "1 × Dranzeit Team (zu 590,00 € / Jahr)", OKT_20, OKT_20_2027, [tax(11210, 59000)])],
            [{**tax(11210, 59000), "tax_rate_details": {"tax_rate": RATE_19}}],
            number="DZ-0009", amount_due=60210,
        ),
        "tarifwechsel": invoice(
            [
                line(-1950, "Nicht genutzte Zeit für Dranzeit Laden nach dem 5. Nov. 2026", NOV_05, NOV_20, [tax(-371, -1950)]),
                line(2950, "Verbleibende Zeit für Dranzeit Team nach dem 5. Nov. 2026", NOV_05, NOV_20, [tax(561, 2950)]),
                line(5900, "1 × Dranzeit Team (zu 59,00 € / Monat)", NOV_20, DEZ_20, [tax(1121, 5900)]),
            ],
            [{**tax(1311, 6900), "tax_rate_details": {"tax_rate": RATE_19}}],
            number="DZ-0003", effective_at=NOV_20,
        ),
        "rabatt": invoice(
            [line(3900, "1 × Dranzeit Laden (zu 39,00 € / Monat)", OKT_20, NOV_20, [tax(371, 1950)], discount=1950)],
            [{**tax(371, 1950), "tax_rate_details": {"tax_rate": RATE_19}}],
            number="DZ-0004",
        ),
        "reverse-charge": invoice(
            [line(39000, "1 × Dranzeit Laden (zu 390,00 € / Jahr)", OKT_20, OKT_20_2027, [tax(0, 39000, "txr_rc", "reverse_charge")])],
            [{**tax(0, 39000, "txr_rc", "reverse_charge"), "tax_rate_details": {"tax_rate": RATE_RC}}],
            number="DZ-0005", customer_name="Friseur Huber e.U.",
            customer_address={"line1": "Mariahilfer Straße 10", "line2": "Top 3", "postal_code": "1060", "city": "Wien", "country": "AT", "state": None},
            customer_tax_ids=[{"type": "eu_vat", "value": "ATU12345678"}],
        ),
    }


def unsupported() -> dict:
    trial = invoice([line(0, "Testzeitraum für Dranzeit Laden", OKT_20, NOV_20, [tax(0, 0)])],
                    [{**tax(0, 0), "tax_rate_details": {"tax_rate": RATE_19}}], number="DZ-0006")
    void = copy.deepcopy(samples()["monat-bezahlt"])
    void.update(status="void", number="DZ-0007")
    no_tax = invoice([line(3900, "1 × Dranzeit Laden (zu 39,00 € / Monat)", OKT_20, NOV_20, [tax(0, 3900, "txr_x", "not_collecting")])],
                     [{**tax(0, 3900, "txr_x", "not_collecting"), "tax_rate_details": {"tax_rate": {"id": "txr_x", "percentage": 0.0}}}],
                     number="DZ-0008")
    rc_without_id = copy.deepcopy(samples()["reverse-charge"])
    rc_without_id["customer_tax_ids"] = []
    return {"testphase": trial, "storniert": void, "ohne-steuer": no_tax, "reverse-charge-ohne-ustid": rc_without_id}


def parse(xml: bytes) -> ET.Element:
    return ET.fromstring(xml)


def text(root, path):
    found = root.find(path, NS)
    return found.text if found is not None else None


def test_liste_zeigt_pflichtangaben():
    row = summary(samples()["monat-bezahlt"])
    assert row["number"] == "DZ-0001" and row["date"] == "2026-10-20"
    assert (row["periodStart"], row["periodEnd"]) == ("2026-10-20", "2026-11-20")
    assert (row["net"], row["tax"], row["total"]) == (3900, 741, 4641)
    assert row["statusText"] == "bezahlt" and row["pdf"] and row["einvoice"]


def test_liste_testphase_ohne_e_rechnung():
    row = summary(unsupported()["testphase"])
    assert row["einvoice"] is False and "0 €" in row["einvoiceMissing"]
    assert summary(unsupported()["storniert"])["statusText"] == "storniert"


def test_xrechnung_monat():
    root = parse(build_xrechnung(samples()["monat-bezahlt"], "laden1"))
    assert text(root, ".//rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID").endswith("xrechnung_3.0")
    assert text(root, ".//rsm:ExchangedDocument/ram:ID") == "DZ-0001"
    assert text(root, ".//rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString") == "20261020"
    assert text(root, ".//ram:BuyerReference") == "laden1"
    seller = root.find(".//ram:SellerTradeParty", NS)
    assert text(seller, "ram:Name") == "ITEBV GmbH"
    assert text(seller, "ram:SpecifiedTaxRegistration/ram:ID") == "DE348787952"
    assert text(seller, "ram:SpecifiedLegalOrganization/ram:ID") == "HRB 236012 B"
    assert text(root, ".//ram:BuyerTradeParty/ram:Name") == "Barbershop Kaya"
    assert text(root, ".//ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CityName") == "Berlin"
    # Leistungszeitraum, Steuersatz und -betrag, Summen
    assert text(root, ".//ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString") == "20261120"
    vat = root.find(".//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax", NS)
    assert (text(vat, "ram:CategoryCode"), text(vat, "ram:RateApplicablePercent")) == ("S", "19.00")
    assert (text(vat, "ram:BasisAmount"), text(vat, "ram:CalculatedAmount")) == ("39.00", "7.41")
    sums = root.find(".//ram:SpecifiedTradeSettlementHeaderMonetarySummation", NS)
    assert text(sums, "ram:GrandTotalAmount") == "46.41"
    assert (text(sums, "ram:TotalPrepaidAmount"), text(sums, "ram:DuePayableAmount")) == ("0.00", "46.41")


def test_xrechnung_unabhaengig_vom_zahlungsstand():
    offen = copy.deepcopy(samples()["monat-bezahlt"])
    offen.update(status="open", amount_paid=0, amount_remaining=4641)
    assert build_xrechnung(offen, "laden1") == build_xrechnung(samples()["monat-bezahlt"], "laden1")


def test_xrechnung_guthaben_aus_tarifwechsel():
    sums = parse(build_xrechnung(samples()["jahr-mit-guthaben"], "laden1")).find(".//ram:SpecifiedTradeSettlementHeaderMonetarySummation", NS)
    assert (text(sums, "ram:TotalPrepaidAmount"), text(sums, "ram:DuePayableAmount")) == ("100.00", "602.10")


def test_xrechnung_offene_jahresrechnung():
    sums = parse(build_xrechnung(samples()["jahr-offen"], "laden1")).find(".//ram:SpecifiedTradeSettlementHeaderMonetarySummation", NS)
    assert text(sums, "ram:GrandTotalAmount") == "702.10" and text(sums, "ram:DuePayableAmount") == "702.10"


def test_xrechnung_tarifwechsel_mit_gutschrift():
    root = parse(build_xrechnung(samples()["tarifwechsel"], "laden1"))
    lines = root.findall(".//ram:IncludedSupplyChainTradeLineItem", NS)
    assert len(lines) == 3
    credit = lines[0]
    assert text(credit, ".//ram:BilledQuantity") == "-1"
    assert text(credit, ".//ram:NetPriceProductTradePrice/ram:ChargeAmount") == "19.5000"  # Preis nie negativ
    assert text(credit, ".//ram:LineTotalAmount") == "-19.50"
    assert text(root, ".//ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString") == "20261105"
    assert text(root, ".//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount") == "82.11"


def test_xrechnung_rabatt():
    item = parse(build_xrechnung(samples()["rabatt"], "laden1")).find(".//ram:IncludedSupplyChainTradeLineItem", NS)
    allowance = item.find(".//ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeAllowanceCharge", NS)
    assert text(allowance, "ram:ChargeIndicator/udt:Indicator") == "false"
    assert text(allowance, "ram:ActualAmount") == "19.50"
    assert text(item, ".//ram:LineTotalAmount") == "19.50"


def test_xrechnung_reverse_charge():
    root = parse(build_xrechnung(samples()["reverse-charge"], "laden1"))
    vat = root.find(".//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax", NS)
    assert text(vat, "ram:CategoryCode") == "AE" and text(vat, "ram:ExemptionReasonCode") == "VATEX-EU-AE"
    assert text(root, ".//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID") == "ATU12345678"
    notes = [n.text for n in root.findall(".//rsm:ExchangedDocument/ram:IncludedNote/ram:Content", NS)]
    assert any("Steuerschuldnerschaft des Leistungsempfängers" in n for n in notes)


def test_keine_e_rechnung_wenn_nicht_moeglich():
    for name, inv in unsupported().items():
        try:
            einvoice_check(inv)
        except NotSupported:
            continue
        raise AssertionError(f"{name}: hätte abgelehnt werden müssen")


def test_beträge_müssen_aufgehen():
    inv = copy.deepcopy(samples()["monat-bezahlt"])
    inv["total"] = 4700
    try:
        build_xrechnung(inv, "laden1")
    except NotSupported:
        return
    raise AssertionError("abweichende Summe nicht bemerkt")


# ---------------------------------------------------------------- Endpunkte (Stripe und Firestore nachgebildet)


class FakeSnap:
    def __init__(self, data):
        self.exists, self._data = data is not None, data

    def to_dict(self):
        return self._data


class FakeDb:
    def __init__(self, shops):
        self.shops = shops

    def collection(self, _name):
        shops = self.shops
        return type("Coll", (), {"document": lambda _s, doc_id: type("Ref", (), {"get": lambda _r: FakeSnap(shops.get(doc_id))})()})()


class FakeStripeObject(dict):
    def to_dict(self):
        return dict(self)


class FakeInvoices:
    def __init__(self, invoices):
        self.invoices = {inv["id"]: inv for inv in invoices}
        self.calls = []

    def list(self, params):
        self.calls.append(("list", params))
        rows = [FakeStripeObject(inv) for inv in self.invoices.values() if inv["customer"] == params["customer"]]
        return type("Page", (), {"auto_paging_iter": lambda _s: iter(rows)})()

    def retrieve(self, invoice_id, params=None):
        self.calls.append(("retrieve", invoice_id, params))
        if invoice_id not in self.invoices:
            import stripe

            raise stripe.InvalidRequestError("No such invoice", "id")
        return FakeStripeObject(self.invoices[invoice_id])


def client_with(shops, invoices, user_uid="owner1", pdf=b"%PDF-1.7 Stripe-Rechnung"):
    import app.apis.billing as billing
    import app.apis.invoices as api
    from databutton_app.mw.auth_mw import get_authorized_user

    fake = FakeInvoices(invoices)
    stripe_client = type("C", (), {"v1": type("V1", (), {"invoices": fake})()})()
    os.environ["STRIPE_SECRET_KEY"] = "sk_test_attrappe"
    db = FakeDb(shops)
    billing.get_firestore_db = lambda: db
    import app.auth.access as access
    import app.apis.firebase_utils as fu

    fu.get_firestore_db = lambda: db
    access.is_admin = lambda _u: False
    api.client = lambda: stripe_client
    api.fetch_pdf = lambda url: pdf
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    user = type("User", (), {"sub": user_uid, "email": f"{user_uid}@example.com"})()
    app.dependency_overrides[get_authorized_user] = lambda: user
    return TestClient(app), fake


def shops():
    return {
        "laden1": {"owner": "owner1", "name": "Barbershop Kaya", "billing": {"customerId": "cus_laden1"}},
        "laden2": {"owner": "owner2", "name": "Fremder Laden", "billing": {"customerId": "cus_laden2"}},
        "neu": {"owner": "owner1", "name": "Ohne Abo"},
    }


def all_invoices():
    other = copy.deepcopy(samples()["monat-bezahlt"])
    other.update(id="in_fremd", customer="cus_laden2", number="DZ-0099")
    draft = copy.deepcopy(samples()["monat-bezahlt"])
    draft.update(id="in_entwurf", status="draft", number=None)
    return [samples()["monat-bezahlt"], samples()["jahr-offen"], unsupported()["testphase"], other, draft]


def test_endpunkt_liste_nur_eigene_und_finale():
    c, _ = client_with(shops(), all_invoices())
    r = c.get("/routes/invoices/list", params={"shop_id": "laden1"})
    assert r.status_code == 200, r.text
    numbers = [row["number"] for row in r.json()["invoices"]]
    assert sorted(numbers) == ["DZ-0001", "DZ-0002", "DZ-0006"]  # ohne Entwurf, ohne fremde


def test_endpunkt_liste_ohne_abo_leer():
    c, fake = client_with(shops(), all_invoices())
    r = c.get("/routes/invoices/list", params={"shop_id": "neu"})
    assert r.status_code == 200 and r.json()["invoices"] == [] and fake.calls == []


def test_endpunkt_fremder_laden_verboten():
    c, _ = client_with(shops(), all_invoices())
    assert c.get("/routes/invoices/list", params={"shop_id": "laden2"}).status_code == 403
    assert c.get("/routes/invoices/pdf", params={"shop_id": "laden2", "invoice_id": "in_fremd"}).status_code == 403


def test_endpunkt_fremde_rechnung_ueber_eigenen_laden_verboten():
    c, _ = client_with(shops(), all_invoices())
    r = c.get("/routes/invoices/pdf", params={"shop_id": "laden1", "invoice_id": "in_fremd"})
    assert r.status_code == 404
    assert c.get("/routes/invoices/xrechnung", params={"shop_id": "laden1", "invoice_id": "in_gibtsnicht"}).status_code == 404


def test_endpunkt_pdf():
    c, _ = client_with(shops(), all_invoices())
    r = c.get("/routes/invoices/pdf", params={"shop_id": "laden1", "invoice_id": "in_DZ0001"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert 'filename="Dranzeit-Rechnung-DZ-0001.pdf"' in r.headers["content-disposition"]


def test_endpunkt_xrechnung():
    c, fake = client_with(shops(), all_invoices())
    r = c.get("/routes/invoices/xrechnung", params={"shop_id": "laden1", "invoice_id": "in_DZ0001"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/xml")
    assert 'filename="Dranzeit-Rechnung-DZ-0001-XRechnung.xml"' in r.headers["content-disposition"]
    assert text(parse(r.content), ".//ram:BuyerReference") == "laden1"
    retrieve = [call for call in fake.calls if call[0] == "retrieve"][0]
    assert "total_taxes.tax_rate_details.tax_rate" in retrieve[2]["expand"]


def test_endpunkt_xrechnung_testphase_abgelehnt():
    c, _ = client_with(shops(), all_invoices())
    r = c.get("/routes/invoices/xrechnung", params={"shop_id": "laden1", "invoice_id": "in_DZ0006"})
    assert r.status_code == 409 and "0 €" in r.json()["detail"]


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
