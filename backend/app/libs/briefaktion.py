"""Briefe an Salons aus dem Verzeichnis, in Wellen (requirements/briefversand.md).

Wer einen Brief bekommen darf, steht nur hier (hindernis). Die Auswahl im Betreiber-Bereich, die Welle und der einzelne
Brief aus dem Reiter Verzeichnis prüfen dieselben Regeln.

Keine Post mehr: Der Brief verspricht, dass niemand Post bekommt, der das nicht will. Gesperrt wird am Eintrag
(postSperre) und zusätzlich in der Sperrliste (Sammlung `briefsperren`). Die hält nur Hashes von Anschrift und
Google-Place-ID, keinen Namen und keine Anschrift im Klartext. So greift die Sperre auch, wenn der Eintrag gelöscht und
derselbe Salon später neu importiert wird.

Unzustellbar: Kam ein Brief zurück, bekommt der Salon keinen weiteren, bis seine Anschrift geändert ist.

Welle (Stufe A): Der Betreiber wählt Salons, Dranzeit legt je Salon einen neuen Übernahme-Code an und baut ein PDF mit einer
Seite je Brief. Die Codes stehen nur darin. Er lädt es beim Dienstleister hoch (PIN eBrief) und klickt „Hochgeladen“; erst
dann gelten die Briefe als verschickt. Nicht hochgeladen lässt sich die Welle verwerfen. Erinnerung frühestens
ERINNERUNG_TAGE nach dem ersten Brief, höchstens HOECHSTENS Briefe je Salon. Grenzen je Welle und Monat: einstellungen().

Felder am Eintrag: postSperre {am, grund}, unzustellbar {am, anschrift (Hash)}, post [{welle, art, am, status, verschicktAm}],
dazu uebernahme.welle/.vorher (app/libs/uebernahme.py)
Sammlungen: briefwellen {art, am, status (erzeugt|verschickt|verworfen), eintraege, anzahl, preis, kosten, verschicktAm},
briefsperren (nur {am}, ID = Hash), einstellungen/briefe {proWelle, proMonat, preis}
"""

import hashlib
import threading
from datetime import datetime, timedelta
from typing import Optional

from app.libs import brief
from app.libs import uebernahme as ue
from app.libs import verzeichnis as vz

WELLEN = "briefwellen"
SPERREN = "briefsperren"
EINSTELLUNGEN = "einstellungen"
BETREIBER_GRUENDE = ("E-Mail", "Brief", "Anruf", "vor Ort")
GRUND_ENTFERNT = "Eintrag entfernt"  # app/libs/entfernen.py sperrt mit
SALZ = "dranzeit-post:"

_stores: dict = {}


def set_stores(wellen, sperren, einstellungen) -> None:
    """Für Tests"""
    _stores.update({WELLEN: wellen, SPERREN: sperren, EINSTELLUNGEN: einstellungen})
    _letzter_abgleich["am"] = None


def _store(name: str):
    if name not in _stores:
        _stores[name] = vz.FirestoreStore(name)
    return _stores[name]


def _wellen():
    return _store(WELLEN)


def _sperren():
    return _store(SPERREN)


def _einstellungen():
    return _store(EINSTELLUNGEN)


# --- Keine Post mehr ------------------------------------------------------------------------------------------------


def _hash(text: str) -> str:
    return hashlib.sha256(f"{SALZ}{text}".encode()).hexdigest()[:32]


def _anschrift(entry: dict) -> str:
    """'Hauptstraße 1', 'Hauptstr. 1' → dieselbe Schreibweise; '' ohne Straße oder PLZ"""
    strasse = vz.slugify(entry.get("street") or "").replace("strasse", "str").replace("-", "")
    plz = (entry.get("postalCode") or "").strip()
    return f"{plz}|{strasse}" if strasse and plz else ""


def schluessel(entry: dict) -> list:
    """IDs in der Sperrliste für diesen Salon: Anschrift und, falls bekannt, Google-Place-ID"""
    keys = []
    if _anschrift(entry):
        keys.append("a" + _hash(_anschrift(entry)))
    if entry.get("googlePlaceId"):
        keys.append("p" + _hash(entry["googlePlaceId"]))
    return keys


def sperrliste() -> set:
    return {d["id"] for d in _sperren().alle()}


def gesperrt(entry: dict, liste: set) -> bool:
    return bool(entry.get("postSperre")) or any(k in liste for k in schluessel(entry))


def sperren(entry: dict, grund: str, now: Optional[datetime] = None, st=None) -> None:
    now = now or vz.now()
    (st or vz.store()).aendere(entry["id"], {"postSperre": {"am": now, "grund": grund}})
    for key in schluessel(entry):
        _sperren().neu({"am": now}, key)


