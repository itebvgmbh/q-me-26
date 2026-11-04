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

STANDARD = {"proWelle": 200, "proMonat": 300.0, "preis": 0.77}  # PIN eBrief, farbig, netto (Recherche 04.11.2026)
GRENZEN = {"proWelle": (1, 2000), "proMonat": (0, 20000), "preis": (0.01, 10)}
ERINNERUNG_TAGE = 21
HOECHSTENS = 2  # Briefe je Salon
ARTEN = ("brief", "erinnerung")


def einstellungen() -> dict:
    gespeichert = _einstellungen().hole("briefe") or {}
    return {k: type(v)(gespeichert.get(k, v)) for k, v in STANDARD.items()}


def einstellungen_speichern(werte: dict) -> dict:
    """Obergrenze je Welle, Kostengrenze je Monat, Preis je Brief; ValueError mit Text für den Betreiber"""
    neu = {}
    for key, standard in STANDARD.items():
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


def _offen(entry: dict) -> bool:
    return any(p.get("status") == "erzeugt" for p in entry.get("post") or [])


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


def monatskosten(now: datetime) -> float:
    """Was im Kalendermonat schon in Wellen steckt (erzeugt oder verschickt)"""
    return round(sum(float(w.get("kosten") or 0) for w in _wellen().alle()
                     if w.get("status") in ("erzeugt", "verschickt") and _monat(_zeit(w["am"])) == _monat(now)), 2)


def welle_erzeugen(ids: list, art: str, basis: str, plaetze_frei: int, now: Optional[datetime] = None) -> tuple:
    """Codes und ein PDF mit einer Seite je Salon, nach PLZ sortiert. Gibt (Welle, PDF) zurück.

    Die Codes stehen nur im PDF. Passt ein Salon nicht (mehr), entsteht gar keine Welle: ValueError mit Text.
    """
    now = now or vz.now()
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
    if schon + kosten > s["proMonat"] + 0.001:
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
    welle = {"art": art, "am": now, "status": "erzeugt", "eintraege": [e["id"] for e in entries], "anzahl": len(entries),
             "preis": s["preis"], "kosten": kosten}
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


def wellen(entries: list) -> list:
    """Alle Wellen außer verworfenen, neueste zuerst, mit Auswertung"""
    by_id = {e["id"]: e for e in entries}
    rows = [w for w in _wellen().alle() if w.get("status") != "verworfen"]
    rows.sort(key=lambda w: _zeit(w["am"]), reverse=True)
    return [{**{k: w.get(k) for k in ("id", "art", "am", "status", "anzahl", "preis", "kosten", "verschicktAm")},
             "auswertung": auswertung(w, by_id)} for w in rows]
