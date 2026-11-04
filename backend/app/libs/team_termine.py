"""
Termine des Teams anlegen und ändern: Tresen, Kalender, Mein Tag (requirements/eigene-datenbank.md, Stufe 2).

Gegenstück zu createAppointment und updateAppointment in frontend/src/utils/firestore/appointments.ts. Die
Transaktionen liefen bis zum 04.11.2026 im Browser. Seitdem prüft der Browser nur noch die Regeln (Öffnungs- und
Arbeitszeiten, Pausen; utils/booking-rules.ts) und schickt den Termin hierher (app/apis/team_termine). Hier passiert,
was zuvor die Transaktion im Browser tat:

- **Anlegen:** Den Platz belegen, die Tagesnummer ziehen, den Termin samt öffentlicher Kurzfassung speichern
  (app/libs/buchung.create_appointment). Ist der Platz inzwischen weg, kommt PlatzWeg.
- **Ändern:**
  - Beim Aufrufen, bei „Fertig“ und „Zurück auf wartet“ die passenden Zeitpunkte setzen.
  - Bei Absage oder Verschieben durch den Laden die Nachricht an den Kunden vormerken (customerNotice; schickt der
    Benachrichtigungsdienst).
  - Den alten Platz freigeben und den neuen belegen. Bei neuer Zeit, anderer Person oder Wiederaufnahme wird geprüft.
  - Die Kurzfassung mitschreiben.

Danach: freie Zeiten neu rechnen, „Früher dran“ anstoßen, wo ein Platz frei wird, und die Live-Kanäle melden
(app/libs/live.py).

Felder, die nur das Backend setzt (SERVER_FELDER), fallen aus der Anfrage heraus. Wer was darf (Inhaber oder Team des
Ladens), prüft der Endpunkt.
"""

from __future__ import annotations

from datetime import datetime, time, timezone

from app import store
from app.i18n import merke
from app.libs import live
from app.libs.buchung import PlatzWeg, create_appointment, run_transaction
from app.libs.public_appointments import write_public
from app.libs.schedule import BERLIN, Placement, aware, day_key, placement_of, read_placement

STATUS = {"scheduled", "in-progress", "completed", "cancelled"}
ARTEN = {"queue", "booked"}
# Setzt nur das Backend: Zeitpunkte, Nummer, Merker für Benachrichtigungen, Schlüssel, Löschfristen
SERVER_FELDER = frozenset({
    "id", "createdAt", "updatedAt", "referenceCode",
    "calledAt", "lastCalledAt", "completedAt", "cancelledAt",
    "notifiedSoonAt", "notifiedCalledAt", "reminderSentAt",
    "customerNotice", "customerNoticePreviousStart", "customerNoticeSentAt", "customerNoticeAt",
    "teamNotice", "teamNoticeAt", "teamNewAt", "teamCancelledAt", "teamNoticeSentAt",
    "ticketKeyHash", "anonymizedAt", "notifyEmail", "checkEarlierOptionsCreatedAt",
})


class TerminFehler(Exception):
    """Anfrage geht so nicht: status (400, 404) und ein mit merke() markierter Text (app/apis/team_termine)"""

    def __init__(self, status: int, text):
        super().__init__(text)
        self.status = status
        self.text = text


def bereinigt(daten: dict) -> dict:
    return {k: v for k, v in daten.items() if k not in SERVER_FELDER}


def _zeit(wert) -> datetime | None:
    return aware(wert) if isinstance(wert, datetime) else None


def anwenden(stand: dict, update: dict) -> dict:
    """Termin nach einem Schreibschritt mit merge: Felder überschrieben, DELETE_FIELD entfernt (wie applyUpdate)"""
    nachher = dict(stand)
    for k, v in update.items():
        if v is store.DELETE_FIELD:
            nachher.pop(k, None)
        else:
            nachher[k] = v
    return nachher


def person_im_laden(db, shop_id: str, staff_id) -> bool:
    if not staff_id or not isinstance(staff_id, str):
        return False
    snap = db.collection("staff").document(staff_id).get()
    return bool(snap.exists and (snap.to_dict() or {}).get("shopId") == shop_id)


def kunden_nachricht(vorher: dict, nachher: dict, jetzt: datetime) -> dict | None:
    """Nachricht an den Kunden, wenn der Laden absagt oder die Zeit ändert (customerNoticeFor). Vergangene Tage nicht."""
    start = _zeit(vorher.get("startTime"))
    heute = datetime.combine(jetzt.astimezone(BERLIN).date(), time(), tzinfo=BERLIN)
    if not start or start < heute or vorher.get("status") in ("cancelled", "completed"):
        return None
    if nachher.get("status") == "cancelled":
        return {"customerNotice": "cancelled"}
    if _zeit(nachher.get("startTime")) != start:
        # Merker von vorher behalten: zweimal verschieben ist eine Nachricht mit der neuesten Zeit
        return {"customerNotice": "moved", "customerNoticePreviousStart": vorher.get("customerNoticePreviousStart") or vorher.get("startTime")}
    return None


