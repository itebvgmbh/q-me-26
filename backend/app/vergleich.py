"""Vergleichsseite "Buchungsplattformen für Friseure": Kosten, Provision und Laufkundschaft, mit Kostenrechner.

Fängt Suchen wie "friseursoftware", "salonsoftware", "planity kosten", "treatwell kosten" und "treatwell alternative"
ab (wenig umkämpft, DataForSEO November 2026) und führt Inhaber zur Anmeldung.

Das ist vergleichende Werbung eines Mitbewerbers (§ 6 UWG), deshalb: Jede Angabe über andere Anbieter hat eine Quelle
in QUELLEN, Absender und Gewichtung stehen offen auf der Seite, "nicht ausgewiesen" heißt nie "gibt es nicht", und
Wörter wie "Testsieger" oder "unabhängig" kommen nicht vor. Preise veralten: ANBIETER, STAND und STAND_ISO zusammen
pflegen. Die Reihenfolge rechnet punkte() aus den Daten aus, von Hand steht sie nirgends.

Fertiges HTML vom Server wie die Stadtseiten (app/seo.py). Erreichbar unter /vergleich/… (Caddy, deploy/caddy-domain.py)
und unter /routes/seo/vergleich/…
"""

import json

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app import seo

BASE_PATH = "/vergleich"
PFAD = BASE_PATH + "/buchungsplattformen-friseure"
STAND = "1. November 2026"
STAND_ISO = "2026-11-01"
# Fresha zeigt auch auf der deutschen Preisseite US-Dollar; EZB-Referenzkurs vom 30.10.2026
USD_JE_EUR = 1.1172
ANMELDEN = "/register-shop-owner"

router = APIRouter(include_in_schema=False)


def _usd(wert: float) -> float:
    return round(wert / USD_JE_EUR, 2)


QUELLEN = [
    ("dranzeit", "Dranzeit: Preise und Tarife", "/preise"),
    ("dranzeit-fragen", "Dranzeit: Häufige Fragen von Läden", "/hilfe/fragen-fuer-laeden"),
    ("treatwell", "Treatwell: Preise für Partner", "https://www.treatwell.de/partners/preise/"),
    ("treatwell-partner", "Treatwell: Partner-Seite (Reichweite)", "https://www.treatwell.de/partners/"),
    ("planity-pabau", "Pabau: Planity Kosten, Stand 13.10.2026 (Pabau ist selbst Anbieter)", "https://pabau.com/de/blog/planity-kosten/"),
    ("planity-studiolution", "studiolution: Vergleich mit Planity, Stand März 2026 (studiolution ist selbst Anbieter)", "https://www.studiolution.com/vergleich/planity/"),
    ("planity-basic", "BASIC thinking: Planity, 02.03.2026", "https://www.basicthinking.de/blog/2026/03/02/planity-die-all-in-one-software-fuer-kosmetikstudios/"),
    ("fresha", "Fresha: Preise", "https://www.fresha.com/de/pricing"),
    ("fresha-plan", "Fresha: Up Next 2026, zuletzt aktualisiert 14.01.2026", "https://www.fresha.com/blog/Up-Next-2026"),
    ("booksy", "Booksy Biz Deutschland", "https://biz.booksy.com/de-de/"),
    ("booksy-boost", "Booksy: Boost (britische Seite)", "https://biz.booksy.com/en-gb/features/boost"),
    ("booksy-warteliste", "Booksy: So funktioniert die Warteliste", "https://support.booksy.com/hc/en-gb/articles/16463469277714-How-does-the-waitlist-work"),
    ("shore", "Shore: Preise", "https://www.shore.com/de/preise/"),
    ("salonkee", "Salonkee: Preise", "https://salonkee.com/pro/de/preise/"),
    ("salonkee-profil", "Friseur-News: Salonkee-Profil, August 2026 (Anbieterangaben)", "https://friseur-news.de/2026/08/salonkee-terminsoftware/"),
    ("ezb", "Europäische Zentralbank: Referenzkurs vom 30.10.2026 (1 € = 1,1172 $)", "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"),
]
QUELLE_NR = {schluessel: i + 1 for i, (schluessel, _, _) in enumerate(QUELLEN)}


# preis: fest | stufen [bis Personen, Preis] | solo/erste/weitere (je Person). provision: Satz und Mindestbetrag je Neukunde.
# laufkundschaft: "nummer" = Kunden ziehen selbst eine Nummer, "warteliste" = nur Warteliste für frei werdende Plätze.
ANBIETER = {
    "dranzeit": {
        "name": "Dranzeit", "url": "/", "preis": {"stufen": [[1, 19], [4, 39], [10, 59]]}, "provision": None,
        "laufkundschaft": "nummer", "preis_oeffentlich": True, "monatlich": True, "gratis": True, "test_tage": 30,
        "kasse": False, "online_zahlung": False, "marktplatz": False,
        "kurz": "Für Läden mit Laufkundschaft gebaut: Nummer ziehen, Termine und Aufruf an einem Ort, ohne Provision.",
        "passt": "Friseure und Barbershops, zu denen Kunden auch spontan kommen",
        "rechner_hinweis": "Solo, Laden oder Team",
    },
    "treatwell": {
        "name": "Treatwell", "url": "https://www.treatwell.de/partners/", "preis": {"fest": 39}, "provision": {"satz": 0.35, "min": 0},
        "laufkundschaft": None, "preis_oeffentlich": True, "monatlich": True, "gratis": False, "test_tage": 0,
        "kasse": True, "online_zahlung": True, "marktplatz": True,
        "kurz": "Viel Reichweite, laut Treatwell täglich eine halbe Million Suchende. Dafür 35 % auf die erste Buchung neuer Kunden.",
        "passt": "Salons mit freien Terminen, die Neukunden über einen Marktplatz gewinnen wollen",
        "rechner_hinweis": "Starter",
    },
    "planity": {
        "name": "Planity", "url": "https://www.planity.com/de-DE", "preis": {"fest": 69}, "provision": None,
        "laufkundschaft": None, "preis_oeffentlich": False, "monatlich": False, "gratis": False, "test_tage": 0,
        "kasse": True, "online_zahlung": True, "marktplatz": True,
        "kurz": "Kalender, Kasse und Terminal im Paket, laut Planity ohne Provision. Einen Preis erfährst du erst im Beratungsgespräch.",
        "passt": "Salons, die Kasse und Kalender im Paket und persönliche Beratung wollen",
        "rechner_hinweis": "Preis laut Drittquelle",
    },
    "fresha": {
        "name": "Fresha", "url": "https://www.fresha.com/de", "preis": {"solo": _usd(19.95), "erste": _usd(14.95), "weitere": _usd(14.95)},
        "provision": {"satz": 0.20, "min": _usd(6)},
        "laufkundschaft": "warteliste", "preis_oeffentlich": True, "monatlich": True, "gratis": False, "test_tage": 7,
        "kasse": True, "online_zahlung": True, "marktplatz": True,
        "kurz": "Für eine Person günstig, mit Kasse und Marktplatz. Dafür 20 % auf Marktplatz-Neukunden und ein Preis je Person.",
        "passt": "Kleine Salons, die Online-Zahlung wollen und Provision einplanen",
        "rechner_hinweis": "umgerechnet aus US-Dollar",
    },
    "booksy": {
        "name": "Booksy", "url": "https://biz.booksy.com/de-de/", "preis": {"solo": 35, "erste": 35, "weitere": 7}, "provision": None,
        "laufkundschaft": "warteliste", "preis_oeffentlich": True, "monatlich": True, "gratis": False, "test_tage": 7,
        "kasse": False, "online_zahlung": False, "marktplatz": True,
        "kurz": "Klarer Preis mit Aufschlag je Person, eigene Kunden-App und Warteliste für frei werdende Termine.",
        "passt": "Kleine Teams, deren Kunden gern im Voraus per App buchen",
        "rechner_hinweis": "ohne Boost",
    },
    "shore": {
        "name": "Shore", "url": "https://www.shore.com/de/", "preis": {"fest": 59.90}, "provision": None,
        "laufkundschaft": None, "preis_oeffentlich": True, "monatlich": True, "gratis": False, "test_tage": 14,
        "kasse": True, "online_zahlung": True, "marktplatz": False,
        "kurz": "Buchung, Marketing und Kasse in Paketen, ohne ausgewiesene Provision. Ein Marktplatz für Neukunden ist nicht ausgewiesen.",
        "passt": "Betriebe, die Stammkunden pflegen und Marketing-Werkzeuge brauchen",
        "rechner_hinweis": "Booking, monatlich gezahlt",
    },
    "salonkee": {
        "name": "Salonkee", "url": "https://salonkee.com/pro/de/", "preis": {"fest": 59}, "provision": None,
        "laufkundschaft": "warteliste", "preis_oeffentlich": True, "monatlich": True, "gratis": False, "test_tage": 14,
        "kasse": True, "online_zahlung": True, "marktplatz": True,
        "kurz": "Sehr breites Paket mit Warteliste, Marktplatz, Kasse und Online-Zahlung, laut Anbieter ohne Provision.",
        "passt": "Salons und Ketten, die alles aus einer Hand wollen",
        "rechner_hinweis": "Ab-Preis, Go-Paket",
    },
}

KRITERIEN = [
    ("laufkundschaft", "Laufkundschaft", 30, "Kunden ziehen selbst eine Nummer vom Handy: 30. Nur Warteliste für frei werdende Plätze: 6. Nichts ausgewiesen: 0."),
    ("kosten", "Monatspreis bei 4 Personen", 20, "Der günstigste Grundpreis ohne Neukunden bekommt 20, die anderen anteilig."),
    ("provision", "Provision auf Neukunden", 15, "0 % ergibt 15, der höchste ausgewiesene Satz (35 %) ergibt 0, dazwischen anteilig. Maßgeblich ist die deutsche Preisseite."),
    ("transparenz", "Offener Preis und kurze Bindung", 10, "5 für einen öffentlichen Preis, 5 für einen ausgewiesenen monatlich kündbaren Vertrag."),
    ("einstieg", "Einstieg ohne Risiko", 5, "3 für einen dauerhaft kostenlosen Tarif, 2 für mindestens 14 Tage Testphase."),
    ("extras", "Kasse, Online-Zahlung, Marktplatz", 20, "8 für eine Kasse, 6 für Online-Zahlung, 6 für einen Marktplatz."),
]


