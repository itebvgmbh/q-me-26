"""
Tests für die Übersetzungen im Backend (app/i18n): Ist jeder Text aus t(), tn() und merke() und jede feste Fehlermeldung
(HTTPException(detail="…")) in Englisch, Türkisch und Arabisch da, passen Platzhalter und HTML-Tags? Dazu Sprache aus
Accept-Language, Push und E-Mails in der gespeicherten Sprache und übersetzte Fehlermeldungen. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_i18n.py
    cd backend && .venv/bin/python tests/test_i18n.py --fehlend     nur auflisten, was in den Katalogen fehlt
"""
import ast
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from app import i18n  # noqa: E402
from app.i18n import ar, en, tr  # noqa: E402

APP = Path(__file__).resolve().parent.parent / "app"
KATALOGE = {"en": en.TEXTE, "tr": tr.TEXTE, "ar": ar.TEXTE}
KATALOG_DATEIEN = {f"i18n/{sprache}.py" for sprache in KATALOGE}
# Bleibt deutsch (Betreiber-Bereich, Werkzeuge, Aufrufe von Maschinen): feste Fehlermeldungen hier müssen nicht in den Katalog
OHNE_DETAIL = (
    "apis/betreiber/", "apis/telefon/", "apis/stripe_webhook/", "apis/schedulers/", "apis/code_history/", "apis/notifications/",
    "libs/verzeichnis_import.py",
)
PLATZHALTER = re.compile(r"\{(\w+)\}")
TAG = re.compile(r"</?\w+")
FORMEN = {"zero", "one", "two", "few", "many", "other"}


def _quellen():
    for datei in sorted(APP.rglob("*.py")):
        name = datei.relative_to(APP).as_posix()
        if name not in KATALOG_DATEIEN:
            yield name, ast.parse(datei.read_text(encoding="utf-8"))


def _aus_i18n(baum) -> set[str]:
    """Namen, die die Datei aus app.i18n holt (t, tn, merke …)"""
    return {a.asname or a.name for n in ast.walk(baum) if isinstance(n, ast.ImportFrom) and n.module == "app.i18n" for a in n.names}


def _text(knoten) -> str | None:
    return knoten.value if isinstance(knoten, ast.Constant) and isinstance(knoten.value, str) else None


def gesammelt():
    """Schlüssel -> (Einzahl oder None, Fundstellen); Probleme: f-Strings, wo ein Schlüssel stehen sollte"""
    schluessel: dict[str, tuple[str | None, list[str]]] = {}
    probleme: list[str] = []

    def merke_dir(text, stelle, einzahl=None):
        schluessel.setdefault(text, (einzahl, []))[1].append(stelle)

    for name, baum in _quellen():
        # app/i18n selbst definiert t und merke (Wochentage), statt sie zu holen
        namen = _aus_i18n(baum) | ({"t", "tn", "merke"} if name == "i18n/__init__.py" else set())
        for knoten in ast.walk(baum):
            if not isinstance(knoten, ast.Call):
                continue
            stelle = f"{name}:{knoten.lineno}"
            aufruf = knoten.func.id if isinstance(knoten.func, ast.Name) else None
            if aufruf in namen and aufruf in ("t", "merke") and knoten.args:
                if _text(knoten.args[0]) is not None:
                    merke_dir(_text(knoten.args[0]), stelle)
                elif isinstance(knoten.args[0], ast.JoinedStr):
                    probleme.append(f"{stelle}: f-String in {aufruf}() – Werte als Platzhalter übergeben")
            elif aufruf in namen and aufruf == "tn" and len(knoten.args) >= 3:
                einzahl, mehrzahl = _text(knoten.args[1]), _text(knoten.args[2])
                if einzahl is None or mehrzahl is None:
                    probleme.append(f"{stelle}: tn() braucht feste Texte")
                else:
                    merke_dir(mehrzahl, stelle, einzahl)
            elif aufruf == "HTTPException" and not name.startswith(OHNE_DETAIL):
                detail = next((k.value for k in knoten.keywords if k.arg == "detail"), None)
                if _text(detail) is not None:
                    merke_dir(_text(detail), stelle)
                elif isinstance(detail, ast.JoinedStr):
                    anfang = _text(detail.values[0]) if detail.values else ""
                    if not (anfang or "").startswith(("Error", "Failed")):  # englische Meldungen nur für Entwickler
                        probleme.append(f"{stelle}: f-String als detail – merke('… {{wert}} …', wert=…) nehmen")
    return schluessel, probleme