def aufheben(entry: dict, st=None) -> None:
    (st or vz.store()).aendere(entry["id"], {"postSperre": None})
    for key in schluessel(entry):
        _sperren().loesche(key)


def keine_post_melden(entry: dict) -> None:
    """Mail an die Betreiber: Der Salon hat auf seiner Seite „Keine Post mehr“ gewählt"""
    from app.libs.entfernen import _salon_zeilen
    from app.libs.mail import an_betreiber, esc, public_url

    salon_html, salon_text = _salon_zeilen(entry)
    satz = "Der Salon hat auf seiner Seite „Keine Post mehr“ gewählt. Er bekommt keine Briefe mehr von uns, die Seite bleibt online."
    ziel = f"{public_url()}/betreiber?reiter=verzeichnis"
    an_betreiber(" ".join(f"Keine Post: {entry.get('name') or ''}".split()), "Keine Post mehr", [esc(satz), *salon_html],
                 f"{satz}\n\n{salon_text}\nBetreiber-Bereich: {ziel}\n", "Im Betreiber-Bereich ansehen", ziel)


# --- Unzustellbar ---------------------------------------------------------------------------------------------------


def unzustellbar(entry: dict, an: bool, now: Optional[datetime] = None, st=None) -> None:
    wert = {"am": now or vz.now(), "anschrift": _hash(_anschrift(entry))} if an else None
    (st or vz.store()).aendere(entry["id"], {"unzustellbar": wert})


def ist_unzustellbar(entry: dict) -> bool:
    """Gilt nur für die Anschrift, an die der Brief ging; nach einer Korrektur ist der Salon wieder auswählbar"""
    u = entry.get("unzustellbar") or {}
    return bool(u) and u.get("anschrift") == _hash(_anschrift(entry))


# --- Regeln ---------------------------------------------------------------------------------------------------------


def hindernis(entry: dict, liste: set, now: datetime) -> str:
    """Warum dieser Salon keinen Brief bekommt; leer = er darf"""
    grund = brief.hindernis(entry)
    if grund:
        return grund
    if entry.get("shopId"):
        return "Die Seite gehört schon zu einem Dranzeit-Laden."
    if gesperrt(entry, liste):
        return "Der Salon möchte keine Post von uns."
    if ist_unzustellbar(entry):
        return "Der letzte Brief kam nicht an. Anschrift prüfen."
    return ""


# --- Einstellungen --------------------------------------------------------------------------------------------------

STANDARD = {"proWelle": 200, "proMonat": 300.0, "preis": 0.77, "testmodus": True}  # PIN eBrief, farbig, netto (Recherche 04.11.2026)
GRENZEN = {"proWelle": (1, 2000), "proMonat": (0, 20000), "preis": (0.01, 10)}
ERINNERUNG_TAGE = 21
HOECHSTENS = 2  # Briefe je Salon
ARTEN = ("brief", "erinnerung")


def einstellungen() -> dict:
    gespeichert = _einstellungen().hole("briefe") or {}
    werte = {k: type(v)(gespeichert.get(k, v)) for k, v in STANDARD.items() if not isinstance(v, bool)}
    werte["testmodus"] = gespeichert["testmodus"] if isinstance(gespeichert.get("testmodus"), bool) else STANDARD["testmodus"]
    return werte


def einstellungen_speichern(werte: dict) -> dict:
    """Obergrenze je Welle, Kostengrenze je Monat, Preis je Brief, Testmodus (Versand an die Testumgebung von PIN).

    Fehlt testmodus, bleibt er, wie er war. ValueError mit Text für den Betreiber.
    """
    neu = {}
    testmodus = werte.get("testmodus", einstellungen()["testmodus"])
    if not isinstance(testmodus, bool):
        raise ValueError("testmodus: ja oder nein.")
    for key, standard in STANDARD.items():
        if key == "testmodus":
            neu[key] = testmodus
            continue
        try:
            wert = type(standard)(werte.get(key))
        except (TypeError, ValueError):
            raise ValueError(f"{key}: bitte eine Zahl angeben.") from None
        low, high = GRENZEN[key]
        if isinstance(werte.get(key), bool) or not low <= wert <= high:
            raise ValueError(f"{key}: zwischen {low} und {high}.")
        neu[key] = round(wert, 2) if isinstance(wert, float) else wert
    _einstellungen().neu(neu, "briefe")
    return neu


def euro(betrag: float) -> str:
    return f"{betrag:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


# --- Welle ----------------------------------------------------------------------------------------------------------


