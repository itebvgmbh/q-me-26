"""Hilfe-Bereich /hilfe: Anleitungen, häufige Fragen und Begriffe für Läden und ihre Kunden.

Die Artikel liegen als Markdown in app/hilfe/artikel/<adresse>.md, oben ein Kopf:

    ---
    titel: In 10 Minuten startklar
    kurz: Ein Satz für Übersicht, Suche und Suchmaschinen.
    thema: loslegen            (Schlüssel aus THEMEN)
    reihenfolge: 1             (innerhalb des Themas)
    stichworte: anfangen, einrichten
    faq: ja                    (optional: jede ###-Überschrift ist eine Frage)
    ---

Sprachen wie in der App: Deutsch unter /hilfe, Übersetzungen unter /en/hilfe, /tr/hilfe, /ar/hilfe (Arabisch von
rechts nach links). Eine Übersetzung liegt in app/hilfe/artikel/<sprache>/<adresse>.md mit eigenem Kopf (titel, kurz,
stichworte, quelle); Thema, Reihenfolge und faq kommen vom deutschen Artikel. quelle ist der Fingerabdruck des
deutschen Artikels, aus dem übersetzt wurde (quelle_von) – ändert sich der deutsche, meldet tests/test_hilfe.py die
Übersetzung als veraltet (Liste und Abhaken: python -m app.hilfe.stand). Links auf /hilfe/… zeigen in einer
Übersetzung auf dieselbe Sprache. Die Texte rundherum (Übersicht, Kopfzeile, Fußzeile) übersetzt app/i18n.

Wer die App in einer anderen Sprache nutzt, kommt von /hilfe/… gleich auf seine Sprache (Skript im Kopf der deutschen
Seiten, wie frontend/src/i18n/index.ts: gespeicherte Wahl, sonst Browsersprache; Suchmaschinen bleiben auf Deutsch).
Die Sprachwahl in der Kopfzeile merkt sich die Wahl für App und Hilfe (dranzeit:sprache).

Fertiges HTML vom Server wie die Stadtseiten (app/seo.py), damit Suchmaschinen es finden. Erreichbar unter
/hilfe (Caddy leitet weiter, deploy/caddy-domain.py) und unter /routes/seo/hilfe.

Markdown bewusst klein (getestet in tests/test_hilfe.py): ## und ### Überschriften, Absätze, Listen mit "- "
und "1. ", **fett**, *kursiv*, [Link](/pfad), [Knopf](/pfad){knopf}, ![Bildtext](/img/hilfe/x.webp) in eigener
Zeile, "> " als Hinweiskasten ("> **Tipp:** …", "> **Achtung:** …"; in den Übersetzungen HINWEISE).
"""

import hashlib
import html
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app import seo
from app.i18n import merke, t, uebersetze

ARTIKEL_DIR = Path(__file__).parent / "artikel"
BASE_PATH = "/hilfe"
KONTAKT = "hilfe@dranzeit.de"
START = "in-10-minuten-startklar"
KUNDEN = "so-funktioniert-die-nummer"
FRAGEN = "fragen-fuer-laeden"

SPRACHEN = ("de", "en", "tr", "ar")
UEBERSETZT = ("en", "tr", "ar")
# Hinweiskästen: so beginnt ein Tipp bzw. eine Warnung in jeder Sprache (für die Farbe am Rand)
HINWEISE = {"tipp": ("Tipp", "Tip", "İpucu", "نصيحة"), "achtung": ("Achtung", "Important", "Dikkat", "تنبيه")}

# Reihenfolge wie auf der Übersicht
THEMEN = {
    "loslegen": merke("Loslegen"),
    "tresen": merke("Am Tresen"),
    "team": merke("Team und Arbeitszeiten"),
    "laden": merke("Laden und Leistungen"),
    "tarif": merke("Tarif und Abrechnung"),
    "konto": merke("Konto und Datenschutz"),
    "kunden": merke("Für deine Kunden"),
    "nachschlagen": merke("Fragen und Begriffe"),
}

router = APIRouter(include_in_schema=False)


