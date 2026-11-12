"""Dranzeit auf der Webseite eines Ladens: Kasten zum Einbetten und QR-Code als Bild.

/einbau/{shop_id}          Kasten fürs iframe: Name, offen oder zu, wer gerade wartet, „Nummer ziehen“ und „Termin
                           buchen“ (nur mit Termin-Tarif), ab 440 px Breite der QR-Code. Die Knöpfe öffnen Dranzeit in
                           einem neuen Tab – Anmeldung, Nummer-Seite und Benachrichtigungen laufen dort wie gewohnt.
/einbau/{shop_id}/qr.svg   QR-Code wie auf dem Plakat (Nummer ziehen) zum Herunterladen
/einbau/{shop_id}/qr.png
/einbau/{shop_id}/qr-karte.svg  QR-Karte im Dranzeit-Design (gelbe Wartemarke mit Name) zum Herunterladen

Nur diese Pfade dürfen fremde Seiten einbetten (deploy/caddy-domain.py, frame-ancestors). Der Kasten setzt keine Cookies
und speichert nichts im Browser. Code zum Kopieren: frontend/src/components/WebseiteEinbau.tsx ("Mein Laden").
Erreichbar wie die Stadtseiten unter eigenem Pfad und unter /routes/seo/... (main.py).
"""

import io
import re
from datetime import datetime, timezone

import segno
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, Response

from app import seo
from app.libs import plans

BASE_PATH = "/einbau"
QR_CACHE_SECONDS = 86400
SHOP_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

router = APIRouter(include_in_schema=False)


def load_shop(shop_id: str) -> dict | None:
    """Laden aus Firestore (60 s zwischengespeichert); None, wenn es ihn nicht gibt"""
    if not SHOP_ID.match(shop_id):
        return None

    def load():
        snap = seo._db().collection("shops").document(shop_id).get()
        return {**(snap.to_dict() or {}), "id": shop_id} if snap.exists else None

    return seo._cached(f"einbau:{shop_id}", load)


def join_path(shop_id: str) -> str:
    """Nummer ziehen – dieselbe Adresse wie der QR-Code auf dem Plakat"""
    return f"/public-join-queue?shopId={shop_id}"


def opening_status(shop: dict, now: datetime | None = None) -> tuple[str, bool]:
    """("Geöffnet bis 18:00 Uhr", True) – Text und ob gerade offen ist (Öffnungszeiten des Ladens, deutsche Zeit)"""
    local = (now or datetime.now(timezone.utc)).astimezone(seo.BERLIN)
    weekday = (local.weekday() + 1) % 7  # Firestore: 0 = Sonntag
    day = next((d for d in shop.get("businessHoursByDay") or [] if d.get("dayOfWeek") == weekday), None)
    if not day:
        return "", False
    if not day.get("isOpen"):
        return "Heute geschlossen", False
    clock = local.strftime("%H:%M")
    opens, closes = day.get("openTime", ""), day.get("closeTime", "")
    if clock < opens:
        return f"Heute ab {opens} Uhr geöffnet", False
    if clock >= closes:
        return "Für heute geschlossen", False
    for pause in day.get("breaks") or []:
        if pause.get("startTime", "") <= clock < pause.get("endTime", ""):
            return f"Pause bis {pause['endTime']} Uhr", False
    return f"Geöffnet bis {closes} Uhr", True


def waiting_text(count: int) -> str:
    if count == 0:
        return "Gerade wartet niemand"
    return "Gerade wartet 1 Person" if count == 1 else f"Gerade warten {count} Personen"


def qr(shop_id: str) -> segno.QRCode:
    return segno.make(seo.public_url() + join_path(shop_id), error="m")