def _zeit(value) -> Optional[datetime]:
    return ue._aware(value)


def verschickt(entry: dict) -> list:
    return [p for p in entry.get("post") or [] if p.get("status") == "verschickt"]


OFFEN = ("erzeugt", "wird_verschickt", "unklar")  # Brief in Arbeit: noch nicht hochgeladen, gerade unterwegs zu PIN, Antwort offen


def _offen(entry: dict) -> bool:
    return any(p.get("status") in OFFEN for p in entry.get("post") or [])


def _datum(value: datetime) -> str:
    return value.astimezone(brief.BERLIN).strftime("%d.%m.%Y")


def grund_fuer(entry: dict, liste: set, now: datetime, art: str) -> str:
    """Wie hindernis, dazu die Regeln einer Welle: erster Brief oder Erinnerung nach ERINNERUNG_TAGE, höchstens zwei"""
    grund = hindernis(entry, liste, now)
    if grund:
        return grund
    if _offen(entry):
        return "Steckt in einer Welle, die noch nicht hochgeladen ist."
    briefe = verschickt(entry)
    if len(briefe) >= HOECHSTENS:
        return "Hat schon zwei Briefe bekommen."
    if art == "brief":
        return "Hat schon einen Brief bekommen." if briefe else ""
    if not briefe:
        return "Hat noch keinen Brief bekommen."
    faellig = max(_zeit(p.get("verschicktAm") or p.get("am")) for p in briefe) + timedelta(days=ERINNERUNG_TAGE)
    return f"Erinnerung ab {_datum(faellig)}." if now < faellig else ""


def _monat(value: datetime) -> str:
    return value.astimezone(brief.BERLIN).strftime("%Y-%m")


ZAEHLEN = ("erzeugt", "verschickt", "versendet", "abgebrochen")  # Wellen, die Geld kosten (verworfene und Tests nicht)


def monatskosten(now: datetime, ohne: str = "") -> float:
    """Was im Kalendermonat schon in Wellen steckt (erzeugt, verschickt oder gerade unterwegs zu PIN)"""
    return round(sum(float(w.get("kosten") or 0) for w in _wellen().alle()
                     if w.get("status") in ZAEHLEN and not w.get("test") and w["id"] != ohne and _monat(_zeit(w["am"])) == _monat(now)), 2)


def _pruefen(ids: list, art: str, now: datetime, test: bool = False) -> tuple:
    """Gemeinsame Prüfung für beide Wege: (Salons nach PLZ sortiert, geschätzte Kosten). ValueError mit Text."""
    if art not in ARTEN:
        raise ValueError("Art ist brief oder erinnerung.")
    ids = list(dict.fromkeys(ids or []))
    if not ids:
        raise ValueError("Keine Salons ausgewählt.")
    s = einstellungen()
    if len(ids) > s["proWelle"]:
        raise ValueError(f"Höchstens {s['proWelle']} Briefe je Welle (Einstellungen).")
    kosten = round(len(ids) * s["preis"], 2)
    schon = monatskosten(now)
    if not test and schon + kosten > s["proMonat"] + 0.001:
        raise ValueError(f"Die Welle kostet {euro(kosten)}, diesen Monat sind schon {euro(schon)} verplant. "
                         f"Die Grenze liegt bei {euro(s['proMonat'])} (Einstellungen).")
    liste = sperrliste()
    entries = []
    for entry_id in ids:
        entry = vz.store().hole(entry_id)
        if not entry:
            raise ValueError("Einen ausgewählten Salon gibt es nicht mehr. Bitte neu laden.")
        grund = grund_fuer(entry, liste, now, art)
        if grund:
            raise ValueError(f"{entry.get('name') or entry_id}: {grund}")
        entries.append(entry)
    entries.sort(key=lambda e: ((e.get("postalCode") or ""), (e.get("name") or "").lower()))
    return entries, kosten


def welle_erzeugen(ids: list, art: str, basis: str, plaetze_frei: int, now: Optional[datetime] = None) -> tuple:
    """Codes und ein PDF mit einer Seite je Salon, nach PLZ sortiert. Gibt (Welle, PDF) zurück.

    Die Codes stehen nur im PDF. Passt ein Salon nicht (mehr), entsteht gar keine Welle: ValueError mit Text.
    """
    now = now or vz.now()
    entries, kosten = _pruefen(ids, art, now)
    welle = {"art": art, "am": now, "status": "erzeugt", "weg": "pdf", "eintraege": [e["id"] for e in entries], "anzahl": len(entries),
             "preis": einstellungen()["preis"], "kosten": kosten}
    welle["id"] = _wellen().neu(welle)
    items = []
    try:
        for entry in entries:
            neu = ue.code_erzeugen(entry, now=now, welle=welle["id"])
            vz.store().aendere(entry["id"], {"post": (entry.get("post") or []) + [{"welle": welle["id"], "art": art, "am": now, "status": "erzeugt"}]})
            items.append((entry, neu["code"], neu["gueltigBis"]))
        pdf = brief.serie(items, art, basis, plaetze_frei, now)
    except Exception:
        verwerfen(welle["id"], now)  # sonst hingen Codes ohne Brief an den Salons
        raise
    return welle, pdf