def _platzhalter(text: str) -> set[str]:
    return set(PLATZHALTER.findall(text))


def _tags(text: str) -> list[str]:
    return sorted(TAG.findall(text))


def pruefe_kataloge() -> list[str]:
    schluessel, fehler = gesammelt()
    for sprache, katalog in KATALOGE.items():
        for text, (einzahl, stellen) in schluessel.items():
            if text not in katalog:
                fehler.append(f"[{sprache}] fehlt: {text!r} ({stellen[0]})")
                continue
            wert = katalog[text]
            erlaubt = _platzhalter(text) | (_platzhalter(einzahl) if einzahl else set())
            if isinstance(wert, dict):
                if einzahl is None:
                    fehler.append(f"[{sprache}] Mehrzahlformen, aber kein tn(): {text!r}")
                if "other" not in wert or set(wert) - FORMEN:
                    fehler.append(f"[{sprache}] Mehrzahlformen unvollständig oder unbekannt: {text!r}")
                formen = list(wert.values())
            else:
                formen = [wert]
            for form in formen:
                if not isinstance(form, str) or not form.strip():
                    fehler.append(f"[{sprache}] leer: {text!r}")
                    continue
                if isinstance(wert, dict):
                    # Einzelne Formen dürfen die Zahl weglassen ("ein Tag"), aber nichts anderes
                    if _platzhalter(form) - erlaubt or not (_platzhalter(text) - {"n"}) <= _platzhalter(form):
                        fehler.append(f"[{sprache}] Platzhalter passen nicht: {text!r} -> {form!r}")
                elif _platzhalter(form) != _platzhalter(text):
                    fehler.append(f"[{sprache}] Platzhalter passen nicht: {text!r} -> {form!r}")
                if _tags(form) != _tags(text):
                    fehler.append(f"[{sprache}] HTML-Tags passen nicht: {text!r} -> {form!r}")
        for text in katalog:
            if text not in schluessel:
                fehler.append(f"[{sprache}] wird nicht mehr verwendet: {text!r}")
    return fehler


# --- Kataloge ---------------------------------------------------------------------------------

def test_alles_uebersetzt():
    fehler = pruefe_kataloge()
    assert not fehler, "\n".join(fehler)


def test_feste_fehlermeldungen_werden_gefunden():
    schluessel, _ = gesammelt()
    assert "Diese Nummer gibt es nicht." in schluessel  # merke() als Konstante
    assert "Dieser Laden bietet keine Benachrichtigungen an." in schluessel  # HTTPException(detail="…")
    assert "{name} hat schon ein Konto und sieht „Mein Tag“." in schluessel  # merke() mit Wert
    assert "Der Link gilt {n} Tage. Fragen beantwortet dir dein Laden." in schluessel  # tn()
    assert not any(s.startswith("apis/betreiber/") for _, stellen in schluessel.values() for s in stellen if "detail" in s)


# --- Grundlagen -------------------------------------------------------------------------------

def test_sprache_aus_accept_language():
    assert i18n.aus_kopf("tr") == "tr"
    assert i18n.aus_kopf("en-GB,en;q=0.9,de;q=0.8") == "en"
    assert i18n.aus_kopf("fr-FR,fr;q=0.9,ar;q=0.8,de;q=0.5") == "ar"
    assert i18n.aus_kopf("de;q=0.5,tr;q=0.9") == "tr"
    assert i18n.aus_kopf("fr") == "de" and i18n.aus_kopf("") == "de" and i18n.aus_kopf(None) == "de"
    assert i18n.aus_kopf("tr;q=0") == "de"