def grundpreis(a: dict, personen: int) -> float:
    preis = a["preis"]
    if "fest" in preis:
        return preis["fest"]
    if "stufen" in preis:
        return next(p for bis, p in preis["stufen"] if personen <= bis)
    return preis["solo"] if personen == 1 else round(preis["erste"] + (personen - 1) * preis["weitere"], 2)


def provision_monat(a: dict, neukunden: int, bon: float) -> float:
    regel = a["provision"]
    return round(max(regel["satz"] * bon, regel["min"]) * neukunden, 2) if regel else 0


def monatskosten(a: dict, personen: int, neukunden: int, bon: float) -> dict:
    grund, provision = grundpreis(a, personen), provision_monat(a, neukunden, bon)
    return {"grund": grund, "provision": provision, "summe": round(grund + provision, 2)}


def punkte(schluessel: str) -> dict[str, int]:
    """Punkte je Kriterium, gerundet, damit die Summe auf der Seite nachrechenbar bleibt"""
    a = ANBIETER[schluessel]
    guenstigster = min(grundpreis(x, 4) for x in ANBIETER.values())
    satz = a["provision"]["satz"] if a["provision"] else 0
    return {
        "laufkundschaft": {"nummer": 30, "warteliste": 6}.get(a["laufkundschaft"], 0),
        "kosten": round(20 * guenstigster / grundpreis(a, 4)),
        "provision": round(15 * (1 - satz / 0.35)),
        "transparenz": 5 * a["preis_oeffentlich"] + 5 * a["monatlich"],
        "einstieg": 3 * a["gratis"] + 2 * (a["test_tage"] >= 14),
        "extras": 8 * a["kasse"] + 6 * a["online_zahlung"] + 6 * a["marktplatz"],
    }


def gesamt(schluessel: str) -> int:
    return sum(punkte(schluessel).values())


def reihenfolge() -> list[str]:
    return sorted(ANBIETER, key=lambda s: (-gesamt(s), ANBIETER[s]["name"]))


def eur(wert: float) -> str:
    gerundet = round(wert, 2)
    if gerundet == int(gerundet):
        return f"{int(gerundet):,}".replace(",", ".") + " €"
    return f"{gerundet:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " €"


def _q(*schluessel: str) -> str:
    return "".join(f'<sup class="q"><a href="#q-{s}" aria-label="Quelle {QUELLE_NR[s]}">{QUELLE_NR[s]}</a></sup>' for s in schluessel)


def _ja(text: str = "", *quellen: str) -> str:
    return f'<span class="m ja" role="img" aria-label="ja">✓</span>{" " + text if text else ""}{_q(*quellen)}'


def _nein(text: str = "") -> str:
    return f'<span class="m nein" role="img" aria-label="nein">✕</span>{" " + text if text else ""}'


def _na(*quellen: str) -> str:
    return f'<span class="m na" role="img" aria-label="nicht ausgewiesen">–</span>{_q(*quellen)}'


def _t(text: str, *quellen: str) -> str:
    return text + _q(*quellen)


TABELLE = [
    ("Kosten", [
        ("Einstieg im Monat", {
            "dranzeit": _t("<b>0 €</b>, mit Online-Terminen 19 €", "dranzeit"), "treatwell": _t("39 €", "treatwell"),
            "planity": _t("nicht öffentlich, laut Drittquelle 69 €", "planity-pabau", "planity-studiolution"),
            "fresha": _t("19,95 $ (≈ 17,86 €)", "fresha", "ezb"), "booksy": _t("35 €", "booksy"),
            "shore": _t("59,90 €", "shore"), "salonkee": _t("ab 59 €", "salonkee"),
        }),
        ("Weitere Personen", {
            "dranzeit": _t("<b>Im Tarif:</b> bis 4 für 39 €, bis 10 für 59 €", "dranzeit"),
            "treatwell": _t("Advanced: unbegrenzt ohne Aufpreis", "treatwell"), "planity": _na("planity-pabau"),
            "fresha": _t("14,95 $ je buchbare Person", "fresha"), "booksy": _t("+7 € je Person", "booksy"),
            "shore": _na("shore"), "salonkee": _na("salonkee"),
        }),
        ("Provision auf Neukunden", {
            "dranzeit": _t("<b>0 %</b>", "dranzeit"), "treatwell": _t("35 % auf die erste Marktplatz-Buchung", "treatwell"),
            "planity": _t("0 % laut Planity", "planity-pabau"), "fresha": _t("20 %, mindestens 6 $", "fresha"),
            "booksy": _t("keine genannt, Boost optional", "booksy", "booksy-boost"), "shore": _na("shore"),
            "salonkee": _t("keine laut Anbieter", "salonkee-profil"),
        }),
        ("Öffentlicher Preis", {
            "dranzeit": _ja("", "dranzeit"), "treatwell": _ja("", "treatwell"), "planity": _nein("auf Anfrage") + _q("planity-pabau"),
            "fresha": _ja("", "fresha"), "booksy": _ja("", "booksy"), "shore": _ja("", "shore"), "salonkee": _ja("Ab-Preis", "salonkee"),
        }),
        ("Monatlich kündbar", {
            "dranzeit": _ja("", "dranzeit-fragen"), "treatwell": _ja("", "treatwell"), "planity": _na("planity-pabau"),
            "fresha": _ja("", "fresha"), "booksy": _ja("", "booksy"), "shore": _ja("14 Tage Frist", "shore"), "salonkee": _ja("", "salonkee-profil"),
        }),
        ("Dauerhaft kostenlos", {
            "dranzeit": _ja("1 Person, bis 100 Kunden im Monat", "dranzeit"), "treatwell": _na("treatwell"), "planity": _na("planity-pabau"),
            "fresha": _na("fresha"), "booksy": _na("booksy"), "shore": _na("shore"), "salonkee": _na("salonkee"),
        }),
        ("Testphase", {
            "dranzeit": _t("<b>30 Tage</b>, ohne Zahlungsdaten", "dranzeit"), "treatwell": _na("treatwell"), "planity": _na("planity-pabau"),
            "fresha": _t("7 Tage", "fresha"), "booksy": _t("7 Tage", "booksy"), "shore": _t("14 Tage", "shore"), "salonkee": _t("14 Tage", "salonkee-profil"),
        }),
    ]),
    ("Laufkundschaft", [
        ("Nummer ziehen vom Handy, ohne App und Konto", {
            "dranzeit": _ja("<b>per QR-Code</b>", "dranzeit-fragen"), "treatwell": _na("treatwell", "treatwell-partner"), "planity": _na("planity-pabau"),
            "fresha": _t("angekündigt, Stand Januar 2026", "fresha-plan"), "booksy": _na("booksy"), "shore": _na("shore"), "salonkee": _na("salonkee"),
        }),
        ("Warteliste für frei werdende Plätze", {
            "dranzeit": _ja("„Früher dran“, ab Solo", "dranzeit"), "treatwell": _na("treatwell"), "planity": _na("planity-pabau"),
            "fresha": _ja("", "fresha"), "booksy": _ja("", "booksy-warteliste"), "shore": _na("shore"), "salonkee": _ja("", "salonkee"),
        }),
        ("Wartezimmer-Bildschirm", {
            "dranzeit": _ja("ab Laden", "dranzeit"), "treatwell": _na(), "planity": _na(), "fresha": _na(), "booksy": _na(), "shore": _na(), "salonkee": _na(),
        }),
    ]),
    ("Drumherum", [
        ("Kasse", {
            "dranzeit": _nein("gibt es nicht"), "treatwell": _ja("Advanced, TSE +7,50 €", "treatwell"),
            "planity": _ja("TSE inklusive laut Drittquelle", "planity-studiolution"), "fresha": _ja("Point of Sale", "fresha"), "booksy": _na("booksy"),
            "shore": _ja("Cloud-TSE +9 €", "shore"), "salonkee": _ja("ab Smart-Paket", "salonkee"),
        }),
        ("Online-Zahlung, Anzahlung", {
            "dranzeit": _nein("gibt es nicht"), "treatwell": _ja("2 % Gebühr", "treatwell"), "planity": _ja("", "planity-basic"),
            "fresha": _ja("2,79 % + 0,20 $", "fresha"), "booksy": _na("booksy"), "shore": _ja("PayPal", "shore"), "salonkee": _ja("Payments-Modul", "salonkee"),
        }),
        ("Marktplatz für Neukunden", {
            "dranzeit": _t("Karte und Stadtseiten, noch klein"), "treatwell": _ja("", "treatwell-partner"), "planity": _ja("", "planity-pabau"),
            "fresha": _ja("", "fresha"), "booksy": _ja("", "booksy"), "shore": _na("shore"), "salonkee": _ja("", "salonkee"),
        }),
    ]),
]