def _welle(welle_id: str) -> dict:
    welle = _wellen().hole(welle_id or "")
    if not welle:
        raise KeyError(welle_id)
    return welle


def hochgeladen(welle_id: str, now: Optional[datetime] = None) -> dict:
    """Der Betreiber hat das PDF beim Dienstleister hochgeladen: Erst jetzt gelten die Briefe als verschickt"""
    now = now or vz.now()
    welle = _welle(welle_id)
    if welle.get("status") != "erzeugt":
        raise ValueError("Diese Welle ist nicht mehr offen.")
    for entry_id in welle.get("eintraege") or []:
        entry = vz.store().hole(entry_id)
        if entry:
            post = [{**p, "status": "verschickt", "verschicktAm": now} if p.get("welle") == welle_id else p for p in entry.get("post") or []]
            vz.store().aendere(entry_id, {"post": post})
    _wellen().aendere(welle_id, {"status": "verschickt", "verschicktAm": now})
    return {**welle, "status": "verschickt", "verschicktAm": now}


def verwerfen(welle_id: str, now: Optional[datetime] = None) -> dict:
    """Nicht hochgeladen: Codes der Welle gelten nicht mehr (ein früherer wieder), die Salons sind wieder auswählbar"""
    now = now or vz.now()
    welle = _welle(welle_id)
    if welle.get("status") != "erzeugt":
        raise ValueError("Nur eine noch nicht hochgeladene Welle lässt sich verwerfen.")
    for entry_id in welle.get("eintraege") or []:
        entry = vz.store().hole(entry_id)
        if not entry:
            continue
        changes = {"post": [p for p in entry.get("post") or [] if p.get("welle") != welle_id]}
        info = entry.get("uebernahme") or {}
        if info.get("welle") == welle_id and not info.get("eingeloestAm"):
            changes["uebernahme"] = info.get("vorher")
        vz.store().aendere(entry_id, changes)
    _wellen().aendere(welle_id, {"status": "verworfen", "verworfenAm": now})
    return {**welle, "status": "verworfen", "verworfenAm": now}


# --- Stufe B: Versand über die Schnittstelle von PIN eBrief (app/libs/briefdienst.py) --------------------------------
#
# Ein Auftrag je Brief. Vor jedem Brief steht in der Welle „wird_verschickt“ mit einem eigenen Dateinamen. Kommt keine
# eindeutige Antwort (Zeitüberschreitung, Neustart), fragt abgleich() bei PIN nach diesem Dateinamen, statt den Brief noch
# einmal zu schicken. Im Testmodus geht alles an die Testumgebung von PIN; die Salons bleiben unverändert (kein Code,
# keine Post), und die Welle zählt weder bei den Kosten noch in der Auswertung.
#
# Welle: weg "pin", test, status versendet (läuft) | verschickt | abgebrochen, briefe {Salon-ID: {status
# (wird_verschickt|verschickt|unklar|fehler), datei, am, auftrag, dokument, preis, fehler, pin, zurueck}}, kosten, hinweis,
# lebenszeichen. Am Eintrag (nur echt): post [{welle, art, am, status, weg "pin", auftrag, verschicktAm}].

ABGEBROCHEN_NACH = timedelta(minutes=10)  # so lange ohne Lebenszeichen gilt eine laufende Welle als abgebrochen (Neustart)
UNKLAR_BIS_FEHLER = timedelta(minutes=30)  # so lange darf PIN brauchen, bis ein Brief in der Suche auftaucht
STATUS_ALLE = timedelta(hours=6)  # so oft fragt Dranzeit den Stand aller Briefe ab (dazu kommt der Webhook)
STATUS_TAGE = 45  # so lange nach dem Versand wird gefragt (Rückläufer)

_dienst_fabrik = None
_schnittstelle = None
_laeuft: set = set()
_versand_lock = threading.Lock()
_letzter_abgleich: dict = {"am": None}


