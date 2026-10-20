"""Stadtseiten für Suchmaschinen: "Friseur ohne Termin in <Stadt>" mit Live-Wartenden, plus sitemap.xml.

Kunden suchen tausendfach "friseur ohne termin (in der nähe)", nach der Produktkategorie fast niemand
(Strategie, Kapitel Markt). Diese Seiten fangen die Suchen ab und führen direkt zum Nummer-Ziehen.

Fertiges HTML vom Server (die React-App sehen Suchmaschinen schlechter). Erreichbar unter
/friseur-ohne-termin/... (Caddy leitet diese Pfade ans Backend, deploy/caddy-domain.py) und zusätzlich
unter /routes/seo/... (geht ohne Caddy-Änderung).
"""

import html
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse, Response

BERLIN = ZoneInfo("Europe/Berlin")
CACHE_SECONDS = 60
BASE_PATH = "/friseur-ohne-termin"
INDUSTRIES = {None, "", "barbershop"}
DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]

router = APIRouter(include_in_schema=False)
_cache: dict[str, tuple[float, object]] = {}


def public_url() -> str:
    return (os.environ.get("PUBLIC_URL", "").strip() or "https://dranzeit.de").rstrip("/")


def slugify(city: str) -> str:
    s = city.strip().lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _cached(key: str, loader):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    value = loader()
    _cache[key] = (time.monotonic(), value)
    return value


def _db():
    from app.apis.firebase_utils import get_firestore_db

    return get_firestore_db()


def load_shops() -> list[dict]:
    """Läden mit Stadt, gefiltert auf Friseure/Barbershops."""
    def load():
        shops = []
        for doc in _db().collection("shops").stream():
            data = doc.to_dict() or {}
            if data.get("industry") not in INDUSTRIES or not (data.get("city") or "").strip() or not data.get("name"):
                continue
            data["id"] = doc.id
            shops.append(data)
        return shops

    return _cached("shops", load)


def waiting_now(shop_id: str, now: datetime | None = None) -> int:
    """Wer heute noch wartet (wie am Tresen: Status scheduled, Ende in der Zukunft)."""
    def load():
        current = now or datetime.now(timezone.utc)
        local = current.astimezone(BERLIN)
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        docs = (
            _db().collection("appointments").where("shopId", "==", shop_id)
            .where("startTime", ">=", start).where("startTime", "<", start + timedelta(days=1)).stream()
        )
        count = 0
        for d in docs:
            a = d.to_dict() or {}
            end = a.get("endTime")
            if a.get("status") == "scheduled" and end and end > current:
                count += 1
        return count

    return _cached(f"waiting:{shop_id}", load)


def cities(shops: list[dict]) -> dict[str, dict]:
    """slug -> {"name": Anzeigename, "shops": [...]}"""
    result: dict[str, dict] = {}
    for shop in shops:
        name = shop["city"].strip()
        entry = result.setdefault(slugify(name), {"name": name, "shops": []})
        entry["shops"].append(shop)
    return dict(sorted(result.items(), key=lambda kv: kv[1]["name"]))


def opening_today(shop: dict, now: datetime | None = None) -> str:
    local = (now or datetime.now(timezone.utc)).astimezone(BERLIN)
    weekday = (local.weekday() + 1) % 7  # Firestore: 0 = Sonntag
    for day in shop.get("businessHoursByDay") or []:
        if day.get("dayOfWeek") == weekday:
            if not day.get("isOpen"):
                return "Heute geschlossen"
            return f"Heute {day.get('openTime', '')}–{day.get('closeTime', '')} Uhr"
    return ""


def _e(value) -> str:
    return html.escape(str(value or ""), quote=True)