def test_gespeicherte_sprache():
    assert i18n.sprache_von("tr") == "tr" and i18n.sprache_von("en-GB") == "en"
    assert i18n.sprache_von(None) == "de" and i18n.sprache_von("xx") == "de" and i18n.sprache_von(42) == "de"


def test_uebersetzen_mit_platzhaltern_und_rueckfall():
    assert i18n.t("Du bist dran", "tr") == tr.TEXTE["Du bist dran"]
    assert i18n.t("Du bist dran", "de") == "Du bist dran"
    assert i18n.t("Gibt es nicht im Katalog {x}", "tr", x=1) == "Gibt es nicht im Katalog 1"
    text = i18n.merke("{name} hat schon ein Konto und sieht „Mein Tag“.", name=i18n.merke("Die Person"))
    assert text == "Die Person hat schon ein Konto und sieht „Mein Tag“."  # als str der deutsche Text
    assert i18n.uebersetze(text, "en") == en.TEXTE["{name} hat schon ein Konto und sieht „Mein Tag“."].replace("{name}", en.TEXTE["Die Person"])
    assert i18n.uebersetze("Diese Nummer gibt es nicht.", "ar") == ar.TEXTE["Diese Nummer gibt es nicht."]
    assert i18n.uebersetze("Nicht übersetzt", "ar") == "Nicht übersetzt"


def test_mehrzahl():
    assert i18n.tn(1, "Noch {n} Tag alles testen", "Noch {n} Tage alles testen", "de") == "Noch 1 Tag alles testen"
    assert i18n.tn(4, "Noch {n} Tag alles testen", "Noch {n} Tage alles testen", "de") == "Noch 4 Tage alles testen"
    formen = ar.TEXTE["Noch {n} Tage alles testen"]
    assert i18n.tn(2, "Noch {n} Tag alles testen", "Noch {n} Tage alles testen", "ar") == formen.get("two", formen["other"]).replace("{n}", "2")
    assert i18n.tn(14, "", "Der Link gilt {n} Tage. Fragen beantwortet dir dein Laden.", "ar") != i18n.tn(
        5, "", "Der Link gilt {n} Tage. Fragen beantwortet dir dein Laden.", "ar"
    ).replace("5", "14")  # 14 = many, 5 = few
    assert [i18n._form(n, "ar") for n in (0, 1, 2, 3, 10, 11, 99, 100, 102, 103)] == [
        "zero", "one", "two", "few", "few", "many", "many", "other", "other", "few"
    ]


# --- Push und E-Mails -------------------------------------------------------------------------

def test_mail_rahmen_von_rechts_nach_links():
    from app.libs.mail import branded_html

    html = branded_html("عنوان", ["نص"], "زر", "https://dranzeit.de/x", sprache="ar")
    assert '<html lang="ar" dir="rtl">' in html and 'dir="rtl"' in html.split("<body", 1)[1]
    assert ar.TEXTE["Impressum"] in html and ar.TEXTE["Diese E-Mail wurde automatisch verschickt."] in html
    assert ar.TEXTE["Klappt der Knopf nicht? Dann öffne diesen Link:"] in html
    assert '<html lang="de" dir="ltr">' in branded_html("Ü", ["A"])


