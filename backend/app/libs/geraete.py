"""Tablet am Tresen per QR-Code koppeln, statt dort das Passwort des Inhabers einzutippen.

Ablauf (Schnittstelle: app/apis/geraete, Seiten: frontend/src/pages/Koppeln.tsx und KoppelnBestaetigen.tsx):

1. Das Tablet ohne Anmeldung öffnet /koppeln. starten() legt eine Kopplung an und gibt zwei Geheimnisse zurück:
   `code` kommt in den QR-Code, `abholen` behält nur das Tablet. Dazu eine vierstellige Prüfzahl.
2. Der Inhaber scannt den QR-Code mit seinem angemeldeten Handy, vergleicht die Prüfzahl mit dem Tablet und
   bestätigt (bestaetigen). Wer den QR-Code nur abfotografiert, kommt damit an nichts: Abholen geht nur mit `abholen`.
3. Das Tablet fragt alle zwei Sekunden nach (abholen). Nach der Bestätigung bekommt es eine Sitzung mit bereich
   „tresen“ für das Konto des Inhabers – genau einmal.

Eine Tresen-Sitzung darf nur, was der Tresen braucht (erlaubt(), Freigabeliste unten; durchgesetzt in
databutton_app/mw/auth_mw.py und für die Anmeldung selbst in app/apis/anmeldung). Tarif, Rechnungen, Team,
Leistungen, Einstellungen, API-Schlüssel, Passwort, Konto löschen und das Koppeln weiterer Geräte gehen dort nicht.
Neue Endpunkte für den Tresen müssen hier eingetragen werden, sonst antworten sie dem Tablet mit 403.

Der Inhaber sieht seine Tablets unter „Laden“ und kann jedes abmelden (liste, abmelden). Ändert er sein Passwort,
sind wie alle Geräte auch die Tablets abgemeldet (app/libs/anmeldung.passwort_aendern).
"""

import re
import secrets
from dataclasses import dataclass
from datetime import timedelta

from app.libs import anmeldung
from app.libs.anmeldung import _engine, _sql, _zu_viele, hash_von, jetzt

BEREICH = "tresen"
KOPPLUNG_DAUER = timedelta(minutes=10)
# Bestätigt kurz vor Ablauf: so lange darf das Tablet danach noch abholen
NACH_BESTAETIGUNG = timedelta(minutes=2)
# Kopplungen starten je IP (Tablets erneuern ihren Code alle 10 Minuten von selbst)
STARTEN_IP = (30, 3600)
# Erledigte und abgelaufene Kopplungen bleiben so lange stehen (zum Nachvollziehen), dann weg
AUFHEBEN = timedelta(days=1)
MAX_NAME = 40


class KoppelFehler(Exception):
    """code: ungueltig (404), zu-viele (429), kein-laden (403), laden-waehlen (400), unbekannt (404)"""

    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


# --- Freigabeliste für Tresen-Sitzungen -------------------------------------------------------------------------------

