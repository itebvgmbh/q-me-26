"""Mehrsprachigkeit im Backend, nach demselben Muster wie im Frontend (frontend/src/i18n/index.ts): Der deutsche Text
im Code ist der Schlüssel, t("Du bist dran", sprache). Kataloge: app/i18n/{en,tr,ar}.py. Fehlt eine Übersetzung,
kommt der deutsche Text. tests/test_i18n.py prüft, ob alles übersetzt ist und die Platzhalter passen.

Welche Sprache?
- Push und E-Mails aus dem Hintergrund (app/libs/notify_worker.py, Start-Mails): die gespeicherte. Feld `language`
  am Termin (Nummer ziehen, Buchen), an der Push-Anmeldung und im Profil users/{uid} (Registrieren, danach bei
  jedem Start der App angeglichen). Fehlt sie: Deutsch.
- Antworten auf eine Anfrage (Fehlermeldungen in `detail`, Mails wie „Passwort vergessen“): Accept-Language. Das
  Frontend schickt dort die gewählte Sprache mit. Fehlermeldungen übersetzt uebersetzte_fehler (main.py) beim Antworten;
  im Code steht weiter HTTPException(detail="…") auf Deutsch, mit Werten detail=merke("… {name} …", name=…).

Bleibt deutsch: Betreiber-Bereich, Hilfe- und Stadtseiten, Seitenköpfe für Suchmaschinen.
"""

import re
from datetime import datetime

SPRACHEN = ("de", "en", "tr", "ar")
STANDARD = "de"

_PLATZHALTER = re.compile(r"\{(\w+)\}")
_kataloge: dict[str, dict] | None = None


def _katalog(sprache: str) -> dict:
    global _kataloge
    if _kataloge is None:
        from app.i18n import ar, en, tr

        _kataloge = {"en": en.TEXTE, "tr": tr.TEXTE, "ar": ar.TEXTE}
    return _kataloge.get(sprache, {})


def sprache_von(wert: object) -> str:
    """Gespeicherten oder mitgeschickten Wert ("tr", "en-GB", None) auf eine der Sprachen bringen, sonst Deutsch"""
    code = str(wert or "").strip()[:2].lower()
    return code if code in SPRACHEN else STANDARD


def aus_kopf(kopf: str | None) -> str:
    """Sprache aus Accept-Language ("tr", "en-GB,en;q=0.9,de;q=0.8"): die erste, die es gibt, sonst Deutsch"""
    wahl = []
    for i, teil in enumerate((kopf or "").split(",")):
        name, _, rest = teil.strip().partition(";")
        gewicht = 1.0
        if rest.strip().startswith("q="):
            try:
                gewicht = float(rest.strip()[2:])
            except ValueError:
                gewicht = 0.0
        code = name.strip()[:2].lower()
        if code in SPRACHEN and gewicht > 0:
            wahl.append((-gewicht, i, code))
    return min(wahl)[2] if wahl else STANDARD


def aus_anfrage(request) -> str:
    """Sprache der Anfrage (Starlette/FastAPI-Request oder None)"""
    return aus_kopf(request.headers.get("accept-language") if request is not None else None)


def ist_rtl(sprache: str) -> bool:
    return sprache == "ar"


class Text(str):
    """Deutscher Text, der sich die Vorlage und die Werte merkt – übersetzt wird erst, wenn die Sprache feststeht
    (Fehlermeldungen beim Antworten). Als str ist er der fertige deutsche Text."""

    vorlage: str
    werte: dict

    def __new__(cls, vorlage: str, werte: dict):
        text = super().__new__(cls, _fuelle(vorlage, werte, STANDARD))
        text.vorlage, text.werte = vorlage, werte
        return text


def merke(text: str, **werte) -> Text:
    """Markiert Text für die Übersetzung, ohne ihn schon zu übersetzen: für Konstanten auf Modulebene und
    Fehlermeldungen. Werte dürfen selbst gemerkte Texte sein (name=merke("Die Person"))."""
    return Text(text, werte)


def _fuelle(text: str, werte: dict, sprache: str) -> str:
    if not werte:
        return text

    def wert(treffer: re.Match) -> str:
        name = treffer.group(1)
        if name not in werte:
            return treffer.group(0)
        return uebersetze(werte[name], sprache) if isinstance(werte[name], Text) else str(werte[name])

    return _PLATZHALTER.sub(wert, text)


def t(text: str, sprache: str = STANDARD, **werte) -> str:
    """Übersetzt einen deutschen Text; Platzhalter in geschweiften Klammern: t("Hallo {name}", sprache, name=…)"""
    uebersetzt = _katalog(sprache).get(text, text) if sprache != STANDARD else text
    if isinstance(uebersetzt, dict):
        uebersetzt = uebersetzt["other"]
    return _fuelle(uebersetzt, werte, sprache)


def _form(anzahl: int, sprache: str) -> str:
    """Mehrzahlform wie Intl.PluralRules (CLDR) für die Sprachen hier"""
    if sprache == "ar":
        rest = anzahl % 100
        if anzahl == 0:
            return "zero"
        if anzahl == 1:
            return "one"
        if anzahl == 2:
            return "two"
        if 3 <= rest <= 10:
            return "few"
        if 11 <= rest <= 99:
            return "many"
        return "other"
    return "one" if anzahl == 1 else "other"


def tn(anzahl: int, einzahl: str, mehrzahl: str, sprache: str = STANDARD, **werte) -> str:
    """Text mit Anzahl: tn(n, "{n} Tag", "{n} Tage", sprache). Schlüssel im Katalog ist die Mehrzahl."""
    alle = {"n": anzahl, **werte}
    uebersetzt = _katalog(sprache).get(mehrzahl) if sprache != STANDARD else None
    if uebersetzt is None:
        return _fuelle(einzahl if anzahl == 1 else mehrzahl, alle, sprache)
    if isinstance(uebersetzt, str):
        return _fuelle(uebersetzt, alle, sprache)
    return _fuelle(uebersetzt.get(_form(anzahl, sprache), uebersetzt["other"]), alle, sprache)


def uebersetze(wert: object, sprache: str) -> str:
    """Gemerkten Text (merke) oder festen deutschen Text in die Sprache bringen; Unbekanntes bleibt, wie es ist"""
    if isinstance(wert, Text):
        return t(wert.vorlage, sprache, **wert.werte)
    return t(wert, sprache) if isinstance(wert, str) else str(wert)


def uebersetzte_fehler(app) -> None:
    """Fehlermeldungen (detail) beim Antworten in die Sprache der Anfrage bringen (main.py). Was nicht im Katalog
    steht, bleibt, wie es ist; Listen (Prüffehler von FastAPI) auch."""
    from fastapi.exception_handlers import http_exception_handler
    from starlette.exceptions import HTTPException

    async def uebersetzt(request, exc: HTTPException):
        if isinstance(exc.detail, str):
            exc.detail = uebersetze(exc.detail, aus_anfrage(request))
        return await http_exception_handler(request, exc)

    app.add_exception_handler(HTTPException, uebersetzt)


WOCHENTAGE = (merke("Mo"), merke("Di"), merke("Mi"), merke("Do"), merke("Fr"), merke("Sa"), merke("So"))


def wochentag(tag: datetime, sprache: str) -> str:
    return t(WOCHENTAGE[tag.weekday()], sprache)


def datum(tag: datetime, sprache: str) -> str:
    """Datum mit Jahr wie in der App: 03.11.2026, englisch und arabisch 03/11/2026"""
    return tag.strftime("%d/%m/%Y" if sprache in ("en", "ar") else "%d.%m.%Y")