DETAILS = {
    "dranzeit": {
        "titel": "Dranzeit: Kosten und Grenzen",
        "zeilen": [
            ("Kosten", _t("Gratis 0 € (eine Person, bis 100 Kunden im Monat, ohne Online-Termine und Benachrichtigungen). Solo 19 €, Laden 39 € (bis 4 Personen), Team 59 € (bis 10 Personen), jeweils netto im Monat. Jährlich zahlst du 10 Monatspreise.", "dranzeit")),
            ("Provision", _t("Keine, auch nicht auf Neukunden.", "dranzeit-fragen")),
            ("Bindung", _t("Monatlich kündbar, 30 Tage Testphase ohne Zahlungsdaten. Danach läuft dein Laden im Gratis-Tarif weiter.", "dranzeit-fragen")),
            ("Stärke", "Kunden scannen den QR-Code an der Tür und ziehen ohne App und Konto eine Nummer. Sie sehen live, wann sie dran sind, und warten, wo sie wollen. Termine und Nummern landen im selben Tag."),
            ("Grenze", "Keine Kasse, keine Online-Zahlung oder Anzahlung, kein großer Marktplatz. Dranzeit läuft im Browser und braucht Internet."),
        ],
    },
    "salonkee": {
        "titel": "Salonkee: Preise und Grenzen",
        "zeilen": [
            ("Kosten", _t("Das Go-Paket startet laut Preisseite bei 59 € im Monat. Smart (mit Kasse) und Pro (Team, Berichte, Ketten) stehen dort ohne Betrag, Salonkee Payments kommt als Zusatzmodul dazu.", "salonkee")),
            ("Provision", _t("Laut Anbieterangaben bei Friseur-News keine Provision und keine Gebühr je Buchung. Kartenzahlungen über Stripe kosten 1,4 bis 1,9 %.", "salonkee-profil")),
            ("Bindung", _t("Monatlich kündbar, 14 Tage Testphase.", "salonkee-profil")),
            ("Stärke", _t("Warteliste, Marktplatz, Kasse und Online-Zahlung aus einer Hand, dazu Funktionen für Ketten.", "salonkee")),
            ("Grenze", "Die Warteliste gilt für frei werdende Termine. Eine Nummer vom Handy für Kunden ohne Termin ist nicht ausgewiesen."),
        ],
    },
    "fresha": {
        "titel": "Fresha: Kosten und Gebühren",
        "zeilen": [
            ("Kosten", _t("Selbstständige zahlen 19,95 $ im Monat, Teams 14,95 $ je buchbare Person, ohne Mehrwertsteuer. Die deutsche Preisseite zeigte beim Abruf US-Dollar, das sind rund 17,86 € und 13,38 €.", "fresha", "ezb")),
            ("Provision", _t("20 % auf die erste Buchung neuer Kunden vom Marktplatz, mindestens 6 $. Bestandskunden und direkte Links kosten nichts. Kartenzahlung online 2,79 % + 0,20 $, vor Ort 2,29 % + 0,20 $.", "fresha")),
            ("Bindung", _t("Keine Mindestlaufzeit, monatlich kündbar, 7 Tage Testphase.", "fresha")),
            ("Stärke", _t("Für eine Person günstiger als Dranzeit Solo, dazu Kasse, Warteliste, Online-Zahlung und Marktplatz.", "fresha")),
            ("Grenze", _t("Digitale Warteschlange und Selbst-Check-in hat Fresha angekündigt. Ob sie in Deutschland verfügbar sind, konnten wir nicht bestätigen. Der Preis steigt mit jeder buchbaren Person.", "fresha-plan")),
        ],
    },
    "shore": {
        "titel": "Shore: Preise und Laufzeit",
        "zeilen": [
            ("Kosten", _t("Booking 59,90 € im Monat (49,90 € bei jährlicher Zahlung), Booking + Marketing 79,90 € (69,90 €), All-in-One mit Kasse 129,90 € (119,90 €), zuzüglich 19 % Mehrwertsteuer. Cloud-TSE 9 €, Hardware extra.", "shore")),
            ("Provision", "Auf der Preisseite ist keine ausgewiesen."),
            ("Bindung", _t("Monatlich kündbar mit 14 Tagen Frist zum Ende der Laufzeit, bei jährlicher Zahlung 12 Monate Grundlaufzeit. 14 Tage Testphase.", "shore")),
            ("Stärke", "Buchung, Marketing und Kasse aus einer Hand, auf Wunsch mit eigener Website und App."),
            ("Grenze", "Kein Marktplatz ausgewiesen, nichts zu Warteliste oder Laufkundschaft auf der Preisseite. All-in-One mit TSE kommt auf 138,90 € im Monat."),
        ],
    },
    "booksy": {
        "titel": "Booksy: Kosten und Boost",
        "zeilen": [
            ("Kosten", _t("35 € im Monat, jede weitere Person 7 €, zuzüglich Steuern.", "booksy")),
            ("Provision", _t("Auf der deutschen Seite ist keine genannt. Die optionale Boost-Funktion kostet laut britischer Seite 30 % des ersten Termins neu vermittelter Kunden, mindestens 5 £. Ob das in Deutschland so gilt, steht dort nicht.", "booksy", "booksy-boost")),
            ("Bindung", _t("Jederzeit kündbar, 7 Tage Testphase.", "booksy")),
            ("Stärke", _t("Klarer Preis, eigene Buchungs-App für Kunden, Warteliste für frei werdende Termine.", "booksy", "booksy-warteliste")),
            ("Grenze", "Die Warteliste füllt frei werdende Termine, eine Schlange vor Ort ersetzt sie nicht. Kasse und Online-Zahlung stehen nicht auf der deutschen Seite."),
        ],
    },
    "treatwell": {
        "titel": "Treatwell: Kosten und Provision",
        "zeilen": [
            ("Kosten", _t("Starter 39 € im Monat (Kalender und Marktplatz), Advanced 49 € plus 7,50 € TSE-Gebühr (mit Kasse und unbegrenzten Teammitgliedern), jeweils zuzüglich Mehrwertsteuer.", "treatwell")),
            ("Provision", _t("Auf die erste Buchung neuer Kunden über den Marktplatz nimmt Treatwell laut FAQ 35 %, die Preisseite nennt den Satz „je nach Standort unterschiedlich“. Bei einem Haarschnitt für 35 € sind das 12,25 €. Erneute Marktplatz-Buchungen kosten 0 %, Online-Vorauszahlungen 2 %.", "treatwell")),
            ("Bindung", _t("Wahlweise monatlich kündbar oder günstiger im Jahresvertrag.", "treatwell")),
            ("Stärke", _t("Reichweite: Laut Treatwell suchen dort täglich eine halbe Million Menschen nach Terminen.", "treatwell-partner")),
            ("Grenze", "Auf den Preis- und Partnerseiten steht nichts zu Laufkundschaft oder einer Warteschlange."),
        ],
    },
    "planity": {
        "titel": "Planity: Kosten und Erfahrungen",
        "zeilen": [
            ("Kosten", _t("Planity veröffentlicht keine Preise. Die drei Tarife (Kalender, Kalender und Kasse, dazu Zahlungsterminal) stehen laut Pabau ohne Betrag auf der Tarifseite, den Preis erfährst du im Beratungsgespräch. Mitbewerber nannten 2026 rund 69 € für den Kalender und 99 € mit Kasse und TSE. Bestätigt hat Planity das nicht.", "planity-pabau", "planity-studiolution")),
            ("Provision", _t("Laut Planity keine, auch nicht auf Neukunden.", "planity-pabau")),
            ("Bindung", "Zu Laufzeit und Kündigungsfrist haben wir keine öffentliche Angabe gefunden. Frag vor dem Abschluss danach."),
            ("Stärke", _t("Kalender, Kasse und Terminal aus einer Hand, 100 SMS-Erinnerungen im Monat, eigene Salon-Seite auf planity.com.", "planity-pabau")),
            ("Grenze", "Kein öffentlicher Preis, und zu Laufkundschaft oder Warteschlange haben wir nichts gefunden."),
            ("Erfahrungen", "Wir haben Planity nicht selbst im Salonalltag betrieben und geben deshalb keine eigenen Erfahrungen wieder. Bewertungen von Salons stehen zum Beispiel bei Capterra."),
        ],
    },
}

GRENZEN = [
    ("Du brauchst eine Kasse mit TSE aus einer Hand.", "Dranzeit hat keine Kasse. Nimm Salonkee, Shore, Planity oder Treatwell Advanced, oder behalte deine Kasse und nutze Dranzeit daneben."),
    ("Du willst Anzahlungen online einziehen.", "Geht bei Dranzeit nicht. Fresha, Salonkee und Treatwell können das."),
    ("Du suchst vor allem Neukunden über einen großen Marktplatz.", "Dranzeit zeigt deinen Laden auf der Karte und den Stadtseiten, das ist aber noch klein. Treatwell, Fresha und Booksy bringen mehr Reichweite, zum Teil gegen Provision."),
    ("Bei dir läuft fast alles über feste Termine.", "Dann zählt das Kriterium Laufkundschaft nicht. Ohne diese 30 Punkte liegt im Raster Salonkee vorn und Dranzeit im Mittelfeld."),
]

FAQ = [
    ("Welche Buchungsplattform ist die beste für Friseure?",
     "Das hängt davon ab, wie deine Kunden kommen. Bei viel Laufkundschaft passt nach unserem Raster Dranzeit am besten, weil Kunden dort ohne App eine Nummer vom Handy ziehen und keine Provision anfällt. Wer Kasse und Online-Zahlung aus einer Hand braucht, findet das bei Salonkee, Shore oder Planity, wer Neukunden über einen Marktplatz sucht, bei Treatwell oder Fresha."),
    ("Welche Friseursoftware ist kostenlos?",
     "Dranzeit hat einen dauerhaft kostenlosen Tarif für eine Person und bis zu 100 Kunden im Monat. Kunden ziehen dort per QR-Code eine Nummer, Online-Termine und Benachrichtigungen sind erst ab Solo für 19 € dabei. Bei den anderen Anbietern in diesem Vergleich haben wir keinen dauerhaft kostenlosen Tarif gefunden."),
    ("Was kostet Treatwell, und wie hoch ist die Provision?",
     "Treatwell Starter kostet 39 € im Monat, Advanced mit Kasse 49 € plus 7,50 € TSE-Gebühr. Auf die erste Buchung neuer Kunden über den Marktplatz kommen laut Treatwell-FAQ 35 % Provision dazu, erneute Buchungen kosten 0 %. Alle Beträge verstehen sich zuzüglich Mehrwertsteuer."),
    ("Was kostet Planity?",
     "Planity veröffentlicht keine Preise, den Betrag erfährst du im Beratungsgespräch. Mitbewerber nannten 2026 rund 69 € im Monat für den Kalender und 99 € mit Kasse und TSE, bestätigt ist das nicht. Laut Planity fällt keine Provision an."),
    ("Gibt es eine Treatwell-Alternative ohne Provision?",
     "Ja. Dranzeit nimmt keine Provision, auch nicht auf Neukunden, und kostet ab 19 € im Monat mit Online-Terminen. Auch Salonkee und Planity geben an, keine Provision zu nehmen, bei Shore ist keine ausgewiesen. Der Unterschied: Neukunden über einen großen Marktplatz bekommst du dort nicht im gleichen Maß."),
    ("Was ist eine digitale Warteschlange beim Friseur?",
     "Kunden scannen im Laden oder von unterwegs einen QR-Code und ziehen eine Nummer. Sie sehen auf dem Handy, wie viele vor ihnen sind, und warten, wo sie wollen. Am Tresen rufst du die nächste Nummer mit einem Knopf auf. Das ersetzt Wartenummern aus Papier und ein fest eingebautes Aufrufsystem, bei Dranzeit ohne App und ohne Konto."),
    ("Welche Buchungssoftware passt zu einem Barbershop?",
     "Kommen deine Kunden meist spontan, zählt die Warteschlange mehr als der Kalender. Dann passt Dranzeit: Kunden ziehen eine Nummer und warten draußen, feste Termine laufen im selben Tag mit. Buchen deine Kunden fast immer im Voraus, sind auch Booksy oder Fresha einen Blick wert."),
    ("Was ist der Unterschied zwischen Buchungsplattform, Friseursoftware und Terminplaner?",
     "Eine Buchungsplattform ist ein Marktplatz, auf dem Kunden Salons suchen und buchen, etwa Treatwell oder Planity. Friseursoftware oder Salonsoftware organisiert den Betrieb mit Kalender, Kundenkartei und oft Kasse. Ein Terminplaner oder Buchungssystem deckt nur die Termine ab. Viele Anbieter verbinden das, deshalb vergleichen wir sie hier gemeinsam."),
    ("Kann ich Dranzeit neben Treatwell, Planity oder meiner Kasse nutzen?",
     "Ja, aber die Systeme sind nicht verbunden. Deine Kasse läuft einfach weiter. Termine aus einer anderen Plattform landen nicht automatisch in Dranzeit, sinnvoll ist deshalb entweder ein klarer Wechsel oder Dranzeit nur für die Laufkundschaft."),
    ("Wie wechsle ich zu Dranzeit?",
     "Laden anlegen, Leistungen und Team eintragen, QR-Plakat aufhängen. Das dauert laut unserer Anleitung rund 10 Minuten. Teste 30 Tage ohne Zahlungsdaten, bevor du beim alten Anbieter kündigst, und prüfe dort vorher die Kündigungsfrist."),
    ("Wie unabhängig ist dieser Vergleich?",
     "Gar nicht, und das sagen wir offen: Er kommt von Dranzeit, einem der verglichenen Anbieter. Die Gewichtung haben wir für Läden mit Laufkundschaft gesetzt. Deshalb stehen Rechenweg und Quellen auf dieser Seite. Einen Fehler gefunden? Schreib an hilfe@dranzeit.de, dann korrigieren wir ihn."),
]


