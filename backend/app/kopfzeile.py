"""Kopfzeile der Seiten vom Backend (Hilfe, /friseur …, alles über seo._page) – dieselbe wie in der App.

Die App zeichnet ihre Kopfzeile in frontend/src/components/Navigation.tsx. Die Menüpunkte stehen für beide in
frontend/src/navigation.json, damit man auf der Hilfe im selben Menü bleibt und die Listen nicht auseinanderlaufen.

Das Gästemenü steht fest im HTML (für Suchmaschinen und ohne JavaScript). Wer angemeldet ist, bekommt per Skript das
Menü seiner Rolle: Die App merkt sich das Konto in localStorage (dranzeit.konto, frontend/src/app/auth/konto.ts) und
die Rolle (dranzeit.rolle, Navigation.tsx). Breiten wie in der App: Gäste sehen das Menü ab 1024 px in der Zeile,
Angemeldete ab 768 px, „Preise“ und „Hilfe“ erst ab 1280 px; schmaler steht alles im Menü zum Aufklappen.

Schriften wie in der App (DM Sans, Bricolage Grotesque; SIL Open Font License) liegen unter /schrift
(frontend/public/schrift), weil die Dateinamen der App bei jedem Bauen wechseln.

Sprachen: Die Hilfe gibt es übersetzt (app/hilfe). Auf ihren Seiten steht die Kopfzeile in der Sprache der Seite
(Menüpunkte über app/i18n, dieselben Wörter wie in der App) mit Sprachwahl wie in der App (Kugel mit Kürzel). Die
Wahl merkt sich der Browser wie die App (dranzeit:sprache), damit App und Hilfe dieselbe Sprache sprechen.
"""
from __future__ import annotations

import html
import json
import logging
from functools import lru_cache
from pathlib import Path

from app.i18n import t, uebersetze

NAV_DATEI = Path(__file__).resolve().parents[2] / "frontend" / "src" / "navigation.json"

# Fehlt die Liste (sollte nie passieren, der Server hat das ganze Repo), bleibt wenigstens Logo und Hilfe
NOTFALL = {"links": {"guest": [{"to": "/hilfe", "label": "Hilfe", "server": True}]}, "profil": {}, "verkauf": []}