# Dranzeit-Design wie die Wartemarke in der App (components/brand/Ticket.tsx): gelbes Ticket, Abriss mit zwei
# ausgestanzten Löchern (Maske, damit die Seite des Ladens durchscheint), Schriften der App von /schrift (seo.SCHRIFTEN).
STYLE = seo.SCHRIFTEN + """
:root{--ink:#141414;--signal:#ffc83d;--sans:"DM Sans Variable","DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
--display:"Bricolage Grotesque Variable","Bricolage Grotesque","DM Sans Variable",system-ui,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:transparent}
body{font:15px/1.35 var(--sans);color:var(--ink);overflow:hidden;-webkit-font-smoothing:antialiased}
.k{--stub:148px;height:100%;display:flex;background:var(--signal);border-radius:24px;overflow:hidden}
.k.leer{background:#fff;border:1px solid hsl(50 8% 84%)}
.text{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:18px 20px}
.eyebrow{margin:0;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
h1{margin:0;font:800 25px/1.08 var(--display);letter-spacing:-.025em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
p{margin:0}
.status{display:flex;align-items:center;gap:7px;font-size:14px;color:rgba(20,20,20,.78)}
.dot{width:9px;height:9px;border-radius:50%;background:rgba(20,20,20,.3);flex:none}
.dot.auf{background:#11804a;box-shadow:0 0 0 3px rgba(17,128,74,.2)}
.live{font-weight:700;font-variant-numeric:tabular-nums}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.btn{flex:1 1 auto;display:inline-flex;justify-content:center;align-items:center;gap:8px;min-height:46px;padding:0 18px;
  border-radius:999px;font:700 15px/1 var(--sans);text-decoration:none;color:var(--ink);border:2px solid var(--ink);white-space:nowrap;
  transition:transform .15s ease}
.btn svg{width:18px;height:18px;flex:none}
.btn.main{background:var(--ink);color:var(--signal)}
.btn:hover{transform:translateY(-1px)}
.btn:focus-visible{outline:3px solid var(--ink);outline-offset:3px}
.marke{display:inline-flex;align-items:center;gap:6px;margin-top:2px;font-size:12px;color:rgba(20,20,20,.72);text-decoration:none}
.marke b{font-family:var(--display);font-weight:800;color:var(--ink)}
.marke svg{width:16px;height:16px;flex:none}
.qr{display:none;margin:0;flex:none;width:var(--stub);flex-direction:column;align-items:center;justify-content:center;gap:10px;
  padding:16px 12px;border-left:2px dashed rgba(20,20,20,.38);font-size:10.5px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;text-align:center}
.qr .code{background:#fff;border-radius:14px;padding:9px}
.qr svg{width:100px;height:100px;display:block}
@media (min-width:440px){
  .qr{display:flex}
  .ticket{-webkit-mask:radial-gradient(circle 11px at calc(100% - var(--stub)) 0,#0000 97%,#000) top/100% 51% no-repeat,
    radial-gradient(circle 11px at calc(100% - var(--stub)) 100%,#0000 97%,#000) bottom/100% 51% no-repeat;
    mask:radial-gradient(circle 11px at calc(100% - var(--stub)) 0,#0000 97%,#000) top/100% 51% no-repeat,
    radial-gradient(circle 11px at calc(100% - var(--stub)) 100%,#0000 97%,#000) bottom/100% 51% no-repeat}
}
@media (max-width:379px){.eyebrow{display:none}h1{font-size:22px}.text{padding:16px}}
"""

# Zeichen von Dranzeit (schwarzes Feld mit Wartemarke) und Ticket-Symbol für den Knopf
LOGO = ('<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="7" fill="#141414"/>'
        '<rect x="5" y="8" width="14" height="8" rx="2" fill="#ffc83d"/></svg>')
TICKET = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
          'stroke-linejoin="round" aria-hidden="true"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7'
          'a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/></svg>')
MARKE = f'<a class="marke" href="/" target="_blank" rel="noopener">{LOGO}Online-Warteschlange von <b>Dranzeit</b></a>'

# Alle 2 Minuten neu laden, damit "wer wartet" stimmt – mit replace, sonst landet jedes Neuladen im Verlauf der
# Ladenseite und die Zurück-Taste bräuchte mehrere Klicks
RELOAD = "<script>setInterval(function(){if(!document.hidden)location.replace(location.href)},120000)</script>"


def _doc(title: str, body: str) -> str:
    return (
        "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\">"
        f"<title>{seo._e(title)}</title>{seo.SCHRIFT_VORLADEN}<style>{STYLE}</style></head><body>{body}</body></html>"
    )