STYLE = """
@font-face{font-family:"Bricolage Grotesque";src:url(/fonts/bricolage-grotesque-latin-wght-normal.woff2) format("woff2");font-weight:200 800;font-display:swap}
@font-face{font-family:"DM Sans";src:url(/fonts/dm-sans-latin-wght-normal.woff2) format("woff2");font-weight:100 1000;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url(/fonts/jetbrains-mono-latin-400-normal.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url(/fonts/jetbrains-mono-latin-700-normal.woff2) format("woff2");font-weight:700;font-display:swap}
:root{--disp:"Bricolage Grotesque","DM Sans",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace;--gut:clamp(16px,4vw,40px);--max:1200px;--board:#141414;--board-ink:#f2f1eb;--board-muted:#b3b2a8;--board-line:#3a3933;--tick:#1b7a43;--cross:#b3361f;--stub:#f7f6f1}
@media (prefers-color-scheme:dark){:root{--board:#1c1c1a;--tick:#5fd08f;--cross:#ff8b73;--stub:#232320}}
html{scroll-behavior:smooth;scroll-padding-top:72px}
body{font-family:"DM Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:17px;overflow-x:clip}
a{color:inherit}
.wrap{max-width:none;padding:0}
.top{max-width:var(--max);margin:0 auto;padding:18px var(--gut) 0}
.brand{font-family:var(--disp)}
footer{max-width:var(--max);margin:0 auto;padding:28px var(--gut)}
footer a,.top nav a{min-height:44px;display:inline-flex;align-items:center}
.sec{max-width:var(--max);margin:0 auto;padding:clamp(56px,8vw,112px) var(--gut)}
.eye{font:700 13px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 14px}
h1,h2,h3{font-family:var(--disp);text-wrap:balance}
h1{font-size:clamp(44px,6.5vw,94px);font-weight:800;line-height:.92;letter-spacing:-.045em;margin:0 0 24px}
h2{font-size:clamp(36px,5.6vw,72px);font-weight:800;line-height:.98;letter-spacing:-.04em;margin:0 0 18px}
h3{font-size:clamp(23px,2.4vw,29px);font-weight:700;line-height:1.1;letter-spacing:-.025em;margin:0}
.intro{font-size:clamp(18px,1.6vw,21px);color:var(--muted);max-width:60ch;margin:0 0 clamp(32px,4vw,56px)}
.knopf{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:54px;padding:0 26px;border-radius:15px;font-weight:700;font-size:17px;text-decoration:none;border:2px solid var(--ink);color:var(--ink);transition:transform .18s cubic-bezier(.2,.8,.2,1),background-color .18s,color .18s}
.knopf:hover{transform:translateY(-2px)}
.knopf:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible{outline:3px solid var(--signal);outline-offset:3px;border-radius:6px}
.knopf.voll{background:var(--ink);color:var(--bg)}
.knopf.gelb{background:var(--signal);border-color:var(--signal);color:#141414}
.knoepfe{display:flex;flex-wrap:wrap;gap:12px}
.pfeil{transition:transform .18s}.knopf:hover .pfeil{transform:translateX(4px)}

.held{max-width:var(--max);margin:0 auto;padding:clamp(28px,5vw,64px) var(--gut) clamp(40px,6vw,80px);display:grid;grid-template-columns:minmax(0,1.42fr) minmax(0,1fr);gap:clamp(32px,5vw,80px);align-items:center}
.held,.grenzen{overflow-x:clip}
.held .lead{font-size:clamp(19px,1.8vw,23px);color:var(--muted);max-width:32em;margin:0 0 30px}
.offen{margin:30px 0 0;padding-left:14px;border-left:4px solid var(--signal);font-size:15px;color:var(--muted);max-width:46ch}
.stapel{position:relative;max-width:400px;width:100%;justify-self:center;padding:34px 0 8px}
.tk{position:relative;border-radius:28px;padding:24px 26px;background:var(--signal);color:#141414}
.tk-kopf{display:flex;justify-content:space-between;gap:12px;font:700 12px/1.3 var(--mono);letter-spacing:.07em;text-transform:uppercase}
.tk-nr{display:block;font:700 clamp(112px,14vw,168px)/.84 var(--mono);letter-spacing:-.07em;margin:20px 0 10px -6px}
.tk-name{font:800 34px/1 var(--disp);letter-spacing:-.03em;margin:0}
.loch{position:relative;border-top:3px dotted rgba(20,20,20,.38);margin:20px -26px}
.loch::before,.loch::after{content:"";position:absolute;top:-13px;width:24px;height:24px;border-radius:50%;background:var(--bg)}
.loch::before{left:-12px}.loch::after{right:-12px}
.tk dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0}
.tk dt{font:700 11px/1.3 var(--mono);letter-spacing:.06em;text-transform:uppercase}
.tk dd{font:700 26px/1.1 var(--mono);margin:4px 0 0;letter-spacing:-.03em}
.tk-hinten{position:absolute;left:0;right:0;background:var(--card);color:var(--ink);border:1px solid var(--line);padding:16px 22px;height:150px;display:flex;justify-content:space-between;align-items:flex-start;font:700 13px/1.2 var(--mono);letter-spacing:.04em;text-transform:uppercase}
.tk-hinten b{font-size:30px;letter-spacing:-.04em}
.tk-a{top:0;left:30px;right:-18px;transform:rotate(5.5deg) translate(12px,-2px);transform-origin:bottom right}
.tk-b{top:12px;left:-14px;right:34px;transform:rotate(-4deg) translate(-10px,0);transform-origin:bottom left}
.tk-vorn{transform:rotate(-1.2deg);box-shadow:0 24px 48px -22px rgba(20,20,20,.55);transition:transform .28s cubic-bezier(.2,.8,.2,1)}
.stapel:hover .tk-vorn{transform:rotate(0) translateY(-6px)}
@media (prefers-reduced-motion:no-preference){
 .tk-vorn{animation:zieh .85s cubic-bezier(.17,.84,.3,1.02) both .1s}
 .tk-a{animation:hinten-a .8s cubic-bezier(.17,.84,.3,1) both}
 .tk-b{animation:hinten-b .8s cubic-bezier(.17,.84,.3,1) both .05s}
 .held>div:first-child>*{animation:auf .7s cubic-bezier(.2,.8,.2,1) both}
 .held>div:first-child>*:nth-child(2){animation-delay:.05s}
 .held>div:first-child>*:nth-child(3){animation-delay:.12s}
 .held>div:first-child>*:nth-child(4){animation-delay:.18s}
 .held>div:first-child>*:nth-child(5){animation-delay:.24s}
 @keyframes zieh{from{transform:translateY(70px) rotate(5deg);opacity:0}to{transform:rotate(-1.2deg);opacity:1}}
 @keyframes hinten-a{from{transform:translateY(30px);opacity:0}to{transform:rotate(5.5deg) translate(12px,-2px);opacity:1}}
 @keyframes hinten-b{from{transform:translateY(30px);opacity:0}to{transform:rotate(-4deg) translate(-10px,0);opacity:1}}
 @keyframes auf{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
 .js .rv{opacity:0;transform:translateY(22px)}
 .js .rv.an-da{opacity:1;transform:none;transition:opacity .55s cubic-bezier(.2,.8,.2,1),transform .55s cubic-bezier(.2,.8,.2,1);transition-delay:calc(var(--i,0)*55ms)}
}
.kurz{background:var(--board);color:var(--board-ink)}
.kurz>div{max-width:var(--max);margin:0 auto;padding:clamp(26px,3.6vw,44px) var(--gut);display:grid;grid-template-columns:auto minmax(0,1fr);gap:clamp(18px,3vw,44px);align-items:baseline}
.kurz strong{font:700 13px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--signal);white-space:nowrap}
.kurz p{margin:0;font-size:clamp(19px,2vw,25px);line-height:1.38;letter-spacing:-.01em;max-width:62ch;font-family:var(--disp);font-weight:500}
.sprung{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 95%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.sprung>div{max-width:var(--max);margin:0 auto;padding:0 var(--gut);display:flex;align-items:center;gap:14px}
.sprung ul{flex:1;min-width:0;margin:0;padding:0;list-style:none;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none}
.sprung-los{flex:none;display:inline-flex;align-items:center;min-height:38px;padding:0 15px;border-radius:11px;background:var(--signal);color:#141414;font-weight:700;font-size:14px;text-decoration:none;transition:transform .18s}
.sprung-los:hover{transform:translateY(-1px)}
.sprung ul::-webkit-scrollbar{display:none}
.sprung li a{display:flex;align-items:center;min-height:52px;padding:0 12px;white-space:nowrap;font-weight:600;font-size:15px;text-decoration:none;color:var(--muted);box-shadow:inset 0 -3px 0 transparent;transition:color .15s,box-shadow .15s}
.sprung li a:hover{color:var(--ink)}.sprung li a.jetzt{color:var(--ink);box-shadow:inset 0 -3px 0 var(--ink)}

.rang{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.r{position:relative;display:grid;grid-template-columns:clamp(84px,11vw,150px) minmax(0,1fr) minmax(170px,230px);background:var(--card);border:1px solid var(--line);border-radius:24px;transition:transform .22s cubic-bezier(.2,.8,.2,1),box-shadow .22s}
.r:hover{transform:translateY(-3px);box-shadow:0 18px 34px -24px rgba(20,20,20,.45)}
.r-nr{display:flex;align-items:center;justify-content:center;font:700 clamp(34px,5vw,62px)/1 var(--mono);letter-spacing:-.06em;border-right:3px dotted var(--line);position:relative}
.r-nr::before,.r-nr::after{content:"";position:absolute;right:-12px;width:21px;height:21px;border-radius:50%;background:var(--bg)}
.r-nr::before{top:-11px}.r-nr::after{bottom:-11px}
.r-text{padding:clamp(18px,2vw,26px) clamp(18px,2.4vw,30px)}
.r-text p{margin:7px 0 0;color:var(--muted);max-width:60ch}
.r-text .passt{font-size:15px}.passt b{color:var(--ink);font-weight:700}
.r-wert{display:flex;flex-direction:column;justify-content:center;gap:9px;padding:18px clamp(18px,2.4vw,30px) 18px 0}
.r-punkte{font:700 clamp(30px,3.4vw,44px)/1 var(--mono);letter-spacing:-.05em}
.r-punkte small{font-size:14px;letter-spacing:0;font-weight:400;color:var(--muted);margin-left:3px}
.leiste{height:9px;border-radius:9px;background:var(--line);overflow:hidden}
.leiste i{display:block;height:100%;border-radius:9px;background:var(--ink);width:var(--w)}
.r.erster{background:var(--signal);border-color:var(--signal);color:#141414}
.r.erster .r-nr{border-right-color:rgba(20,20,20,.38)}
.r.erster p,.r.erster .r-punkte small{color:#2b2a24}.r.erster .passt b{color:#141414}
.r.erster h3{font-size:clamp(30px,3.8vw,46px);font-weight:800}
.r.erster .leiste{background:rgba(20,20,20,.2)}.r.erster .leiste i{background:#141414}
.r.erster .r-text{padding-block:clamp(24px,3vw,36px)}
.r h3 a{text-decoration:none}.r h3 a:hover{text-decoration:underline}

.rechner{background:var(--board);color:var(--board-ink)}
.rechner .eye{color:var(--signal)}.rechner .intro{color:var(--board-muted)}
.rechner h2{color:var(--board-ink)}
.r-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,8fr);gap:clamp(28px,5vw,72px);align-items:start}
.regler{display:grid;gap:26px}
html:not(.js) .regler{display:none}
.regler label{display:block}
.r-kopf{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-weight:600;margin-bottom:10px}
.r-kopf output{font:700 34px/1 var(--mono);letter-spacing:-.04em;color:var(--signal)}
input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:44px;background:transparent;margin:0;cursor:pointer;--p:30%}
input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:8px;background:linear-gradient(90deg,var(--signal) var(--p),var(--board-line) var(--p))}
input[type=range]::-moz-range-track{height:8px;border-radius:8px;background:var(--board-line)}
input[type=range]::-moz-range-progress{height:8px;border-radius:8px;background:var(--signal)}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:34px;height:34px;margin-top:-13px;border-radius:11px;background:var(--signal);border:4px solid var(--board);box-shadow:0 0 0 2px var(--signal)}
input[type=range]::-moz-range-thumb{width:26px;height:26px;border-radius:11px;background:var(--signal);border:4px solid var(--board);box-shadow:0 0 0 2px var(--signal)}
.szenario{color:var(--board-muted);font-size:15px;margin:0}
.fazit{margin-top:6px;background:var(--signal);color:#141414;border-radius:22px;padding:20px 22px}
.fazit b{display:block;font:700 clamp(38px,4.6vw,56px)/1 var(--mono);letter-spacing:-.05em;margin:4px 0 8px}
.fazit span{font:700 12px/1.3 var(--mono);letter-spacing:.07em;text-transform:uppercase}
.fazit p{margin:0;font-size:16px;line-height:1.4}
.balken{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.b{display:grid;grid-template-columns:104px minmax(0,1fr) 92px;grid-template-areas:"n s w" "n h h";gap:0 14px;align-items:center;padding:11px 14px;border-radius:15px;background:rgba(255,255,255,.05);position:relative;will-change:transform}
.b-name{grid-area:n;font:700 18px/1.1 var(--disp);letter-spacing:-.015em}
.b-spur{grid-area:s;height:14px;border-radius:7px;background:var(--board-line);overflow:hidden}
.b-spur i{display:block;height:100%;width:var(--w);border-radius:7px;background:var(--board-muted);transition:width .45s cubic-bezier(.2,.8,.2,1)}
.b-wert{grid-area:w;font:700 20px/1 var(--mono);letter-spacing:-.04em;text-align:right;white-space:nowrap}
.b-note{grid-area:h;font-size:13px;color:var(--board-muted);margin-top:5px}
.b.d{background:var(--signal);color:#141414}
.b.d .b-spur{background:rgba(20,20,20,.18)}.b.d .b-spur i{background:#141414}.b.d .b-note{color:#2b2a24}
.klein{font-size:14px;color:var(--muted);margin:18px 0 0;max-width:80ch}
.rechner .klein{color:var(--board-muted)}

.tab-rand{position:relative;overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:24px;-webkit-overflow-scrolling:touch}
table.m-tab{border-collapse:separate;border-spacing:0;width:100%;min-width:1120px;font-size:15px;line-height:1.35}
.m-tab th,.m-tab td{padding:13px 14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
.m-tab tbody tr:last-child>*{border-bottom:0}
.m-tab thead th{font:800 19px/1.1 var(--disp);letter-spacing:-.02em;vertical-align:bottom;padding-top:18px}
.m-tab thead small{display:block;white-space:nowrap;font:700 12px/1.2 var(--mono);letter-spacing:.04em;color:var(--muted);margin-bottom:6px}
.m-tab th.zeile{position:sticky;left:0;z-index:2;background:var(--card);font-weight:600;width:178px;min-width:150px;box-shadow:1px 0 0 var(--line)}
.m-tab thead th.zeile{z-index:3}
.m-tab .gruppe th{position:sticky;left:0;background:var(--stub);font:700 12px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-block:10px}
.m-tab .gruppe td{background:var(--stub);padding:0}
.m-tab .gruppe td.d{background:#f2b91f}
.m-tab .d{background:var(--signal);color:#141414;border-bottom-color:rgba(20,20,20,.16);width:172px;min-width:160px}
.m-tab thead .d small{color:#2b2a24}
.m{display:inline-block;font-weight:800;font-size:17px;line-height:1}
.m.ja{color:var(--tick)}.m.nein{color:var(--cross)}.m.na{color:var(--muted)}
.d .m.ja{color:#141414}.d .m.nein{color:#141414}
.q{font:400 10px/0 var(--mono);margin-left:2px}.q a{text-decoration:none;color:var(--muted);padding:2px 1px}.q a:hover{color:var(--ink);text-decoration:underline}.d .q a{color:#2b2a24}
.legende{display:flex;flex-wrap:wrap;gap:6px 22px;margin:14px 0 0;font-size:14px;color:var(--muted)}
.wisch{display:none}

.warum{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:clamp(32px,6vw,90px);align-items:center}
.warum p{font-size:clamp(18px,1.5vw,20px);color:var(--muted);margin:0 0 16px;max-width:54ch}
.schritte{list-style:none;margin:30px 0 0;padding:0;display:grid;gap:0}
.schritte li{display:grid;grid-template-columns:56px minmax(0,1fr);gap:8px;padding:16px 0;border-top:3px dotted var(--line)}
.schritte b{font:700 21px/1.3 var(--mono);letter-spacing:-.04em}
.schritte strong{display:block;font:700 21px/1.2 var(--disp);letter-spacing:-.02em;margin-bottom:3px}
.schritte span{color:var(--muted)}
.live{max-width:340px;width:100%;justify-self:center;transform:rotate(1.6deg)}
.live .tk-nr{font-size:clamp(104px,12vw,144px)}
.live dd{min-height:29px}

.an-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.an{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:clamp(20px,2.4vw,30px);scroll-margin-top:72px}
.an-kopf{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:12px}
.an-kopf span{font:700 13px/1 var(--mono);color:var(--muted);white-space:nowrap}
.an dl{margin:0;display:grid;gap:0}
.an dl>div{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;padding:11px 0;border-top:1px solid var(--line)}
.an dt{font:700 11px/1.7 var(--mono);letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.an dd{margin:0;font-size:16px;line-height:1.45}
.an.d{background:var(--signal);border-color:var(--signal);color:#141414;grid-column:1/-1}
.an.d dl{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:clamp(20px,3vw,44px)}
.an.d dl>div{border-top-color:rgba(20,20,20,.22)}
.an.d dt,.an.d .an-kopf span{color:#2b2a24}
.an.d .q a{color:#2b2a24}
.an.d .knoepfe{margin-top:18px}
.an.d .knopf{border-color:#141414;color:#141414}.an.d .knopf.voll{background:#141414;color:var(--signal)}

.grenzen{background:var(--stub);border-block:1px solid var(--line)}
.g-liste{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 clamp(24px,4vw,64px)}
.g-liste li{padding:22px 0;border-top:3px dotted var(--line)}
.g-liste strong{display:block;font:700 clamp(21px,2vw,25px)/1.15 var(--disp);letter-spacing:-.02em;margin-bottom:8px}
.g-liste span{color:var(--muted)}

.fragen{max-width:880px}
.fragen details{border-top:3px dotted var(--line)}
.fragen details:last-of-type{border-bottom:3px dotted var(--line)}
.fragen summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:18px;padding:19px 0;font:700 clamp(19px,1.9vw,23px)/1.2 var(--disp);letter-spacing:-.02em;min-height:44px}
.fragen summary::-webkit-details-marker{display:none}
.fragen summary::after{content:"+";font:700 28px/1 var(--mono);transition:transform .2s;flex:none}
.fragen details[open] summary::after{transform:rotate(45deg)}
.fragen p{margin:0 0 22px;color:var(--muted);max-width:70ch}

.methode{display:grid;grid-template-columns:minmax(0,1fr);gap:clamp(36px,5vw,64px)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.tk dd,.fazit b,.b-wert,.r-kopf output{word-spacing:-.32em}
.p-tab{border-collapse:collapse;width:100%;min-width:760px;font-size:15px}
.p-tab th,.p-tab td{padding:11px 12px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
.p-tab th:first-child{text-align:left;font-weight:600;min-width:240px}
.p-tab thead th{font:700 13px/1.2 var(--mono);letter-spacing:.02em}
.p-tab td{font-family:var(--mono)}
.p-tab small{display:block;font:400 13px/1.35 "DM Sans",system-ui,sans-serif;color:var(--muted);margin-top:3px}
.p-tab .sum>*{font-weight:700;border-bottom:0;font-size:17px}
.p-tab .d{background:var(--signal);color:#141414}
.p-tab thead .d,.p-tab .sum .d{font-weight:700}
.q-liste{margin:0;padding-left:26px;columns:2;column-gap:clamp(24px,4vw,56px);font-size:15px}
.q-liste li{break-inside:avoid;margin-bottom:9px;scroll-margin-top:72px}
.q-liste li:target{background:var(--signal);color:#141414}
.drei{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(20px,3vw,40px)}
.drei h3{margin-bottom:8px;font-size:21px}.drei p{margin:0;color:var(--muted);font-size:16px}

.schluss{background:var(--signal);color:#141414;overflow:hidden;position:relative}
.schluss>div{position:relative;max-width:var(--max);margin:0 auto;padding:clamp(60px,9vw,120px) var(--gut)}
.schluss h2{max-width:13em;color:#141414}
.schluss p{font-size:clamp(18px,1.7vw,22px);margin:0 0 28px;max-width:44ch}
.schluss .knopf{border-color:#141414;color:#141414}.schluss .knopf.voll{background:#141414;color:var(--signal)}
.schluss-nr{position:absolute;right:-.06em;bottom:-.2em;font:700 clamp(220px,38vw,520px)/.8 var(--mono);letter-spacing:-.08em;color:rgba(20,20,20,.08);pointer-events:none;user-select:none}

@media (max-width:980px){
 .held,.warum,.r-grid{grid-template-columns:minmax(0,1fr)}
 .stapel{max-width:360px}
 .kurz>div{grid-template-columns:minmax(0,1fr);gap:10px}
 .an-grid,.g-liste,.drei{grid-template-columns:minmax(0,1fr)}
 .an.d dl{grid-template-columns:minmax(0,1fr)}
 .q-liste{columns:1}
 .wisch{display:block;font-size:14px;color:var(--muted);margin:0 0 10px}
}
@media (max-width:680px){
 body{font-size:16px}
 .r{grid-template-columns:62px minmax(0,1fr)}
 .r-nr{grid-row:1/span 2;font-size:30px}
 .r-text{padding:16px 16px 6px}
 .r-wert{padding:4px 16px 16px;flex-direction:row;align-items:center;gap:14px}
 .r-wert .leiste{flex:1}
 .r-punkte{font-size:26px}
 .b{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"n w" "s s" "h h";row-gap:7px;padding:12px}
 .m-tab th.zeile{width:128px;min-width:128px;font-size:14px;padding-inline:10px}
 .an dl>div{grid-template-columns:minmax(0,1fr);gap:2px}
 .knoepfe .knopf{flex:1 1 100%}
 .sprung-los{padding:0 11px;font-size:13px;min-height:36px}
 .sprung>div{gap:8px}
 .sprung li a{padding:0 9px;font-size:14px}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}}
"""