@lru_cache(maxsize=1)
def menue() -> dict:
    try:
        return json.loads(NAV_DATEI.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logging.exception("Kopfzeile: %s nicht lesbar", NAV_DATEI)
        return NOTFALL


def _e(value) -> str:
    return html.escape(str(value or ""), quote=True)


def aktiv(punkt: dict, pfad: str) -> bool:
    """Wie in der App: die Seite selbst samt Unterseiten, dazu die Bereiche aus also (Anfang der Adresse)"""
    ziel = punkt["to"].rstrip("/")
    return pfad == ziel or pfad.startswith(ziel + "/") or any(pfad.startswith(p) for p in punkt.get("also", []))


SPRACHEN = (("de", "Deutsch"), ("en", "English"), ("tr", "Türkçe"), ("ar", "العربية"))


def _ziel(to: str, sprache: str) -> str:
    """Die Hilfe in der Sprache der Seite; alles andere (App) wählt die Sprache selbst"""
    return f"/{sprache}{to}" if sprache != "de" and (to == "/hilfe" or to.startswith("/hilfe/")) else to


def _lokal(punkte: list[dict], sprache: str) -> list[dict]:
    """Menüpunkte in der Sprache der Seite"""
    return [{**p, "to": _ziel(p["to"], sprache), "label": uebersetze(p["label"], sprache)} for p in punkte]


def _links(punkte: list[dict], pfad: str, aufklapp: bool = False) -> str:
    """aufklapp: für das Menü zum Aufklappen – dort stehen alle Punkte, auch die erst ab 1280 px in der Zeile"""
    out = []
    for p in punkte:
        an = aktiv(p, pfad)
        cls = " ".join(c for c in ("kz-xl" if p.get("ab") == "xl" and not aufklapp else "", "kz-an" if an else "") if c)
        out.append(
            f'<a href="{_e(p["to"])}"' + (f' class="{cls}"' if cls else "") + (' aria-current="page"' if an else "")
            + f">{_e(p['label'])}</a>"
        )
    return "".join(out)


# Wartemarke wie BrandMark in frontend/src/components/brand/Logo.tsx
MARKE = (
    '<span class="kz-marke" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 6h16a2 2 0 0 1 2 2v1.5a2.5 '
    '2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5V8a2 2 0 0 1 2-2z"/><path d="M6.5 12h11" '
    'stroke="#141414" stroke-width="1.6" stroke-dasharray="2 1.6"/></svg></span>'
)
_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
ICON_MENUE = _SVG + '<path d="M4 6h16M4 12h16M4 18h16"/></svg>'
ICON_HILFE = _SVG + '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>'
ICON_ZU = _SVG + '<path d="M18 6 6 18M6 6l12 12"/></svg>'
ICON_KUGEL = _SVG + '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>'
ICON_HAKEN = _SVG + '<path d="M20 6 9 17l-5-5"/></svg>'

STYLE = """
.kz{position:sticky;top:0;z-index:40;border-bottom:1px solid var(--line);font-family:var(--sans);color:var(--ink)}
.kz::before{content:"";position:absolute;inset:0;z-index:-1;background:hsl(50 16% 92.5%/.85);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.kz a{color:inherit;text-decoration:none}.kz details{margin:0}.kz summary{list-style:none}.kz summary::-webkit-details-marker{display:none}
.kz [hidden]{display:none!important}
.kz-in{max-width:72rem;margin:0 auto;height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 16px}
.kz-logo{display:flex;align-items:center;gap:10px;min-height:44px;border-radius:8px;font-family:var(--display);font-size:22px;font-weight:800;letter-spacing:-.03em;line-height:1}
.kz-marke{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:#141414;color:var(--signal);flex-shrink:0}
.kz-marke svg{width:19px;height:19px}
.kz-nav{display:none;align-items:center;gap:4px}
.kz-nav a{display:inline-flex;align-items:center;height:40px;padding:0 12px;border-radius:999px;font-size:15px;font-weight:500;white-space:nowrap;transition:background-color .15s}
.kz-nav a:hover,.kz-rund:hover,.kz-leise:hover,.kz-pop a:hover,.kz-liste a:hover{background:rgb(20 20 20/.05)}
.kz-nav a.kz-an,.kz-liste a.kz-an{background:var(--signal);color:#141414}
.kz-nav a.kz-xl{display:none}
.kz-rechts{display:flex;align-items:center;gap:8px}
.kz-gast,.kz-konto{display:none;align-items:center;gap:8px}
.kz-knopf{display:inline-flex;align-items:center;justify-content:center;height:44px;padding:0 20px;border-radius:999px;font-size:14px;font-weight:600;white-space:nowrap;background:#141414;color:var(--signal)!important}
.kz-knopf.kz-leise{background:transparent;color:var(--ink)!important}
.kz-knopf.kz-rahmen{background:var(--bg);color:var(--ink)!important;border:1px solid var(--line)}
.kz-knopf.kz-gross{height:48px;padding:0 24px;font-size:16px}
.kz-rund{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;cursor:pointer}
.kz-rund svg{width:24px;height:24px}
.kz-initial{background:#141414;color:var(--signal);font-family:var(--display);font-weight:700;font-size:16px}
.kz-initial:hover{background:#141414!important}
.kz-profil{position:relative}
.kz-pop{position:absolute;inset-inline-end:0;top:52px;width:240px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:4px;box-shadow:0 8px 24px rgb(0 0 0/.12),0 2px 6px rgb(0 0 0/.08)}
.kz-pop a{display:flex;align-items:center;min-height:36px;padding:0 8px;border-radius:8px;font-size:14px}
.kz-wer{margin:0 0 4px;padding:6px 8px 8px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);overflow:hidden}
.kz-wer strong,.kz-wer span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kz-wer strong{font-size:14px;color:var(--ink)}
.kz-menue{display:block}
.kz-schleier{position:fixed;inset:0;z-index:45;background:rgb(0 0 0/.8)}
.kz-blatt{position:fixed;top:0;inset-inline-end:0;bottom:0;z-index:50;width:85vw;max-width:24rem;background:var(--bg);padding:24px;display:flex;flex-direction:column;gap:24px;overflow-y:auto;box-shadow:-8px 0 24px rgb(0 0 0/.15)}
.kz-blatt-kopf{display:flex;align-items:center;justify-content:space-between}
.kz-titel{margin:0;font-family:var(--display);font-size:24px;font-weight:700;letter-spacing:-.02em}
.kz-zu{background:none;border:0;color:inherit;opacity:.7}.kz-zu:hover{opacity:1}.kz-zu svg{width:18px;height:18px}
.kz-liste{display:flex;flex-direction:column;gap:4px}
.kz-liste a{display:flex;align-items:center;height:48px;padding:0 16px;border-radius:12px;font-size:18px;font-weight:500}
.kz-unten{margin-top:auto;display:flex;flex-direction:column;gap:8px}
.kz-sprache{position:relative}
.kz-sprache summary{width:auto;min-width:44px;gap:6px;padding:0 10px;font-size:14px;font-weight:600;text-transform:uppercase}
.kz-sprache summary span{display:none}
.kz-sprache .kz-pop{width:176px}.kz-sprache .kz-pop a{justify-content:space-between}
.kz-sprache .kz-pop svg{width:16px;height:16px}
[dir=rtl] .kz-blatt{box-shadow:8px 0 24px rgb(0 0 0/.15)}
@media(min-width:1280px){.kz-sprache summary span{display:inline}}
@media(min-width:640px){.kz-in{padding:0 24px}.kz-gast,.kz-konto{display:flex}}
@media(min-width:768px){.kz:not([data-gast]) .kz-nav{display:flex}.kz:not([data-gast]) .kz-menue{display:none}}
@media(min-width:1024px){.kz[data-gast] .kz-nav{display:flex}.kz[data-gast] .kz-menue{display:none}.kz:not([data-gast]) .kz-nav a{padding:0 16px}}
@media(min-width:1280px){.kz-nav a.kz-xl{display:inline-flex}}
@media print{.kz{display:none}}
"""

# Angemeldet: Menü der Rolle statt Gästemenü (wie Navigation.tsx). Aufgeklappte Menüs schließen bei Klick daneben,
# auf den Schleier, „Schließen“ oder Escape.
JS = """(function(){var h=document.getElementById('kopfzeile');if(!h)return;var M=__MENUE__;
h.querySelectorAll('[data-sprache]').forEach(function(a){a.addEventListener('click',function(){
try{localStorage.setItem('dranzeit:sprache',a.getAttribute('data-sprache'))}catch(e){}})});
function zu(){h.querySelectorAll('details[open]').forEach(function(d){d.open=false})}
document.addEventListener('click',function(e){var t=e.target;if(t.closest&&(t.closest('.kz-zu')||t.classList.contains('kz-schleier')))return zu();
h.querySelectorAll('details[open]').forEach(function(d){if(!d.contains(t))d.open=false})});
document.addEventListener('keydown',function(e){if(e.key==='Escape')zu()});
var k=null,r=null;try{k=JSON.parse(localStorage.getItem('dranzeit.konto')||'null');r=localStorage.getItem('dranzeit.rolle')}catch(e){}
if(!k||!k.uid)return;var tresen=k.bereich==='tresen',links=tresen?M.links.tresen:(r&&M.links[r])||[],p=location.pathname;
function an(x){var z=x.to.replace(/\\/$/,'');return p===z||p.indexOf(z+'/')===0||(x.also||[]).some(function(a){return p.indexOf(a)===0})}
function bau(ziel,liste){ziel.textContent='';liste.forEach(function(x){var a=document.createElement('a');a.href=x.to;a.textContent=x.label;
if(an(x)){a.className='kz-an';a.setAttribute('aria-current','page')}ziel.appendChild(a)})}
bau(h.querySelector('.kz-nav'),links);var extra=[];var prof=!tresen&&r&&M.profil[r];
if(prof)extra.push({to:prof,label:M.texte.profil});extra.push({to:M.hilfe,label:M.texte.hilfe});
bau(h.querySelector('.kz-liste'),links.concat(extra));
h.removeAttribute('data-gast');h.querySelectorAll('.kz-gast,.kz-gast-unten').forEach(function(x){x.hidden=true});
h.querySelectorAll('.kz-konto,.kz-konto-unten').forEach(function(x){x.hidden=false});
var name=(k.displayName||k.email||'').trim();h.querySelector('.kz-initial').textContent=(name[0]||'Q').toUpperCase();
h.querySelector('.kz-wer strong').textContent=k.displayName||M.texte.konto;h.querySelector('.kz-wer span').textContent=k.email||'';
var pl=h.querySelector('.kz-profil-link');if(prof)pl.href=prof;else pl.hidden=true})();"""


def sprachwahl(sprache: str, alternativen: dict[str, str]) -> str:
    """Kugel mit Kürzel wie in der App (SprachWahl.tsx); jede Sprache, in der es die Seite gibt"""
    eintraege = "".join(
        f'<a href="{_e(alternativen[code])}" lang="{code}" hreflang="{code}" data-sprache="{code}"'
        + (' dir="rtl"' if code == "ar" else "") + (' aria-current="true"' if code == sprache else "")
        + f">{_e(name)}{ICON_HAKEN if code == sprache else ''}</a>"
        for code, name in SPRACHEN if code in alternativen
    )
    return (f'<details class="kz-sprache"><summary class="kz-rund" aria-label="{_e(t("Sprache wählen", sprache))}" '
            f'title="{_e(t("Sprache wählen", sprache))}">{ICON_KUGEL}<span>{_e(sprache)}</span></summary>'
            f'<div class="kz-pop">{eintraege}</div></details>')


def kopfzeile(pfad: str, sprache: str = "de", alternativen: dict[str, str] | None = None) -> str:
    """HTML der Kopfzeile; pfad = Adresse der Seite (für den hervorgehobenen Menüpunkt). sprache und alternativen
    (Sprache → Adresse derselben Seite) nur auf übersetzten Seiten: Texte in der Sprache, dazu die Sprachwahl."""
    m = menue()
    links = {rolle: _lokal(punkte, sprache) for rolle, punkte in m["links"].items()}
    gast = links["guest"]
    hilfe = _ziel("/hilfe", sprache)
    daten = {"links": links, "profil": m.get("profil", {}), "hilfe": hilfe,
             "texte": {"profil": t("Mein Profil", sprache), "hilfe": t("Hilfe", sprache), "konto": t("Dein Konto", sprache)}}
    skript = JS.replace("__MENUE__", json.dumps(daten, ensure_ascii=False).replace("</", "<\\/"))
    wahl = sprachwahl(sprache, alternativen) if alternativen and len(alternativen) > 1 else ""
    anmelden, registrieren, abmelden = t("Anmelden", sprache), t("Registrieren", sprache), t("Abmelden", sprache)
    haupt, zu = _e(t("Hauptnavigation", sprache)), _e(t("Schließen", sprache))
    return (
        '<header class="kz" id="kopfzeile" data-gast><div class="kz-in">'
        f'<a class="kz-logo" href="/" aria-label="{_e(t("Dranzeit – zur Startseite", sprache))}">{MARKE}<span>Dranzeit</span></a>'
        f'<nav class="kz-nav" aria-label="{haupt}">{_links(gast, pfad)}</nav>'
        f'<div class="kz-rechts">{wahl}'
        f'<div class="kz-gast"><a class="kz-knopf kz-leise" href="/login">{_e(anmelden)}</a>'
        f'<a class="kz-knopf" href="/register-options">{_e(registrieren)}</a></div>'
        f'<div class="kz-konto" hidden><a class="kz-rund" href="{hilfe}" aria-label="{_e(t("Hilfe und Anleitungen", sprache))}" '
        f'title="{_e(t("Hilfe und Anleitungen", sprache))}">{ICON_HILFE}</a>'
        f'<details class="kz-profil"><summary class="kz-rund kz-initial" aria-label="{_e(t("Konto-Menü öffnen", sprache))}">Q</summary>'
        f'<div class="kz-pop"><p class="kz-wer"><strong>{_e(t("Dein Konto", sprache))}</strong><span></span></p>'
        f'<a class="kz-profil-link" href="/profile">{_e(t("Mein Profil", sprache))}</a><a href="/logout">{_e(abmelden)}</a></div></details></div>'
        f'<details class="kz-menue"><summary class="kz-rund" aria-label="{_e(t("Menü öffnen", sprache))}">{ICON_MENUE}</summary>'
        f'<div class="kz-schleier"></div><div class="kz-blatt" role="dialog" aria-label="{_e(t("Menü", sprache))}">'
        f'<div class="kz-blatt-kopf"><p class="kz-titel">{_e(t("Menü", sprache))}</p><button type="button" class="kz-rund kz-zu" aria-label="{zu}">{ICON_ZU}</button></div>'
        f'<nav class="kz-liste" aria-label="{haupt}">{_links(gast, pfad, aufklapp=True)}</nav>'
        f'<div class="kz-unten kz-gast-unten"><a class="kz-knopf kz-gross" href="/register-options">{_e(registrieren)}</a>'
        f'<a class="kz-knopf kz-rahmen kz-gross" href="/login">{_e(anmelden)}</a></div>'
        f'<div class="kz-unten kz-konto-unten" hidden><a class="kz-knopf kz-rahmen kz-gross" href="/logout">{_e(abmelden)}</a></div>'
        # Skript in der Kopfzeile: läuft, sobald sie da ist (kein Flackern), und gehört zu ihr
        f"</div></details></div></div><script>{skript}</script></header>"
    )