def render_box(shop: dict, waiting: int | None, now: datetime | None = None) -> str:
    """waiting None: Zahl gerade nicht lesbar, dann ohne Zeile"""
    shop_id, name = shop["id"], shop.get("name") or "Laden"
    if plans.is_suspended(shop):
        body = (
            f"<main class=\"k leer\"><div class=\"text\"><h1>{seo._e(name)}</h1>"
            "<p class=\"status\">Online gibt es hier gerade keine Nummern und Termine.</p>"
            f"{MARKE}</div></main>"
        )
        return _doc(f"{name} | Dranzeit", body)
    status, is_open = opening_status(shop, now)
    live = f"<p class=\"live\">{waiting_text(waiting)}</p>" if waiting is not None and is_open else ""
    book = (
        f"<a class=\"btn\" href=\"/book-appointment?shopId={seo._e(shop_id)}&amp;fromMarketplace=true\" target=\"_blank\" rel=\"noopener\">Termin buchen</a>"
        if plans.has_feature(shop, "termine", now) else ""
    )
    svg = qr(shop_id).svg_inline(scale=1, border=0, dark="#141414", omitsize=True, title=f"QR-Code: Nummer ziehen bei {name}")
    eyebrow = "Nummer ziehen · Termin buchen" if book else "Online Nummer ziehen"
    body = (
        f"<main class=\"k ticket\"><div class=\"text\"><p class=\"eyebrow\">{eyebrow}</p><h1>{seo._e(name)}</h1>"
        + (f"<p class=\"status\"><span class=\"dot{' auf' if is_open else ''}\"></span>{seo._e(status)}</p>" if status else "")
        + live
        + f"<div class=\"btns\"><a class=\"btn main\" href=\"{seo._e(join_path(shop_id))}\" target=\"_blank\" rel=\"noopener\">{TICKET}Nummer ziehen</a>{book}</div>"
        + MARKE + "</div>"
        f"<figure class=\"qr\"><div class=\"code\">{svg}</div><figcaption>Mit dem Handy scannen</figcaption></figure></main>{RELOAD}"
    )
    return _doc(f"{name} – Nummer ziehen | Dranzeit", body)


def render_missing() -> str:
    body = (
        "<main class=\"k leer\"><div class=\"text\"><h1>Nicht gefunden</h1>"
        "<p class=\"status\">Diesen Laden gibt es bei Dranzeit nicht (mehr).</p>"
        f"{MARKE}</div></main>"
    )
    return _doc("Nicht gefunden | Dranzeit", body)


@router.get(BASE_PATH + "/{shop_id}")
def box_page(shop_id: str) -> HTMLResponse:
    shop = load_shop(shop_id)
    if not shop:
        return seo._html(render_missing(), 404)
    try:
        waiting = seo.waiting_now(shop_id)
    except Exception as e:  # ohne Zahl ist der Kasten trotzdem brauchbar
        print(f"Einbau: Wartende für {shop_id} nicht lesbar: {e}")
        waiting = None
    return seo._html(render_box(shop, waiting))


def _qr_file(shop_id: str, kind: str, media_type: str) -> Response:
    shop = load_shop(shop_id)
    if not shop:
        return Response("Diesen Laden gibt es bei Dranzeit nicht.", status_code=404, media_type="text/plain; charset=utf-8")
    out = io.BytesIO()
    # Ruhezone 4 Module wie vorgeschrieben; PNG gut 900 px breit, reicht auch für den Druck
    qr(shop_id).save(out, kind=kind, scale=10 if kind == "svg" else 20, border=4, dark="#141414", light="#ffffff")
    name = seo.slugify(shop.get("name") or "") or "laden"
    return Response(
        out.getvalue(),
        media_type=media_type,
        headers={
            "Cache-Control": f"public, max-age={QR_CACHE_SECONDS}",
            "Content-Disposition": f"attachment; filename=\"dranzeit-qr-{name}.{kind}\"",
        },
    )


