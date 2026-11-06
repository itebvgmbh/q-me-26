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

Fertiges HTML vom Server wie die Stadtseiten (app/seo.py), damit Suchmaschinen es finden. Erreichbar unter
/hilfe (Caddy leitet weiter, deploy/caddy-domain.py) und unter /routes/seo/hilfe.

Markdown bewusst klein (getestet in tests/test_hilfe.py): ## und ### Überschriften, Absätze, Listen mit "- "
und "1. ", **fett**, *kursiv*, [Link](/pfad), [Knopf](/pfad){knopf}, ![Bildtext](/img/hilfe/x.webp) in eigener
Zeile, "> " als Hinweiskasten ("> **Tipp:** …", "> **Achtung:** …").
"""

import html
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app import seo

ARTIKEL_DIR = Path(__file__).parent / "artikel"
BASE_PATH = "/hilfe"
KONTAKT = "hilfe@dranzeit.de"
START = "in-10-minuten-startklar"
KUNDEN = "so-funktioniert-die-nummer"
FRAGEN = "fragen-fuer-laeden"

# Reihenfolge wie auf der Übersicht
THEMEN = {
    "loslegen": "Loslegen",
    "tresen": "Am Tresen",
    "team": "Team und Arbeitszeiten",
    "laden": "Laden und Leistungen",
    "tarif": "Tarif und Abrechnung",
    "konto": "Konto und Datenschutz",
    "kunden": "Für deine Kunden",
    "nachschlagen": "Fragen und Begriffe",
}

router = APIRouter(include_in_schema=False)


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

    @property
    def pfad(self) -> str:
        return f"{BASE_PATH}/{self.slug}"


# ---------- Markdown ----------

_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)(\{knopf\})?")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_ITALIC = re.compile(r"(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])")
_IMAGE = re.compile(r"^!\[([^\]]*)\]\((/img/hilfe/[\w./-]+)\)$")
_ITEM_UL = re.compile(r"^- (.*)$")
_ITEM_OL = re.compile(r"^\d+\. (.*)$")
_ERLAUBT = ("/", "#", "https://", "mailto:")


def _link(m: re.Match) -> str:
    label, url, knopf = m.group(1), html.unescape(m.group(2)), m.group(3)
    if not url.startswith(_ERLAUBT) or url.startswith("//"):
        raise ValueError(f"Link nicht erlaubt: {url}")
    cls = ' class="knopf"' if knopf else ""
    extern = ' rel="noopener" target="_blank"' if url.startswith("https://") else ""
    return f'<a{cls} href="{html.escape(url, quote=True)}"{extern}>{label}</a>'


def inline(text: str) -> str:
    """Eine Zeile Text: erst alles maskieren, dann Links, fett und kursiv."""
    s = html.escape(text, quote=True)
    s = _LINK.sub(_link, s)
    s = _BOLD.sub(r"<strong>\1</strong>", s)
    return _ITALIC.sub(r"<em>\1</em>", s)


def _plain(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def render_markdown(md: str, faq: bool = False) -> Gerendert:
    result = Gerendert(html="")
    out: list[str] = []
    para: list[str] = []
    items: list[str] = []
    list_tag = ""
    quote: list[str] = []
    frage: list = []  # [Frage, [HTML-Teile der Antwort]]

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
            emit(f"<p>{inline(' '.join(para))}</p>")
            para.clear()
        if items:
            emit(f"<{list_tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{list_tag}>")
            items.clear()
            list_tag = ""
        if quote:
            text = " ".join(quote)
            kind = " tipp" if text.startswith("**Tipp") else " achtung" if text.startswith("**Achtung") else ""
            emit(f'<aside class="hinweis{kind}">{inline(text)}</aside>')
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
            anchor = seo.slugify(title)
            if level == 2 or faq:
                close_frage()
            if level == 2:
                result.inhalt.append((anchor, _plain(inline(title))))
            result.ueberschriften.append(_plain(inline(title)))
            out.append(f'<h{level} id="{anchor}">{inline(title)}</h{level}>')
            if level == 3 and faq:
                frage.extend([_plain(inline(title)), []])
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
_cache: dict = {"stand": None, "artikel": {}}


def parse_artikel(slug: str, source: str) -> Artikel:
    source = source.replace("\r\n", "\n").lstrip("﻿")
    m = _KOPF.match(source)
    if not m:
        raise ValueError(f"{slug}: Kopf mit --- fehlt")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        key, _, value = line.partition(":")
        if key.strip():
            meta[key.strip()] = value.strip()
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
        text=source[m.end():],
    )


def alle_artikel() -> dict[str, Artikel]:
    """Alle Artikel nach Adresse; neu eingelesen, sobald sich eine Datei ändert."""
    files = sorted(ARTIKEL_DIR.glob("*.md"))
    stand = tuple((f.name, f.stat().st_mtime_ns) for f in files)
    if _cache["stand"] != stand:
        _cache["artikel"] = {f.stem: parse_artikel(f.stem, f.read_text(encoding="utf-8")) for f in files}
        _cache["stand"] = stand
    return _cache["artikel"]


def nach_thema(artikel: dict[str, Artikel]) -> dict[str, list[Artikel]]:
    groups: dict[str, list[Artikel]] = {key: [] for key in THEMEN}
    for a in artikel.values():
        groups[a.thema].append(a)
    for items in groups.values():
        items.sort(key=lambda a: (a.reihenfolge, a.titel))
    return {k: v for k, v in groups.items() if v}


def sitemap_paths() -> list[str]:
    return [BASE_PATH] + [a.pfad for a in sorted(alle_artikel().values(), key=lambda a: a.slug)]


# ---------- Seiten ----------

STYLE = """
.crumbs{font-size:14px;color:var(--muted);margin:0 0 12px}.crumbs a{color:inherit}
.doc{max-width:70ch}.doc a{color:inherit;text-decoration-thickness:2px;text-underline-offset:3px}
.doc h2{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:40px 0 8px;scroll-margin-top:16px}
.doc h3{font-size:19px;line-height:1.3;margin:28px 0 6px;scroll-margin-top:16px}
.doc ol,.doc ul{padding-left:1.4em}.doc li{margin:6px 0}
.doc a.knopf{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:12px;font-weight:700;text-decoration:none;background:var(--ink);color:var(--bg)}
.hinweis{display:block;background:var(--card);border:1px solid var(--line);border-left:6px solid var(--muted);border-radius:14px;padding:14px 16px;margin:18px 0}
.hinweis.tipp{border-left-color:var(--signal)}.hinweis.achtung{border-left-color:#d4553a}
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


def _e(value) -> str:
    return html.escape(str(value or ""), quote=True)


def _suchtext(a: Artikel, gerendert: Gerendert) -> str:
    text = " ".join([a.titel, a.kurz, a.stichworte, *gerendert.ueberschriften]).lower()
    for x, y in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(x, y)
    return text


def _kontakt() -> str:
    return (
        f'<div class="cta"><strong>Nicht gefunden, was du suchst?</strong> Schreib uns an '
        f'<a href="mailto:{KONTAKT}">{KONTAKT}</a>. Wir helfen dir gern weiter.</div>'
    )


def _liste(items: list[Artikel], suche: bool = False) -> str:
    rows = []
    for a in items:
        s = f' data-s="{_e(_suchtext(a, render_markdown(a.text, a.faq)))}"' if suche else ""
        rows.append(f'<li{s}><a href="{a.pfad}"><strong>{_e(a.titel)}</strong><span>{_e(a.kurz)}</span></a></li>')
    return f'<ul class="artikel">{"".join(rows)}</ul>'


def render_index(artikel: dict[str, Artikel]) -> str:
    themen = "".join(
        f'<section class="thema" id="{key}"><h2>{_e(THEMEN[key])}</h2>{_liste(items, suche=True)}</section>'
        for key, items in nach_thema(artikel).items()
    )
    tiles = []
    for slug, title, text, cls in (
        (START, "Neu bei Dranzeit?", "In 10 Minuten vom Konto bis zum ersten Kunden.", "tile main"),
        (KUNDEN, "Du hast eine Nummer gezogen?", "So funktioniert’s, wenn du wartest.", "tile"),
        (FRAGEN, "Häufige Fragen", "Kosten, Geräte, Datenschutz, Kunden ohne Smartphone.", "tile"),
    ):
        if slug in artikel:
            tiles.append(f'<a class="{cls}" href="{BASE_PATH}/{slug}"><strong>{_e(title)}</strong>{_e(text)}</a>')
    body = (
        "<h1>Wie können wir helfen?</h1>"
        '<p class="lead">Anleitungen und Antworten rund um Dranzeit – für Läden und für alle, die eine Nummer gezogen haben.</p>'
        '<input class="suche" type="search" placeholder="Suchen, z. B. Plakat, Pause, kündigen" aria-label="Hilfe durchsuchen" hidden>'
        f'<div class="tiles">{"".join(tiles)}</div>'
        f'<p class="leer lead" hidden>Dazu haben wir noch keinen Artikel. Schreib uns an <a href="mailto:{KONTAKT}">{KONTAKT}</a>.</p>'
        f"{themen}{_kontakt()}<script>{SUCHE_JS}</script>"
    )
    json_ld = {"@context": "https://schema.org", "@type": "WebPage", "name": "Dranzeit Hilfe", "inLanguage": "de"}
    return seo._page(
        "Hilfe und Anleitungen | Dranzeit",
        "Anleitungen und Antworten zu Dranzeit: Laden einrichten, Nummern am Tresen, Team, Tarife und Hilfe für Kunden.",
        BASE_PATH, body, json_ld, extra_style=STYLE,
    )


def render_artikel(a: Artikel, artikel: dict[str, Artikel]) -> str:
    g = render_markdown(a.text, a.faq)
    thema = THEMEN[a.thema]
    toc = ""
    if len(g.inhalt) >= 3 and not a.faq:
        toc = '<nav class="toc" aria-label="Inhalt"><strong>Auf dieser Seite</strong><ul>' + "".join(
            f'<li><a href="#{anchor}">{_e(text)}</a></li>' for anchor, text in g.inhalt
        ) + "</ul></nav>"
    andere = [x for x in nach_thema(artikel).get(a.thema, []) if x.slug != a.slug]
    mehr = f'<div class="mehr"><h2>Mehr zu „{_e(thema)}“</h2>{_liste(andere)}</div>' if andere else ""
    body = (
        f'<nav class="crumbs" aria-label="Brotkrumen"><a href="{BASE_PATH}">Hilfe</a> › '
        f'<a href="{BASE_PATH}#{a.thema}">{_e(thema)}</a></nav>'
        f'<article class="doc"><h1>{_e(a.titel)}</h1><p class="lead">{_e(a.kurz)}</p>{toc}{g.html}</article>'
        f"{mehr}{_kontakt()}"
    )
    url = seo.public_url() + a.pfad
    graph: list[dict] = [{
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Hilfe", "item": seo.public_url() + BASE_PATH},
            {"@type": "ListItem", "position": 2, "name": a.titel, "item": url},
        ],
    }]
    if a.faq and g.fragen:
        graph.append({
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": answer}}
                for q, answer in g.fragen
            ],
        })
    return seo._page(f"{a.titel} | Dranzeit Hilfe", a.kurz, a.pfad, body,
                     {"@context": "https://schema.org", "@graph": graph}, extra_style=STYLE)


def _html(content: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(content, status_code=status, headers={"Cache-Control": "public, max-age=300"})


@router.get(BASE_PATH)
def index_page() -> HTMLResponse:
    return _html(render_index(alle_artikel()))


@router.get(BASE_PATH + "/")
def index_slash() -> RedirectResponse:
    return RedirectResponse(BASE_PATH, status_code=301)


@router.get(BASE_PATH + "/{slug}")
def artikel_page(slug: str) -> HTMLResponse:
    artikel = alle_artikel()
    a = artikel.get(slug)
    if not a:
        return _html(render_index(artikel), status=404)
    return _html(render_artikel(a, artikel))
