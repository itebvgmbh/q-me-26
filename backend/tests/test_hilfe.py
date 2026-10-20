"""
Tests für den Hilfe-Bereich (app/hilfe): Markdown, Artikelkopf, Seiten, Links. Ohne Firebase lauffähig:

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


def test_sitemap_enthaelt_hilfe():
    seo.load_shops = lambda: []
    app = FastAPI()
    app.include_router(seo.router)
    xml = TestClient(app).get("/sitemap.xml").text
    assert "/hilfe</loc>" in xml and f"/hilfe/{hilfe.START}</loc>" in xml


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
