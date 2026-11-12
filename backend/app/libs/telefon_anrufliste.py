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
    zusammenfassung  ein, zwei Sätze der KI nach dem Gespräch: was der Anrufer wollte, was daraus wurde
    ausgang     wie die KI das Gespräch einordnet (AUSGAENGE): termin, nummer, frage, offen, aufgelegt
    berichtHash SHA-256 des Schlüssels, mit dem Vapi den Bericht nach dem Gespräch abliefert; danach gelöscht

Zusammenfassung und Ausgang: Der Eingang (app/apis/telefon_eingang) gibt Vapi je Anruf eine Adresse mit, an die Vapi
nach dem Gespräch seinen Bericht schickt ("end-of-call-report"), dazu einen Schlüssel nur für diesen Anruf und den
Auftrag, das Gespräch auszuwerten (bericht_auftrag). Eine Tonaufnahme gibt es nicht, Kosten aus dem Bericht bleiben
draußen.

Gelöscht wird ein Eintrag nach 90 Tagen (wie Name und Nummer an Terminen, app/libs/privacy.py), wenn der Laden den
Kunden mit dieser Nummer aus seiner Kundenliste löscht, oder mit dem Laden (app/libs/konten.py, SHOP_COLLECTIONS).
"""
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from app.libs import telefon as t
from app.libs import telefon_kunden as tk

SAMMLUNG = "telefon_anrufliste"
TAGE = 90
ZEIGEN = 100  # so viele Anrufe zeigt die Liste, die neuesten zuerst
ASSISTENT, ANSAGE, BELEGT, STOERUNG = "assistent", "ansage", "belegt", "stoerung"

# Nach dem Gespräch (Bericht von Vapi)
AUSGAENGE = ("termin", "nummer", "frage", "offen", "aufgelegt")
BERICHT_KOPF = "X-Dranzeit-Bericht"   # Kopfzeile mit dem Schlüssel des Anrufs
BERICHT_NAME = "dranzeit_anruf"       # Name der Auswertung bei Vapi (höchstens 40 Zeichen)
ZUSAMMENFASSUNG_MAX = 500
_LEER = re.compile(r"\s+")


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def merken(db, call_sid: Optional[str], shop_id: str, anrufer: Optional[str], ergebnis: str,
           grund: Optional[str] = None, jetzt: Optional[datetime] = None, bericht_hash: Optional[str] = None) -> None:
    """Anruf eintragen oder sein Ergebnis ändern (zweiter Versuch, wenn beim ersten alles belegt war).
    bericht_hash: Vapi hat den Anruf angenommen und liefert danach einen Bericht (bericht_schluessel)."""
    if not call_sid:
        return
    ref = db.collection(SAMMLUNG).document(call_sid)
    if ref.get().exists:
        ref.update({"ergebnis": ergebnis, "grund": grund, **({"berichtHash": bericht_hash} if bericht_hash else {})})
        return
    ref.set({"shopId": shop_id, "beginn": jetzt or _jetzt(), "ende": None, "sekunden": 0, "anrufer": anrufer,
             "ergebnis": ergebnis, "grund": grund, "termine": [], "berichtHash": bericht_hash})


# --- Bericht nach dem Gespräch -------------------------------------------------------------------------------------------


def _hash(schluessel: str) -> str:
    return hashlib.sha256(schluessel.encode()).hexdigest()


def bericht_schluessel() -> Tuple[str, str]:
    """(Schlüssel für Vapi, Hash für die Anrufliste): gilt nur für diesen einen Anruf und nur einmal"""
    schluessel = secrets.token_urlsafe(32)
    return schluessel, _hash(schluessel)


def bericht_auftrag(url: str, schluessel: str) -> dict:
    """Was der Eingang Vapi je Anruf zusätzlich mitgibt (assistantOverrides): wohin der Bericht geht, nur dieser
    Bericht, und was die KI danach auswertet. Die Aufnahme bleibt ausdrücklich aus. Felder laut Vapi-Schnittstelle
    (CreateCallDTO → AssistantOverrides: server, serverMessages, artifactPlan.structuredOutputs)."""
    return {
        "server": {"url": url, "headers": {BERICHT_KOPF: schluessel}, "timeoutSeconds": 20},
        "serverMessages": ["end-of-call-report"],
        "artifactPlan": {
            "recordingEnabled": False,
            "structuredOutputs": [{
                "name": BERICHT_NAME,
                "description": "Auswertung eines Anrufs beim KI-Telefon-Assistenten eines Ladens (Friseur, Barbershop) für die "
                               "Anrufliste des Inhabers. Er liest sie, um zu entscheiden, ob er zurückruft.",
                "schema": {
                    "type": "object",
                    "properties": {
                        "zusammenfassung": {
                            "type": "string",
                            "description": "Ein, höchstens zwei kurze Sätze auf Deutsch für den Inhaber: was der Anrufer wollte "
                                           "und was daraus wurde. Mit dem Namen des Anrufers, falls er ihn gesagt hat, bei einem "
                                           "Termin mit Tag, Uhrzeit und Leistung. Keine Telefonnummern, nichts über Technik, "
                                           "nichts, was im Gespräch nicht vorkam.",
                        },
                        "ergebnis": {
                            "type": "string",
                            "enum": list(AUSGAENGE),
                            "description": "termin: ein Termin wurde gebucht. nummer: eine Nummer für die Schlange wurde gezogen. "
                                           "frage: der Anrufer hat eine Auskunft bekommen (Öffnungszeiten, Preise, Wartezeit, "
                                           "Adresse) und brauchte nichts weiter. offen: der Anrufer wollte etwas, bei dem der "
                                           "Assistent nicht helfen konnte (einen Menschen sprechen, Termin absagen oder "
                                           "verschieben, Beschwerde, Frage ohne Antwort), der Laden sollte zurückrufen. "
                                           "aufgelegt: der Anrufer hat aufgelegt oder nichts gesagt, bevor sein Anliegen klar war.",
                        },
                    },
                    "required": ["zusammenfassung", "ergebnis"],
                },
            }],
        },
    }


def _kurz(text) -> Optional[str]:
    text = _LEER.sub(" ", str(text or "")).strip()
    if len(text) > ZUSAMMENFASSUNG_MAX:
        text = text[:ZUSAMMENFASSUNG_MAX].rsplit(" ", 1)[0].rstrip(",;:") + " …"
    return text or None


def auswerten(nachricht: dict) -> Tuple[Optional[str], Optional[str]]:
    """(zusammenfassung, ausgang) aus dem end-of-call-report von Vapi. Die Auswertung steht in
    artifact.structuredOutputs ({id: {name, result}}); fehlt sie, bleibt die Zusammenfassung von Vapi (analysis.summary).
    Hat der Anrufer gar nichts gesagt, hat er aufgelegt."""
    artefakt = nachricht.get("artifact") or (nachricht.get("call") or {}).get("artifact") or {}
    ergebnis = {}
    ausgaben = artefakt.get("structuredOutputs")
    for schluessel, wert in (ausgaben.items() if isinstance(ausgaben, dict) else ()):
        if isinstance(wert, dict) and BERICHT_NAME in (wert.get("name"), schluessel) and isinstance(wert.get("result"), dict):
            ergebnis = wert["result"]
            break
    zusammenfassung = _kurz(ergebnis.get("zusammenfassung")) or _kurz((nachricht.get("analysis") or {}).get("summary"))
    ausgang = ergebnis.get("ergebnis") if ergebnis.get("ergebnis") in AUSGAENGE else None
    nachrichten = artefakt.get("messages")
    if isinstance(nachrichten, list) and not any(isinstance(m, dict) and m.get("role") == "user" for m in nachrichten):
        ausgang = "aufgelegt"
    return zusammenfassung, ausgang


def bericht(db, call_sid: str, schluessel: Optional[str], nachricht: dict) -> str:
    """Bericht von Vapi zum Anruf call_sid eintragen. Gibt zurück: ok, ignoriert (keine Abschlussmeldung),
    unbekannt (kein solcher Anruf), kein_zugang (falscher oder schon benutzter Schlüssel)."""
    ref = db.collection(SAMMLUNG).document(call_sid)
    snap = ref.get()
    if not snap.exists:
        return "unbekannt"
    erwartet = (snap.to_dict() or {}).get("berichtHash")
    if not erwartet or not schluessel or not hmac.compare_digest(_hash(schluessel), str(erwartet)):
        return "kein_zugang"
    if nachricht.get("type") != "end-of-call-report":
        return "ignoriert"
    zusammenfassung, ausgang = auswerten(nachricht)
    ref.update({"zusammenfassung": zusammenfassung, "ausgang": ausgang, "berichtHash": None})
    return "ok"


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
            "zusammenfassung": e.get("zusammenfassung"),
            "ausgang": e.get("ausgang"),
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
