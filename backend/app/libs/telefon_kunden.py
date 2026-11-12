"""
Anrufer wiedererkennen (Telefon-Assistent): der Eintrag in der Kundenliste des Ladens zur Nummer, von der jemand anruft.

Bucht jemand am Telefon einen Termin oder zieht eine Nummer, steht er danach in der Kundenliste des Ladens (Sammlung
customers, wie "Kunde anlegen" unter "Mein Tag"): mit dem Namen aus dem Gespräch, der Nummer des Anrufers und
source = "telefon". Gibt es zu der Nummer schon einen Eintrag, auch einen, den der Laden selbst angelegt hat, gilt
dieser. Der Termin bekommt dessen ID als customerId, wie ein Termin für einen Bestandskunden am Tresen. So sieht der
Laden in der Kundenliste alle Termine dieser Person (termine_von, app/apis/team_laden).

Ruft dieselbe Nummer wieder an, kennt der Eingang (app/apis/telefon_eingang) den Anrufer: Die Begrüßung nennt seinen
Namen, und der Assistent bekommt Namen, letzten Besuch und kommende Termine gleich zum Gesprächsbeginn mit (bekannt).
Unterdrückte Nummern bleiben ohne Eintrag, wie bisher.

Löschen wie jeder Eintrag der Kundenliste (app/libs/privacy.py): ohne verbundenes Konto 24 Monate nach dem letzten
Termin, Name und Nummer an den Terminen nach 90 Tagen. Der Laden kann ihn jederzeit selbst löschen.
"""
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional, Tuple

from app.libs import telefon as t
from app.libs.schedule import BERLIN, aware

KUNDEN = "customers"
QUELLE = "telefon"
TITEL = {"herr", "frau", "hr.", "fr.", "dr.", "prof."}
KOMMEND = 3      # so viele kommende Termine bekommt der Assistent mit
HISTORIE = 100   # so viele Termine zeigt die Kundenliste je Person


def _zeit(wert) -> datetime:
    return aware(wert) if isinstance(wert, datetime) else datetime.min.replace(tzinfo=timezone.utc)


def zur_nummer(db, shop_id: str, anrufer) -> Tuple[Optional[str], dict]:
    """(ID, Eintrag) zur Nummer in diesem Laden, sonst (None, {}). Die Schreibweise ist egal: Der Laden tippt
    "0151 2345678", der Anruf kommt als "+491512345678". Gibt es mehrere, gilt der mit Konto, sonst der zuletzt geänderte."""
    gesucht = t.e164(anrufer)
    if not gesucht:
        return None, {}
    treffer = [(d.id, d.to_dict() or {}) for d in db.collection(KUNDEN).where("shopId", "==", shop_id).stream()]
    treffer = [(i, k) for i, k in treffer if t.e164(k.get("phone")) == gesucht]
    if not treffer:
        return None, {}
    return max(treffer, key=lambda e: (bool(e[1].get("userId")), _zeit(e[1].get("updatedAt") or e[1].get("createdAt"))))


def fuer_termin(db, shop_id: str, anrufer, name: str, quelle: str = QUELLE) -> Tuple[Optional[str], Optional[dict]]:
    """ID des Eintrags für einen Termin und, wenn es noch keinen gibt, der neue Eintrag. Den speichert anlegen()
    erst, wenn der Termin steht – geht der Platz weg, bleibt nichts zurück. Ohne lesbare Nummer (None, None).
    Am Telefon wird die ID zur customerId; bei Nummern und Terminen ohne Konto aus dem Browser zur kundeId
    (quelle "online", app/apis/nummer)."""
    nummer = t.e164(anrufer)
    if not nummer:
        return None, None
    kunde_id, _ = zur_nummer(db, shop_id, nummer)
    if kunde_id:
        return kunde_id, None
    ref = db.collection(KUNDEN).document()
    jetzt = datetime.now(timezone.utc)
    return ref.id, {"id": ref.id, "shopId": shop_id, "name": name, "email": "", "phone": nummer, "isActive": False,
                    "source": quelle, "createdAt": jetzt, "updatedAt": jetzt}


def anlegen(db, eintrag: Optional[dict]) -> None:
    if eintrag:
        db.collection(KUNDEN).document(eintrag["id"]).set(eintrag)


def name_berichtigt(db, termin: dict, alt: str, neu: str, minuten: int) -> None:
    """Name am Termin im selben Gespräch berichtigt: Hat der Assistent den Eintrag eben erst mit diesem Namen angelegt,
    dort auch. Ältere Einträge bleiben, wie sie sind – vielleicht bucht der Anrufer gerade für jemand anderen."""
    kunde_id = termin.get("customerId")
    if not kunde_id or not t.ID_RE.fullmatch(str(kunde_id)):
        return
    ref = db.collection(KUNDEN).document(kunde_id)
    snap = ref.get()
    kunde = (snap.to_dict() or {}) if snap.exists else None
    jetzt = datetime.now(timezone.utc)
    if (kunde and kunde.get("source") == QUELLE and kunde.get("name") == alt
            and jetzt - _zeit(kunde.get("createdAt")) <= timedelta(minutes=minuten)):
        ref.update({"name": neu, "updatedAt": jetzt})