_ID = r"[^/]+"
_TRESEN: list[tuple[set[str], re.Pattern]] = [
    (methoden, re.compile(muster))
    for methoden, muster in [
        # Wer bin ich, abmelden
        ({"GET"}, r"/routes/anmeldung/ich"),
        ({"POST"}, r"/routes/anmeldung/abmelden"),
        # Live-Daten (Tresen, Schlange, Bildschirm, Ereignisse) und was öffentlich ohnehin geht
        ({"GET"}, r"/routes/live(/.*)?"),
        ({"GET"}, r"/routes/laden-live"),
        ({"GET"}, r"/routes/telefon-hinweis"),
        ({"GET"}, r"/routes/push/config"),
        ({"GET"}, r"/routes/billing-public/.*"),
        ({"GET"}, r"/routes/verzeichnis/.*"),
        # Hinweis am Tresen zu Testphase und Tarif (nur lesen), Rolle des Kontos
        ({"GET"}, r"/routes/billing/modus"),
        ({"GET"}, r"/routes/konto/profil"),
        # Laden, Personen, Kunden, Termine lesen
        ({"GET"}, r"/routes/team/ich/(laeden|personen)"),
        ({"GET"}, rf"/routes/team/laden/{_ID}/personen"),
        ({"GET"}, rf"/routes/team/laeden/{_ID}(/kunden(/{_ID}/termine)?|/startklar)?"),
        ({"GET"}, rf"/routes/team/termine(/{_ID})?"),
        # Am Tresen arbeiten: Termine anlegen und ändern, Kunden anlegen, Nummern, freie Zeiten, Früher dran
        ({"POST"}, rf"/routes/team/termine(/{_ID})?"),
        ({"POST"}, r"/routes/team/kunden"),
        ({"POST"}, r"/routes/nummer/(ziehen|termin|verschieben|absagen|uebernehmen)"),
        ({"POST"}, r"/routes/available-timeslots"),
        ({"POST"}, rf"/routes/frueher-dran/{_ID}"),
        ({"POST"}, r"/routes/(check-earlier-slots-v2|slot-freed)"),
    ]
]


def erlaubt(methode: str, pfad: str) -> bool:
    """Darf eine Tresen-Sitzung diesen Aufruf? Alles, was nicht in der Liste steht, nicht."""
    methode = (methode or "GET").upper()
    if methode in ("HEAD", "OPTIONS"):
        methode = "GET"
    pfad = (pfad or "").rstrip("/") or "/"
    return any(methode in methoden and muster.fullmatch(pfad) for methoden, muster in _TRESEN)


# --- Koppeln ---------------------------------------------------------------------------------------------------------


def geraet_name(wunsch: str | None, user_agent: str | None = None) -> str:
    """Name in der Geräteliste: vom Tablet vorgeschlagen (es erkennt sich besser, ein iPad meldet sich als Mac), sonst
    aus dem User-Agent geraten"""
    name = re.sub(r"\s+", " ", re.sub(r"[^\w .,()+-]", "", wunsch or "")).strip()[:MAX_NAME]
    if name:
        return name
    ua = user_agent or ""
    if "iPad" in ua:
        return "iPad"
    if "Android" in ua:
        return "Android-Handy" if "Mobile" in ua else "Android-Tablet"
    if "iPhone" in ua:
        return "iPhone"
    if "Windows" in ua:
        return "Windows-Rechner"
    if "Macintosh" in ua:
        return "Mac"
    return "Gerät"


@dataclass
class Gestartet:
    code: str
    abholen: str
    pruefzahl: str
    gueltig_sekunden: int


def starten(ip: str, geraet: str) -> Gestartet:
    if _zu_viele(f"koppeln:{ip}", STARTEN_IP, merken=True):
        raise KoppelFehler("zu-viele", 429)
    code, abholen = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    pruefzahl = f"{secrets.randbelow(10_000):04d}"
    nun = jetzt()
    with _engine().begin() as conn:
        conn.execute(_sql("delete from kopplungen where angelegt < :alt"), {"alt": nun - AUFHEBEN})
        conn.execute(_sql(
            "insert into kopplungen (code, abholen, pruefzahl, geraet, angelegt, laeuft_ab) "
            "values (:c, :a, :p, :g, :n, :ab)"
        ), {"c": hash_von(code), "a": hash_von(abholen), "p": pruefzahl, "g": geraet, "n": nun, "ab": nun + KOPPLUNG_DAUER})
    return Gestartet(code, abholen, pruefzahl, int(KOPPLUNG_DAUER.total_seconds()))


@dataclass
class Offen:
    pruefzahl: str
    geraet: str | None
    bestaetigt: bool


def _offen(conn, code: str, sperren: bool = False):
    if not code or len(code) > 200:
        raise KoppelFehler("ungueltig", 404)
    zeile = conn.execute(_sql(
        "select pruefzahl, geraet, laeuft_ab, bestaetigt, abgeholt from kopplungen where code = :c"
        + (" for update" if sperren else "")
    ), {"c": hash_von(code)}).first()
    if zeile is None or zeile.abgeholt is not None or zeile.laeuft_ab <= jetzt():
        raise KoppelFehler("ungueltig", 404)
    return zeile


