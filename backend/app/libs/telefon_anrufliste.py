"""Anrufliste des Telefon-Assistenten: wer wann angerufen hat und was daraus wurde. Der Inhaber sieht sie unter
/telefon-assistent, damit er zurückrufen kann, wo der Assistent nicht weiterhelfen konnte.

telefon_anrufliste/{CallSid}: nur das Backend liest und schreibt das.
    shopId, beginn, ende, sekunden
    anrufer     Nummer des Anrufers (+49…), None bei unterdrückter Nummer
    ergebnis    ASSISTENT: die KI hat abgenommen
                ANSAGE: nur die kurze Ansage, warum steht in grund (app/libs/telefon.py, grund)
                BELEGT: alle Leitungen bei Vapi waren belegt, auch nach dem zweiten Versuch
                STOERUNG: Vapi hat nicht geantwortet
    grund       nur bei ANSAGE
    termine     Termine und Nummern, die der Assistent in diesem Gespräch angelegt hat (IDs aus appointments)

Gelöscht wird ein Eintrag nach 90 Tagen (wie Name und Nummer an Terminen, app/libs/privacy.py) oder wenn der Laden
den Kunden mit dieser Nummer aus seiner Kundenliste löscht.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.libs import telefon as t
from app.libs import telefon_kunden as tk

SAMMLUNG = "telefon_anrufliste"
TAGE = 90
ZEIGEN = 100  # so viele Anrufe zeigt die Liste, die neuesten zuerst
ASSISTENT, ANSAGE, BELEGT, STOERUNG = "assistent", "ansage", "belegt", "stoerung"


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def merken(db, call_sid: Optional[str], shop_id: str, anrufer: Optional[str], ergebnis: str,
           grund: Optional[str] = None, jetzt: Optional[datetime] = None) -> None:
    """Anruf eintragen oder sein Ergebnis ändern (zweiter Versuch, wenn beim ersten alles belegt war)"""
    if not call_sid:
        return
    ref = db.collection(SAMMLUNG).document(call_sid)
    if ref.get().exists:
        ref.update({"ergebnis": ergebnis, "grund": grund})
        return
    ref.set({"shopId": shop_id, "beginn": jetzt or _jetzt(), "ende": None, "sekunden": 0, "anrufer": anrufer,
             "ergebnis": ergebnis, "grund": grund, "termine": []})


def termin_dazu(db, shop_id: str, anrufer: Optional[str], termin_id: str) -> Optional[str]:
    """Der Assistent hat gebucht: Termin beim laufenden Anruf eintragen. Laufende Anrufe eines Ladens stehen in
    telefon_anrufe, meist ist es einer; laufen mehrere, entscheidet die Nummer des Anrufers. Gibt den Anruf zurück."""
    passend = []
    for laufend in db.collection(t.ANRUFE).where("shopId", "==", shop_id).stream():
        snap = db.collection(SAMMLUNG).document(laufend.id).get()
        if snap.exists:
            passend.append((laufend.id, snap.to_dict() or {}))
    if len(passend) > 1:
        passend = [(sid, e) for sid, e in passend if e.get("anrufer") == anrufer]
    if len(passend) != 1:
        return None
    sid, eintrag = passend[0]
    termine = list(eintrag.get("termine") or [])
    if termin_id not in termine:
        db.collection(SAMMLUNG).document(sid).update({"termine": [*termine, termin_id]})
    return sid


def ende(db, call_sid: str, sekunden: int, jetzt: Optional[datetime] = None) -> None:
    """Twilio meldet das Ende des Anrufs"""
    ref = db.collection(SAMMLUNG).document(call_sid)
    if ref.get().exists:
        ref.update({"ende": jetzt or _jetzt(), "sekunden": max(0, int(sekunden or 0))})


def _namen_zur_nummer(db, shop_id: str) -> dict:
    """Nummer → Name aus der Kundenliste des Ladens"""
    namen = {}
    for snap in db.collection(tk.KUNDEN).where("shopId", "==", shop_id).stream():
        kunde = snap.to_dict() or {}
        nummer = t.e164(kunde.get("phone"))
        if nummer and str(kunde.get("name") or "").strip():
            namen.setdefault(nummer, str(kunde["name"]).strip())
    return namen


def _termin(db, termin_id: str, shop_id: str, leistungen: dict, personen: dict) -> Optional[dict]:
    snap = db.collection("appointments").document(termin_id).get()
    termin = (snap.to_dict() or {}) if snap.exists else None
    if not termin or termin.get("shopId") != shop_id:
        return None
    return {
        "id": termin_id,
        "startTime": termin.get("startTime"),
        "status": termin.get("status"),
        "type": termin.get("type"),
        "nummer": termin.get("referenceCode"),
        "name": termin.get("customerName"),
        "leistung": leistungen.get(termin.get("serviceId"), ""),
        "person": personen.get(termin.get("staffId"), ""),
    }


def liste(db, shop_id: str, jetzt: Optional[datetime] = None, anzahl: int = ZEIGEN) -> list:
    """Die letzten Anrufe des Ladens, die neuesten zuerst, mit dem Namen aus der Kundenliste und den Terminen"""
    seit = (jetzt or _jetzt()) - timedelta(days=TAGE)
    eintraege = [(s.id, s.to_dict() or {}) for s in db.collection(SAMMLUNG).where("shopId", "==", shop_id).stream()]
    eintraege = [(sid, e) for sid, e in eintraege if isinstance(e.get("beginn"), datetime) and e["beginn"] >= seit]
    eintraege.sort(key=lambda x: x[1]["beginn"], reverse=True)
    eintraege = eintraege[:anzahl]
    if not eintraege:
        return []
    namen = _namen_zur_nummer(db, shop_id)
    leistungen, personen = tk._namen(db, "services", shop_id), tk._namen(db, "staff", shop_id)
    ergebnis = []
    for sid, e in eintraege:
        termine = [x for x in (_termin(db, tid, shop_id, leistungen, personen) for tid in e.get("termine") or []) if x]
        name = next((x["name"] for x in termine if x.get("name")), None) or namen.get(e.get("anrufer") or "")
        ergebnis.append({
            "id": sid,
            "beginn": e["beginn"],
            "sekunden": int(e.get("sekunden") or 0),
            "laeuft": e.get("ende") is None and e.get("ergebnis") == ASSISTENT,
            "anrufer": e.get("anrufer"),
            "name": name or None,
            "ergebnis": e.get("ergebnis"),
            "grund": e.get("grund"),
            "termine": termine,
        })
    return ergebnis


def vergessen(db, shop_id: str, nummer: Optional[str]) -> int:
    """Der Laden löscht einen Kunden: seine Anrufe verschwinden mit. Gibt die Zahl zurück."""
    nummer = t.e164(nummer)
    if not nummer:
        return 0
    weg = 0
    for snap in db.collection(SAMMLUNG).where("shopId", "==", shop_id).stream():
        if (snap.to_dict() or {}).get("anrufer") == nummer:
            snap.reference.delete()
            weg += 1
    return weg


def aufraeumen(db, jetzt: Optional[datetime] = None, stapel: int = 500) -> int:
    """Einmal am Tag (app/apis/schedulers): Anrufe, die älter als 90 Tage sind, löschen. Gibt die Zahl zurück."""
    grenze = (jetzt or _jetzt()) - timedelta(days=TAGE)
    weg = 0
    while True:
        alte = list(db.collection(SAMMLUNG).where("beginn", "<", grenze).limit(stapel).stream())
        for snap in alte:
            snap.reference.delete()
        weg += len(alte)
        if len(alte) < stapel:
            return weg
