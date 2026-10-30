"""Brief an einen Salon aus dem Verzeichnis: eine A4-Seite als PDF mit Übernahme-Code und QR-Code.

Der Betreiber erzeugt den Code im Reiter Verzeichnis und lädt gleich den Brief (app/apis/betreiber/verzeichnis.py). Der
Code steht nirgends im Klartext, darum geht das nur in diesem Moment. Regeln und Wortlaut: hindernis(), texte().

Blatt nach DIN 5008 Form B: Die Anschrift sitzt im Fenster eines DL-Umschlags, Falz- und Lochmarken am linken Rand. Die
Wartemarke mit dem QR-Code liegt ganz im mittleren Drittel, damit kein Falz durch den Code läuft. Schriften sind
eingebettet (app/schriften): Briefdienste verlangen das, und „Kuaför Şahin“ steht nicht in den PDF-Standardschriften.
"""

import io
from datetime import datetime
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

import segno
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from app.libs import uebernahme as ue
from app.libs import verzeichnis as vz
from app.libs.invoices import SELLER
from app.libs.plans import FOUNDER_LIMIT

BERLIN = ZoneInfo("Europe/Berlin")
HILFE = "hilfe@dranzeit.de"
AB_WUENSCHE = 3  # wie auf der Seite des Salons (app/verzeichnis_seiten.py)

INK = HexColor("#141414")
SIGNAL = HexColor("#ffc83d")
MUTED = HexColor("#5a5a52")

SCHRIFTEN = Path(__file__).resolve().parent.parent / "schriften"
for _name, _datei in (("Text", "DMSans-Regular"), ("Text-Fett", "DMSans-Bold"), ("Titel", "BricolageGrotesque-ExtraBold"), ("Mono", "JetBrainsMono-Bold")):
    pdfmetrics.registerFont(TTFont(_name, str(SCHRIFTEN / f"{_datei}.ttf")))
pdfmetrics.registerFontFamily("Text", normal="Text", bold="Text-Fett", italic="Text", boldItalic="Text-Fett")

LINKS = 25 * mm
BREITE = 165 * mm
FALZ = (105, 210)  # mm von oben
BETREFF_MM = 107
MARKE_MM = 158
MARKE_HOEHE_MM = 48

KOERPER = ParagraphStyle("koerper", fontName="Text", fontSize=10, leading=13.5, textColor=INK)
KLEIN = ParagraphStyle("klein", parent=KOERPER, fontSize=8, leading=10.5, textColor=MUTED)
SCHRITT = ParagraphStyle("schritt", parent=KOERPER, fontSize=9, leading=12)
ZWISCHEN = ParagraphStyle("zwischen", fontName="Titel", fontSize=11, leading=14, textColor=INK)


def hindernis(entry: dict) -> str:
    """Warum es für diesen Eintrag keinen Brief gibt; leer = alles gut"""
    if entry.get("status") == "entfernt":
        return "Der Salon hat seine Seite entfernt. Er bekommt keine Post von uns."
    if entry.get("status") != "online":
        return "Der Brief verweist auf die Seite des Salons. Veröffentliche sie zuerst."
    if not all((entry.get(k) or "").strip() for k in ("street", "postalCode", "city")):
        return "Für den Brief fehlt die Anschrift (Straße, PLZ, Ort)."
    return ""