def anrede(name: str) -> str:
    """Wie der Assistent jemanden anspricht: 'Stefan' aus 'Stefan Tittmann', 'Herr Krause' bleibt 'Herr Krause'"""
    teile = str(name or "").split()
    i = 0
    while i < len(teile) - 1 and teile[i].casefold() in TITEL:
        i += 1
    return " ".join(teile[: i + 1])


def termine_von(db, shop_id: str, kunde_id: str, kunde: dict) -> List[Tuple[str, dict]]:
    """Alle Termine dieser Person in diesem Laden, neueste zuerst: über den Eintrag (customerId), über das verbundene
    Konto und die zugeordneten ohne Konto (kundeId, app/libs/kartei.py). Ist ein Termin einem anderen Eintrag
    zugeordnet, gehört er dorthin."""
    termine = {}
    for feld, kid in [("customerId", kunde_id), *([("customerId", kunde["userId"])] if kunde.get("userId") else []), ("kundeId", kunde_id)]:
        for d in db.collection("appointments").where(feld, "==", kid).stream():
            a = d.to_dict() or {}
            if a.get("shopId") != shop_id or (a.get("kundeId") and a["kundeId"] != kunde_id):
                continue
            termine[d.id] = a
    return sorted(termine.items(), key=lambda e: _zeit(e[1].get("startTime")), reverse=True)


def _namen(db, sammlung: str, shop_id: str) -> dict:
    """ID → Name, auch ausgeblendete Leistungen und frühere Personen (für alte Termine)"""
    return {d.id: str((d.to_dict() or {}).get("name") or "").strip() for d in db.collection(sammlung).where("shopId", "==", shop_id).stream()}


def historie(db, shop_id: str, kunde_id: str, kunde: dict) -> List[dict]:
    """Termine für die Kundenliste: Zeit, Leistung, Person, Status, ob am Telefon gebucht"""
    leistungen, personen = _namen(db, "services", shop_id), _namen(db, "staff", shop_id)
    return [{"id": tid, "startTime": a.get("startTime"), "endTime": a.get("endTime"), "status": a.get("status"),
             "type": a.get("type"), "source": a.get("source"), "referenceCode": a.get("referenceCode"),
             "customerName": a.get("customerName"), "leistung": leistungen.get(a.get("serviceId"), ""),
             "person": personen.get(a.get("staffId"), "")}
            for tid, a in termine_von(db, shop_id, kunde_id, kunde)[:HISTORIE]]


def _ortszeit(wert) -> Optional[datetime]:
    return aware(wert).astimezone(BERLIN).replace(tzinfo=None) if isinstance(wert, datetime) else None


def vorbei_text(day: date, heute: date) -> str:
    """'heute', 'gestern', 'am 3. November', aus einem anderen Jahr 'am 3. November 2025'"""
    delta = (heute - day).days
    if delta == 0:
        return "heute"
    if delta == 1:
        return "gestern"
    jahr = f" {day.year}" if day.year != heute.year else ""
    return f"am {day.day}. {t.MONATE[day.month - 1]}{jahr}"


def bekannt(db, shop_id: str, anrufer, jetzt: Optional[datetime] = None) -> Optional[dict]:
    """Was der Assistent über einen bekannten Anrufer wissen muss, sonst None. jetzt: Ortszeit ohne Zeitzone."""
    kunde_id, kunde = zur_nummer(db, shop_id, anrufer)
    name = " ".join(str(kunde.get("name") or "").split())
    if not kunde_id or not name:
        return None
    jetzt = jetzt or datetime.now(BERLIN).replace(tzinfo=None)
    leistungen, personen = _namen(db, "services", shop_id), _namen(db, "staff", shop_id)
    vorbei, kommend = [], []
    for _, a in termine_von(db, shop_id, kunde_id, kunde):
        start = _ortszeit(a.get("startTime"))
        if start is None or a.get("status") == "cancelled":
            continue
        if start < jetzt:
            vorbei.append((start, a))
        elif a.get("status") == "scheduled":
            kommend.append((start, a))
    info = {"name": name, "anrede": anrede(name), "besuche": len(vorbei)}

    def was(a: dict) -> dict:
        person = personen.get(a.get("staffId"), "")
        return {"leistung": leistungen.get(a.get("serviceId"), ""), "person": person.split()[0] if person else ""}

    if vorbei:
        start, a = vorbei[0]
        info["zuletzt"] = {"wann": vorbei_text(start.date(), jetzt.date()), **was(a)}
    if kommend:
        info["kommend"] = [{"zeit": t.zeit_text(s, jetzt), **was(a), **({"nummer": a["referenceCode"]} if a.get("referenceCode") else {})}
                           for s, a in sorted(kommend, key=lambda e: e[0])[:KOMMEND]]
    return info