JS = """
(function(){
var d=document,D=__DATEN__;
function eur(x){var r=Math.round(x*100)/100;return r.toLocaleString('de-DE',{minimumFractionDigits:r%1?2:0,maximumFractionDigits:2})+' €'}
function grund(a,n){var p=a.preis;if(p.fest!=null)return p.fest;if(p.stufen){for(var i=0;i<p.stufen.length;i++)if(n<=p.stufen[i][0])return p.stufen[i][1]}return n===1?p.solo:Math.round((p.erste+(n-1)*p.weitere)*100)/100}
function prov(a,k,b){var r=a.provision;return r?Math.round(Math.max(r.satz*b,r.min)*k*100)/100:0}
var e={p:d.getElementById('r-personen'),k:d.getElementById('r-neukunden'),b:d.getElementById('r-bon')};
function rechne(){
 var P=+e.p.value,K=+e.k.value,B=+e.b.value;
 [['p',P],['k',K],['b',B]].forEach(function(x){var el=e[x[0]];el.style.setProperty('--p',((x[1]-el.min)/(el.max-el.min)*100)+'%');d.getElementById(el.id+'-o').textContent=x[0]==='b'?x[1]+' €':x[1]});
 var z=Object.keys(D).map(function(id){var a=D[id],g=grund(a,P),v=prov(a,K,B);return{id:id,a:a,g:g,v:v,s:Math.round((g+v)*100)/100}});
 z.sort(function(x,y){return x.s-y.s||(y.id==='dranzeit')-(x.id==='dranzeit')});
 var max=z[z.length-1].s,liste=d.getElementById('balken'),alt={};
 [].forEach.call(liste.children,function(li){alt[li.dataset.id]=li.getBoundingClientRect().top});
 z.forEach(function(r){var li=liste.querySelector('[data-id="'+r.id+'"]');
  li.querySelector('.b-wert').textContent=eur(r.s);
  li.querySelector('i').style.setProperty('--w',Math.max(3,r.s/max*100)+'%');
  li.querySelector('.b-note').textContent=(r.v?eur(r.g)+' + '+eur(r.v)+' Provision':eur(r.g))+' · '+r.a.rechner_hinweis;
  liste.appendChild(li)});
 if(!matchMedia('(prefers-reduced-motion:reduce)').matches)[].forEach.call(liste.children,function(li){var dy=alt[li.dataset.id]-li.getBoundingClientRect().top;if(dy&&li.animate)li.animate([{transform:'translateY('+dy+'px)'},{transform:'none'}],{duration:380,easing:'cubic-bezier(.2,.8,.2,1)'})});
 var me=z.filter(function(r){return r.id==='dranzeit'})[0],top=z[z.length-1],erst=z[0];
 d.getElementById('f-summe').textContent=eur(me.s);
 d.getElementById('f-text').textContent=me.s<=erst.s?'Das sind '+eur(Math.round((top.s-me.s)*12))+' im Jahr weniger als bei '+top.a.name+'.':'Bei dieser Einstellung ist '+erst.a.name+' '+eur(me.s-erst.s)+' im Monat günstiger.';
 d.getElementById('r-szenario').textContent=P+(P===1?' Person':' Personen')+', '+K+(K===1?' Neukunde':' Neukunden')+' über den Marktplatz, '+B+' € je Besuch.';
}
if(e.p){[e.p,e.k,e.b].forEach(function(el){el.addEventListener('input',rechne)});rechne()}

var rv=[].slice.call(d.querySelectorAll('.rv'));
if('IntersectionObserver'in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('an-da');io.unobserve(x.target)}})},{rootMargin:'0px 0px -6% 0px'});rv.forEach(function(x){io.observe(x)})}else rv.forEach(function(x){x.classList.add('an-da')});

var links=[].slice.call(d.querySelectorAll('.sprung li a'));
if(links.length&&'IntersectionObserver'in window){var so=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting)links.forEach(function(l){var an=l.getAttribute('href')==='#'+x.target.id;l.classList.toggle('jetzt',an);if(an&&l.parentNode.parentNode.scrollWidth>l.parentNode.parentNode.clientWidth)l.parentNode.parentNode.scrollTo({left:l.offsetLeft-20,behavior:'smooth'})})})},{rootMargin:'-20% 0px -70% 0px'});links.forEach(function(l){var t=d.querySelector(l.getAttribute('href'));if(t)so.observe(t)})}

var v=d.getElementById('live-vor'),u=d.getElementById('live-kopf');
if(v&&!matchMedia('(prefers-reduced-motion:reduce)').matches&&'IntersectionObserver'in window){var n=3,tm=null;function tick(){n=n>0?n-1:3;v.textContent=n===0?'Du!':n;u.textContent=n===0?'Jetzt dran':'Gleich dran'}
 new IntersectionObserver(function(es){if(es[0].isIntersecting){if(!tm)tm=setInterval(tick,2200)}else{clearInterval(tm);tm=null}}).observe(v)}
})();
"""