def frei_oder_gesucht(vorher: dict, nachher: dict) -> bool:
    """Wird ein Platz frei (oder will jemand früher dran)? Wie freesOrWantsSlot (utils/earlierSlots.ts)"""
    return (
        (nachher.get("status") == "cancelled" and vorher.get("status") != "cancelled")
        or _zeit(vorher.get("startTime")) != _zeit(nachher.get("startTime"))
        or _zeit(vorher.get("endTime")) != _zeit(nachher.get("endTime"))
        or (vorher.get("staffId") or None) != (nachher.get("staffId") or None)
        or (bool(nachher.get("checkEarlierOptions")) and not vorher.get("checkEarlierOptions"))
    )


def _pruefen(db, shop_id: str, daten: dict) -> None:
    if "status" in daten and daten["status"] not in STATUS:
        raise TerminFehler(400, merke("Diesen Status gibt es nicht."))
    if "type" in daten and daten["type"] not in ARTEN:
        raise TerminFehler(400, merke("Diese Art von Termin gibt es nicht."))
    for feld in ("startTime", "endTime"):
        if feld in daten and not isinstance(daten[feld], datetime):
            raise TerminFehler(400, merke("Ungültige Zeitangabe für den Termin."))
    if "staffId" in daten and not person_im_laden(db, shop_id, daten["staffId"]):
        raise TerminFehler(400, merke("Diese Person gehört nicht zu diesem Laden."))


def _nach_dem_schreiben(termin_id: str, vorher: dict | None, nachher: dict, frei: bool, benachrichtigen: bool) -> None:
    """Freie Zeiten neu rechnen, „Früher dran“ anstoßen, Benachrichtigungen wecken, Live-Kanäle melden. Wirft nie."""
    try:
        from app.apis.cache import invalidate_shop_date_cache

        tage = {(s.get("shopId"), day_key(_zeit(s.get("startTime")))) for s in (vorher, nachher) if s and _zeit(s.get("startTime"))}
        for shop_id, tag in tage:
            invalidate_shop_date_cache(shop_id, tag, verbose=False)
    except Exception as e:
        print(f"Zwischenspeicher nach Termin {termin_id} nicht geleert: {e}")
    if frei:
        try:
            from app.apis.check_slots import trigger_check_in_background

            for staff_id in dict.fromkeys(s.get("staffId") for s in (vorher, nachher) if s and s.get("staffId")):
                trigger_check_in_background(nachher.get("shopId"), staff_id)
        except Exception as e:
            print(f"Früher-dran-Prüfung nach Termin {termin_id} nicht angestoßen: {e}")
    if benachrichtigen:
        try:
            from app.libs.notify_worker import wake

            wake()
        except Exception as e:
            print(f"Benachrichtigungsdienst nicht geweckt: {e}")
    try:
        live.termin_geaendert(termin_id, vorher, nachher)
    except Exception as e:
        print(f"Live-Kanäle nach Termin {termin_id} nicht gemeldet: {e}")


def termin_anlegen(db, uid: str | None, daten: dict) -> dict:
    """Neuer Termin vom Team. daten wie im Browser (shopId, staffId, startTime, endTime, Kunde, Leistung, Preis …)."""
    daten = bereinigt(daten)
    shop_id = daten.get("shopId")
    if not isinstance(shop_id, str) or not shop_id:
        raise TerminFehler(400, merke("Diesen Laden gibt es nicht."))
    if not daten.get("staffId"):
        raise TerminFehler(400, merke("Diese Person gehört nicht zu diesem Laden."))
    _pruefen(db, shop_id, daten)
    start, ende = _zeit(daten.get("startTime")), _zeit(daten.get("endTime"))
    if not start or not ende or ende <= start:
        raise TerminFehler(400, merke("Ungültige Zeitangabe für den Termin."))
    status = daten.get("status") or "scheduled"
    if status == "cancelled":
        raise TerminFehler(400, merke("Diesen Status gibt es nicht."))
    art = daten.get("type") or "booked"

    # Name und Handynummer aus dem eigenen Profil, wenn jemand für sich selbst bucht (wie im Browser)
    kunde = daten.get("customerId")
    if uid and kunde and kunde != "walk-in" and kunde == uid:
        profil = db.collection("users").document(uid).get()
        p = (profil.to_dict() or {}) if profil.exists else {}
        daten["customerName"] = p.get("displayName") or p.get("email") or daten.get("customerName") or "Unbekannter Kunde"
        if p.get("phoneNumber") and not daten.get("customerPhone"):
            daten["customerPhone"] = p["phoneNumber"]

    data = {k: v for k, v in daten.items() if k not in ("staffId", "startTime", "endTime")}
    data.update(status=status, type=art, customerName=daten.get("customerName") or "Unbekannter Kunde")
    needs_code = bool(daten.get("isAnonymous") or art == "queue")
    created = create_appointment(db, data, [Placement(daten["staffId"], start, ende)], needs_code)
    _nach_dem_schreiben(created["id"], None, created, frei=bool(created.get("checkEarlierOptions")), benachrichtigen=False)
    return created


