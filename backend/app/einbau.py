"""Dranzeit auf der Webseite eines Ladens: Kasten zum Einbetten und QR-Code als Bild.

/einbau/{shop_id}          Kasten fürs iframe: Name, offen oder zu, wer gerade wartet, „Nummer ziehen“ und „Termin
                           buchen“ (nur mit Termin-Tarif), ab 440 px Breite der QR-Code. Die Knöpfe öffnen Dranzeit in
                           einem neuen Tab – Anmeldung, Nummer-Seite und Benachrichtigungen laufen dort wie gewohnt.
/einbau/{shop_id}/qr.svg   QR-Code wie auf dem Plakat (Nummer ziehen) zum Herunterladen
/einbau/{shop_id}/qr.png

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


STYLE = """
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:transparent}
body{font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#141414;overflow:hidden}
.k{height:100%;display:flex;gap:16px;align-items:stretch;background:#fff;border:1px solid #d8d6cc;border-radius:20px;padding:16px 18px}
.text{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:6px}
h1{margin:0;font-size:21px;line-height:1.2;letter-spacing:-.02em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
p{margin:0}
.status{display:flex;align-items:center;gap:6px;color:#5a5a52;font-size:14px}
.dot{width:8px;height:8px;border-radius:50%;background:#b5b3a8;flex:none}.dot.auf{background:#1f9d55}
.live{font-weight:700;font-variant-numeric:tabular-nums}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.btn{flex:1 1 auto;display:inline-flex;justify-content:center;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;
  font-weight:700;text-decoration:none;color:#141414;border:2px solid #141414;white-space:nowrap}
.btn.main{background:#ffc83d;border-color:#ffc83d}
.btn:focus-visible{outline:3px solid #141414;outline-offset:2px}
.marke{margin-top:6px;font-size:12px;color:#5a5a52;text-decoration:none}.marke b{color:#141414}
.qr{display:none;margin:0;flex:none;width:132px;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  font-size:12px;color:#5a5a52;text-align:center}
.qr svg{width:132px;height:132px;display:block}
@media (min-width:440px){.qr{display:flex}}
"""

# Alle 2 Minuten neu laden, damit "wer wartet" stimmt – mit replace, sonst landet jedes Neuladen im Verlauf der
# Ladenseite und die Zurück-Taste bräuchte mehrere Klicks
RELOAD = "<script>setInterval(function(){if(!document.hidden)location.replace(location.href)},120000)</script>"


def _doc(title: str, body: str) -> str:
    return (
        "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\">"
        f"<title>{seo._e(title)}</title><style>{STYLE}</style></head><body>{body}</body></html>"
    )


def render_box(shop: dict, waiting: int | None, now: datetime | None = None) -> str:
    """waiting None: Zahl gerade nicht lesbar, dann ohne Zeile"""
    shop_id, name = shop["id"], shop.get("name") or "Laden"
    if plans.is_suspended(shop):
        body = (
            f"<main class=\"k\"><div class=\"text\"><h1>{seo._e(name)}</h1>"
            "<p class=\"status\">Online gibt es hier gerade keine Nummern und Termine.</p>"
            "<a class=\"marke\" href=\"/\" target=\"_blank\" rel=\"noopener\">Online-Warteschlange von <b>Dranzeit</b></a></div></main>"
        )
        return _doc(f"{name} | Dranzeit", body)
    status, is_open = opening_status(shop, now)
    live = f"<p class=\"live\">{waiting_text(waiting)}</p>" if waiting is not None and is_open else ""
    book = (
        f"<a class=\"btn\" href=\"/book-appointment?shopId={seo._e(shop_id)}&amp;fromMarketplace=true\" target=\"_blank\" rel=\"noopener\">Termin buchen</a>"
        if plans.has_feature(shop, "termine", now) else ""
    )
    svg = qr(shop_id).svg_inline(scale=1, border=0, dark="#141414", omitsize=True, title=f"QR-Code: Nummer ziehen bei {name}")
    body = (
        f"<main class=\"k\"><div class=\"text\"><h1>{seo._e(name)}</h1>"
        + (f"<p class=\"status\"><span class=\"dot{' auf' if is_open else ''}\"></span>{seo._e(status)}</p>" if status else "")
        + live
        + f"<div class=\"btns\"><a class=\"btn main\" href=\"{seo._e(join_path(shop_id))}\" target=\"_blank\" rel=\"noopener\">Nummer ziehen</a>{book}</div>"
        "<a class=\"marke\" href=\"/\" target=\"_blank\" rel=\"noopener\">Online-Warteschlange von <b>Dranzeit</b></a></div>"
        f"<figure class=\"qr\">{svg}<figcaption>Mit dem Handy scannen</figcaption></figure></main>{RELOAD}"
    )
    return _doc(f"{name} – Nummer ziehen | Dranzeit", body)


def render_missing() -> str:
    body = (
        "<main class=\"k\"><div class=\"text\"><h1>Nicht gefunden</h1>"
        "<p class=\"status\">Diesen Laden gibt es bei Dranzeit nicht (mehr).</p>"
        "<a class=\"marke\" href=\"/\" target=\"_blank\" rel=\"noopener\">Online-Warteschlange von <b>Dranzeit</b></a></div></main>"
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


@router.get(BASE_PATH + "/{shop_id}/qr.svg")
def qr_svg(shop_id: str) -> Response:
    return _qr_file(shop_id, "svg", "image/svg+xml")


@router.get(BASE_PATH + "/{shop_id}/qr.png")
def qr_png(shop_id: str) -> Response:
    return _qr_file(shop_id, "png", "image/png")