def set_dienst(fabrik, eingerichtet: dict) -> None:
    """Für Tests: fabrik(test) liefert den Dienst, eingerichtet sagt, welche Zugänge es gibt"""
    global _dienst_fabrik, _schnittstelle
    _dienst_fabrik, _schnittstelle = fabrik, eingerichtet


def schnittstelle() -> dict:
    from app.libs import briefdienst

    return dict(_schnittstelle) if _schnittstelle is not None else briefdienst.eingerichtet()


_dienste: dict = {}


def dienst(test: bool):
    """PIN eBrief für Testumgebung oder echten Versand; None ohne Zugang"""
    from app.libs import briefdienst

    if _dienst_fabrik is not None:
        return _dienst_fabrik(test)
    if not schnittstelle()["test" if test else "echt"]:
        return None
    if test not in _dienste:
        _dienste[test] = briefdienst.PinEbrief(test)
    return _dienste[test]


def _im_hintergrund(fn, *args) -> None:
    threading.Thread(target=fn, args=args, daemon=True, name="briefversand").start()


class _System:
    """Wer im Protokoll steht, wenn der Versand im Hintergrund etwas meldet"""
    email = "Dranzeit (Briefversand)"
    sub = ""


def _protokoll(user, aktion: str, welle_id: str, **after) -> None:
    from app.libs import protokoll

    protokoll.write(user or _System(), aktion, {"welle": welle_id}, after=after)


def versand_starten(ids: list, art: str, basis: str, plaetze_frei: int, now: Optional[datetime] = None, user=None) -> dict:
    """Welle anlegen und im Hintergrund Brief für Brief an PIN schicken. Ob Test oder echt, sagt die Einstellung testmodus."""
    fest = now is not None
    now = now or vz.now()
    test = einstellungen()["testmodus"]
    if dienst(test) is None:
        raise ValueError(f"Der Versand über PIN eBrief ist für {'die Testumgebung' if test else 'den echten Versand'} nicht eingerichtet.")
    with _versand_lock:
        if any(w.get("status") == "versendet" for w in _wellen().alle()):
            raise ValueError("Eine Welle wird gerade verschickt. Warte, bis sie fertig ist.")
        entries, kosten = _pruefen(ids, art, now, test)
        welle = {"art": art, "am": now, "status": "versendet", "weg": "pin", "test": test, "eintraege": [e["id"] for e in entries],
                 "anzahl": len(entries), "preis": einstellungen()["preis"], "kosten": 0.0 if test else kosten, "briefe": {},
                 "lebenszeichen": now}
        welle["id"] = _wellen().neu(welle)
    _protokoll(user, "Briefe: Welle an PIN (Test)" if test else "Briefe: Welle an PIN", welle["id"], art=art, anzahl=len(entries), kosten=kosten)
    uhr = (lambda: now) if fest else vz.now  # mit festem Zeitpunkt (Tests) tragen alle Briefe ihn
    _im_hintergrund(_versenden, welle["id"], welle["eintraege"], art, basis, plaetze_frei, user, uhr)
    return welle


def _briefe_setzen(welle_id: str, entry_id: str, brief_info: dict, **welle_changes) -> dict:
    w = _welle(welle_id)
    briefe = {**(w.get("briefe") or {}), entry_id: brief_info}
    _wellen().aendere(welle_id, {"briefe": briefe, **welle_changes})
    return briefe


def _ist_kosten(briefe: dict, preis: float) -> float:
    return round(sum(float(b.get("preis") or preis) for b in briefe.values() if b.get("status") == "verschickt"), 2)


def _post_setzen(entry_id: str, welle_id: str, **felder) -> None:
    entry = vz.store().hole(entry_id)
    if entry:
        vz.store().aendere(entry_id, {"post": [{**p, **felder} if p.get("welle") == welle_id else p for p in entry.get("post") or []]})


def _markieren(welle_id: str, entry_id: str, now: datetime) -> dict:
    """Vor dem Abschicken: Ab hier fragt Dranzeit nach einem Abbruch bei PIN nach, statt den Brief noch einmal zu schicken"""
    w = _welle(welle_id)
    info = {"status": "wird_verschickt", "datei": f"dranzeit-{welle_id}-{entry_id}.pdf", "am": now}
    _briefe_setzen(welle_id, entry_id, info, lebenszeichen=now)
    entry = vz.store().hole(entry_id)
    if entry and not w.get("test"):
        vz.store().aendere(entry_id, {"post": [p for p in entry.get("post") or [] if p.get("welle") != welle_id]
                                      + [{"welle": welle_id, "art": w["art"], "am": now, "status": "wird_verschickt", "weg": "pin"}]})
    return info