STYLE = """
:root{--bg:#eeede7;--card:#fff;--ink:#141414;--muted:#5a5a52;--line:#d8d6cc;--signal:#ffc83d}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1c1c1a;--ink:#f2f1eb;--muted:#a8a79e;--line:#34332e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-left))}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-block:8px 24px}.top nav{display:flex;gap:16px}.top nav a{color:inherit}
.brand{font-weight:800;font-size:22px;letter-spacing:-.03em;text-decoration:none;color:inherit;display:flex;gap:8px;align-items:center}
.brand i{width:26px;height:26px;border-radius:7px;background:var(--signal);display:inline-block}
h1{font-size:clamp(34px,6vw,56px);line-height:1;letter-spacing:-.04em;margin:0 0 12px;text-wrap:balance}
.lead{color:var(--muted);font-size:19px;max-width:60ch;margin:0 0 28px}
.list{display:grid;gap:12px;padding:0;margin:0;list-style:none}
.shop{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px;display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between;align-items:center}
.shop h2{margin:0;font-size:21px;letter-spacing:-.02em}.meta{color:var(--muted);font-size:14px}
.live{font-weight:700;font-variant-numeric:tabular-nums}.btns{display:flex;gap:8px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:12px;font-weight:700;text-decoration:none;border:2px solid var(--ink);color:var(--ink)}
.btn.main{background:var(--ink);color:var(--bg)}
.steps{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin:40px 0;padding:0;list-style:none}
.steps li{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px}
.cta{background:var(--signal);color:#141414;border-radius:24px;padding:24px;margin:32px 0}
.cta a{color:#141414;font-weight:700}
footer{color:var(--muted);font-size:14px;padding-block:24px;display:flex;gap:16px;flex-wrap:wrap}footer a{color:inherit}
"""


def _page(title: str, description: str, canonical_path: str, body: str, json_ld: dict | None = None, extra_style: str = "") -> str:
    ld = f'<script type="application/ld+json">{json.dumps(json_ld, ensure_ascii=False).replace("</", "<\\/")}</script>' if json_ld else ""
    url = public_url() + canonical_path
    return (
        "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
        f"<title>{_e(title)}</title><meta name=\"description\" content=\"{_e(description)}\">"
        f"<link rel=\"canonical\" href=\"{_e(url)}\"><link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\">"
        f"<meta property=\"og:title\" content=\"{_e(title)}\"><meta property=\"og:description\" content=\"{_e(description)}\">"
        f"<meta property=\"og:url\" content=\"{_e(url)}\"><meta property=\"og:site_name\" content=\"Dranzeit\">"
        f"<style>{STYLE}{extra_style}</style>{ld}</head><body><div class=\"wrap\">"
        "<div class=\"top\"><a class=\"brand\" href=\"/\"><i></i>Dranzeit</a>"
        "<nav><a href=\"/hilfe\">Hilfe</a><a href=\"/features\">Für Läden</a></nav></div>"
        f"{body}"
        "<footer><a href=\"/\">Startseite</a><a href=\"/friseur-ohne-termin\">Alle Städte</a><a href=\"/hilfe\">Hilfe</a>"
        "<a href=\"/impressum\">Impressum</a><a href=\"/datenschutz\">Datenschutz</a></footer></div></body></html>"
    )


STEPS_HTML = (
    "<ol class=\"steps\"><li><strong>Nummer ziehen</strong><br>Laden und Leistung wählen. Ohne App, ohne Konto.</li>"
    "<li><strong>Weitermachen</strong><br>Du siehst live, wie viele vor dir sind und wann du ungefähr dran bist.</li>"
    "<li><strong>Bescheid bekommen</strong><br>Kurz bevor du dran bist, kommt eine Nachricht. Dann ab in den Laden.</li></ol>"
)