def offen(code: str) -> Offen:
    """Was das Handy vor dem Bestätigen zeigt (Prüfzahl, Gerät). Abgelaufen, abgeholt, unbekannt: KoppelFehler."""
    with _engine().connect() as conn:
        z = _offen(conn, code)
    return Offen(z.pruefzahl, z.geraet, z.bestaetigt is not None)


def bestaetigen(code: str, uid: str, laden: str) -> None:
    """Der Inhaber (uid) gibt das Tablet für einen seiner Läden frei. Prüft nicht, ob ihm der Laden gehört – das tut
    die Schnittstelle vorher (app/apis/geraete)."""
    nun = jetzt()
    with _engine().begin() as conn:
        z = _offen(conn, code, sperren=True)
        if z.bestaetigt is not None:
            raise KoppelFehler("ungueltig", 404)
        conn.execute(_sql(
            "update kopplungen set uid = :uid, laden = :laden, bestaetigt = :n, laeuft_ab = greatest(laeuft_ab, :ab) "
            "where code = :c"
        ), {"uid": uid, "laden": laden, "n": nun, "ab": nun + NACH_BESTAETIGUNG, "c": hash_von(code)})


@dataclass
class Abgeholt:
    # wartet | fertig | abgelaufen
    status: str
    token: str | None = None
    konto: anmeldung.Konto | None = None
    laden: str | None = None


def abholen(geheimnis: str) -> Abgeholt:
    """Fragt das Tablet: Ist die Kopplung bestätigt? Dann einmalig eine Tresen-Sitzung."""
    if not geheimnis or len(geheimnis) > 200:
        return Abgeholt("abgelaufen")
    nun = jetzt()
    with _engine().begin() as conn:
        z = conn.execute(_sql(
            "select code, uid, laden, geraet, laeuft_ab, bestaetigt, abgeholt from kopplungen where abholen = :a for update"
        ), {"a": hash_von(geheimnis)}).first()
        if z is None or z.abgeholt is not None or z.laeuft_ab <= nun:
            return Abgeholt("abgelaufen")
        if z.bestaetigt is None or not z.uid:
            return Abgeholt("wartet")
        k = anmeldung.konto(z.uid)
        if k is None or k.gesperrt:
            return Abgeholt("abgelaufen")
        token = anmeldung.sitzung_anlegen(z.uid, bestaetigt=False, bereich=BEREICH, laden=z.laden, geraet=z.geraet, conn=conn)
        conn.execute(_sql("update kopplungen set abgeholt = :n where code = :c"), {"n": nun, "c": z.code})
    return Abgeholt("fertig", token, k, z.laden)


# --- Tablets verwalten ------------------------------------------------------------------------------------------------


def liste(uid: str) -> list[dict]:
    """Gekoppelte Tablets eines Kontos, neueste zuerst"""
    with _engine().connect() as conn:
        zeilen = conn.execute(_sql(
            "select kennung, geraet, laden, angelegt, zuletzt from sitzungen "
            "where uid = :uid and bereich = :b and laeuft_ab > :n and kennung is not null order by angelegt desc"
        ), {"uid": uid, "b": BEREICH, "n": jetzt()}).all()
    return [
        {"kennung": z.kennung, "geraet": z.geraet, "laden": z.laden, "angelegt": z.angelegt, "zuletzt": z.zuletzt}
        for z in zeilen
    ]


def abmelden(uid: str, kennung: str) -> bool:
    """Ein Tablet abmelden. False: gibt es nicht (oder gehört jemand anderem)."""
    if not kennung or len(kennung) > 100:
        return False
    with _engine().begin() as conn:
        return conn.execute(
            _sql("delete from sitzungen where uid = :uid and kennung = :k and bereich = :b"),
            {"uid": uid, "k": kennung, "b": BEREICH},
        ).rowcount > 0
