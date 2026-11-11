"""
Tests für den Hilfe-Bereich (app/hilfe): Markdown, Artikelkopf, Seiten, Links, Übersetzungen. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_hilfe.py
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import hilfe, seo  # noqa: E402
from app import i18n  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def test_markdown_grundlagen():
    g = hilfe.render_markdown(
        "Erster Absatz\nmit zwei Zeilen.\n\n## Schritt eins\n\n1. **Tippen**\n2. Fertig\n\n- a\n- b\n  weiter\n\n> **Tipp:** Kurz.\n"
    )
    assert "<p>Erster Absatz mit zwei Zeilen.</p>" in g.html
    assert '<h2 id="schritt-eins">Schritt eins</h2>' in g.html
    assert "<ol><li><strong>Tippen</strong></li><li>Fertig</li></ol>" in g.html
    assert "<ul><li>a</li><li>b weiter</li></ul>" in g.html
    assert '<aside class="hinweis tipp"><strong>Tipp:</strong> Kurz.</aside>' in g.html
    assert g.inhalt == [("schritt-eins", "Schritt eins")]


def test_markdown_links_knopf_bild_und_maskierung():
    g = hilfe.render_markdown(
        "Siehe [Tresen](/shop-dashboard) und [extern](https://example.com).\n\n"
        "[Zum Tresen](/shop-dashboard){knopf}\n\n![Der Tresen](/img/hilfe/tresen.webp)\n\n<script>alert(1)</script> *kursiv*"
    )
    assert '<a href="/shop-dashboard">Tresen</a>' in g.html
    assert 'href="https://example.com" rel="noopener" target="_blank"' in g.html
    assert '<a class="knopf" href="/shop-dashboard">Zum Tresen</a>' in g.html
    assert '<img src="/img/hilfe/tresen.webp" alt="Der Tresen" loading="lazy">' in g.html
    assert "<script>" not in g.html and "&lt;script&gt;" in g.html
    assert "<em>kursiv</em>" in g.html


def test_markdown_verbietet_fremde_links():
    for bad in ("[x](javascript:alert(1))", "[x](//evil.example)", "[x](http://example.com)"):
        try:
            hilfe.render_markdown(bad)
        except ValueError:
            continue
        raise AssertionError(f"nicht abgelehnt: {bad}")


def test_faq_fragen():
    g = hilfe.render_markdown("## Häufige Fragen\n\n### Brauche ich eine App?\n\nNein. Der **Browser** reicht.\n\n### Kostet das was?\n\nFür Kunden nie.\n", faq=True)
    assert g.fragen == [("Brauche ich eine App?", "Nein. Der Browser reicht."), ("Kostet das was?", "Für Kunden nie.")]


def test_kopf_pflichtfelder():
    a = hilfe.parse_artikel("x", "---\r\ntitel: T\r\nkurz: K\r\nthema: tresen\r\nreihenfolge: 2\r\nfaq: ja\r\n---\r\nText\r\n")
    assert (a.titel, a.kurz, a.thema, a.reihenfolge, a.faq, a.text) == ("T", "K", "tresen", 2, True, "Text\n")
    for broken in ("Text ohne Kopf", "---\ntitel: T\nkurz: K\nthema: gibtsnicht\n---\n", "---\ntitel: T\nthema: tresen\n---\n"):
        try:
            hilfe.parse_artikel("x", broken)
        except ValueError:
            continue
        raise AssertionError(f"nicht abgelehnt: {broken!r}")


def test_alle_artikel_gueltig_und_verlinkt():
    """Jeder Artikel rendert, jeder /hilfe/-Link zeigt auf einen vorhandenen Artikel, jede Seite hat eine Beschreibung."""
    artikel = hilfe.alle_artikel()
    assert hilfe.START in artikel
    for a in artikel.values():
        g = hilfe.render_markdown(a.text, a.faq)
        assert len(a.kurz) <= 160, f"{a.slug}: kurz zu lang ({len(a.kurz)})"
        for target in re.findall(r'href="/hilfe/([\w-]+)', g.html):
            assert target in artikel, f"{a.slug}: Link auf fehlenden Artikel {target}"
        if a.faq:
            assert g.fragen, f"{a.slug}: faq ohne Fragen"


def test_bilder_existieren():
    """Jedes Bild in einem Artikel liegt in frontend/public/img/hilfe (dev/e2e/hilfe-bilder.cjs erzeugt sie)."""
    public = ROOT / "frontend" / "public"
    for a in hilfe.alle_artikel().values():
        for src in re.findall(r"\]\((/img/hilfe/[^)]+)\)", a.text):
            assert (public / src.lstrip("/")).is_file(), f"{a.slug}: Bild {src} fehlt"


def test_app_verweise_auf_hilfe_existieren():
    """Hilfe-Links im Frontend (hilfe="…" bzw. /hilfe/…) zeigen auf vorhandene Artikel."""
    artikel = hilfe.alle_artikel()
    src = ROOT / "frontend" / "src"
    for path in src.rglob("*.tsx"):
        text = path.read_text(encoding="utf-8")
        for slug in re.findall(r"/hilfe/([a-z0-9-]+)", text) + re.findall(r'\bhilfe="([a-z0-9-]+)"', text):
            assert slug in artikel, f"{path.relative_to(ROOT)}: Hilfe-Artikel {slug} fehlt"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(hilfe.router)
    app.include_router(hilfe.router, prefix="/routes/seo")
    return TestClient(app)


def test_seiten():
    c = _client()
    index = c.get("/hilfe")
    assert index.status_code == 200 and "Wie können wir helfen?" in index.text
    assert f'href="/hilfe/{hilfe.START}"' in index.text and "data-s=" in index.text
    page = c.get(f"/hilfe/{hilfe.START}")
    assert page.status_code == 200
    assert '<link rel="canonical" href="https://dranzeit.de/hilfe/in-10-minuten-startklar">' in page.text
    ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page.text).group(1).replace("<\\/", "</"))
    assert ld["@graph"][0]["@type"] == "BreadcrumbList"
    assert "mailto:hilfe@dranzeit.de" in page.text
    assert c.get("/hilfe/gibtsnicht").status_code == 404
    assert c.get("/routes/seo/hilfe").status_code == 200
    r = c.get("/hilfe/", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == "/hilfe"


def test_faq_seite_hat_faqpage():
    artikel = hilfe.alle_artikel()
    faqs = [a for a in artikel.values() if a.faq]
    if not faqs:
        return
    page = _client().get(faqs[0].pfad).text
    ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page).group(1).replace("<\\/", "</"))
    assert any(x["@type"] == "FAQPage" and x["mainEntity"] for x in ld["@graph"])


def test_markdown_in_einer_uebersetzung():
    g = hilfe.render_markdown(
        "[a](/hilfe/plakat) [b](/hilfe) [c](/hilfe#tresen) [d](/shop-dashboard) [e](/hilfe-x)\n\n"
        "## خطوة\n\n## خطوة\n\n## Başla\n\n> **İpucu:** kısa\n\n> **تنبيه:** مهم\n", sprache="tr")
    assert 'href="/tr/hilfe/plakat"' in g.html and 'href="/tr/hilfe"' in g.html and 'href="/tr/hilfe#tresen"' in g.html
    assert 'href="/shop-dashboard"' in g.html and 'href="/hilfe-x"' in g.html, "nur /hilfe selbst bekommt die Sprache"
    ids = [a for a, _ in g.inhalt]
    assert ids[0] and ids[1] and len(set(ids)) == 3, ids
    assert '<aside class="hinweis tipp">' in g.html and '<aside class="hinweis achtung">' in g.html


def _bau(text: str) -> dict:
    """Was in einer Übersetzung gleich bleiben muss: Überschriften, Bilder, Ziele der Links, Knöpfe, Hinweiskästen"""
    zeilen = text.replace("\r\n", "\n").split("\n")
    kaesten, vorher = [], False
    for z in zeilen:
        if z.startswith(">") and not vorher:
            kaesten.append(hilfe._hinweis_art(z[1:].strip()))
        vorher = z.startswith(">")
    return {
        "##": sum(z.startswith("## ") for z in zeilen),
        "###": sum(z.startswith("### ") for z in zeilen),
        "bilder": re.findall(r"\]\((/img/hilfe/[^)]+)\)", text),
        "links": sorted(re.findall(r"\]\(((?:/|https://|mailto:)[^)\s]*)\)", text)),
        "knoepfe": text.count("){knopf}"),
        "kaesten": kaesten,
    }


def test_uebersetzungen_vollstaendig_aktuell_und_gleich_gebaut():
    """Jeder Artikel in jeder Sprache, aus dem aktuellen deutschen übersetzt und genauso aufgebaut.
    Fehlt oder veraltet etwas: python -m app.hilfe.stand (Anleitung in app/hilfe/README.md)."""
    assert not hilfe.fehlend(), f"Übersetzung fehlt: {hilfe.fehlend()}"
    assert not hilfe.veraltet(), (f"Deutscher Artikel geändert, Übersetzung nicht nachgezogen: {hilfe.veraltet()} – "
                                  "Übersetzungen anpassen, dann python -m app.hilfe.stand --setzen <sprache> <adresse>")
    deutsch = hilfe.alle_artikel()
    for sprache in hilfe.UEBERSETZT:
        for a in hilfe.alle_artikel(sprache).values():
            name = f"{sprache}/{a.slug}"
            assert a.titel and a.kurz and len(a.kurz) <= 160, f"{name}: titel/kurz fehlt oder kurz zu lang ({len(a.kurz)})"
            assert _bau(a.text) == _bau(deutsch[a.slug].text), (name, _bau(a.text), _bau(deutsch[a.slug].text))
            g = hilfe.render_markdown(a.text, a.faq, sprache)
            for target in re.findall(rf'href="/{sprache}/hilfe/([\w-]+)', g.html):
                assert target in deutsch, f"{name}: Link auf fehlenden Artikel {target}"
            assert "„" not in a.titel + a.text or sprache == "de", f"{name}: deutsche Anführungszeichen"


def test_seiten_in_anderen_sprachen():
    c = _client()
    tr = c.get("/tr/hilfe")
    assert tr.status_code == 200 and '<html lang="tr">' in tr.text and i18n.t("Wie können wir helfen?", "tr") in tr.text
    assert f'href="/tr/hilfe/{hilfe.START}"' in tr.text and "dranzeit:sprache" not in tr.text.split("</head>")[0]
    ar = c.get(f"/ar/hilfe/{hilfe.START}")
    assert ar.status_code == 200 and '<html lang="ar" dir="rtl">' in ar.text
    assert '<link rel="canonical" href="https://dranzeit.de/ar/hilfe/in-10-minuten-startklar">' in ar.text
    for s, pfad in (("de", ""), ("en", "/en"), ("tr", "/tr"), ("ar", "/ar"), ("x-default", "")):
        assert f'hreflang="{s}" href="https://dranzeit.de{pfad}/hilfe/{hilfe.START}"' in ar.text, s
    assert 'data-sprache="de"' in ar.text and 'href="/ar/hilfe"' in ar.text  # Sprachwahl, Hilfe in der Kopfzeile
    assert i18n.t("Hilfe", "ar") in ar.text.split('class="crumbs"')[1].split("</nav>")[0]
    # Die deutsche Seite schickt Leute mit anderer Sprache in der App gleich in ihre Sprache
    de = c.get(f"/hilfe/{hilfe.START}").text.split("</head>")[0]
    assert "dranzeit:sprache" in de and f'"tr": "/tr/hilfe/{hilfe.START}"' in de
    assert c.get("/routes/seo/en/hilfe").status_code == 200
    assert c.get("/en/hilfe/gibtsnicht").status_code == 404 and c.get("/xx/hilfe").status_code == 404
    r = c.get(f"/de/hilfe/{hilfe.START}", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == f"/hilfe/{hilfe.START}"
    # Noch nicht übersetzt: lieber der deutsche Artikel als eine leere Seite
    echt = hilfe.alle_artikel
    hilfe.alle_artikel = lambda s="de": echt(s) if s == "de" else {k: v for k, v in echt(s).items() if k != hilfe.START}
    try:
        r = c.get(f"/en/hilfe/{hilfe.START}", follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == f"/hilfe/{hilfe.START}?sprache=de"
    finally:
        hilfe.alle_artikel = echt


def test_stand_haken_setzt_quelle():
    import tempfile
    from pathlib import Path as P
    from app.hilfe import stand

    echt = hilfe.ARTIKEL_DIR
    with tempfile.TemporaryDirectory() as tmp:
        ordner = P(tmp)
        (ordner / "tr").mkdir()
        (ordner / "x.md").write_text("---\ntitel: T\nkurz: K\nthema: tresen\n---\nText\n", encoding="utf-8")
        (ordner / "tr" / "x.md").write_text("---\ntitel: Tt\nkurz: Kk\nquelle: offen\n---\nMetin\n", encoding="utf-8")
        hilfe.ARTIKEL_DIR = ordner
        hilfe._cache.clear()
        try:
            assert ("tr", "x") in hilfe.veraltet() and ("en", "x") in hilfe.fehlend()
            stand.setzen("tr", "x")
            hilfe._cache.clear()
            assert ("tr", "x") not in hilfe.veraltet()
            assert hilfe.alle_artikel("tr")["x"].text == "Metin\n" and hilfe.alle_artikel("tr")["x"].thema == "tresen"
        finally:
            hilfe.ARTIKEL_DIR = echt
            hilfe._cache.clear()


def test_sitemap_enthaelt_hilfe():
    seo.load_shops = lambda: []
    app = FastAPI()
    app.include_router(seo.router)
    xml = TestClient(app).get("/sitemap.xml").text
    assert "/hilfe</loc>" in xml and f"/hilfe/{hilfe.START}</loc>" in xml
    assert "/en/hilfe</loc>" in xml and f"/ar/hilfe/{hilfe.START}</loc>" in xml


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
