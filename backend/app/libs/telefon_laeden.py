"""Telefon-Assistent je Laden: freigegeben, eingeschaltet, Ladennummer, verbrauchte Minuten.

telefon_laeden/{Laden-ID}: nur das Backend liest und schreibt das (firestore.rules).
    freigegeben   der Betreiber lässt den Laden zu (Betreiber-Bereich)
    freiminuten   so viele Minuten sind frei, danach nur noch die Ansage
    aktiv         der Inhaber hat ihn eingeschaltet (/telefon-assistent)
    anschluss     Nummer des Ladens, die auf uns umleitet (+49…)
    status        "wartet" bis zum ersten Anruf von dort, dann "aktiv"
    sekunden      verbrauchte Gesprächszeit
telefon_anrufe/{CallSid}: laufender Anruf → Laden, bis Twilio das Ende meldet. Ohne Anrufernummer.
"""
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from app import store
from app.i18n import merke
from app.libs import telefon as t
from app.libs.plans import has_feature, is_suspended

WARTET_TAGE = 7  # so lange hält ein Laden eine Nummer ohne Probeanruf, danach darf sie ein anderer eintragen


class Abgelehnt(Exception):
    """Geht nicht, mit Text für den Inhaber"""

    def __init__(self, status: int, text: str):
        super().__init__(text)
        self.status, self.text = status, text


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def leistungen(db, shop_id: str) -> list:
    """Angebotene Leistungen (gelöschte nicht), wie offeredServices im Frontend"""
    items = []
    for snap in db.collection("services").where("shopId", "==", shop_id).stream():
        s = snap.to_dict() or {}
        if not s.get("archived"):
            items.append({**s, "id": snap.id, "name": str(s.get("name") or "").strip()})
    return sorted(items, key=lambda s: s["name"].casefold())


def eintrag(db, shop_id: str) -> dict:
    snap = db.collection(t.LAEDEN).document(shop_id).get()
    return (snap.to_dict() or {}) if snap.exists else {}


def zum_anschluss(db, nummer: str) -> Tuple[Optional[str], dict]:
    """Welcher Laden leitet von dieser Nummer um? (Laden-ID, Eintrag) oder (None, {})"""
    for snap in db.collection(t.LAEDEN).where("anschluss", "==", nummer).limit(1).stream():
        return snap.id, snap.to_dict() or {}
    return None, {}


def eigene_nummer(db, shop_id: str) -> Optional[str]:
    """Nummer nur für diesen Laden (telefon_leitungen), falls die Ladennummer bei der Umleitung nicht mitkommt"""
    for snap in db.collection(t.LEITUNGEN).where("shopId", "==", shop_id).limit(1).stream():
        return snap.id
    return None


def gemeinsame_nummer() -> Optional[str]:
    return t.e164(os.environ.get("QME_TELEFON_NUMMER", ""))


def _laeuft(daten: dict, shop: dict, eigene: Optional[str]) -> bool:
    """Nimmt der Assistent gerade ab und kann er einen Termin buchen? Nur dann darf man es Kunden sagen."""
    if t.entscheiden(daten, is_suspended(shop)) != t.ANNEHMEN or not has_feature(shop, "termine"):
        return False
    return bool(eigene) or daten.get("status") == "aktiv"


def nimmt_an(db, shop_id: str) -> bool:
    """Für den Hinweis neben der Nummer des Ladens (Ladenseite, Salonseite). Steht dort eine andere Nummer als die
    umgeleitete, landet der Anruf nicht beim Assistenten."""
    daten = eintrag(db, shop_id)
    if not daten:
        return False
    snap = db.collection("shops").document(shop_id).get()
    if not snap.exists:
        return False
    shop = snap.to_dict() or {}
    eigene = eigene_nummer(db, shop_id)
    nummer = t.e164(shop.get("phone"))
    return _laeuft(daten, shop, eigene) and bool(nummer) and (bool(eigene) or nummer == daten.get("anschluss"))


def nehmen_an(db) -> list:
    """Alle Läden, bei denen man über die Nummer auf der Ladenseite per Telefon buchen kann (Ladenliste, Buchung)"""
    return [snap.id for snap in db.collection(t.LAEDEN).where("aktiv", "==", True).stream() if nimmt_an(db, snap.id)]


def stand(db, shop_id: str, shop: dict) -> dict:
    """Was der Inhaber und der Betreiber zu sehen bekommen"""
    daten = eintrag(db, shop_id)
    eigene = eigene_nummer(db, shop_id)
    return {
        "freigegeben": bool(daten.get("freigegeben")),
        "aktiv": bool(daten.get("aktiv")),
        "weitersagen": _laeuft(daten, shop, eigene),
        "status": "aktiv" if eigene else daten.get("status") or "aus",
        "anschluss": daten.get("anschluss") or "",
        "vorschlag": t.e164(shop.get("phone")) or "",
        "zielnummer": eigene or gemeinsame_nummer() or "",
        "eigeneNummer": bool(eigene),
        "minuten": math.ceil(int(daten.get("sekunden") or 0) / 60),
        "freiminuten": int(daten.get("freiminuten") if daten.get("freiminuten") is not None else t.FREIMINUTEN),
    }