def basis(sprache: str = "de") -> str:
    """Anfang der Adressen: /hilfe, /en/hilfe, /tr/hilfe, /ar/hilfe"""
    return BASE_PATH if sprache == "de" else f"/{sprache}{BASE_PATH}"


@dataclass
class Gerendert:
    html: str
    inhalt: list[tuple[str, str]] = field(default_factory=list)  # (id, Text) der ##-Überschriften
    fragen: list[tuple[str, str]] = field(default_factory=list)  # (Frage, Antwort als Text) bei faq: ja
    ueberschriften: list[str] = field(default_factory=list)


@dataclass
class Artikel:
    slug: str
    titel: str
    kurz: str
    thema: str
    reihenfolge: int
    stichworte: str
    faq: bool
    text: str
    sprache: str = "de"
    quelle: str = ""  # bei Übersetzungen: Fingerabdruck des deutschen Artikels, aus dem übersetzt wurde

    @property
    def pfad(self) -> str:
        return f"{basis(self.sprache)}/{self.slug}"


# ---------- Markdown ----------

_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)(\{knopf\})?")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])")
_IMAGE = re.compile(r"^!\[([^\]]*)\]\((/img/hilfe/[\w./-]+)\)$")
_ITEM_UL = re.compile(r"^- (.*)$")
_ITEM_OL = re.compile(r"^\d+\. (.*)$")
_ERLAUBT = ("/", "#", "https://", "mailto:")
_HILFE_LINK = re.compile(r"^/hilfe(?=$|[/#?])")


def _link(m: re.Match, sprache: str = "de") -> str:
    label, url, knopf = m.group(1), html.unescape(m.group(2)), m.group(3)
    if not url.startswith(_ERLAUBT) or url.startswith("//"):
        raise ValueError(f"Link nicht erlaubt: {url}")
    if sprache != "de":
        url = _HILFE_LINK.sub(basis(sprache), url)  # in der Übersetzung bleibt man in ihrer Sprache
    cls = ' class="knopf"' if knopf else ""
    extern = ' rel="noopener" target="_blank"' if url.startswith("https://") else ""
    return f'<a{cls} href="{html.escape(url, quote=True)}"{extern}>{label}</a>'


def inline(text: str, sprache: str = "de") -> str:
    """Eine Zeile Text: erst alles maskieren, dann Links, fett und kursiv."""
    s = html.escape(text, quote=True)
    s = _LINK.sub(lambda m: _link(m, sprache), s)
    s = _BOLD.sub(r"<strong>\1</strong>", s)
    return _ITALIC.sub(r"<em>\1</em>", s)