def _an_link(schluessel: str, text: str) -> str:
    return f'<a href="#{schluessel}">{seo._e(text)}</a>'


def render_rangliste() -> str:
    items = []
    for i, s in enumerate(reihenfolge()):
        a, p = ANBIETER[s], gesamt(s)
        items.append(
            f'<li class="r rv{" erster" if i == 0 else ""}" style="--i:{i}"><div class="r-nr"><span class="vh">Platz </span>{i + 1:02d}</div>'
            f'<div class="r-text"><h3>{_an_link(s, a["name"])}</h3><p>{seo._e(a["kurz"])}</p>'
            f'<p class="passt"><b>Passt zu:</b> {seo._e(a["passt"])}</p></div>'
            f'<div class="r-wert"><div class="r-punkte">{p}<small>von 100</small></div>'
            f'<div class="leiste" aria-hidden="true"><i style="--w:{p}%"></i></div></div></li>'
        )
    return f'<ol class="rang">{"".join(items)}</ol>'


VORGABE = {"personen": 4, "neukunden": 8, "bon": 35}


def render_rechner() -> str:
    werte = {s: monatskosten(ANBIETER[s], **VORGABE) for s in ANBIETER}
    sortiert = sorted(werte, key=lambda s: (werte[s]["summe"], s != "dranzeit"))
    groesster = werte[sortiert[-1]]["summe"]
    balken = []
    for s in sortiert:
        w, a = werte[s], ANBIETER[s]
        note = f'{eur(w["grund"])} + {eur(w["provision"])} Provision' if w["provision"] else eur(w["grund"])
        balken.append(
            f'<li class="b{" d" if s == "dranzeit" else ""}" data-id="{s}"><span class="b-name">{seo._e(a["name"])}</span>'
            f'<span class="b-spur" aria-hidden="true"><i style="--w:{w["summe"] / groesster * 100:.1f}%"></i></span>'
            f'<span class="b-wert">{eur(w["summe"])}</span><span class="b-note">{note} · {seo._e(a["rechner_hinweis"])}</span></li>'
        )
    mir = werte["dranzeit"]["summe"]
    jahr = round((groesster - mir) * 12)
    teuerster = ANBIETER[sortiert[-1]]["name"]
    return (
        '<section class="rechner" id="rechner"><div class="sec">'
        '<p class="eye">Kostenrechner</p><h2>Was kostet dich die Plattform im Monat?</h2>'
        '<p class="intro">Stell dein Team ein und wie viele Neukunden du über einen Marktplatz bekommst. '
        'Die Liste sortiert sich neu, das Günstigste steht vorn.</p>'
        '<div class="r-grid"><div class="regler-spalte"><div class="regler">'
        f'<label for="r-personen"><span class="r-kopf">Personen im Team <output id="r-personen-o" for="r-personen">{VORGABE["personen"]}</output></span>'
        f'<input type="range" id="r-personen" min="1" max="10" step="1" value="{VORGABE["personen"]}"></label>'
        f'<label for="r-neukunden"><span class="r-kopf">Neukunden über den Marktplatz im Monat <output id="r-neukunden-o" for="r-neukunden">{VORGABE["neukunden"]}</output></span>'
        f'<input type="range" id="r-neukunden" min="0" max="40" step="1" value="{VORGABE["neukunden"]}"></label>'
        f'<label for="r-bon"><span class="r-kopf">Preis je Besuch <output id="r-bon-o" for="r-bon">{VORGABE["bon"]} €</output></span>'
        f'<input type="range" id="r-bon" min="15" max="120" step="5" value="{VORGABE["bon"]}"></label></div>'
        '<div class="fazit" aria-live="polite"><span>Dranzeit in deinem Fall</span>'
        f'<b id="f-summe">{eur(mir)}</b><p id="f-text">Das sind {eur(jahr)} im Jahr weniger als bei {seo._e(teuerster)}.</p></div>'
        f'<p class="szenario" id="r-szenario" style="margin-top:14px">{VORGABE["personen"]} Personen, {VORGABE["neukunden"]} Neukunden über den Marktplatz, {VORGABE["bon"]} € je Besuch.</p></div>'
        f'<div><ol class="balken" id="balken">{"".join(balken)}</ol>'
        '<p class="klein">Grundpreise bei monatlicher Zahlung, netto, soweit ausgewiesen. Ohne Kartengebühren, SMS, Hardware und Zusatzmodule. '
        f'Fresha ist zum EZB-Kurs umgerechnet{_q("ezb")}, Planity beruht auf einer Drittquelle{_q("planity-studiolution")}. '
        'Bei Salonkee und Shore haben wir keine Angabe zu Aufschlägen je Person gefunden. '
        'Fair gesagt: Provision bezahlt Reichweite. Ein Neukunde vom Marktplatz kann sich lohnen, wenn er wiederkommt, '
        'und wo kein Marktplatz ist, kommt er nicht von allein. Bei Booksy ist die optionale Boost-Provision nicht eingerechnet.</p></div></div></div></section>'
    )