def render_qr_card(shop: dict) -> str:
    """QR-Karte zum Herunterladen (Webseite, Flyer, Schaufenster): gelbe Wartemarke mit Name, QR-Code und Anleitung.
    Eigenständiges SVG, 600 × 840; der QR-Code steckt als eigenes svg darin (Ruhezone 4 Module)."""
    name = shop.get("name") or "Laden"
    groesse = 54 if len(name) <= 16 else 40 if len(name) <= 24 else 34
    zeilen = _umbrechen(name, 17 if groesse == 54 else 22 if groesse == 40 else 26)
    code = qr(shop["id"]).svg_inline(scale=1, border=4, dark="#141414", light="#ffffff", omitsize=True)
    code = code.replace("<svg ", '<svg x="138" y="318" width="324" height="324" ', 1)
    titel = "".join(f'<tspan x="60" dy="{0 if i == 0 else round(groesse * 1.05)}">{seo._e(z)}</tspan>' for i, z in enumerate(zeilen))
    sans = "DM Sans Variable,DM Sans,Helvetica,Arial,sans-serif"
    display = "Bricolage Grotesque Variable,Bricolage Grotesque,Helvetica,Arial,sans-serif"
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 840" width="600" height="840">'
        f"<title>QR-Code: Nummer ziehen bei {seo._e(name)}</title>"
        '<defs><mask id="loch"><rect width="600" height="840" fill="#fff"/><circle cx="0" cy="690" r="22" fill="#000"/>'
        '<circle cx="600" cy="690" r="22" fill="#000"/></mask></defs>'
        '<rect width="600" height="840" rx="44" fill="#ffc83d" mask="url(#loch)"/>'
        f'<text x="60" y="92" font-family="{sans}" font-size="20" font-weight="700" letter-spacing="2.4" fill="#141414">NUMMER ZIEHEN</text>'
        f'<text x="60" y="{170 if len(zeilen) == 1 else 150}" font-family="{display}" font-size="{groesse}" font-weight="800" '
        f'letter-spacing="-1.2" fill="#141414">{titel}</text>'
        '<rect x="118" y="298" width="364" height="364" rx="32" fill="#fff"/>'
        f"{code}"
        '<line x1="40" y1="690" x2="560" y2="690" stroke="#141414" stroke-opacity=".38" stroke-width="3" stroke-dasharray="12 10"/>'
        f'<text x="300" y="742" text-anchor="middle" font-family="{sans}" font-size="22" font-weight="600" fill="#141414">'
        "Scannen, Nummer ziehen, wiederkommen.</text>"
        '<g transform="translate(222 772)"><rect width="34" height="34" rx="10" fill="#141414"/>'
        '<rect x="7" y="11" width="20" height="12" rx="3" fill="#ffc83d"/>'
        f'<text x="46" y="26" font-family="{display}" font-size="26" font-weight="800" fill="#141414">dranzeit.de</text></g>'
        "</svg>"
    )


def _umbrechen(text: str, breite: int) -> list[str]:
    """Name auf höchstens zwei Zeilen, zu Langes mit …"""
    zeilen, zeile = [], ""
    for wort in text.split():
        if zeile and len(zeile) + 1 + len(wort) > breite:
            zeilen.append(zeile)
            zeile = wort
        else:
            zeile = f"{zeile} {wort}".strip()
    if zeile:
        zeilen.append(zeile)
    if len(zeilen) > 2:
        rest = " ".join(zeilen[1:])
        zeilen = [zeilen[0], rest[: breite - 1] + "…"]
    return zeilen or ["Laden"]


@router.get(BASE_PATH + "/{shop_id}/qr-karte.svg")
def qr_karte(shop_id: str) -> Response:
    shop = load_shop(shop_id)
    if not shop:
        return Response("Diesen Laden gibt es bei Dranzeit nicht.", status_code=404, media_type="text/plain; charset=utf-8")
    name = seo.slugify(shop.get("name") or "") or "laden"
    return Response(
        render_qr_card(shop),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=3600", "Content-Disposition": f'attachment; filename="dranzeit-qr-karte-{name}.svg"'},
    )


@router.get(BASE_PATH + "/{shop_id}/qr.svg")
def qr_svg(shop_id: str) -> Response:
    return _qr_file(shop_id, "svg", "image/svg+xml")


@router.get(BASE_PATH + "/{shop_id}/qr.png")
def qr_png(shop_id: str) -> Response:
    return _qr_file(shop_id, "png", "image/png")
