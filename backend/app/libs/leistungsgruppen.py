"""
Leistungsgruppen für „Läden finden“: Jeder Laden nennt seine Leistungen anders, über die feste Gruppe findet die Suche
sie trotzdem. Regeln in frontend/src/data/leistungsgruppen.json (gleich gelesen von frontend/src/utils/leistungsgruppen.ts),
gemeinsame Prüffälle in dev/leistungsgruppen-faelle.json.

Ein Inhaber kann die Gruppe einer Leistung festlegen (Feld gruppe: Schlüssel oder „keine“), sonst gilt die Zuordnung
per Stichwort: erst der Name, dann die Kategorie, zuletzt ein allgemeiner Schnitt.
"""
import json
import logging
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

DATEI = Path(__file__).resolve().parents[3] / "frontend" / "src" / "data" / "leistungsgruppen.json"
KEINE = "keine"
LEER = {"gruppen": [], "name": [], "kategorie": [], "schnitt": {"woerter": [], "gruppe": "", "herren": []}, "ohneLeistungen": {}}


@lru_cache(maxsize=1)
def daten() -> dict:
    # Fehlt die Datei (sollte nie passieren, der Server hat das ganze Repo), sucht die Seite nur nach Text
    try:
        return json.loads(DATEI.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logging.exception("Leistungsgruppen: %s nicht lesbar", DATEI)
        return LEER


def norm(text) -> str:
    """Wie normSuche in frontend/src/utils/suche.ts: klein, ohne Akzente, ä→ae, Satzzeichen als Leerzeichen"""
    t = (text or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def _trifft(text: str, wort: str) -> bool:
    # „_x“: ein Wort fängt mit x an; sonst irgendwo im Text
    return f" {wort[1:]}" in f" {text}" if wort.startswith("_") else wort in text


def _einer(text: str, woerter) -> bool:
    return any(_trifft(text, w) for w in woerter or [])


def _passt(text: str, regel: dict) -> bool:
    return _einer(text, regel["woerter"]) and (not regel.get("und") or _einer(text, regel["und"])) and not _einer(text, regel.get("nicht"))


def keys() -> list[str]:
    return [g["key"] for g in daten()["gruppen"]]


def auto(name: str, kategorie: str = "", kontext: str = "") -> str | None:
    d = daten()
    n = norm(name)
    for r in d["name"]:
        if _passt(n, r):
            return r["gruppe"]
    k = norm(kategorie)
    if k:
        for r in d["kategorie"]:
            if _passt(k, r):
                return r["gruppe"]
    if _einer(n, d["schnitt"]["woerter"]):
        return "herren" if _einer(norm(kontext), d["schnitt"]["herren"]) else d["schnitt"]["gruppe"]
    return None


def wirksam(leistung: dict, kontext: str = "") -> str | None:
    """Vom Inhaber festgelegt, sonst automatisch"""
    g = leistung.get("gruppe")
    if g == KEINE:
        return None
    if g and g in keys():
        return g
    return auto(leistung.get("name") or "", leistung.get("category") or "", kontext)


def menge(key: str) -> set[str]:
    """Welche Gruppen bei der Suche nach key mitzählen („Herrenhaarschnitt“ findet auch „Haarschnitt“)"""
    g = next((x for x in daten()["gruppen"] if x["key"] == key), None)
    return {key, *(g.get("auch") or [])} if g else set()


def salon_gruppen(namen: list, kategorie: str, kontext: str = "") -> list[str]:
    """Salon im Verzeichnis: Gruppen seiner Leistungen; ohne Liste (oder ohne Treffer) die üblichen seiner Kategorie.
    Schneidet er laut Liste nur Damen (oder nur Herren), ist ein Schnitt ohne Angabe keiner für alle – sonst stünde ein
    Damensalon mit „Pony schneiden“ bei der Suche nach dem Herrenschnitt."""
    gefunden = []
    for name in namen:
        g = auto(name, "", f"{kontext} {kategorie}")
        if g and g not in gefunden:
            gefunden.append(g)
    if "haarschnitt" in gefunden and ("damen" in gefunden) != ("herren" in gefunden):
        gefunden.remove("haarschnitt")
    return gefunden or list(daten()["ohneLeistungen"].get(kategorie) or [])


def gueltig(wert) -> bool:
    """Was als Feld gruppe gespeichert werden darf: nichts (automatisch), „keine“ oder ein Schlüssel"""
    return wert is None or wert == "" or wert == KEINE or (isinstance(wert, str) and wert in keys())