def render_tabelle() -> str:
    folge = reihenfolge()
    kopf = "".join(
        f'<th scope="col"{" class=d" if s == "dranzeit" else ""}><small>{i + 1:02d} · {gesamt(s)} Pkt.</small>{seo._e(ANBIETER[s]["name"])}</th>'
        for i, s in enumerate(folge)
    )
    zeilen = []
    for gruppe, reihen in TABELLE:
        leer = "".join(f'<td{" class=d" if s == "dranzeit" else ""}></td>' for s in folge)
        zeilen.append(f'<tr class="gruppe"><th scope="rowgroup" class="zeile">{seo._e(gruppe)}</th>{leer}</tr>')
        for name, zellen in reihen:
            zeilen.append(
                f'<tr><th scope="row" class="zeile">{seo._e(name)}</th>'
                + "".join(f'<td{" class=d" if s == "dranzeit" else ""}>{zellen[s]}</td>' for s in folge)
                + "</tr>"
            )
    return (
        '<section id="tabelle"><div class="sec"><p class="eye">Alle Anbieter, eine Tabelle</p>'
        '<h2>Friseursoftware im direkten Vergleich</h2>'
        '<p class="intro">Preise, Provision, Laufkundschaft und alles drumherum. Die Spalte von Dranzeit ist gelb, die Zeilen, in denen andere besser sind, stehen trotzdem drin.</p>'
        '<p class="wisch">Seitlich wischen, um alle Anbieter zu sehen.</p>'
        f'<div class="tab-rand" tabindex="0" role="region" aria-label="Vergleichstabelle"><table class="m-tab"><thead><tr><th scope="col" class="zeile">Stand {STAND}</th>{kopf}</tr></thead>'
        f'<tbody>{"".join(zeilen)}</tbody></table></div>'
        '<p class="legende"><span><span class="m ja">✓</span> ausgewiesen</span>'
        '<span><span class="m nein">✕</span> gibt es nicht</span>'
        '<span><span class="m na">–</span> auf den öffentlichen Seiten nicht gefunden. Das heißt nicht, dass es das nicht gibt.</span></p>'
        '</div></section>'
    )


def render_details() -> str:
    karten = []
    for i, s in enumerate(reihenfolge()):
        d, a = DETAILS[s], ANBIETER[s]
        zeilen = "".join(f"<div><dt>{seo._e(k)}</dt><dd>{v}</dd></div>" for k, v in d["zeilen"])
        extra = ""
        if s == "dranzeit":
            extra = (
                f'<div class="knoepfe"><a class="knopf voll" href="{ANMELDEN}">30 Tage testen</a>'
                '<a class="knopf" href="/preise">Alle Preise</a><a class="knopf" href="/hilfe/so-funktioniert-die-nummer">So funktioniert die Nummer</a></div>'
            )
        karten.append(
            f'<article class="an rv{" d" if s == "dranzeit" else ""}" id="{s}" style="--i:{i % 2}"><div class="an-kopf"><h3>{seo._e(d["titel"])}</h3>'
            f'<span>{i + 1:02d} · {gesamt(s)} Pkt.</span></div><dl>{zeilen}</dl>{extra}</article>'
        )
    return (
        '<section id="anbieter"><div class="sec"><p class="eye">Einzeln betrachtet</p>'
        '<h2>Die Anbieter im Detail</h2><p class="intro">Was kostet Treatwell, was kostet Planity, wo liegen die Grenzen? '
        'Die Antworten mit Quelle, in der Reihenfolge des Rasters.</p>'
        f'<div class="an-grid">{"".join(karten)}</div></div></section>'
    )


def render_methode() -> str:
    folge = reihenfolge()
    kopf = "".join(f'<th scope="col"{" class=d" if s == "dranzeit" else ""}>{seo._e(ANBIETER[s]["name"])}</th>' for s in folge)
    zeilen = "".join(
        f"<tr><th scope=\"row\">{seo._e(name)} ({maximum})<small>{seo._e(regel)}</small></th>"
        + "".join(f'<td{" class=d" if s == "dranzeit" else ""}>{punkte(s)[k]}</td>' for s in folge)
        + "</tr>"
        for k, name, maximum, regel in KRITERIEN
    )
    summe = "".join(f'<td{" class=d" if s == "dranzeit" else ""}>{gesamt(s)}</td>' for s in folge)
    quellen = "".join(
        f'<li id="q-{s}"><a href="{seo._e(url)}"'
        + ("" if url.startswith("/") else ' rel="nofollow noopener" target="_blank"')
        + f">{seo._e(titel)}</a></li>"
        for s, titel, url in QUELLEN
    )
    return (
        '<section id="methode"><div class="sec methode"><div><p class="eye">Offengelegt</p><h2>So haben wir bewertet</h2>'
        '<p class="intro">Das Raster ist für Friseure und Barbershops mit viel Laufkundschaft gemacht. Die Gewichtung ist unsere Entscheidung als Anbieter, '
        'mit anderen Schwerpunkten kommt eine andere Reihenfolge heraus. Jeder Punkt lässt sich hier nachrechnen.</p>'
        f'<div class="tab-rand" tabindex="0" role="region" aria-label="Punkte je Kriterium"><table class="p-tab"><thead><tr><th scope="col">Kriterium (höchstens)</th>{kopf}</tr></thead>'
        f'<tbody>{zeilen}<tr class="sum"><th scope="row">Summe (100)</th>{summe}</tr></tbody></table></div></div>'
        '<div class="drei"><div><h3>Wer das schreibt</h3><p>Dranzeit, betrieben von der ITEBV GmbH aus Berlin. Wir sind einer der verglichenen Anbieter und haben ein Interesse daran, dass du uns wählst.</p></div>'
        f'<div><h3>Wie aktuell das ist</h3><p>Stand {STAND}. Abgerufen von den öffentlichen Seiten der Anbieter, wo nötig aus Drittquellen, die wir als solche kennzeichnen. Konditionen ändern sich, verbindlich ist das Angebot des Anbieters.</p></div>'
        '<div><h3>Fehler gefunden?</h3><p>Ist eine Angabe falsch oder veraltet, auch als Anbieter: Schreib an <a href="mailto:hilfe@dranzeit.de">hilfe@dranzeit.de</a>, wir korrigieren das zügig. Markennamen gehören ihren Inhabern.</p></div></div>'
        f'<div><h3 style="margin-bottom:16px">Quellen</h3><ol class="q-liste">{quellen}</ol></div></div></section>'
    )