def _plain(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def _hinweis_art(text: str) -> str:
    for art, woerter in HINWEISE.items():
        if any(text.startswith(f"**{w}") for w in woerter):
            return f" {art}"
    return ""


def render_markdown(md: str, faq: bool = False, sprache: str = "de") -> Gerendert:
    result = Gerendert(html="")
    out: list[str] = []
    para: list[str] = []
    items: list[str] = []
    list_tag = ""
    quote: list[str] = []
    frage: list = []  # [Frage, [HTML-Teile der Antwort]]
    anker_da: set[str] = set()

    def zeile(text: str) -> str:
        return inline(text, sprache)

    def anker(title: str) -> str:
        # Überschriften auf Arabisch (oder nur mit ı, ş …) ergeben keine lesbare Adresse: dann durchzählen
        a = seo.slugify(title) or f"abschnitt-{len(anker_da) + 1}"
        while a in anker_da:
            a = f"{a}-{len(anker_da) + 1}"
        anker_da.add(a)
        return a

    def emit(fragment: str):
        out.append(fragment)
        if frage:
            frage[1].append(fragment)

    def close_frage():
        if frage:
            result.fragen.append((frage[0], " ".join(_plain(x) for x in frage[1])))
            frage.clear()

    def flush():
        nonlocal list_tag
        if para:
            emit(f"<p>{zeile(' '.join(para))}</p>")
            para.clear()
        if items:
            emit(f"<{list_tag}>" + "".join(f"<li>{zeile(x)}</li>" for x in items) + f"</{list_tag}>")
            items.clear()
            list_tag = ""
        if quote:
            text = " ".join(quote)
            emit(f'<aside class="hinweis{_hinweis_art(text)}">{zeile(text)}</aside>')
            quote.clear()

    for raw in md.replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            if para or quote:
                flush()
            continue
        if line.startswith("## ") or line.startswith("### "):
            flush()
            level = 2 if line.startswith("## ") else 3
            title = line[level + 1:].strip()
            a = anker(title)
            if level == 2 or faq:
                close_frage()
            if level == 2:
                result.inhalt.append((a, _plain(zeile(title))))
            result.ueberschriften.append(_plain(zeile(title)))
            out.append(f'<h{level} id="{a}">{zeile(title)}</h{level}>')
            if level == 3 and faq:
                frage.extend([_plain(zeile(title)), []])
            continue
        image = _IMAGE.match(stripped)
        if image:
            flush()
            alt = html.escape(image.group(1), quote=True)
            emit(f'<figure><img src="{html.escape(image.group(2), quote=True)}" alt="{alt}" loading="lazy">'
                 f"<figcaption>{alt}</figcaption></figure>")
            continue
        if line.startswith(">"):
            if para or items:
                flush()
            quote.append(line[1:].strip())
            continue
        ul, ol = _ITEM_UL.match(line), _ITEM_OL.match(line)
        if ul or ol:
            tag = "ul" if ul else "ol"
            if para or quote or (items and list_tag != tag):
                flush()
            list_tag = tag
            items.append((ul or ol).group(1))
            continue
        if items and line.startswith("  "):
            items[-1] += " " + stripped
            continue
        if items:
            flush()
        para.append(stripped)
    flush()
    close_frage()
    result.html = "".join(out)
    return result


# ---------- Artikel laden ----------

_KOPF = re.compile(r"^---\n(.*?)\n---\n", re.S)
_cache: dict = {}


def _normal(source: str) -> str:
    return source.replace("\r\n", "\n").lstrip("﻿")


def quelle_von(source: str) -> str:
    """Fingerabdruck eines deutschen Artikels (Kopf und Text); steht als quelle in seinen Übersetzungen"""
    return hashlib.sha256(_normal(source).strip().encode("utf-8")).hexdigest()[:12]


def _kopf(slug: str, source: str) -> tuple[dict[str, str], str]:
    source = _normal(source)
    m = _KOPF.match(source)
    if not m:
        raise ValueError(f"{slug}: Kopf mit --- fehlt")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        key, _, value = line.partition(":")
        if key.strip():
            meta[key.strip()] = value.strip()
    return meta, source[m.end():]


def parse_artikel(slug: str, source: str) -> Artikel:
    meta, text = _kopf(slug, source)
    for key in ("titel", "kurz", "thema"):
        if not meta.get(key):
            raise ValueError(f"{slug}: {key} fehlt")
    if meta["thema"] not in THEMEN:
        raise ValueError(f"{slug}: unbekanntes Thema {meta['thema']}")
    return Artikel(
        slug=slug,
        titel=meta["titel"],
        kurz=meta["kurz"],
        thema=meta["thema"],
        reihenfolge=int(meta.get("reihenfolge") or 99),
        stichworte=meta.get("stichworte", ""),
        faq=meta.get("faq", "").lower() in ("ja", "true", "1"),
        text=text,
    )


def parse_uebersetzung(original: Artikel, sprache: str, source: str) -> Artikel:
    """Übersetzung: eigener Titel, Kurztext, Stichwörter und Text; Thema, Reihenfolge und faq vom deutschen Artikel"""
    meta, text = _kopf(f"{sprache}/{original.slug}", source)
    for key in ("titel", "kurz"):
        if not meta.get(key):
            raise ValueError(f"{sprache}/{original.slug}: {key} fehlt")
    return Artikel(
        slug=original.slug, titel=meta["titel"], kurz=meta["kurz"], thema=original.thema,
        reihenfolge=original.reihenfolge, stichworte=meta.get("stichworte", ""), faq=original.faq, text=text,
        sprache=sprache, quelle=meta.get("quelle", ""),
    )


def _ordner(sprache: str) -> Path:
    return ARTIKEL_DIR if sprache == "de" else ARTIKEL_DIR / sprache


def alle_artikel(sprache: str = "de") -> dict[str, Artikel]:
    """Alle Artikel einer Sprache nach Adresse; neu eingelesen, sobald sich eine Datei ändert. In einer Übersetzung nur
    die, die es übersetzt gibt (und deren deutscher Artikel noch existiert)."""
    deutsch = sorted(ARTIKEL_DIR.glob("*.md"))
    files = deutsch if sprache == "de" else sorted(_ordner(sprache).glob("*.md"))
    stand = tuple((f.name, f.stat().st_mtime_ns) for f in [*deutsch, *files])
    hit = _cache.get(sprache)
    if hit and hit[0] == stand:
        return hit[1]
    if sprache == "de":
        artikel = {f.stem: parse_artikel(f.stem, f.read_text(encoding="utf-8")) for f in deutsch}
    else:
        original = alle_artikel("de")
        artikel = {f.stem: parse_uebersetzung(original[f.stem], sprache, f.read_text(encoding="utf-8"))
                   for f in files if f.stem in original}
    _cache[sprache] = (stand, artikel)
    return artikel


def veraltet() -> list[tuple[str, str]]:
    """(sprache, adresse) der Übersetzungen, deren deutscher Artikel sich seit dem Übersetzen geändert hat"""
    quellen = {f.stem: quelle_von(f.read_text(encoding="utf-8")) for f in ARTIKEL_DIR.glob("*.md")}
    return [(s, a.slug) for s in UEBERSETZT for a in alle_artikel(s).values() if a.quelle != quellen.get(a.slug)]


def fehlend() -> list[tuple[str, str]]:
    """(sprache, adresse) der deutschen Artikel ohne Übersetzung"""
    return [(s, slug) for s in UEBERSETZT for slug in alle_artikel("de") if slug not in alle_artikel(s)]


def alternativen(slug: str | None = None) -> dict[str, str]:
    """Dieselbe Seite in allen Sprachen, die es gibt: Sprache → Adresse (für hreflang und die Sprachwahl)"""
    return {s: basis(s) + (f"/{slug}" if slug else "") for s in SPRACHEN if not slug or slug in alle_artikel(s)}


def nach_thema(artikel: dict[str, Artikel]) -> dict[str, list[Artikel]]:
    groups: dict[str, list[Artikel]] = {key: [] for key in THEMEN}
    for a in artikel.values():
        groups[a.thema].append(a)
    for items in groups.values():
        items.sort(key=lambda a: (a.reihenfolge, a.titel))
    return {k: v for k, v in groups.items() if v}


def sitemap_paths() -> list[str]:
    paths = []
    for s in SPRACHEN:
        paths += [basis(s)] + [a.pfad for a in sorted(alle_artikel(s).values(), key=lambda a: a.slug)]
    return paths


# ---------- Seiten ----------

STYLE = """
.crumbs{font-size:14px;color:var(--muted);margin:0 0 12px}.crumbs a{color:inherit}
.doc{max-width:70ch}.doc a{color:inherit;text-decoration-thickness:2px;text-underline-offset:3px}
.doc h2{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:40px 0 8px;scroll-margin-top:16px}
.doc h3{font-size:19px;line-height:1.3;margin:28px 0 6px;scroll-margin-top:16px}
.doc ol,.doc ul{padding-inline-start:1.4em}.doc li{margin:6px 0}
.doc a.knopf{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:12px;font-weight:700;text-decoration:none;background:var(--ink);color:var(--bg)}
.hinweis{display:block;background:var(--card);border:1px solid var(--line);border-inline-start:6px solid var(--muted);border-radius:14px;padding:14px 16px;margin:18px 0}
.hinweis.tipp{border-inline-start-color:var(--signal)}.hinweis.achtung{border-inline-start-color:#d4553a}
.toc{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 18px;margin:0 0 8px;max-width:70ch}
.toc ul{margin:6px 0 0;padding:0;list-style:none}.toc li{margin:4px 0}.toc a{color:inherit}
figure{margin:22px 0}figure img{display:block;max-width:100%;height:auto;border:1px solid var(--line);border-radius:14px}
figcaption{color:var(--muted);font-size:14px;margin-top:6px}
.suche{width:100%;min-height:54px;font:inherit;font-size:18px;padding:0 16px;border-radius:14px;border:2px solid var(--ink);background:var(--card);color:var(--ink)}
.tiles{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin:24px 0 8px}
.tile{display:block;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px 20px;text-decoration:none;color:inherit}
.tile strong{display:block;font-size:20px;letter-spacing:-.02em;margin-bottom:4px}
.tile.main{background:var(--signal);border-color:var(--signal);color:#141414}
.thema{margin:36px 0 0}.thema h2{font-size:24px;letter-spacing:-.02em;margin:0 0 10px}
.artikel{display:grid;gap:8px;list-style:none;padding:0;margin:0}
.artikel a{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 16px;text-decoration:none;color:inherit}
.artikel a span{display:block;color:var(--muted);font-size:14px}
.mehr{margin:48px 0 0}.mehr h2{font-size:22px;margin:0 0 10px}
.bilder-de{color:var(--muted);font-size:14px;margin:0 0 8px}
[hidden]{display:none!important}
"""

SUCHE_JS = """(()=>{const q=document.querySelector('.suche');if(!q)return;q.hidden=false;
const norm=s=>s.toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss');
const items=[...document.querySelectorAll('.artikel li')],leer=document.querySelector('.leer');
const run=()=>{const w=norm(q.value).split(/\\s+/).filter(Boolean);let n=0;
items.forEach(li=>{const ok=w.every(x=>li.dataset.s.includes(x));li.hidden=!ok;if(ok)n++;});
document.querySelectorAll('.thema').forEach(s=>{s.hidden=!s.querySelector('li:not([hidden])');});
document.querySelectorAll('.tiles').forEach(t=>{t.hidden=w.length>0;});leer.hidden=n>0;};
q.addEventListener('input',run);const p=new URLSearchParams(location.search).get('q');if(p){q.value=p;run();}})();"""

# Deutsche Seite, aber die App läuft in einer anderen Sprache: gleich dorthin (wie ermittleSprache in
# frontend/src/i18n/index.ts – gespeicherte Wahl, sonst Browsersprache; Suchmaschinen bleiben auf der deutschen Seite)
SPRACHE_JS = """(function(){var a=__ALT__,s=null;try{s=localStorage.getItem('dranzeit:sprache')}catch(e){}
if(new URLSearchParams(location.search).get('sprache'))s=new URLSearchParams(location.search).get('sprache');
if(!s){if(/bot\\b|bot\\/|crawl|spider|slurp|lighthouse/i.test(navigator.userAgent))return;
var l=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];
for(var i=0;i<l.length;i++){var c=(l[i]||'').slice(0,2).toLowerCase();if(c==='de'||a[c]){s=c;break}}}
if(s&&s!=='de'&&a[s])location.replace(a[s]+(__ANKER__?location.hash:''))})();"""


def _e(value) -> str:
    return html.escape(str(value or ""), quote=True)


def _suchtext(a: Artikel, gerendert: Gerendert) -> str:
    text = " ".join([a.titel, a.kurz, a.stichworte, *gerendert.ueberschriften]).lower()
    for x, y in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(x, y)
    return text


def _kontakt(sprache: str) -> str:
    return (
        f'<div class="cta"><strong>{_e(t("Nicht gefunden, was du suchst?", sprache))}</strong> '
        + t("Schreib uns an {adresse}. Wir helfen dir gern weiter.", sprache,
            adresse=f'<a href="mailto:{KONTAKT}">{KONTAKT}</a>')
        + "</div>"
    )


def _liste(items: list[Artikel], suche: bool = False) -> str:
    rows = []
    for a in items:
        s = f' data-s="{_e(_suchtext(a, render_markdown(a.text, a.faq, a.sprache)))}"' if suche else ""
        rows.append(f'<li{s}><a href="{a.pfad}"><strong>{_e(a.titel)}</strong><span>{_e(a.kurz)}</span></a></li>')
    return f'<ul class="artikel">{"".join(rows)}</ul>'


def _kopf_extra(sprache: str, alt: dict[str, str], anker: bool) -> str:
    """Auf deutschen Seiten: in die Sprache der App wechseln, wenn es die Seite darin gibt"""
    if sprache != "de" or len(alt) < 2:
        return ""
    ziele = json.dumps({s: p for s, p in alt.items() if s != "de"}).replace("</", "<\\/")
    return f"<script>{SPRACHE_JS.replace('__ALT__', ziele).replace('__ANKER__', 'true' if anker else 'false')}</script>"


KACHELN = (
    (START, merke("Neu bei Dranzeit?"), merke("In 10 Minuten vom Konto bis zum ersten Kunden."), "tile main"),
    (KUNDEN, merke("Du hast eine Nummer gezogen?"), merke("So funktioniert’s, wenn du wartest."), "tile"),
    (FRAGEN, merke("Häufige Fragen"), merke("Kosten, Geräte, Datenschutz, Kunden ohne Smartphone."), "tile"),
)


def render_index(artikel: dict[str, Artikel], sprache: str = "de") -> str:
    themen = "".join(
        f'<section class="thema" id="{key}"><h2>{_e(uebersetze(THEMEN[key], sprache))}</h2>{_liste(items, suche=True)}</section>'
        for key, items in nach_thema(artikel).items()
    )
    tiles = []
    for slug, title, text, cls in KACHELN:
        if slug in artikel:
            tiles.append(f'<a class="{cls}" href="{basis(sprache)}/{slug}"><strong>{_e(uebersetze(title, sprache))}</strong>'
                         f"{_e(uebersetze(text, sprache))}</a>")
    mail = f'<a href="mailto:{KONTAKT}">{KONTAKT}</a>'
    body = (
        f"<h1>{_e(t('Wie können wir helfen?', sprache))}</h1>"
        f'<p class="lead">{_e(t("Anleitungen und Antworten rund um Dranzeit – für Läden und für alle, die eine Nummer gezogen haben.", sprache))}</p>'
        f'<input class="suche" type="search" placeholder="{_e(t("Suchen, z. B. Plakat, Pause, kündigen", sprache))}" '
        f'aria-label="{_e(t("Hilfe durchsuchen", sprache))}" hidden>'
        f'<div class="tiles">{"".join(tiles)}</div>'
        f'<p class="leer lead" hidden>{t("Dazu haben wir noch keinen Artikel. Schreib uns an {adresse}.", sprache, adresse=mail)}</p>'
        f"{themen}{_kontakt(sprache)}<script>{SUCHE_JS}</script>"
    )
    json_ld = {"@context": "https://schema.org", "@type": "WebPage", "name": t("Dranzeit Hilfe", sprache), "inLanguage": sprache}
    alt = alternativen()
    return seo._page(
        t("Hilfe und Anleitungen | Dranzeit", sprache),
        t("Anleitungen und Antworten zu Dranzeit: Laden einrichten, Nummern am Tresen, Team, Tarife und Hilfe für Kunden.", sprache),
        basis(sprache), body, json_ld, extra_style=STYLE, sprache=sprache, alternativen=alt,
        extra_head=_kopf_extra(sprache, alt, anker=True),
    )


def render_artikel(a: Artikel, artikel: dict[str, Artikel]) -> str:
    s = a.sprache
    g = render_markdown(a.text, a.faq, s)
    thema = uebersetze(THEMEN[a.thema], s)
    toc = ""
    if len(g.inhalt) >= 3 and not a.faq:
        toc = (f'<nav class="toc" aria-label="{_e(t("Inhalt", s))}"><strong>{_e(t("Auf dieser Seite", s))}</strong><ul>'
               + "".join(f'<li><a href="#{anchor}">{_e(text)}</a></li>' for anchor, text in g.inhalt) + "</ul></nav>")
    # Die Bilder zeigen die App auf Deutsch – lieber sagen als wundern lassen
    bilder = (f'<p class="bilder-de">{_e(t("Die Bilder zeigen die App auf Deutsch.", s))}</p>'
              if s != "de" and "<figure>" in g.html else "")
    andere = [x for x in nach_thema(artikel).get(a.thema, []) if x.slug != a.slug]
    mehr = (f'<div class="mehr"><h2>{_e(t("Mehr zu „{thema}“", s, thema=thema))}</h2>{_liste(andere)}</div>'
            if andere else "")
    body = (
        f'<nav class="crumbs" aria-label="{_e(t("Brotkrumen", s))}"><a href="{basis(s)}">{_e(t("Hilfe", s))}</a> › '
        f'<a href="{basis(s)}#{a.thema}">{_e(thema)}</a></nav>'
        f'<article class="doc"><h1>{_e(a.titel)}</h1><p class="lead">{_e(a.kurz)}</p>{toc}{bilder}{g.html}</article>'
        f"{mehr}{_kontakt(s)}"
    )
    url = seo.public_url() + a.pfad
    graph: list[dict] = [{
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": t("Hilfe", s), "item": seo.public_url() + basis(s)},
            {"@type": "ListItem", "position": 2, "name": a.titel, "item": url},
        ],
    }]
    if a.faq and g.fragen:
        graph.append({
            "@type": "FAQPage",
            "inLanguage": s,
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": answer}}
                for q, answer in g.fragen
            ],
        })
    alt = alternativen(a.slug)
    return seo._page(t("{titel} | Dranzeit Hilfe", s, titel=a.titel), a.kurz, a.pfad, body,
                     {"@context": "https://schema.org", "@graph": graph}, extra_style=STYLE, sprache=s,
                     alternativen=alt, extra_head=_kopf_extra(s, alt, anker=False))