def _fehlschlag(welle_id: str, entry_id: str, grund: str) -> None:
    """Kein Brief: Grund in der Welle, Salon wieder auswählbar, sein Code aus dieser Welle verfällt (ein früherer gilt wieder)"""
    w = _welle(welle_id)
    info = {**(w.get("briefe") or {}).get(entry_id, {}), "status": "fehler", "fehler": grund[:300]}
    briefe = _briefe_setzen(welle_id, entry_id, info)
    if w.get("status") != "versendet" and not w.get("test"):
        _wellen().aendere(welle_id, {"kosten": _ist_kosten(briefe, float(w.get("preis") or 0))})
    if w.get("test"):
        return
    entry = vz.store().hole(entry_id)
    if entry:
        changes = {"post": [p for p in entry.get("post") or [] if p.get("welle") != welle_id]}
        code = entry.get("uebernahme") or {}
        if code.get("welle") == welle_id and not code.get("eingeloestAm"):
            changes["uebernahme"] = code.get("vorher")
        vz.store().aendere(entry_id, changes)


def _angekommen(welle_id: str, entry_id: str, ergebnis: dict, now: datetime) -> None:
    w = _welle(welle_id)
    info = {**(w.get("briefe") or {}).get(entry_id, {}), "status": "verschickt", "auftrag": ergebnis["auftrag"],
            "dokument": ergebnis.get("dokument") or "", "preis": ergebnis.get("preis") or float(w.get("preis") or 0),
            "pin": {"status": ergebnis.get("status") or "", "am": now}}
    briefe = _briefe_setzen(welle_id, entry_id, info, lebenszeichen=now)
    if w.get("status") != "versendet" and not w.get("test"):
        _wellen().aendere(welle_id, {"kosten": _ist_kosten(briefe, float(w.get("preis") or 0))})
    if not w.get("test"):
        _post_setzen(entry_id, welle_id, status="verschickt", auftrag=ergebnis["auftrag"], verschicktAm=info.get("am") or now)


def _einen_brief(welle_id: str, entry_id: str, art: str, basis: str, plaetze_frei: int, now: datetime) -> str:
    """Code, PDF, an PIN. Gibt den Status des Briefs zurück (verschickt, fehler, unklar)."""
    from app.libs import briefdienst

    w = _welle(welle_id)
    test = bool(w.get("test"))
    info = _markieren(welle_id, entry_id, now)
    entry = vz.store().hole(entry_id)
    try:
        if not entry:
            raise ValueError("Den Eintrag gibt es nicht mehr.")
        if test:  # Testumgebung: Code nur fürs Blatt, nirgends gespeichert, nicht einlösbar
            code, gueltig = ue.anzeigen(ue.neuer_code()), now + timedelta(days=ue.GUELTIG_TAGE)
        else:
            neu = ue.code_erzeugen(entry, now=now, welle=welle_id)
            code, gueltig = neu["code"], neu["gueltigBis"]
        pdf = brief.serie([(entry, code, gueltig)], art, basis, plaetze_frei, now)
    except Exception as e:
        _fehlschlag(welle_id, entry_id, f"Brief nicht erstellt: {e}")
        return "fehler"
    try:
        ergebnis = dienst(test).senden(pdf, info["datei"])
    except briefdienst.Abgelehnt as e:
        _fehlschlag(welle_id, entry_id, str(e) or "Von PIN abgelehnt.")
        return "fehler"
    except Exception as e:  # Unklar und alles Unerwartete: vielleicht angekommen, abgleich() fragt nach
        _briefe_setzen(welle_id, entry_id, {**info, "status": "unklar", "fehler": str(e)[:300]})
        if not test:
            _post_setzen(entry_id, welle_id, status="unklar")
        return "unklar"
    _angekommen(welle_id, entry_id, ergebnis, now)
    return "verschickt"