def texte(entry: dict, basis: str, plaetze_frei: int) -> dict:
    """Wortlaut des Briefs; Name und Adresse sind schon für Paragraph maskiert"""
    host = basis.split("//")[-1]
    name = escape((entry.get("name") or "").strip())
    art = vz.KATEGORIEN.get(entry.get("kategorie") or "", "Friseur")
    quelle = "von deiner Webseite" if (entry.get("quelle") or {}).get("website") else "aus öffentlichen Quellen"
    wuensche = int(entry.get("wuensche") or 0)
    if plaetze_frei > 0:
        rest = f"Noch {plaetze_frei} von {FOUNDER_LIMIT} Plätzen frei." if plaetze_frei < FOUNDER_LIMIT else f"Das gilt für die ersten {FOUNDER_LIMIT} Läden."
        angebot = (f"<b>Dein Gründerangebot:</b> 3 Monate kostenlos, danach den Tarif Laden für 19 € statt 39 € im Monat (zzgl. USt.), "
                   f"solange dein Abo durchläuft. {rest} ")
    else:
        angebot = "<b>Zum Ausprobieren:</b> 30 Tage alles kostenlos, danach ab 19 € im Monat (zzgl. USt.). "
    return {
        "betreff": f"{name} hat bei Dranzeit schon eine Seite.",
        "anrede": "Hallo,",
        "einstieg": (f"wer in {escape(vz.ortsname(entry))} einen {art} sucht, findet bei Dranzeit auch deinen Salon: "
                     f"<b>{escape(host + vz.pfad(entry))}</b>. Die Angaben stammen {quelle}. Bisher ist das nur eine Infoseite. "
                     "Mit dem Code unten gehört sie dir, und deine Kunden ziehen dort online eine Nummer oder buchen einen Termin."),
        "wuensche": f"{wuensche} Leute wünschen sich auf deiner Seite schon, bei dir online eine Nummer zu ziehen." if wuensche >= AB_WUENSCHE else "",
        "schritte": [
            f"QR-Code scannen oder <b>{escape(host)}/uebernehmen</b> öffnen und den Code eingeben.",
            "Konto anlegen. Was auf deiner Seite steht, ist schon eingetragen.",
            "Prüfen und „Laden eröffnen“. Deine Seite bleibt unter derselben Adresse.",
        ],
        "was": "Dranzeit ist die digitale Warteschlange für Friseure und Barbershops.",
        "vorteile": [
            "<b>Weniger Gedränge im Laden.</b> Kunden ziehen am Handy eine Nummer, warten, wo sie wollen, und bekommen Bescheid, kurz bevor sie dran sind.",
            "<b>Ein Plan für alles.</b> Termine und Laufkundschaft stehen in derselben Schlange.",
            "<b>Keine Provision.</b> Keine Kosten pro Kunde, keine App für deine Kunden, monatlich kündbar.",
        ],
        "angebot": angebot + "Zum Start brauchst du keine Zahlungsdaten. Ohne Abo läuft dein Laden danach im kostenlosen Tarif weiter.",
        "widerspruch": (f"Du möchtest das nicht? Ganz unten auf deiner Seite kannst du mit „Eintrag entfernen“ die Seite sofort offline nehmen. "
                        f"Keine Post mehr von uns: kurz an {HILFE} oder an die Absenderadresse schreiben. Mehr dazu: {escape(host)}/datenschutz."),
    }


def _y(von_oben_mm: float) -> float:
    return A4[1] - von_oben_mm * mm


def _mm(y: float) -> float:
    return (A4[1] - y) / mm


def _absatz(c: canvas.Canvas, text: str, x: float, oben: float, breite: float, stil: ParagraphStyle) -> float:
    """Absatz ab Oberkante zeichnen; gibt die Unterkante zurück"""
    p = Paragraph(text, stil)
    _, h = p.wrap(breite, A4[1])
    p.drawOn(c, x, oben - h)
    return oben - h


def _logo(c: canvas.Canvas, x: float, oben: float) -> None:
    """Wie BrandMark in frontend/src/components/brand/Logo.tsx: Wartemarke auf dunklem Feld"""
    s = 8.5 * mm
    u = s * 19 / 28 / 24
    x0, y0 = x + (s - 24 * u) / 2, oben - s + (s - 24 * u) / 2
    c.setFillColor(INK)
    c.roundRect(x, oben - s, s, s, 1.6 * mm, stroke=0, fill=1)
    c.setFillColor(SIGNAL)
    c.roundRect(x0 + 2 * u, y0 + 6 * u, 20 * u, 12 * u, 2 * u, stroke=0, fill=1)
    c.setFillColor(INK)
    c.circle(x0 + 2 * u, y0 + 12 * u, 2.5 * u, stroke=0, fill=1)
    c.circle(x0 + 22 * u, y0 + 12 * u, 2.5 * u, stroke=0, fill=1)
    c.setStrokeColor(INK)
    c.setLineWidth(1.6 * u)
    c.setDash(2 * u, 1.6 * u)
    c.line(x0 + 6.5 * u, y0 + 12 * u, x0 + 17.5 * u, y0 + 12 * u)
    c.setDash()
    c.setFont("Titel", 19)
    c.drawString(x + s + 2.2 * mm, oben - s + 2 * mm, "Dranzeit")