def render_city(city_name: str, slug: str, shops: list[dict], waiting: dict[str, int], now: datetime | None = None) -> str:
    items = []
    for shop in sorted(shops, key=lambda s: s["name"].lower()):
        w = waiting.get(shop["id"], 0)
        live = "Gerade wartet niemand" if w == 0 else ("1 Person wartet" if w == 1 else f"{w} Personen warten")
        address = ", ".join(x for x in [shop.get("street"), f"{shop.get('postalCode', '')} {shop.get('city', '')}".strip()] if x)
        hours = opening_today(shop, now)
        items.append(
            f"<li class=\"shop\"><div><h2>{_e(shop['name'])}</h2><div class=\"meta\">{_e(address)}"
            f"{' · ' + _e(hours) if hours else ''}</div><div class=\"live\">{_e(live)}</div></div>"
            f"<div class=\"btns\"><a class=\"btn main\" href=\"/public-join-queue?shopId={_e(shop['id'])}\">Nummer ziehen</a>"
            f"<a class=\"btn\" href=\"/shop-details?shopId={_e(shop['id'])}\">Details</a></div></li>"
        )
    count = len(shops)
    title = f"Friseur ohne Termin in {city_name} – Nummer ziehen | Dranzeit"
    description = (
        f"{count} {'Friseur oder Barbershop' if count == 1 else 'Friseure und Barbershops'} in {city_name} ohne Termin: "
        "Nummer online ziehen, live sehen, wann du dran bist, und draußen warten."
    )
    body = (
        f"<h1>Friseur ohne Termin in {_e(city_name)}</h1>"
        f"<p class=\"lead\">Zieh bei {'diesem Laden' if count == 1 else f'{count} Läden'} in {_e(city_name)} eine Nummer, "
        "ohne App und ohne Konto. Du siehst, wann du dran bist, und wartest, wo du willst.</p>"
        f"<ul class=\"list\">{''.join(items)}</ul>{STEPS_HTML}"
        "<div class=\"cta\"><strong>Dein Laden fehlt?</strong> Mit Dranzeit reihen sich deine Kunden selbst ein. "
        "<a href=\"/preise\">30 Tage kostenlos testen</a></div>"
    )
    json_ld = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"Friseur ohne Termin in {city_name}",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": i + 1,
                "item": {
                    "@type": "HairSalon",
                    "name": s["name"],
                    "url": f"{public_url()}/shop-details?shopId={s['id']}",
                    "address": {
                        "@type": "PostalAddress",
                        "streetAddress": s.get("street") or "",
                        "postalCode": s.get("postalCode") or "",
                        "addressLocality": s.get("city") or "",
                        "addressCountry": "DE",
                    },
                },
            }
            for i, s in enumerate(sorted(shops, key=lambda s: s["name"].lower()))
        ],
    }
    return _page(title, description, f"{BASE_PATH}/{slug}", body, json_ld)


def render_index(all_cities: dict[str, dict]) -> str:
    links = "".join(
        f"<li class=\"shop\"><h2><a href=\"{BASE_PATH}/{_e(slug)}\">Friseur ohne Termin in {_e(c['name'])}</a></h2>"
        f"<span class=\"meta\">{len(c['shops'])} {'Laden' if len(c['shops']) == 1 else 'Läden'}</span></li>"
        for slug, c in all_cities.items()
    )
    body = (
        "<h1>Friseur ohne Termin</h1><p class=\"lead\">Läden, bei denen du online eine Nummer ziehst und draußen wartest.</p>"
        f"<ul class=\"list\">{links or '<li class=shop>Bald gibt es hier die ersten Städte.</li>'}</ul>{STEPS_HTML}"
    )
    return _page("Friseur ohne Termin – Nummer ziehen statt warten | Dranzeit", "Friseure und Barbershops ohne Termin: Nummer online ziehen und draußen warten.", BASE_PATH, body)


def _html(content: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(content, status_code=status, headers={"Cache-Control": f"public, max-age={CACHE_SECONDS}"})


@router.get(BASE_PATH)
def index_page() -> HTMLResponse:
    return _html(render_index(cities(load_shops())))


@router.get(BASE_PATH + "/{slug}")
def city_page(slug: str) -> HTMLResponse:
    all_cities = cities(load_shops())
    city = all_cities.get(slug)
    if not city:
        return _html(render_index(all_cities), status=404)
    waiting = {}
    for shop in city["shops"]:
        try:
            waiting[shop["id"]] = waiting_now(shop["id"])
        except Exception as e:  # ohne Zahl lieber die Seite zeigen
            print(f"SEO: Wartende für {shop['id']} nicht lesbar: {e}")
    return _html(render_city(city["name"], slug, city["shops"], waiting))


@router.get("/barbershop-ohne-termin")
@router.get("/barbershop-ohne-termin/{slug}")
def barbershop_alias(slug: str = "") -> RedirectResponse:
    return RedirectResponse(f"{BASE_PATH}/{slug}" if slug else BASE_PATH, status_code=301)


@router.get("/sitemap.xml")
def sitemap() -> Response:
    base = public_url()
    today = datetime.now(BERLIN).date().isoformat()
    paths = ["/", "/features", "/preise", "/shop-map", BASE_PATH]
    shops = load_shops()
    paths += [f"{BASE_PATH}/{slug}" for slug in cities(shops)]
    paths += [f"/shop-details?shopId={s['id']}" for s in shops]

    from app import hilfe

    paths += hilfe.sitemap_paths()
    urls = "".join(f"<url><loc>{html.escape(base + p)}</loc><lastmod>{today}</lastmod></url>" for p in paths)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return Response(xml, media_type="application/xml", headers={"Cache-Control": "public, max-age=3600"})
