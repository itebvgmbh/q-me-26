"""Kopfzeile der Seiten vom Backend (Hilfe, /friseur …, alles über seo._page) – dieselbe wie in der App.

Die App zeichnet ihre Kopfzeile in frontend/src/components/Navigation.tsx. Die Menüpunkte stehen für beide in
frontend/src/navigation.json, damit man auf der Hilfe im selben Menü bleibt und die Listen nicht auseinanderlaufen.

Das Gästemenü steht fest im HTML (für Suchmaschinen und ohne JavaScript). Wer angemeldet ist, bekommt per Skript das
Menü seiner Rolle: Die App merkt sich das Konto in localStorage (dranzeit.konto, frontend/src/app/auth/konto.ts) und
die Rolle (dranzeit.rolle, Navigation.tsx). Breiten wie in der App: Gäste sehen das Menü ab 1024 px in der Zeile,
Angemeldete ab 768 px, „Preise“ und „Hilfe“ erst ab 1280 px; schmaler steht alles im Menü zum Aufklappen.

Schriften wie in der App (DM Sans, Bricolage Grotesque; SIL Open Font License) liegen unter /schrift
(frontend/public/schrift), weil die Dateinamen der App bei jedem Bauen wechseln.
"""
from __future__ import annotations

import html
import json
import logging
from functools import lru_cache
from pathlib import Path

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
.kz-pop{position:absolute;right:0;top:52px;width:240px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:4px;box-shadow:0 8px 24px rgb(0 0 0/.12),0 2px 6px rgb(0 0 0/.08)}
.kz-pop a{display:flex;align-items:center;min-height:36px;padding:0 8px;border-radius:8px;font-size:14px}
.kz-wer{margin:0 0 4px;padding:6px 8px 8px;border-bottom:1px solid var(--line);font-size:12px;color:var(--muted);overflow:hidden}
.kz-wer strong,.kz-wer span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kz-wer strong{font-size:14px;color:var(--ink)}
.kz-menue{display:block}
.kz-schleier{position:fixed;inset:0;z-index:45;background:rgb(0 0 0/.8)}
.kz-blatt{position:fixed;top:0;right:0;bottom:0;z-index:50;width:85vw;max-width:24rem;background:var(--bg);padding:24px;display:flex;flex-direction:column;gap:24px;overflow-y:auto;box-shadow:-8px 0 24px rgb(0 0 0/.15)}
.kz-blatt-kopf{display:flex;align-items:center;justify-content:space-between}
.kz-titel{margin:0;font-family:var(--display);font-size:24px;font-weight:700;letter-spacing:-.02em}
.kz-zu{background:none;border:0;color:inherit;opacity:.7}.kz-zu:hover{opacity:1}.kz-zu svg{width:18px;height:18px}
.kz-liste{display:flex;flex-direction:column;gap:4px}
.kz-liste a{display:flex;align-items:center;height:48px;padding:0 16px;border-radius:12px;font-size:18px;font-weight:500}
.kz-unten{margin-top:auto;display:flex;flex-direction:column;gap:8px}
@media(min-width:640px){.kz-in{padding:0 24px}.kz-gast,.kz-konto{display:flex}}
@media(min-width:768px){.kz:not([data-gast]) .kz-nav{display:flex}.kz:not([data-gast]) .kz-menue{display:none}}
@media(min-width:1024px){.kz[data-gast] .kz-nav{display:flex}.kz[data-gast] .kz-menue{display:none}.kz:not([data-gast]) .kz-nav a{padding:0 16px}}
@media(min-width:1280px){.kz-nav a.kz-xl{display:inline-flex}}
@media print{.kz{display:none}}
"""

# Angemeldet: Menü der Rolle statt Gästemenü (wie Navigation.tsx). Aufgeklappte Menüs schließen bei Klick daneben,
# auf den Schleier, „Schließen“ oder Escape.
JS = """(function(){var h=document.getElementById('kopfzeile');if(!h)return;var M=__MENUE__;
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
if(prof)extra.push({to:prof,label:'Mein Profil'});extra.push({to:'/hilfe',label:'Hilfe'});
bau(h.querySelector('.kz-liste'),links.concat(extra));
h.removeAttribute('data-gast');h.querySelectorAll('.kz-gast,.kz-gast-unten').forEach(function(x){x.hidden=true});
h.querySelectorAll('.kz-konto,.kz-konto-unten').forEach(function(x){x.hidden=false});
var name=(k.displayName||k.email||'').trim();h.querySelector('.kz-initial').textContent=(name[0]||'Q').toUpperCase();
h.querySelector('.kz-wer strong').textContent=k.displayName||'Dein Konto';h.querySelector('.kz-wer span').textContent=k.email||'';
var pl=h.querySelector('.kz-profil-link');if(prof)pl.href=prof;else pl.hidden=true})();"""


def kopfzeile(pfad: str) -> str:
    """HTML der Kopfzeile; pfad = Adresse der Seite (für den hervorgehobenen Menüpunkt)"""
    m = menue()
    gast = m["links"]["guest"]
    skript = JS.replace("__MENUE__", json.dumps({"links": m["links"], "profil": m.get("profil", {})}, ensure_ascii=False).replace("</", "<\\/"))
    return (
        '<header class="kz" id="kopfzeile" data-gast><div class="kz-in">'
        f'<a class="kz-logo" href="/" aria-label="Dranzeit – zur Startseite">{MARKE}<span>Dranzeit</span></a>'
        f'<nav class="kz-nav" aria-label="Hauptnavigation">{_links(gast, pfad)}</nav>'
        '<div class="kz-rechts">'
        '<div class="kz-gast"><a class="kz-knopf kz-leise" href="/login">Anmelden</a>'
        '<a class="kz-knopf" href="/register-options">Registrieren</a></div>'
        f'<div class="kz-konto" hidden><a class="kz-rund" href="/hilfe" aria-label="Hilfe und Anleitungen" title="Hilfe und Anleitungen">{ICON_HILFE}</a>'
        '<details class="kz-profil"><summary class="kz-rund kz-initial" aria-label="Konto-Menü öffnen">Q</summary>'
        '<div class="kz-pop"><p class="kz-wer"><strong>Dein Konto</strong><span></span></p>'
        '<a class="kz-profil-link" href="/profile">Mein Profil</a><a href="/logout">Abmelden</a></div></details></div>'
        f'<details class="kz-menue"><summary class="kz-rund" aria-label="Menü öffnen">{ICON_MENUE}</summary>'
        '<div class="kz-schleier"></div><div class="kz-blatt" role="dialog" aria-label="Menü">'
        f'<div class="kz-blatt-kopf"><p class="kz-titel">Menü</p><button type="button" class="kz-rund kz-zu" aria-label="Schließen">{ICON_ZU}</button></div>'
        f'<nav class="kz-liste" aria-label="Hauptnavigation">{_links(gast, pfad, aufklapp=True)}</nav>'
        '<div class="kz-unten kz-gast-unten"><a class="kz-knopf kz-gross" href="/register-options">Registrieren</a>'
        '<a class="kz-knopf kz-rahmen kz-gross" href="/login">Anmelden</a></div>'
        '<div class="kz-unten kz-konto-unten" hidden><a class="kz-knopf kz-rahmen kz-gross" href="/logout">Abmelden</a></div>'
        # Skript in der Kopfzeile: läuft, sobald sie da ist (kein Flackern), und gehört zu ihr
        f"</div></details></div></div><script>{skript}</script></header>"
    )