def _qr(c: canvas.Canvas, link: str, x: float, y: float, groesse: float) -> None:
    """QR-Code als Vektor: scharf in jedem Druck; alle Module in einem Pfad, damit keine feinen Spalten entstehen"""
    matrix = segno.make(link, error="m", micro=False).matrix
    m = groesse / len(matrix)
    pfad = c.beginPath()
    for r, zeile in enumerate(matrix):
        s = 0
        while s < len(zeile):
            if not zeile[s]:
                s += 1
                continue
            e = s
            while e < len(zeile) and zeile[e]:
                e += 1
            pfad.rect(x + s * m, y + groesse - (r + 1) * m, (e - s) * m, m)
            s = e
    c.setFillColor(INK)
    c.drawPath(pfad, stroke=0, fill=1)


def _marke(c: canvas.Canvas, schritte: list, code: str, gueltig: str, link: str, oben: float) -> float:
    """Der Code als Wartemarke wie in der App; gibt die Unterkante zurück"""
    h = MARKE_HOEHE_MM * mm
    unten = oben - h
    feld = 50 * mm
    kante = LINKS + feld
    rand = c.beginPath()
    rand.roundRect(LINKS, unten, BREITE, h, 4 * mm)
    c.saveState()
    c.clipPath(rand, stroke=0, fill=0)
    c.setFillColor(SIGNAL)
    c.rect(LINKS, unten, feld, h, stroke=0, fill=1)
    c.restoreState()
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.roundRect(LINKS, unten, BREITE, h, 4 * mm, stroke=1, fill=0)
    # Abrisskante mit Kerben oben und unten
    c.setDash(3, 2.4)
    c.line(kante, unten + 2.5 * mm, kante, oben - 2.5 * mm)
    c.setDash()
    r = 2.5 * mm
    c.setFillColor(white)
    for mitte, aussen in ((oben, oben), (unten, unten - r - 0.5)):
        c.circle(kante, mitte, r, stroke=1, fill=1)
        c.rect(kante - r - 1, aussen, 2 * r + 2, r + 0.5, stroke=0, fill=1)
    qr = 38 * mm
    _qr(c, link, LINKS + (feld - qr) / 2, unten + (h - qr) / 2, qr)

    x = kante + 7 * mm
    breite = LINKS + BREITE - x - 5 * mm
    c.setFillColor(MUTED)
    c.setFont("Text-Fett", 7.5)
    c.drawString(x, oben - 7 * mm, "DEIN PERSÖNLICHER CODE")
    c.setFillColor(INK)
    c.setFont("Mono", 22)
    c.drawString(x, oben - 15.5 * mm, code)
    c.setFillColor(MUTED)
    c.setFont("Text", 8.5)
    c.drawString(x, oben - 20 * mm, f"gültig bis {gueltig}")
    y = oben - 23.5 * mm
    for i, schritt in enumerate(schritte, 1):
        c.setFillColor(INK)
        c.setFont("Mono", 9)
        c.drawString(x, y - 9.2, str(i))
        y = _absatz(c, schritt, x + 4.5 * mm, y, breite - 4.5 * mm, SCHRITT) - 1
    return unten