def termin_aendern(db, termin_id: str, aenderung: dict, kunde_benachrichtigen: bool = False, jetzt: datetime | None = None) -> dict:
    """Termin ändern wie updateAppointment im Browser. Gibt den Termin danach zurück (mit id)."""
    ref = db.collection("appointments").document(termin_id)
    snap = ref.get()
    if not snap.exists:
        raise TerminFehler(404, merke("Diesen Termin gibt es nicht mehr."))
    vorher = snap.to_dict() or {}
    aenderung = bereinigt(aenderung)
    aenderung.pop("shopId", None)  # ein Termin wechselt nie den Laden
    shop_id = vorher.get("shopId", "")
    if "staffId" in aenderung and aenderung["staffId"] == vorher.get("staffId"):
        pruefen = {k: v for k, v in aenderung.items() if k != "staffId"}
    else:
        pruefen = aenderung
    _pruefen(db, shop_id, pruefen)

    zusammen = {**vorher, **aenderung}
    start, ende = _zeit(zusammen.get("startTime")), _zeit(zusammen.get("endTime"))
    if ("startTime" in aenderung or "endTime" in aenderung) and (not start or not ende or ende <= start):
        raise TerminFehler(400, merke("Ungültige Zeitangabe für den Termin."))
    zeit_oder_person = (_zeit(vorher.get("startTime")), _zeit(vorher.get("endTime")), vorher.get("staffId")) != (start, ende, zusammen.get("staffId"))
    wieder = vorher.get("status") == "cancelled" and zusammen.get("status") != "cancelled"
    absage = vorher.get("status") != "cancelled" and zusammen.get("status") == "cancelled"

    jetzt = jetzt or datetime.now(timezone.utc)
    update = {**aenderung, "updatedAt": jetzt}
    status = aenderung.get("status")
    # Zeitpunkte für die Auswertung (Wartezeit = Nummer ziehen bis Aufruf), nur beim ersten Wechsel
    aufgerufen = status == "in-progress" and vorher.get("status") != "in-progress"
    if aufgerufen and not vorher.get("calledAt"):
        update["calledAt"] = jetzt
    # Letzter Aufruf: ab hier rechnet die Schlange, wie lange er noch dran ist (queue-lane.ts, queue_notify.py)
    if aufgerufen:
        update["lastCalledAt"] = jetzt
    if status == "completed" and vorher.get("status") != "completed":
        update["completedAt"] = jetzt
        if not vorher.get("calledAt") and "calledAt" not in update:
            update["calledAt"] = jetzt
    # Zurück auf „wartet“: beim nächsten Aufruf kommt „Du bist dran“ noch einmal
    if status == "scheduled" and vorher.get("status") == "in-progress":
        update["notifiedCalledAt"] = store.DELETE_FIELD
    nachricht = kunden_nachricht(vorher, zusammen, jetzt) if kunde_benachrichtigen else None
    if nachricht:
        update.update(nachricht, customerNoticeAt=jetzt)

    # Belegung: alten Platz frei, neuen belegen. Geprüft wird nur, was wie eine Buchung ist; Aufrufen und Fertig
    # passieren im Laden (wer früher fertig ist, gibt den Rest frei)
    buchung_aendert = (zeit_oder_person or wieder) and zusammen.get("status") != "cancelled"
    belegung_aendert = absage or placement_of(vorher) != placement_of(anwenden(vorher, update))

    @store.transactional
    def run(tx):
        aktuell_snap = ref.get(transaction=tx)
        if not aktuell_snap.exists:
            raise TerminFehler(404, merke("Diesen Termin gibt es nicht mehr."))
        aktuell = aktuell_snap.to_dict() or {}
        nachher = anwenden(aktuell, update)
        change = None
        if buchung_aendert or belegung_aendert:
            neu = placement_of(nachher)
            change = read_placement(tx, db, termin_id, aktuell.get("shopId", ""), occupy=neu, release=placement_of(aktuell))
            if buchung_aendert and neu and change.conflict:
                raise PlatzWeg(change.conflict, change.conflict_window)
        tx.set(ref, update, merge=True)
        write_public(tx, db, termin_id, nachher)
        if change:
            change.write()
        return aktuell, nachher

    aktuell, nachher = run_transaction(db, run)

    # „Früher dran“: frei gewordenen Platz gleich neu verteilen; auch wer früher aufgerufen wird oder früher fertig ist
    frueher_fertig = (aufgerufen and jetzt < (_zeit(vorher.get("startTime")) or jetzt)) or (
        status == "completed" and vorher.get("status") != "completed" and jetzt < (_zeit(vorher.get("endTime")) or jetzt)
    )
    _nach_dem_schreiben(termin_id, aktuell, nachher, frei=frei_oder_gesucht(vorher, zusammen) or frueher_fertig,
                        benachrichtigen=bool(nachricht))
    return {**nachher, "id": termin_id}