def _versenden(welle_id: str, ids: list, art: str, basis: str, plaetze_frei: int, user=None, uhr=None) -> None:
    """Im Hintergrund: Brief für Brief, mit Kostengrenze. Nur eine Welle zur Zeit."""
    uhr = uhr or vz.now
    _laeuft.add(welle_id)
    hinweis = ""
    try:
        for entry_id in ids:
            w = _welle(welle_id)
            if w.get("status") != "versendet":
                return
            if not w.get("test"):
                s = einstellungen()
                briefe = w.get("briefe") or {}
                ist = _ist_kosten(briefe, s["preis"])
                letzter = max([float(b.get("preis") or 0) for b in briefe.values() if b.get("status") == "verschickt"] + [s["preis"]])
                if monatskosten(uhr(), ohne=welle_id) + ist + letzter > s["proMonat"] + 0.001:
                    fertig = sum(1 for b in briefe.values() if b.get("status") == "verschickt")
                    hinweis = (f"Kostengrenze von {euro(s['proMonat'])} im Monat erreicht: {fertig} von {len(ids)} Briefen verschickt, "
                               "der Rest nicht.")
                    break
            _einen_brief(welle_id, entry_id, art, basis, plaetze_frei, uhr())
        w = _welle(welle_id)
        briefe = w.get("briefe") or {}
        _wellen().aendere(welle_id, {"status": "abgebrochen" if hinweis else "verschickt", "hinweis": hinweis, "verschicktAm": uhr(),
                                     "kosten": 0.0 if w.get("test") else _ist_kosten(briefe, float(w.get("preis") or 0))})
        zaehlen = {s: sum(1 for b in briefe.values() if b.get("status") == s) for s in ("verschickt", "fehler", "unklar")}
        _protokoll(user, "Briefe: Welle an PIN fertig", welle_id, test=bool(w.get("test")), hinweis=hinweis, **zaehlen)
    finally:
        _laeuft.discard(welle_id)


def _nachfragen(w: dict, entry_id: str, info: dict, now: datetime) -> None:
    """Brief ohne eindeutige Antwort: bei PIN nach dem Dateinamen suchen"""
    d = dienst(bool(w.get("test")))
    if d is None:
        return
    try:
        gefunden = d.suchen(info["datei"], _zeit(w["am"]) - timedelta(hours=1))
    except Exception as e:
        print(f"Briefe: Nachfragen bei PIN für {info['datei']} ging nicht: {e}")
        return
    if gefunden:
        _angekommen(w["id"], entry_id, gefunden, now)
    elif now - _zeit(info.get("am") or w["am"]) >= UNKLAR_BIS_FEHLER:
        _fehlschlag(w["id"], entry_id, "Bei PIN nicht angekommen (keine Antwort beim Abschicken).")


def _stand_pruefen(w: dict, entry_id: str, info: dict, now: datetime) -> None:
    """Stand eines verschickten Briefs bei PIN: Fehler nach der Annahme oder unzustellbar"""
    from app.libs import briefdienst

    d = dienst(bool(w.get("test")))
    if d is None or not info.get("auftrag"):
        return
    try:
        st = d.stand(info["auftrag"])
    except Exception as e:
        print(f"Briefe: Stand von Auftrag {info['auftrag']} bei PIN nicht lesbar: {e}")
        return
    if st["status"] in briefdienst.FEHLER_STATUS:
        _fehlschlag(w["id"], entry_id, f"Bei PIN nicht gedruckt ({st['status']}).")
        return
    neu = {**info, "pin": {"status": st["status"], "ereignis": st.get("ereignis") or "", "am": now}}
    if st.get("preis"):
        neu["preis"] = st["preis"]
    if st.get("zurueck") and not info.get("zurueck"):
        neu["zurueck"] = True
        entry = vz.store().hole(entry_id)
        if entry and not w.get("test"):
            unzustellbar(entry, True, now)
    _briefe_setzen(w["id"], entry_id, neu)


def abgleich(now: Optional[datetime] = None, alle: bool = False) -> None:
    """Regelmäßig im Hintergrund (app/apis/schedulers): abgebrochene Wellen abschließen, unklare Briefe klären, Stand abfragen"""
    now = now or vz.now()
    stand_jetzt = alle or not _letzter_abgleich["am"] or now - _letzter_abgleich["am"] >= STATUS_ALLE
    for w in _wellen().alle():
        if w.get("weg") != "pin" or w.get("status") == "verworfen":
            continue
        if w.get("status") == "versendet":
            if w["id"] in _laeuft or now - _zeit(w.get("lebenszeichen") or w["am"]) < ABGEBROCHEN_NACH:
                continue
            fertig = sum(1 for b in (w.get("briefe") or {}).values() if b.get("status") == "verschickt")
            _wellen().aendere(w["id"], {"status": "abgebrochen", "hinweis": f"Versand unterbrochen (Neustart): Briefe, die noch nicht dran waren, "
                                                                             f"gingen nicht raus. {fertig} von {w.get('anzahl')} verschickt."})
            w = _welle(w["id"])
        for entry_id, info in list((w.get("briefe") or {}).items()):
            if info.get("status") in ("unklar", "wird_verschickt"):
                _nachfragen(w, entry_id, info, now)
            elif stand_jetzt and info.get("status") == "verschickt" and not info.get("zurueck") \
                    and now - _zeit(info.get("am") or w["am"]) <= timedelta(days=STATUS_TAGE):
                _stand_pruefen(w, entry_id, info, now)
            w = _welle(w["id"])
        if w.get("status") != "versendet" and not w.get("test"):
            _wellen().aendere(w["id"], {"kosten": _ist_kosten(w.get("briefe") or {}, float(w.get("preis") or 0))})
    if stand_jetzt:
        _letzter_abgleich["am"] = now