def json_ld() -> list[dict]:
    basis = seo.public_url()
    url = basis + PFAD
    titel = "Buchungsplattformen für Friseure im Vergleich"
    return [
        {
            "@context": "https://schema.org", "@type": "Article", "headline": titel, "description": BESCHREIBUNG,
            "inLanguage": "de-DE", "datePublished": STAND_ISO, "dateModified": STAND_ISO, "mainEntityOfPage": url,
            "image": f"{basis}{OG_BILD}",
            "author": {"@type": "Organization", "@id": f"{basis}/#organisation", "name": "Dranzeit", "url": f"{basis}/"},
            "publisher": {"@type": "Organization", "@id": f"{basis}/#organisation", "name": "Dranzeit", "url": f"{basis}/"},
        },
        {
            "@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Dranzeit", "item": f"{basis}/"},
                {"@type": "ListItem", "position": 2, "name": titel, "item": url},
            ],
        },
        {
            "@context": "https://schema.org", "@type": "ItemList", "name": titel,
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "name": ANBIETER[s]["name"], "url": f"{url}#{s}"}
                for i, s in enumerate(reihenfolge())
            ],
        },
        {
            "@context": "https://schema.org", "@type": "SoftwareApplication", "name": "Dranzeit", "url": f"{basis}/",
            "applicationCategory": "BusinessApplication", "operatingSystem": "Web",
            "offers": {"@type": "AggregateOffer", "priceCurrency": "EUR", "lowPrice": 0, "highPrice": 59, "offerCount": 4},
        },
        {
            "@context": "https://schema.org", "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": frage, "acceptedAnswer": {"@type": "Answer", "text": antwort}}
                for frage, antwort in FAQ
            ],
        },
    ]


TITEL = "Friseursoftware-Vergleich 2026: 7 Buchungsplattformen | Dranzeit"
BESCHREIBUNG = (
    "Treatwell, Planity, Fresha, Booksy, Shore, Salonkee und Dranzeit im Vergleich: Kosten, Provision, Laufzeit und "
    "Laufkundschaft. Mit Kostenrechner und allen Quellen."
)
OG_BILD = "/og-vergleich.png"


def render_seite() -> str:
    folge = reihenfolge()
    erster, zweiter, dritter = folge[0], folge[1], folge[2]
    daten = {s: {"name": a["name"], "preis": a["preis"], "provision": a["provision"], "rechner_hinweis": a["rechner_hinweis"]} for s, a in ANBIETER.items()}
    sprung = "".join(
        f'<li><a href="#{ziel}">{text}</a></li>'
        for ziel, text in [("reihenfolge", "Reihenfolge"), ("rechner", "Rechner"), ("tabelle", "Tabelle"), ("laufkundschaft", "Laufkundschaft"),
                           ("anbieter", "Anbieter"), ("grenzen", "Grenzen"), ("fragen", "Fragen"), ("methode", "Bewertung und Quellen")]
    )
    fragen = "".join(f"<details><summary>{seo._e(f)}</summary><p>{seo._e(a)}</p></details>" for f, a in FAQ)
    grenzen = "".join(f"<li><strong>{seo._e(a)}</strong><span>{seo._e(b)}</span></li>" for a, b in GRENZEN)
    body = (
        '<div class="held"><div>'
        f'<p class="eye">Vergleich · Stand {STAND} · 7 Anbieter</p>'
        "<h1>Buchungs&shy;plattformen für Friseure im Vergleich</h1>"
        '<p class="lead">Treatwell, Planity, Fresha, Booksy, Shore, Salonkee und Dranzeit: was sie im Monat kosten, wer Provision nimmt und wer mit Kunden ohne Termin umgehen kann.</p>'
        f'<div class="knoepfe"><a class="knopf voll" href="#rechner">Kosten berechnen <span class="pfeil" aria-hidden="true">↓</span></a><a class="knopf" href="{ANMELDEN}">Dranzeit testen</a></div>'
        '<p class="offen">Dieser Vergleich kommt von Dranzeit, einem der verglichenen Anbieter. Deshalb stehen Bewertung, Rechenweg und Quellen offen auf dieser Seite, auch dort, wo andere besser sind.</p>'
        "</div>"
        '<div class="stapel" aria-hidden="true">'
        f'<div class="tk tk-hinten tk-a"><span>{seo._e(ANBIETER[dritter]["name"])}</span><b>03</b></div>'
        f'<div class="tk tk-hinten tk-b"><span>{seo._e(ANBIETER[zweiter]["name"])}</span><b>02</b></div>'
        '<div class="tk tk-vorn"><div class="tk-kopf"><span>Jetzt dran</span><span>Laufkundschaft</span></div>'
        f'<span class="tk-nr">01</span><p class="tk-name">{seo._e(ANBIETER[erster]["name"])}</p><div class="loch"></div>'
        f'<dl><div><dt>Provision</dt><dd>0 %</dd></div><div><dt>Punkte</dt><dd>{gesamt(erster)}/100</dd></div></dl></div></div></div>'
        '<div class="kurz"><div><strong>Kurz gesagt</strong><p>Für Friseure und Barbershops mit viel Laufkundschaft passt Dranzeit am besten: keine Provision, ab 0 € im Monat, '
        "und Kunden ziehen ohne App eine Nummer vom Handy. Wer Kasse und Online-Anzahlung aus einer Hand braucht, ist bei Salonkee, Shore oder Planity besser aufgehoben. "
        "Treatwell bringt Reichweite, nimmt auf die erste Buchung neuer Kunden aber 35 %.</p></div></div>"
        f'<nav class="sprung" aria-label="Auf dieser Seite"><div><ul>{sprung}</ul><a class="sprung-los" href="{ANMELDEN}">30 Tage testen</a></div></nav>'
        '<section id="reihenfolge"><div class="sec"><p class="eye">Unser Raster für Läden mit Laufkundschaft</p>'
        "<h2>Wer ist bei Laufkundschaft dran?</h2>"
        '<p class="intro">Sechs Kriterien, 100 Punkte. Laufkundschaft wiegt am schwersten, Kasse und Marktplatz zählen auch. '
        '<a href="#methode">So rechnen wir.</a></p>'
        f"{render_rangliste()}</div></section>"
        f"{render_rechner()}{render_tabelle()}"
        '<section id="laufkundschaft" class="grenzen"><div class="sec warum"><div><p class="eye">Der Unterschied</p>'
        "<h2>Ein Kalender kennt nur, wer vorher gebucht hat.</h2>"
        "<p>Die meisten Plattformen sind um den Terminkalender gebaut. Für einen Salon mit festen Terminen ist das richtig. Zu dir kommen aber Kunden, die spontan vorbeischauen, "
        "den vollen Laden sehen und wieder gehen. Für die braucht es keinen Termin, sondern eine Nummer.</p>"
        '<ol class="schritte">'
        "<li><b>01</b><div><strong>Nummer ziehen</strong><span>QR-Code an der Tür scannen, Leistung wählen. Ohne App, ohne Konto.</span></div></li>"
        "<li><b>02</b><div><strong>Weitermachen</strong><span>Live sehen, wie viele vor einem sind, und warten, wo man will.</span></div></li>"
        "<li><b>03</b><div><strong>Bescheid bekommen</strong><span>Kurz vorher kommt eine Nachricht. Am Tresen rufst du die nächste Nummer mit einem Knopf auf.</span></div></li></ol>"
        f'<div class="knoepfe" style="margin-top:26px"><a class="knopf voll" href="{ANMELDEN}">Mit meinem Laden testen</a><a class="knopf" href="/friseur-ohne-termin">So sehen es Kunden</a></div></div>'
        '<div class="tk live" aria-hidden="true"><div class="tk-kopf"><span id="live-kopf">Gleich dran</span><span>Haarschnitt</span></div>'
        '<span class="tk-nr">14</span><div class="loch" style="--bg:var(--stub)"></div>'
        '<dl><div><dt>Noch vor dir</dt><dd id="live-vor">3</dd></div><div><dt>Dran um ca.</dt><dd>11:52</dd></div></dl></div></div></section>'
        f"{render_details()}"
        '<section id="grenzen" class="grenzen"><div class="sec"><p class="eye">Ehrlich gesagt</p><h2>Wann du Dranzeit nicht nehmen solltest</h2>'
        f'<p class="intro">Wir bauen ein Werkzeug für eine Sache. Wenn du etwas anderes brauchst, spar dir den Test.</p><ul class="g-liste">{grenzen}</ul></div></section>'
        f'<section id="fragen"><div class="sec fragen"><p class="eye">Häufige Fragen</p><h2>Was Inhaber vor dem Wechsel wissen wollen</h2>{fragen}</div></section>'
        f"{render_methode()}"
        '<section class="schluss"><div><span class="schluss-nr" aria-hidden="true">01</span>'
        "<h2>Probier’s mit deinem Laden aus.</h2><p>30 Tage alle Funktionen, ohne Zahlungsdaten. Danach läuft dein Laden im Gratis-Tarif weiter, bis du dich entscheidest.</p>"
        f'<div class="knoepfe"><a class="knopf voll" href="{ANMELDEN}">Laden anmelden</a><a class="knopf" href="/preise">Preise ansehen</a></div></div></section>'
        f"<script>{JS.replace('__DATEN__', json.dumps(daten, ensure_ascii=False))}</script>"
    )
    body = body.replace(" €", "\u00a0€").replace(" %", "\u00a0%").replace(" $", "\u00a0$")  # Betrag und Einheit bleiben in einer Zeile
    kopf = (
        # In der App aus dem Store wird nichts verkauft (app/seo.py, APP_VERKAUF): dort gar nicht erst anzeigen
        "<script>document.documentElement.classList.add('js');"
        "if(document.documentElement.classList.contains('in-app'))location.replace('/features')</script>"
        '<link rel="preload" href="/fonts/bricolage-grotesque-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>'
        '<link rel="preload" href="/fonts/dm-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>'
        '<meta name="author" content="Dranzeit">'
        f'<meta property="article:modified_time" content="{STAND_ISO}">'
    )
    return seo._page(TITEL, BESCHREIBUNG, PFAD, body, json_ld(), extra_style=STYLE, extra_head=kopf, og_bild=OG_BILD)


@router.get(BASE_PATH)
def vergleich_start() -> RedirectResponse:
    return RedirectResponse(PFAD, status_code=301)


@router.get(PFAD)
def vergleich_seite() -> HTMLResponse:
    return HTMLResponse(render_seite(), headers={"Cache-Control": "public, max-age=3600"})