def zeichnen(c: canvas.Canvas, entry: dict, code: str, gueltig_bis: datetime, basis: str, plaetze_frei: int, heute: datetime) -> dict:
    """Das Blatt auf den Canvas zeichnen; gibt zurück, wie weit Text und Marke reichen (mm von oben), für die Tests"""
    t = texte(entry, basis, plaetze_frei)
    host = basis.split("//")[-1]

    c.setStrokeColor(MUTED)
    c.setLineWidth(0.25)
    for von_oben, laenge in ((FALZ[0], 5), (148.5, 3), (FALZ[1], 5)):
        c.line(4 * mm, _y(von_oben), (4 + laenge) * mm, _y(von_oben))

    _logo(c, LINKS, _y(14))
    c.setFont("Text", 9)
    c.setFillColor(MUTED)
    c.drawRightString(LINKS + BREITE, _y(19.5), host)

    # Fenster: Rücksendezeile, darunter die Anschrift
    absender = f"{SELLER['name']} · {SELLER['street']} · {SELLER['postal_code']} {SELLER['city']}"
    c.setFont("Text", 7)
    c.drawString(LINKS, _y(60.5), absender)
    c.setFillColor(INK)
    y = _y(63)
    name = simpleSplit((entry.get("name") or "").strip(), "Text-Fett", 10, 80 * mm)[:2]
    zeilen = [("Text-Fett", z) for z in name] + [("Text", z) for z in (
        "z. Hd. Inhaberin oder Inhaber", entry["street"].strip(), f"{entry['postalCode'].strip()} {entry['city'].strip()}")]
    for schrift, zeile in zeilen:
        c.setFont(schrift, 10)
        c.drawString(LINKS, y - 10, zeile)
        y -= 4.4 * mm
    c.setFont("Text", 10)
    c.drawRightString(LINKS + BREITE, _y(63) - 10, f"{SELLER['city']}, {heute.astimezone(BERLIN).strftime('%d.%m.%Y')}")

    # Betreff: lange Namen dürfen höchstens zwei Zeilen füllen, sonst rutscht die Marke über den Falz
    groesse = 18
    for groesse in (18, 15, 12):
        if len(simpleSplit(t["betreff"].replace("&amp;", "&"), "Titel", groesse, BREITE)) <= 2:
            break
    betreff = ParagraphStyle("betreff", fontName="Titel", fontSize=groesse, leading=groesse * 1.12, textColor=INK)
    y = _absatz(c, t["betreff"], LINKS, _y(BETREFF_MM), BREITE, betreff) - 2.5 * mm
    y = _absatz(c, t["anrede"], LINKS, y, BREITE, KOERPER) - 1 * mm
    y = _absatz(c, t["einstieg"], LINKS, y, BREITE, KOERPER)
    if t["wuensche"]:
        y = _absatz(c, f"<b>{t['wuensche']}</b>", LINKS, y - 1 * mm, BREITE, KOERPER)
    text_vor_marke = _mm(y)

    y = _marke(c, t["schritte"], ue.anzeigen(code), gueltig_bis.astimezone(BERLIN).strftime("%d.%m.%Y"), ue.link(basis, code), _y(MARKE_MM))
    marke_unten = _mm(y)

    y = _absatz(c, t["was"], LINKS, y - 3.5 * mm, BREITE, ZWISCHEN) - 0.5 * mm
    for vorteil in t["vorteile"]:
        y = _absatz(c, vorteil, LINKS, y, BREITE, KOERPER) - 0.5 * mm
    y = _absatz(c, t["angebot"], LINKS, y - 2 * mm, BREITE, KOERPER) - 3 * mm
    y = _absatz(c, "Viele Grüße", LINKS, y, BREITE, KOERPER)
    y = _absatz(c, f"<b>{escape(SELLER['managing_director'])}</b>, Geschäftsführer {escape(SELLER['name'])}", LINKS, y, BREITE, KOERPER) - 2.5 * mm
    y = _absatz(c, t["widerspruch"], LINKS, y, BREITE, KLEIN)
    text_unten = _mm(y)

    c.setStrokeColor(MUTED)
    c.setLineWidth(0.4)
    c.setDash(3, 2.4)
    c.line(LINKS, _y(279), LINKS + BREITE, _y(279))
    c.setDash()
    c.setFont("Text", 7)
    c.setFillColor(MUTED)
    c.drawString(LINKS, _y(283), f"{absender} · {HILFE} · {host}")
    c.drawString(LINKS, _y(286.5), f"Geschäftsführer: {SELLER['managing_director']} · {SELLER['register_court']}, {SELLER['register_number']} · USt-IdNr. {SELLER['vat_id']}")
    return {"text_vor_marke": text_vor_marke, "marke_unten": marke_unten, "text_unten": text_unten}


def pdf(entry: dict, code: str, gueltig_bis: datetime, basis: str, plaetze_frei: int, heute: Optional[datetime] = None) -> bytes:
    puffer = io.BytesIO()
    c = canvas.Canvas(puffer, pagesize=A4, initialFontName="Text")  # sonst steht das nicht eingebettete Helvetica im PDF
    c.setTitle(f"Brief an {entry.get('name') or 'Salon'}")
    c.setAuthor(f"Dranzeit ({SELLER['name']})")
    zeichnen(c, entry, code, gueltig_bis, basis, plaetze_frei, heute or vz.now())
    c.showPage()
    c.save()
    return puffer.getvalue()