def auftrag_aktualisieren(auftrag: str, now: Optional[datetime] = None) -> bool:
    """Webhook von PIN: Stand dieses Auftrags neu abfragen (dem Inhalt der Meldung selbst trauen wir nicht). False = unbekannt."""
    now = now or vz.now()
    for w in _wellen().alle():
        for entry_id, info in (w.get("briefe") or {}).items():
            if info.get("auftrag") == str(auftrag):
                _stand_pruefen(w, entry_id, info, now)
                return True
    return False


# --- Übersicht und Auswertung ---------------------------------------------------------------------------------------


def zeile(entry: dict, liste: set, now: datetime) -> dict:
    """Ein Salon für die Auswahl im Bereich „Briefe“, mit dem Grund je Art (leer = auswählbar)"""
    briefe = verschickt(entry)
    return {
        **{k: entry.get(k) or "" for k in ("id", "name", "kategorie", "street", "postalCode", "city", "bezirk", "ortsteil", "status")},
        "pfad": vz.pfad(entry) if entry.get("slug") and entry.get("stadtSlug") else "",
        "briefe": len(briefe),
        "letzterBrief": max((_zeit(p.get("verschicktAm") or p.get("am")) for p in briefe), default=None),
        "gruende": {art: grund_fuer(entry, liste, now, art) for art in ARTEN},
    }


def _seit(value, welle: dict) -> bool:
    zeit = _zeit(value)
    return bool(zeit) and zeit >= _zeit(welle["am"])


def auswertung(welle: dict, entries_by_id: dict) -> dict:
    """Was aus einer Welle wurde. Übernommen zählt nur ein Code aus dieser Welle, eingelöst über den Brief."""
    salons = [entries_by_id[i] for i in welle.get("eintraege") or [] if i in entries_by_id]
    uebernommen = sum(1 for e in salons if (e.get("uebernahme") or {}).get("welle") == welle["id"]
                      and (e.get("uebernahme") or {}).get("eingeloestAm") and (e.get("uebernahme") or {}).get("per") != "mail")
    kosten = float(welle.get("kosten") or 0)
    return {
        "uebernommen": uebernommen,
        "unzustellbar": sum(1 for e in salons if _seit((e.get("unzustellbar") or {}).get("am"), welle)),
        "entfernt": sum(1 for e in salons if e.get("status") == "entfernt" and _seit(e.get("entferntAm"), welle)),
        "keinePost": sum(1 for e in salons if _seit((e.get("postSperre") or {}).get("am"), welle)
                         and (e.get("postSperre") or {}).get("grund") != GRUND_ENTFERNT),  # zählt schon unter entfernt
        "kostenJeUebernahme": round(kosten / uebernommen, 2) if uebernommen else None,
    }


LEER = {"uebernommen": 0, "unzustellbar": 0, "entfernt": 0, "keinePost": 0, "kostenJeUebernahme": None}


def wellen(entries: list) -> list:
    """Alle Wellen außer verworfenen, neueste zuerst, mit Auswertung (Testwellen ohne)"""
    by_id = {e["id"]: e for e in entries}
    rows = [w for w in _wellen().alle() if w.get("status") != "verworfen"]
    rows.sort(key=lambda w: _zeit(w["am"]), reverse=True)
    out = []
    for w in rows:
        briefe = w.get("briefe") or {}
        pin = w.get("weg") == "pin"
        zahl = lambda *st: sum(1 for b in briefe.values() if b.get("status") in st)  # noqa: E731
        out.append({
            **{k: w.get(k) for k in ("id", "art", "am", "status", "anzahl", "preis", "kosten", "verschicktAm")},
            "weg": w.get("weg") or "pdf",
            "test": bool(w.get("test")),
            "geschickt": zahl("verschickt") if pin else (w.get("anzahl") or 0) if w.get("status") == "verschickt" else 0,
            "unklar": zahl("unklar", "wird_verschickt"),
            "fehler": [{"id": i, "name": (by_id.get(i) or {}).get("name") or i, "grund": b.get("fehler") or ""}
                       for i, b in briefe.items() if b.get("status") == "fehler"],
            "hinweis": w.get("hinweis") or "",
            "auswertung": dict(LEER) if w.get("test") else auswertung(w, by_id),
        })
    return out