def test_mails_auf_tuerkisch():
    from app.apis.email_verification import verification_mail
    from app.apis.password_reset import reset_mail
    from app.apis.staff_invitation import invitation_mail
    from app.libs import onboarding_mail as om

    subject, html, text = verification_mail("eva@salon.de", "https://dranzeit.de/email-bestaetigen?code=x", "tr")
    assert subject == tr.TEXTE["Bitte bestätige deine E-Mail-Adresse"] and "<strong>eva@salon.de</strong>" in html
    assert 'lang="tr"' in html and "https://dranzeit.de/email-bestaetigen?code=x" in text
    subject, html, _ = reset_mail("eva@salon.de", "https://dranzeit.de/passwort-neu?code=x", "tr")
    assert subject == tr.TEXTE["Neues Passwort für Dranzeit"] and tr.TEXTE["Neues Passwort setzen"] in html
    subject, html, _ = invitation_mail("Salon <Eva>", "Kim", "https://dranzeit.de/staff-registration?token=x", "tr")
    assert "Salon <Eva>" in subject and "Salon &lt;Eva&gt;" in html and "Salon <Eva>" not in html
    assert tr.TEXTE["Einladung annehmen"] in html
    now = datetime(2026, 10, 19, 10, tzinfo=timezone.utc)
    shop = {"name": "Salon Eva", "createdAt": now - timedelta(days=26), "trialEndsAt": now + timedelta(days=4), "owner": "u1"}
    subject, html, _ = om.compose("testende", shop, now, "https://dranzeit.de", "tr")
    assert "Salon Eva" in html and subject == tr.TEXTE["Deine Testphase endet am {datum}"].replace("{datum}", "23.10.2026")
    assert tr.TEXTE["Noch {n} Tage alles testen"].replace("{n}", "4") in html and tr.TEXTE["Tarife ansehen"] in html


class _Snap:
    def __init__(self, data):
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data or {})


def test_startmail_in_der_sprache_des_inhabers():
    from app.libs import onboarding_mail as om

    class Users:
        def document(self, uid):
            return type("Ref", (), {"get": lambda _self: _Snap({"u1": {"language": "ar"}}.get(uid))})()

    db = type("Db", (), {"collection": lambda _self, name: Users()})()
    assert om._owner_language(db, {"owner": "u1"}) == "ar"
    assert om._owner_language(db, {"owner": "u2"}) == "de"
    assert om._owner_language(object(), {"owner": "u1"}) == "de"  # Lesen klappt nicht: Deutsch


# --- Fehlermeldungen --------------------------------------------------------------------------

def test_fehlermeldungen_in_der_sprache_der_anfrage():
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient

    from app.i18n import merke, uebersetzte_fehler

    app = FastAPI()
    uebersetzte_fehler(app)

    @app.get("/fest")
    def fest():
        raise HTTPException(status_code=404, detail="Diese Nummer gibt es nicht.")

    @app.get("/mit-wert")
    def mit_wert():
        raise HTTPException(status_code=409, detail=merke("{name} ist deaktiviert. Hol sie zuerst zurück ins Team.", name="Kim"))

    client = TestClient(app)
    assert client.get("/fest", headers={"Accept-Language": "tr"}).json() == {"detail": tr.TEXTE["Diese Nummer gibt es nicht."]}
    assert client.get("/fest").json() == {"detail": "Diese Nummer gibt es nicht."}
    r = client.get("/mit-wert", headers={"Accept-Language": "ar"})
    assert r.status_code == 409 and r.json()["detail"] == ar.TEXTE["{name} ist deaktiviert. Hol sie zuerst zurück ins Team."].replace("{name}", "Kim")
    assert client.get("/mit-wert", headers={"Accept-Language": "de"}).json()["detail"] == "Kim ist deaktiviert. Hol sie zuerst zurück ins Team."
    assert client.get("/gibt-es-nicht", headers={"Accept-Language": "tr"}).status_code == 404


if __name__ == "__main__":
    if "--fehlend" in sys.argv:
        for zeile in pruefe_kataloge():
            print(zeile)
        sys.exit(0)
    tests =[v for k, v in dict(globals()).items() if k.startswith("test_")]
    for test in tests:
        test()
        print("ok ", test.__name__)
    print(f"{len(tests)} Tests bestanden")
