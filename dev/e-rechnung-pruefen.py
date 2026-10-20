"""
E-Rechnungen (XRechnung, Syntax CII) gegen die offiziellen Prüfregeln prüfen – ohne Java.

Prüft wie der KoSIT-Validator: XML-Schema (UN/CEFACT CII D16B), Geschäftsregeln der EN 16931 und der
XRechnung 3.0 (Schematron, ausgeführt mit Saxon). Die Prüfdateien lädt das Skript beim ersten Lauf von GitHub
(Release der KoSIT, Prüfsumme fest im Skript) nach dev/out/kosit/; danach geht es ohne Internet.

    cd backend
    uv pip install --python .venv saxonche                         # einmalig, nur zum Prüfen
    .venv/Scripts/python ../dev/e-rechnung-pruefen.py              # Beispielrechnungen aus tests/test_invoices.py
    .venv/Scripts/python ../dev/e-rechnung-pruefen.py rechnung.xml # eigene Datei, z. B. unter "Mein Tarif" geladen

(Linux/macOS: .venv/bin/python.) Meldet je Rechnung OK oder FEHL samt Regel, Exit-Code 1 bei Fehlern.
Warnungen (flag="warning") werden gezeigt, zählen aber nicht als Fehler.
"""
import hashlib
import importlib.util
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
OUT = Path(__file__).resolve().parent / "out" / "kosit"
RELEASE = "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-08-31/xrechnung-3.0.2-validator-configuration-2026-08-31.zip"
SHA256 = "2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8"
XSD = "resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd"
SCHEMATRON = {
    "EN 16931": "resources/cii/16b/xsl/EN16931-CII-validation.xsl",
    "XRechnung": "resources/xrechnung/3.0.2/xsl/XRechnung-CII-validation.xsl",
}
SVRL = "{http://purl.oclc.org/dsdl/svrl}"


def rules() -> Path:
    """Prüfdateien der KoSIT (einmal laden, Prüfsumme prüfen, entpacken)."""
    if (OUT / SCHEMATRON["XRechnung"]).exists():
        return OUT
    OUT.mkdir(parents=True, exist_ok=True)
    archive = OUT / "konfiguration.zip"
    print(f"Lade Prüfregeln der KoSIT: {RELEASE}")
    with urllib.request.urlopen(RELEASE, timeout=60) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        sys.exit("Abbruch: Prüfsumme der KoSIT-Datei stimmt nicht. Nichts entpackt.")
    archive.write_bytes(data)
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if name.startswith("resources/") and not name.endswith("/"):
                target = (OUT / name).resolve()
                if OUT.resolve() not in target.parents:
                    sys.exit(f"Abbruch: unerwarteter Pfad im Archiv: {name}")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))
    return OUT


def samples() -> dict[str, bytes]:
    """XRechnungen aus den Beispielrechnungen der Backend-Tests (wie Stripe sie liefert)."""
    sys.path.insert(0, str(BACKEND))
    spec = importlib.util.spec_from_file_location("test_invoices", BACKEND / "tests" / "test_invoices.py")
    tests = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tests)
    from app.libs.invoices import build_xrechnung

    return {name: build_xrechnung(inv, buyer_reference="laden1") for name, inv in tests.samples().items()}


def check(name: str, xml: bytes, base: Path, saxon) -> bool:
    from lxml import etree

    errors, warnings = [], []
    schema = etree.XMLSchema(etree.parse(str(base / XSD)))
    doc = etree.fromstring(xml)
    if not schema.validate(doc):
        errors += [f"XML-Schema: {e.message}" for e in schema.error_log]
    for label, xsl in SCHEMATRON.items():
        exe = saxon["xslt"].compile_stylesheet(stylesheet_file=str(base / xsl))
        report = exe.transform_to_string(xdm_node=saxon["proc"].parse_xml(xml_text=xml.decode("utf-8")))
        for fail in etree.fromstring(report.encode("utf-8")).iter(f"{SVRL}failed-assert"):
            text = " ".join("".join(fail.find(f"{SVRL}text").itertext()).split())
            entry = f"{label} [{fail.get('flag')}] {text}"
            (warnings if fail.get("flag") in ("warning", "information") else errors).append(entry)
    print(f"{'OK  ' if not errors else 'FEHL'} {name}")
    for line in errors + warnings:
        print(f"     {line[:300]}")
    return not errors


def main() -> None:
    try:
        from saxonche import PySaxonProcessor
    except ImportError:
        sys.exit("Saxon fehlt: im Ordner backend `uv pip install --python .venv saxonche` ausführen.")
    base = rules()
    if len(sys.argv) > 1:
        files = {Path(p).name: Path(p).read_bytes() for p in sys.argv[1:]}
    else:
        files = samples()
    with PySaxonProcessor(license=False) as proc:
        saxon = {"proc": proc, "xslt": proc.new_xslt30_processor()}
        results = [check(name, xml, base, saxon) for name, xml in files.items()]
    print(f"{sum(results)}/{len(results)} gültig")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