def _html(content: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(content, status_code=status, headers={"Cache-Control": "public, max-age=300"})


def _seite(sprache: str, slug: str | None):
    artikel = alle_artikel(sprache)
    if slug is None:
        return _html(render_index(artikel, sprache))
    a = artikel.get(slug)
    if a:
        return _html(render_artikel(a, artikel))
    # Den Artikel gibt es (noch) nicht übersetzt: lieber den deutschen als eine leere Seite
    if sprache != "de" and slug in alle_artikel("de"):
        return RedirectResponse(f"{BASE_PATH}/{slug}?sprache=de", status_code=302)
    return _html(render_index(artikel, sprache), status=404)


@router.get(BASE_PATH)
def index_page() -> HTMLResponse:
    return _seite("de", None)


@router.get(BASE_PATH + "/")
def index_slash() -> RedirectResponse:
    return RedirectResponse(BASE_PATH, status_code=301)


@router.get(BASE_PATH + "/{slug}")
def artikel_page(slug: str):
    return _seite("de", slug)


@router.get("/{sprache}" + BASE_PATH)
def index_sprache(sprache: str):
    if sprache not in UEBERSETZT:
        return RedirectResponse(BASE_PATH, status_code=301) if sprache == "de" else _html(render_index(alle_artikel()), 404)
    return _seite(sprache, None)


@router.get("/{sprache}" + BASE_PATH + "/")
def index_sprache_slash(sprache: str) -> RedirectResponse:
    return RedirectResponse(basis(sprache) if sprache in UEBERSETZT else BASE_PATH, status_code=301)


@router.get("/{sprache}" + BASE_PATH + "/{slug}")
def artikel_sprache(sprache: str, slug: str):
    if sprache not in UEBERSETZT:
        if sprache == "de":
            return RedirectResponse(f"{BASE_PATH}/{slug}", status_code=301)
        return _html(render_index(alle_artikel()), 404)
    return _seite(sprache, slug)
