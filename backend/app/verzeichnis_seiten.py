"""Salon-Verzeichnis für Suchmaschinen: eine Seite je Salon, dazu Seiten je Stadt, Bezirk und Ortsteil.

    /friseur                                 alle Orte
    /friseur/berlin                          Friseure in Berlin (auch /friseur/berlin-pankow, /friseur/berlin-prenzlauer-berg)
    /friseur/berlin/salon-mueller            Seite eines Salons
    /barbershop/...                          dasselbe nur mit Barbershops

Ein Salon ohne Vertrag (Eintrag ohne shopId) zeigt Adresse, Telefon, Webseite, Zeiten, Preise und einen kurzen Text –
alles von seiner eigenen Webseite, vom Betreiber geprüft (app/libs/verzeichnis_import.py). Buchen geht nicht; dafür
„Wünsch ich mir“ für Kunden und „Ist das dein Salon?“. Ein Dranzeit-Laden (mit shopId) zeigt seine Daten live, die
Wartenden und die Knöpfe zum Nummer ziehen und Buchen.

Neutral bleiben (BGH zu Jameda, VI ZR 30/17): auf der Seite eines Salons keine Werbung für andere. „In der Nähe“
listet alle Salons gleich, nach Entfernung. Wer zum Salon gehört, nimmt den Eintrag selbst offline (/routes/verzeichnis).

Fertiges HTML wie die Stadtseiten (app/seo.py); Caddy leitet /friseur und /barbershop ans Backend
(deploy/caddy-domain.py), zusätzlich unter /routes/seo/... erreichbar.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app import seo
from app.libs import verzeichnis as vz
from app.seo import BERLIN, _e, _html, _page, public_url

router = APIRouter(include_in_schema=False)

TAGE_REIHE = [1, 2, 3, 4, 5, 6, 0]
TAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
SCHEMA_TAG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
NAEHE_M = 3000

EXTRA_STYLE = """
.crumbs{font-size:14px;color:var(--muted);margin:0 0 14px}.crumbs a{color:inherit}
.sub{color:var(--muted);font-size:19px;margin:0 0 24px}
.cols{display:grid;gap:16px;align-items:start}@media(min-width:820px){.cols{grid-template-columns:1fr 320px}}
.stack{display:grid;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:20px}
.card h2,.sec h2{font-size:21px;margin:0 0 10px;letter-spacing:-.02em}.sec{margin:40px 0 0}.sec h2{font-size:24px}
.card p{margin:0 0 8px}.facts{display:grid;gap:8px}.facts a{color:inherit}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:10px 0 0;list-style:none}
.chips li{border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:14px}
table{border-collapse:collapse;width:100%}td{padding:7px 0;border-bottom:1px solid var(--line);vertical-align:top}
td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;padding-left:12px}
.zeiten td{padding:3px 0;border:0}.zeiten td:first-child{color:var(--muted);width:3em}
.hinweis{border:2px dashed var(--line);border-radius:20px;padding:20px;display:grid;gap:12px}
.hinweis p{margin:0}.danke{font-weight:700}
.klein{color:var(--muted);font-size:13px}.klein a{color:inherit}
button.btn{cursor:pointer;background:transparent;font:inherit;font-weight:700}button.btn.main{background:var(--ink)}
.orte{display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0;list-style:none}
.orte a{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:5px 12px;color:inherit;text-decoration:none;background:var(--card)}
.shop h2 a{color:inherit;text-decoration:none}
details{margin-top:12px}summary{cursor:pointer}
.form{display:grid;gap:10px;margin-top:12px;max-width:520px}
.form label{display:grid;gap:4px;font-size:14px}.form label.check{display:flex;gap:8px;align-items:flex-start}
.form textarea,.form input[type=text]{font:inherit;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
"""


# --- Daten ---------------------------------------------------------------------------------------------------------


def _laden_seite(e: dict, shop: dict) -> dict:
    """Seite eines Dranzeit-Ladens: Inhalt live aus dem Laden, Adresse der Seite und Ortsteil aus dem Eintrag"""
    return {
        "id": e["id"], "typ": "laden", "shopId": shop["id"], "pfad": vz.pfad(e),
        "kategorie": e.get("kategorie") or "friseur", "stadtSlug": e.get("stadtSlug"),
        "name": shop.get("name") or e.get("name", ""), "street": shop.get("street", ""),
        "postalCode": shop.get("postalCode", ""), "city": shop.get("city") or e.get("city", ""),
        "ortsteil": e.get("ortsteil", ""), "bezirk": e.get("bezirk", ""),
        "coordinates": shop.get("coordinates") or e.get("coordinates"),
        "phone": shop.get("phone", ""), "website": shop.get("website", ""),
        "businessHoursByDay": shop.get("businessHoursByDay") or [],
        "beschreibung": e.get("beschreibung") or shop.get("description") or "",
        "schwerpunkte": e.get("schwerpunkte") or [], "services": [], "ohneTermin": "ja",
        "wuensche": 0, "quelle": None, "gehaltvoll": True,
    }


def _eintrag_seite(e: dict) -> dict:
    return {
        **{k: e.get(k) for k in ("name", "street", "postalCode", "city", "ortsteil", "bezirk", "coordinates", "phone",
                                 "website", "beschreibung", "ohneTermin", "quelle", "stadtSlug")},
        "id": e["id"], "typ": "eintrag", "shopId": "", "pfad": vz.pfad(e), "kategorie": e.get("kategorie") or "friseur",
        "businessHoursByDay": e.get("businessHoursByDay") or [], "services": e.get("services") or [],
        "schwerpunkte": e.get("schwerpunkte") or [], "wuensche": int(e.get("wuensche") or 0),
        "gehaltvoll": vz.gehaltvoll(e),
    }


def orte_bilden(seiten: list) -> dict:
    """ort-slug → {name, voll, typ (stadt|bezirk|ortsteil), stadtSlug, city, seiten}; Bezirk gewinnt bei gleichem Namen"""
    orte: dict = {}

    def add(slug: str, name: str, typ: str, s: dict):
        o = orte.setdefault(slug, {"name": name, "typ": typ, "stadtSlug": s["stadtSlug"], "city": s["city"], "seiten": [], "ids": set()})
        if typ == "bezirk" and o["typ"] == "ortsteil":
            o["typ"] = "bezirk"
        if s["id"] not in o["ids"]:
            o["ids"].add(s["id"])
            o["seiten"].append(s)

    for s in seiten:
        add(s["stadtSlug"], s["city"], "stadt", s)
        for typ in ("bezirk", "ortsteil"):
            teil = (s.get(typ) or "").strip()
            if teil and vz.slugify(teil) != s["stadtSlug"]:
                add(f"{s['stadtSlug']}-{vz.slugify(teil)}", teil, typ, s)
    for o in orte.values():
        o["voll"] = o["name"] if o["typ"] == "stadt" else f"{o['city']}-{o['name']}"
        o["seiten"].sort(key=lambda x: x["name"].lower())
    return orte


def daten_bauen(entries: list, shops: list) -> dict:
    shops_by_id = {s["id"]: s for s in shops}
    seiten, umleitungen = [], {}
    for e in entries:
        if e.get("status") != "online" or not e.get("slug") or not e.get("stadtSlug"):
            continue
        if e.get("shopId"):
            shop = shops_by_id.get(e["shopId"])
            if not shop:
                continue  # gesperrt, gelöscht oder keine Stadt mehr
            seite = _laden_seite(e, shop)
        else:
            if not e.get("name"):
                continue
            seite = _eintrag_seite(e)
        seiten.append(seite)
        for alt in e.get("altePfade") or []:
            umleitungen[alt] = seite["pfad"]
    nach_pfad = {s["pfad"]: s for s in seiten}
    for alt in list(umleitungen):
        if alt in nach_pfad:
            del umleitungen[alt]  # die Adresse gehört inzwischen einem anderen Salon
    return {"seiten": seiten, "nach_pfad": nach_pfad, "umleitungen": umleitungen, "orte": orte_bilden(seiten)}


def daten() -> dict:
    def load():
        shops = seo.load_shops()
        entries = vz.abgleich_ausfuehren(vz.store().alle(), shops)
        return daten_bauen(entries, shops)

    return seo._cached("verzeichnis", load)


def vergessen() -> None:
    """Nach Änderungen im Betreiber-Bereich: Seiten sofort neu bauen"""
    seo._cache.pop("verzeichnis", None)
    seo._cache.pop("shops", None)


def laden_pfade() -> dict:
    return {s["shopId"]: s["pfad"] for s in daten()["seiten"] if s["shopId"]}


def laden_leistungen(shop_id: str) -> list:
    def load():
        from app.apis.firebase_utils import get_firestore_db

        rows = []
        for d in get_firestore_db().collection("services").where("shopId", "==", shop_id).stream():
            s = d.to_dict() or {}
            if s.get("archived") or not s.get("name"):
                continue
            rows.append({"name": s["name"], "category": s.get("category") or "", "price": s.get("price") or 0,
                         "priceFrom": False, "duration": s.get("duration") or 0})
        return sorted(rows, key=lambda r: (r["category"].lower(), r["name"].lower()))

    return seo._cached(f"leistungen:{shop_id}", load)


def sitemap_pfade() -> list:
    d = daten()
    pfade = ["/friseur"]
    if any(s["kategorie"] == "barbershop" for s in d["seiten"]):
        pfade.append("/barbershop")
    for slug, o in d["orte"].items():
        if len(o["seiten"]) >= 2:
            pfade.append(f"/friseur/{slug}")
        if sum(1 for s in o["seiten"] if s["kategorie"] == "barbershop") >= 2:
            pfade.append(f"/barbershop/{slug}")
    pfade += [s["pfad"] for s in d["seiten"] if s["gehaltvoll"]]
    return pfade


# --- Bausteine -----------------------------------------------------------------------------------------------------


def adresse(s: dict) -> str:
    return ", ".join(x for x in [s.get("street"), f"{s.get('postalCode') or ''} {s.get('city') or ''}".strip()] if x)


def preis(p: dict) -> str:
    if not p.get("price"):
        return "–"
    value = f"{float(p['price']):.2f}".replace(".", ",").replace(",00", "")
    return f"{'ab ' if p.get('priceFrom') else ''}{value} €"


def tageszeit(day: Optional[dict]) -> str:
    if not day or not day.get("isOpen"):
        return "geschlossen"
    spans, start = [], day.get("openTime", "")
    for b in sorted(day.get("breaks") or [], key=lambda b: b.get("startTime", "")):
        spans.append(f"{start}–{b.get('startTime')}")
        start = b.get("endTime", "")
    spans.append(f"{start}–{day.get('closeTime', '')}")
    return ", ".join(spans)


def heute(s: dict, now: Optional[datetime] = None) -> str:
    return seo.opening_today(s, now) if s.get("businessHoursByDay") else ""


def tel_link(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    return f"tel:{digits}" if digits else ""


def webseite_anzeige(url: str) -> str:
    return url.split("://", 1)[-1].removeprefix("www.").rstrip("/")


def stand(s: dict) -> str:
    gelesen = (s.get("quelle") or {}).get("gelesenAm")
    if isinstance(gelesen, datetime):
        local = gelesen.astimezone(BERLIN)
        return f"{MONATE[local.month - 1]} {local.year}"
    return ""


def schema_salon(s: dict) -> dict:
    ld = {
        "@context": "https://schema.org", "@type": "HairSalon", "name": s["name"], "url": public_url() + s["pfad"],
        "address": {"@type": "PostalAddress", "streetAddress": s.get("street") or "", "postalCode": s.get("postalCode") or "",
                    "addressLocality": s.get("city") or "", "addressCountry": "DE"},
    }
    if s.get("phone"):
        ld["telephone"] = s["phone"]
    if s.get("coordinates"):
        ld["geo"] = {"@type": "GeoCoordinates", "latitude": s["coordinates"]["latitude"], "longitude": s["coordinates"]["longitude"]}
    if s.get("website"):
        ld["sameAs"] = [s["website"]]
    if s.get("beschreibung"):
        ld["description"] = s["beschreibung"]
    specs = []
    for day in s.get("businessHoursByDay") or []:
        if not day.get("isOpen"):
            continue
        start = day.get("openTime")
        for b in sorted(day.get("breaks") or [], key=lambda b: b.get("startTime", "")):
            specs.append((day["dayOfWeek"], start, b.get("startTime")))
            start = b.get("endTime")
        specs.append((day["dayOfWeek"], start, day.get("closeTime")))
    if specs:
        ld["openingHoursSpecification"] = [
            {"@type": "OpeningHoursSpecification", "dayOfWeek": f"https://schema.org/{SCHEMA_TAG[d]}", "opens": o, "closes": c}
            for d, o, c in specs
        ]
    return ld


def schema_brotkrumen(krumen: list) -> dict:
    return {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": public_url() + href} for i, (name, href) in enumerate(krumen)
        ],
    }


def brotkrumen_html(krumen: list) -> str:
    teile = [f"<a href=\"{_e(href)}\">{_e(name)}</a>" for name, href in krumen[:-1]] + [_e(krumen[-1][0])]
    return f"<nav class=\"crumbs\" aria-label=\"Brotkrumen\">{' › '.join(teile)}</nav>"


def salon_karte(s: dict, now: Optional[datetime] = None, waiting: Optional[int] = None, buchbar: bool = False) -> str:
    """Eintrag in Listen. buchbar nur im Abschnitt „Online Nummer ziehen“ der Ortsseiten; „In der Nähe“ auf der Seite
    eines Salons zeigt alle gleich (keine Knöpfe für Dranzeit-Läden auf fremden Seiten, siehe oben)."""
    meta = " · ".join(x for x in [adresse(s), heute(s, now)] if x)
    live = ""
    if s["typ"] == "laden" and waiting is not None:
        live = "<div class=\"live\">" + ("Gerade wartet niemand" if waiting == 0 else "1 Person wartet" if waiting == 1 else f"{waiting} Personen warten") + "</div>"
    btns = f"<a class=\"btn\" href=\"{_e(s['pfad'])}\">Ansehen</a>"
    if buchbar and s["typ"] == "laden":
        btns = f"<a class=\"btn main\" href=\"/public-join-queue?shopId={_e(s['shopId'])}\">Nummer ziehen</a>" + btns
    return (
        f"<li class=\"shop\"><div><h2><a href=\"{_e(s['pfad'])}\">{_e(s['name'])}</a></h2>"
        f"<div class=\"meta\">{_e(meta)}</div>{live}</div><div class=\"btns\">{btns}</div></li>"
    )


def _wartende(s: dict) -> Optional[int]:
    try:
        return seo.waiting_now(s["shopId"])
    except Exception as e:  # ohne Zahl lieber die Seite zeigen
        print(f"Verzeichnis: Wartende für {s['shopId']} nicht lesbar: {e}")
        return None


# --- Seite eines Salons --------------------------------------------------------------------------------------------


def krumen_fuer(s: dict, orte: dict) -> list:
    kat = s["kategorie"]
    krumen = [(vz.KATEGORIEN_MEHRZAHL[kat], f"/{kat}"), (s["city"], f"/{kat}/{s['stadtSlug']}")]
    for typ in ("bezirk", "ortsteil"):
        teil = s.get(typ) or ""
        slug = f"{s['stadtSlug']}-{vz.slugify(teil)}"
        if teil and slug in orte and (f"/{kat}/{slug}") not in [h for _, h in krumen]:
            krumen.append((teil, f"/{kat}/{slug}"))
    return krumen + [(s["name"], s["pfad"])]


def naechste(s: dict, seiten: list, n: int = 6) -> list:
    if not s.get("coordinates"):
        return [x for x in seiten if x is not s and x.get("ortsteil") and x.get("ortsteil") == s.get("ortsteil")][:n]
    mit = [(vz.entfernung_m(s["coordinates"], x.get("coordinates")), x) for x in seiten if x is not s]
    return [x for d, x in sorted(mit, key=lambda t: t[0]) if d <= NAEHE_M][:n]


def render_salon(s: dict, d: dict, now: Optional[datetime] = None, gewuenscht: bool = False,
                 leistungen: Optional[list] = None, waiting: Optional[int] = None) -> str:
    kat_name = vz.KATEGORIEN[s["kategorie"]]
    ort = vz.ortsname(s)
    today = heute(s, now)
    krumen = krumen_fuer(s, d["orte"])
    services = leistungen if leistungen is not None else s.get("services") or []

    if s["typ"] == "laden":
        live = ""
        if waiting is not None:
            live = "Gerade wartet niemand." if waiting == 0 else "1 Person wartet gerade." if waiting == 1 else f"{waiting} Personen warten gerade."
        aktion = (
            "<section class=\"card\" aria-label=\"Nummer ziehen\"><p><strong>Hier ziehst du online eine Nummer</strong> und wartest, "
            f"wo du willst. {_e(live)}</p><div class=\"btns\">"
            f"<a class=\"btn main\" href=\"/public-join-queue?shopId={_e(s['shopId'])}\">Nummer ziehen</a>"
            f"<a class=\"btn\" href=\"/book-appointment?shopId={_e(s['shopId'])}&amp;fromMarketplace=true\">Termin buchen</a></div></section>"
        )
    else:
        zahl = s.get("wuensche") or 0
        andere = f" {zahl} Leute wünschen sich das schon." if zahl >= 3 else ""
        wunsch = (
            f"<p class=\"danke\" role=\"status\">Danke! Wir geben es an {_e(s['name'])} weiter.</p>" if gewuenscht else
            f"<form method=\"post\" action=\"/routes/verzeichnis/{_e(s['id'])}/wunsch\">"
            "<button class=\"btn main\" type=\"submit\">Das wünsch ich mir</button></form>"
        )
        aktion = (
            "<section class=\"hinweis\" id=\"wunsch\" aria-label=\"Online Nummer ziehen\">"
            f"<p><strong>Bei {_e(s['name'])} kannst du über Dranzeit noch keine Nummer ziehen.</strong> "
            f"Du möchtest das? Sag es uns – je mehr fragen, desto eher klappt es.{_e(andere)}</p>{wunsch}"
            "<p class=\"klein\">Ist das dein Salon? Mit Dranzeit ziehen deine Kunden online eine Nummer und warten, wo sie wollen. "
            "<a href=\"/features\">So funktioniert’s</a> · <a href=\"/register-shop-owner\">30 Tage kostenlos testen</a></p></section>"
        )

    ueber = ""
    if s.get("beschreibung") or s.get("schwerpunkte"):
        chips = "".join(f"<li>{_e(x)}</li>" for x in s.get("schwerpunkte") or [])
        ueber = (
            f"<section class=\"card\"><h2>Über {_e(s['name'])}</h2>"
            + (f"<p>{_e(s['beschreibung'])}</p>" if s.get("beschreibung") else "")
            + (f"<ul class=\"chips\" aria-label=\"Schwerpunkte\">{chips}</ul>" if chips else "")
            + "</section>"
        )

    preise = ""
    if services:
        rows = "".join(
            f"<tr><td>{_e(p['name'])}" + (f"<br><span class=\"klein\">{_e(p['category'])}</span>" if p.get("category") else "")
            + (f" <span class=\"klein\">· {int(p['duration'])} Min</span>" if p.get("duration") else "")
            + f"</td><td class=\"r\">{_e(preis(p))}</td></tr>"
            for p in services
        )
        quelle = (f"Laut Webseite des Salons{', Stand ' + stand(s) if stand(s) else ''}. Ohne Gewähr."
                  if s["typ"] == "eintrag" else "Preise vom Salon bei Dranzeit.")
        preise = f"<section class=\"card\"><h2>Preise</h2><table>{rows}</table><p class=\"klein\">{_e(quelle)}</p></section>"

    kontakt = []
    if adresse(s):
        osm = ""
        if s.get("coordinates"):
            c = s["coordinates"]
            osm = (f" · <a href=\"https://www.openstreetmap.org/?mlat={c['latitude']}&amp;mlon={c['longitude']}#map=18/"
                   f"{c['latitude']}/{c['longitude']}\" rel=\"nofollow noopener\">Karte</a>")
        kontakt.append(f"<div>{_e(adresse(s))}{osm}</div>")
    if s.get("phone"):
        kontakt.append(f"<div><a href=\"{_e(tel_link(s['phone']))}\">{_e(s['phone'])}</a></div>")
    if s.get("website"):
        kontakt.append(f"<div><a href=\"{_e(s['website'])}\" rel=\"noopener\">{_e(webseite_anzeige(s['website']))}</a></div>")
    kontakt_html = f"<section class=\"card\"><h2>Kontakt</h2><div class=\"facts\">{''.join(kontakt)}</div></section>" if kontakt else ""

    zeiten = ""
    hours = {h.get("dayOfWeek"): h for h in s.get("businessHoursByDay") or []}
    if hours:
        rows = "".join(f"<tr><td>{TAG_KURZ[d]}</td><td>{_e(tageszeit(hours.get(d)))}</td></tr>" for d in TAGE_REIHE)
        ohne = "<p class=\"klein\">Laut Webseite auch ohne Termin.</p>" if s.get("ohneTermin") == "ja" and s["typ"] == "eintrag" else ""
        zeiten = f"<section class=\"card\"><h2>Öffnungszeiten</h2><table class=\"zeiten\">{rows}</table>{ohne}</section>"

    nahe = naechste(s, d["seiten"])
    nahe_html = ""
    if nahe:
        nahe_html = (f"<section class=\"sec\"><h2>Weitere Friseure in der Nähe</h2><ul class=\"list\">"
                     f"{''.join(salon_karte(x, now) for x in nahe)}</ul></section>")

    if s["typ"] == "eintrag":
        st = stand(s)
        fuss = (
            "<p class=\"klein\">Angaben ohne Gewähr. Quelle: Webseite des Salons" + (f" (Stand {_e(st)})" if st else "")
            + "; der Text ist mit KI zusammengefasst und von uns geprüft. Lage und Ortsteil: © OpenStreetMap-Mitwirkende. "
            "Du kannst hier nicht buchen – Dranzeit arbeitet (noch) nicht mit diesem Salon zusammen.</p>"
            "<details id=\"entfernen\"><summary class=\"klein\">Das ist mein Salon: Angaben falsch oder Eintrag entfernen</summary>"
            f"<form class=\"form\" method=\"post\" action=\"/routes/verzeichnis/{_e(s['id'])}/entfernen\">"
            "<p class=\"klein\">Der Eintrag geht sofort offline. Falsche Angaben korrigieren wir gern – schreib es einfach dazu.</p>"
            "<label>Was ist falsch oder warum soll er weg? (freiwillig)<textarea name=\"grund\" rows=\"3\" maxlength=\"1000\"></textarea></label>"
            "<label>E-Mail oder Telefon für Rückfragen (freiwillig)<input type=\"text\" name=\"kontakt\" maxlength=\"200\"></label>"
            "<label class=\"check\"><input type=\"checkbox\" name=\"inhaber\" value=\"ja\" required> Ich gehöre zu diesem Salon.</label>"
            "<div><button class=\"btn\" type=\"submit\">Eintrag entfernen</button></div></form></details>"
        )
    else:
        fuss = (f"<p class=\"klein\">{_e(s['name'])} nutzt Dranzeit. Lage und Ortsteil: © OpenStreetMap-Mitwirkende. "
                f"<a href=\"/shop-details?shopId={_e(s['shopId'])}\">Alles zum Salon in der App</a></p>")

    sub = " · ".join(x for x in [f"{kat_name} in {ort}" if ort else kat_name, today] if x)
    body = (
        f"{brotkrumen_html(krumen)}<h1>{_e(s['name'])}</h1><p class=\"sub\">{_e(sub)}</p>"
        f"<div class=\"cols\"><div class=\"stack\">{aktion}{ueber}{preise}</div>"
        f"<aside class=\"stack\">{kontakt_html}{zeiten}</aside></div>{nahe_html}"
        f"<section class=\"sec\">{fuss}</section>"
    )

    if s["typ"] == "laden":
        title = f"{s['name']} – {kat_name} in {ort} | Nummer ziehen ohne Termin"
        description = f"{s['name']}, {adresse(s)}: online eine Nummer ziehen, live sehen, wann du dran bist, Preise und Öffnungszeiten."
    else:
        title = f"{s['name']} – {kat_name} in {ort} | Öffnungszeiten & Preise"
        lead = (s.get("beschreibung") or "").split(". ")[0].rstrip(".")
        description = f"{s['name']}, {adresse(s)}: Öffnungszeiten, Preise und Kontakt." + (f" {lead}." if lead else "")
    if len(description) > 160:
        description = description[:157].rsplit(" ", 1)[0] + " …"
    robots = "" if s["gehaltvoll"] else "noindex,follow"
    return _page(title, description, s["pfad"], body, [schema_salon(s), schema_brotkrumen(krumen)], EXTRA_STYLE, robots)


# --- Ortsseiten ----------------------------------------------------------------------------------------------------


def render_ort(kat: str, slug: str, o: dict, d: dict, now: Optional[datetime] = None, waiting: Optional[dict] = None) -> str:
    waiting = waiting or {}
    seiten = [s for s in o["seiten"] if kat == "friseur" or s["kategorie"] == "barbershop"]
    laeden = [s for s in seiten if s["typ"] == "laden"]
    andere = [s for s in seiten if s["typ"] == "eintrag"]
    mehrzahl = vz.KATEGORIEN_MEHRZAHL[kat]
    wo = o["name"]
    krumen = [(mehrzahl, f"/{kat}")]
    if o["typ"] != "stadt":
        krumen.append((o["city"], f"/{kat}/{o['stadtSlug']}"))
    krumen.append((wo, f"/{kat}/{slug}"))
    n = len(seiten)
    was = ("Barbershops" if n != 1 else "Barbershop") if kat == "barbershop" else ("Friseure und Barbershops" if n != 1 else "Friseur")
    lead = f"{n} {was} in {o['voll']} – mit Adresse, Öffnungszeiten und Preisen."
    if laeden:
        lead += f" Bei {'einem davon' if len(laeden) == 1 else str(len(laeden)) + ' davon'} ziehst du online eine Nummer und wartest, wo du willst."
    teile = []
    if laeden:
        teile.append(f"<section class=\"sec\"><h2>Online Nummer ziehen</h2><ul class=\"list\">"
                     f"{''.join(salon_karte(s, now, waiting.get(s['shopId']), buchbar=True) for s in laeden)}</ul></section>")
    if andere:
        ueberschrift = f"Weitere {mehrzahl} in {wo}" if laeden else f"{mehrzahl} in {wo}"
        teile.append(f"<section class=\"sec\"><h2>{_e(ueberschrift)}</h2><ul class=\"list\">"
                     f"{''.join(salon_karte(s, now) for s in andere)}</ul></section>")
    # Bezirke und Ortsteile derselben Stadt
    nachbarn = sorted(
        ((k, x) for k, x in d["orte"].items()
         if x["stadtSlug"] == o["stadtSlug"] and x["typ"] != "stadt" and k != slug
         and any(kat == "friseur" or s["kategorie"] == "barbershop" for s in x["seiten"])),
        key=lambda kv: kv[1]["name"].lower(),
    )
    if nachbarn:
        links = "".join(f"<li><a href=\"/{kat}/{_e(k)}\">{_e(x['name'])}</a></li>" for k, x in nachbarn)
        teile.append(f"<section class=\"sec\"><h2>{_e(mehrzahl)} in anderen Teilen von {_e(o['city'])}</h2><ul class=\"orte\">{links}</ul></section>")
    teile.append(
        "<div class=\"cta\"><strong>Dein Salon fehlt oder soll hier Nummern vergeben?</strong> Mit Dranzeit reihen sich deine Kunden "
        "online ein und warten, wo sie wollen. <a href=\"/preise\">30 Tage kostenlos testen</a></div>"
    )
    body = f"{brotkrumen_html(krumen)}<h1>{_e(mehrzahl)} in {_e(wo)}</h1><p class=\"lead\">{_e(lead)}</p>{''.join(teile)}"
    title = f"{mehrzahl} in {o['voll']} – Öffnungszeiten & Preise | Dranzeit"
    description = lead if len(lead) <= 160 else lead[:157].rsplit(" ", 1)[0] + " …"
    ld = {
        "@context": "https://schema.org", "@type": "ItemList", "name": f"{mehrzahl} in {o['voll']}",
        "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": public_url() + s["pfad"], "name": s["name"]}
                            for i, s in enumerate(laeden + andere)],
    }
    robots = "" if n >= 2 else "noindex,follow"
    return _page(title, description, f"/{kat}/{slug}", body, [ld, schema_brotkrumen(krumen)], EXTRA_STYLE, robots)


def render_index(kat: str, d: dict) -> str:
    mehrzahl = vz.KATEGORIEN_MEHRZAHL[kat]
    staedte = sorted(((k, o) for k, o in d["orte"].items() if o["typ"] == "stadt"), key=lambda kv: kv[1]["name"].lower())
    teile = []
    for k, o in staedte:
        anzahl = sum(1 for s in o["seiten"] if kat == "friseur" or s["kategorie"] == "barbershop")
        if not anzahl:
            continue
        bezirke = sorted(((bk, b) for bk, b in d["orte"].items() if b["stadtSlug"] == k and b["typ"] == "bezirk"),
                         key=lambda kv: kv[1]["name"].lower())
        links = "".join(f"<li><a href=\"/{kat}/{_e(bk)}\">{_e(b['name'])}</a></li>" for bk, b in bezirke
                        if any(kat == "friseur" or s["kategorie"] == "barbershop" for s in b["seiten"]))
        teile.append(
            f"<section class=\"sec\"><h2><a href=\"/{kat}/{_e(k)}\">{_e(mehrzahl)} in {_e(o['name'])}</a></h2>"
            f"<p class=\"meta\">{anzahl} {'Salon' if anzahl == 1 else 'Salons'}</p>"
            + (f"<ul class=\"orte\">{links}</ul>" if links else "") + "</section>"
        )
    body = (
        f"<h1>{_e(mehrzahl)} finden</h1><p class=\"lead\">Adressen, Öffnungszeiten und Preise – und bei Dranzeit-Salons "
        "online eine Nummer ziehen statt im Laden warten.</p>"
        + ("".join(teile) or "<p>Bald gibt es hier die ersten Salons.</p>")
    )
    return _page(f"{mehrzahl} finden – Öffnungszeiten & Preise | Dranzeit",
                 f"{mehrzahl} in deiner Stadt mit Adresse, Öffnungszeiten und Preisen. Bei Dranzeit-Salons online eine Nummer ziehen.",
                 f"/{kat}", body, None, EXTRA_STYLE)


def render_entfernt(name: str) -> str:
    body = (f"<h1>Erledigt</h1><p class=\"lead\">Der Eintrag „{_e(name)}“ ist offline. Hast du uns einen Kontakt dagelassen, "
            "melden wir uns, falls wir eine Frage haben.</p><p><a class=\"btn\" href=\"/\">Zur Startseite</a></p>")
    return _page("Eintrag entfernt | Dranzeit", "Der Eintrag ist offline.", "/friseur", body, None, EXTRA_STYLE, "noindex")


# --- Routen --------------------------------------------------------------------------------------------------------


def _not_found(kat: str, d: dict) -> HTMLResponse:
    return _html(render_index(kat, d), status=404)


def _index(kat: str) -> HTMLResponse:
    return _html(render_index(kat, daten()))


def _ort(kat: str, ort: str) -> HTMLResponse:
    d = daten()
    o = d["orte"].get(ort)
    if not o or not any(kat == "friseur" or s["kategorie"] == "barbershop" for s in o["seiten"]):
        return _not_found(kat, d)
    waiting = {}
    for s in o["seiten"]:
        if s["typ"] == "laden":
            w = _wartende(s)
            if w is not None:
                waiting[s["shopId"]] = w
    return _html(render_ort(kat, ort, o, d, waiting=waiting))


def _salon(kat: str, stadt: str, slug: str, request: Request):
    d = daten()
    path = f"/{kat}/{stadt}/{slug}"
    s = d["nach_pfad"].get(path)
    if not s:
        other = "barbershop" if kat == "friseur" else "friseur"
        target = d["nach_pfad"].get(f"/{other}/{stadt}/{slug}")
        target_path = target["pfad"] if target else d["umleitungen"].get(path) or d["umleitungen"].get(f"/{other}/{stadt}/{slug}")
        if target_path:
            return RedirectResponse(target_path, status_code=301)
        return _not_found(kat, d)
    leistungen = waiting = None
    if s["typ"] == "laden":
        waiting = _wartende(s)
        try:
            leistungen = laden_leistungen(s["shopId"])
        except Exception as e:
            print(f"Verzeichnis: Leistungen für {s['shopId']} nicht lesbar: {e}")
            leistungen = []
    gewuenscht = request.query_params.get("gewuenscht") == "1"
    return _html(render_salon(s, d, gewuenscht=gewuenscht, leistungen=leistungen, waiting=waiting))


def _routen(kat: str) -> None:
    def index():
        return _index(kat)

    def ort_seite(ort: str):
        return _ort(kat, ort)

    def salon_seite(stadt: str, slug: str, request: Request):
        return _salon(kat, stadt, slug, request)

    router.add_api_route(f"/{kat}", index, methods=["GET"])
    router.add_api_route(f"/{kat}/{{ort}}", ort_seite, methods=["GET"])
    router.add_api_route(f"/{kat}/{{stadt}}/{{slug}}", salon_seite, methods=["GET"])


for _kat in vz.KATEGORIEN:
    _routen(_kat)