def _pruefe_anschluss(db, shop_id: str, nummer: str) -> None:
    if not nummer.startswith("+49"):
        raise Abgelehnt(400, merke("Bitte eine deutsche Rufnummer eintragen."))
    if nummer == gemeinsame_nummer():
        raise Abgelehnt(400, merke("Das ist die Nummer des Assistenten. Trag hier die Nummer deines Ladens ein."))
    fremd, daten = zum_anschluss(db, nummer)
    if not fremd or fremd == shop_id:
        return
    seit = daten.get("wartetSeit")
    frei = daten.get("status") != "aktiv" and seit is not None and seit < _jetzt() - timedelta(days=WARTET_TAGE)
    if not frei:
        raise Abgelehnt(409, merke("Diese Nummer ist schon bei einem anderen Laden eingetragen. Schreib uns an hilfe@dranzeit.de."))
    db.collection(t.LAEDEN).document(fremd).update({"anschluss": None, "status": "aus", "aktiv": False})


def einstellen(db, shop_id: str, aktiv: bool, anschluss: str) -> None:
    """Der Inhaber schaltet ein oder aus und trägt die Nummer seines Ladens ein"""
    daten = eintrag(db, shop_id)
    if not daten.get("freigegeben"):
        raise Abgelehnt(403, merke("Der Telefon-Assistent ist für diesen Laden noch nicht freigeschaltet."))
    nummer = t.e164(anschluss)
    if anschluss.strip() and not nummer:
        raise Abgelehnt(400, merke("Das ist keine Rufnummer (z. B. 030 1234567)."))
    eigene = eigene_nummer(db, shop_id)
    if not nummer and not eigene and aktiv:
        raise Abgelehnt(400, merke("Trag zuerst die Nummer deines Ladens ein."))
    aenderung: dict = {"aktiv": aktiv, "updatedAt": _jetzt()}
    if nummer != daten.get("anschluss"):
        if nummer:
            _pruefe_anschluss(db, shop_id, nummer)
        aenderung.update({"anschluss": nummer, "status": "wartet" if nummer else "aus", "wartetSeit": _jetzt() if nummer else None, "probeAm": None})
    db.collection(t.LAEDEN).document(shop_id).set(aenderung, merge=True)


def freigeben(db, shop_id: str, freigegeben: bool, freiminuten: int) -> None:
    """Der Betreiber lässt einen Laden zu"""
    if freiminuten < 0:
        raise Abgelehnt(400, "Die Minuten dürfen nicht negativ sein.")
    aenderung = {"shopId": shop_id, "freigegeben": freigegeben, "freiminuten": freiminuten, "updatedAt": _jetzt()}
    db.collection(t.LAEDEN).document(shop_id).set(aenderung, merge=True)


def eigene_nummer_zugeordnet(db, shop_id: str) -> None:
    """Der Betreiber hat dem Laden eine eigene Nummer gegeben: Damit ist er zugelassen und eingeschaltet"""
    db.collection(t.LAEDEN).document(shop_id).set({"shopId": shop_id, "freigegeben": True, "aktiv": True, "updatedAt": _jetzt()}, merge=True)


def probeanruf(db, shop_id: str) -> None:
    """Der erste Anruf von der eingetragenen Nummer: Wer dort umleiten kann, hat Zugriff auf den Anschluss"""
    db.collection(t.LAEDEN).document(shop_id).update({"status": "aktiv", "probeAm": _jetzt(), "wartetSeit": None})


def anruf_merken(db, call_sid: str, shop_id: str) -> None:
    db.collection(t.ANRUFE).document(call_sid).set({"shopId": shop_id, "createdAt": _jetzt()})


def anruf_ende(db, call_sid: str, sekunden: int) -> None:
    """Twilio meldet das Ende: Gesprächszeit beim Laden zählen. Unbekannte Anrufe (abgewiesen, Ansage) zählen nicht."""
    ref = db.collection(t.ANRUFE).document(call_sid)
    snap = ref.get()
    if not snap.exists:
        return
    shop_id = (snap.to_dict() or {}).get("shopId")
    ref.delete()
    if shop_id and sekunden > 0:
        db.collection(t.LAEDEN).document(shop_id).set({"sekunden": store.Increment(sekunden), "anrufe": store.Increment(1)}, merge=True)
