"""Eigene Anmeldung statt Firebase Auth (Stufe 4, requirements/eigene-datenbank.md).

Konten, Sitzungen und Einmal-Links liegen in PostgreSQL (Schema 0003, migrations/versions/20261104_0003_konten.py).

- **Passwörter:** Argon2id (argon2-cffi), Einstellungen nach OWASP (19 MiB, 2 Durchläufe).
- **Sitzung:** Cookie `qme_sitzung` (HttpOnly, Secure, SameSite=Lax) mit 256 Bit Zufall; in der Datenbank steht nur
  der SHA-256. Sie gilt 180 Tage ab der letzten Nutzung, verlängert wird höchstens alle 12 Stunden. Ein per QR-Code
  gekoppeltes Tablet bekommt eine Sitzung mit bereich „tresen“: Sie darf nur, was der Tresen braucht (app/libs/geraete.py).
- **Einmal-Links** (Passwort neu: 1 Stunde, Adresse bestätigen: 3 Tage) gehen per Resend raus
  (app/apis/password_reset, app/apis/email_verification). Auch sie nur als Hash, einmal benutzbar, und nur, solange
  die Adresse des Kontos dieselbe ist.
- **Schutz:** Nach 5 falschen Passwörtern für eine Adresse sind 15 Minuten Pause, je IP nach 30. Registrieren je IP
  höchstens 20-mal in der Stunde. Schreibende Anfragen mit Sitzung prüft databutton_app/mw/auth_mw.py auf ihren
  Ursprung (Origin).

**Übernahme aus Firebase:** Beim ersten Start von Stufe 4 (04.11.2026) kamen alle Firebase-Konten mit ihrer bisherigen
ID nach `konten`, aber ohne Passwort (herkunft „firebase“). Die erste Anmeldung prüft das Passwort deshalb noch einmal
bei Firebase (öffentliche REST-Schnittstelle, kein Firebase-Paket) und speichert es danach als Argon2id-Hash. Gibt es
das Firebase-Projekt nicht mehr, scheitert die Prüfung still, und die Person setzt ihr Passwort über „Passwort
vergessen“ neu. Ist das Projekt gelöscht, kann firebase_passwort() mit FIREBASE_WEB_SCHLUESSEL weg.
"""

import hashlib
import secrets
import string
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
COOKIE = "qme_sitzung"
SITZUNG_DAUER = timedelta(days=180)
VERLAENGERN_NACH = timedelta(hours=12)
BESTAETIGT_DAUER = timedelta(minutes=5)
LINK_DAUER = {"passwort": timedelta(hours=1), "bestaetigen": timedelta(days=3)}
MIN_PASSWORT = 6
MAX_PASSWORT = 200
UID_ZEICHEN = string.ascii_letters + string.digits

# Falsche Passwörter: (Höchstzahl, Zeitraum in Sekunden); Registrieren je IP
FEHLVERSUCHE_EMAIL = (5, 900)
FEHLVERSUCHE_IP = (30, 900)
REGISTRIEREN_IP = (20, 3600)

# Öffentlicher Web-Schlüssel des Firebase-Projekts (stand bis Stufe 4 in frontend/src/app/auth/firebase.ts und steckt in
# jeder ausgelieferten Seite). Nur für die Passwort-Prüfung bei der Übernahme; fällt mit dem Firebase-Projekt weg.
FIREBASE_WEB_SCHLUESSEL = "AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE"
FIREBASE_REST = "https://identitytoolkit.googleapis.com/v1/accounts"


class AnmeldeFehler(Exception):
    """Fehler mit Code wie bei Firebase (auth/…), damit frontend/src/utils/auth-errors.ts ihn übersetzt"""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code, self.status = code, status


@dataclass
class Konto:
    uid: str
    email: str
    passwort: str | None
    email_bestaetigt: bool
    gesperrt: bool
    name: str | None
    herkunft: str
    angelegt: datetime
    zuletzt_angemeldet: datetime | None

    def oeffentlich(self) -> dict:
        """Was der Browser über das eigene Konto erfährt (GET /routes/anmeldung/ich)"""
        return {"uid": self.uid, "email": self.email, "emailVerified": self.email_bestaetigt, "displayName": self.name}


SPALTEN = "uid, email, passwort, email_bestaetigt, gesperrt, name, herkunft, angelegt, zuletzt_angemeldet"


def _engine():
    from app.libs import datenbank

    return datenbank.engine()


def _sql(text_: str):
    from sqlalchemy import text

    return text(text_)


def _konto(zeile) -> Konto | None:
    return Konto(*zeile) if zeile is not None else None


def jetzt() -> datetime:
    return datetime.now(UTC)


def hash_von(wert: str) -> str:
    return hashlib.sha256(wert.encode()).hexdigest()


def neue_uid() -> str:
    """28 Zeichen wie die Firebase-IDs, damit sich neue und übernommene Konten nicht unterscheiden"""
    return "".join(secrets.choice(UID_ZEICHEN) for _ in range(28))


def email_normal(email: str) -> str:
    return (email or "").strip()


def email_pruefen(email: str) -> str:
    import re

    email = email_normal(email)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) or len(email) > 254:
        raise AnmeldeFehler("auth/invalid-email")
    return email


def passwort_pruefen(passwort: str) -> str:
    if not passwort:
        raise AnmeldeFehler("auth/missing-password")
    if len(passwort) < MIN_PASSWORT:
        raise AnmeldeFehler("auth/weak-password")
    if len(passwort) > MAX_PASSWORT:
        raise AnmeldeFehler("auth/password-too-long")
    return passwort


# --- Passwörter -------------------------------------------------------------------------------------------------------

_hasher = None


def _ph():
    global _hasher
    if _hasher is None:
        from argon2 import PasswordHasher

        _hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
    return _hasher


def passwort_hash(passwort: str) -> str:
    return _ph().hash(passwort)


def passwort_stimmt(gespeichert: str | None, passwort: str) -> bool:
    if not gespeichert or not passwort:
        return False
    from argon2.exceptions import InvalidHashError, VerificationError

    try:
        return _ph().verify(gespeichert, passwort)
    except (VerificationError, InvalidHashError):
        return False


# --- Fehlversuche (im Speicher: ein Prozess, siehe Plan) --------------------------------------------------------------

_versuche: dict = defaultdict(deque)
_versuche_lock = threading.Lock()


def _zu_viele(schluessel: str, grenze: tuple[int, int], merken: bool = False) -> bool:
    anzahl, zeitraum = grenze
    nun = time.time()
    with _versuche_lock:
        liste = _versuche[schluessel]
        while liste and nun - liste[0] > zeitraum:
            liste.popleft()
        if merken:
            liste.append(nun)
        return len(liste) >= anzahl if not merken else len(liste) > anzahl


def _fehlversuch(email: str, ip: str) -> None:
    _zu_viele(f"mail:{email.lower()}", FEHLVERSUCHE_EMAIL, merken=True)
    _zu_viele(f"ip:{ip}", FEHLVERSUCHE_IP, merken=True)


def versuche_vergessen() -> None:
    """Für Tests"""
    with _versuche_lock:
        _versuche.clear()


# --- Konten -----------------------------------------------------------------------------------------------------------


def konto(uid: str) -> Konto | None:
    if not uid:
        return None
    with _engine().connect() as conn:
        return _konto(conn.execute(_sql(f"select {SPALTEN} from konten where uid = :uid"), {"uid": uid}).first())


def konto_per_email(email: str) -> Konto | None:
    email = email_normal(email)
    if not email:
        return None
    with _engine().connect() as conn:
        zeile = conn.execute(_sql(f"select {SPALTEN} from konten where lower(email) = lower(:e)"), {"e": email}).first()
    return _konto(zeile)


def konten(uids) -> list[Konto]:
    ids = sorted({u for u in uids if isinstance(u, str) and u})
    if not ids:
        return []
    with _engine().connect() as conn:
        zeilen = conn.execute(_sql(f"select {SPALTEN} from konten where uid = any(:ids)"), {"ids": ids}).all()
    return [_konto(z) for z in zeilen]


def alle_konten() -> list[Konto]:
    with _engine().connect() as conn:
        return [_konto(z) for z in conn.execute(_sql(f"select {SPALTEN} from konten order by angelegt, uid")).all()]


def anlegen(email: str, passwort: str | None, *, uid: str | None = None, bestaetigt: bool = False, gesperrt: bool = False,
            name: str | None = None, herkunft: str = "dranzeit", angelegt: datetime | None = None) -> Konto:
    """Neues Konto; gibt es die Adresse schon: AnmeldeFehler auth/email-already-in-use"""
    from sqlalchemy.exc import IntegrityError

    werte = {
        "uid": uid or neue_uid(), "email": email_normal(email), "pw": passwort_hash(passwort) if passwort else None,
        "b": bestaetigt, "g": gesperrt, "n": name, "h": herkunft, "a": angelegt or jetzt(),
    }
    try:
        with _engine().begin() as conn:
            zeile = conn.execute(_sql(
                "insert into konten (uid, email, passwort, email_bestaetigt, gesperrt, name, herkunft, angelegt) "
                f"values (:uid, :email, :pw, :b, :g, :n, :h, :a) returning {SPALTEN}"
            ), werte).first()
    except IntegrityError:
        raise AnmeldeFehler("auth/email-already-in-use")
    return _konto(zeile)


def aendern(uid: str, **felder) -> Konto | None:
    """Felder: email, passwort (Klartext, wird gehasht), email_bestaetigt, gesperrt, name.
    Adresse schon vergeben: AnmeldeFehler auth/email-already-in-use. Kein Konto: None."""
    from sqlalchemy.exc import IntegrityError

    erlaubt = {"email", "passwort", "email_bestaetigt", "gesperrt", "name", "zuletzt_angemeldet"}
    unbekannt = set(felder) - erlaubt
    if unbekannt:
        raise ValueError(f"Unbekannte Felder: {sorted(unbekannt)}")
    werte = dict(felder)
    if "passwort" in werte and werte["passwort"] is not None:
        werte["passwort"] = passwort_hash(werte["passwort"])
    if "email" in werte:
        werte["email"] = email_normal(werte["email"])
    if not werte:
        return konto(uid)
    setzen = ", ".join(f"{k} = :{k}" for k in werte)
    try:
        with _engine().begin() as conn:
            zeile = conn.execute(
                _sql(f"update konten set {setzen}, geaendert = now() where uid = :uid returning {SPALTEN}"),
                {**werte, "uid": uid},
            ).first()
    except IntegrityError:
        raise AnmeldeFehler("auth/email-already-in-use")
    return _konto(zeile)


def loeschen(uid: str) -> bool:
    """Konto samt Sitzungen und Links (on delete cascade). False: gab es nicht."""
    with _engine().begin() as conn:
        return conn.execute(_sql("delete from konten where uid = :uid"), {"uid": uid}).rowcount > 0


# --- Sitzungen --------------------------------------------------------------------------------------------------------


@dataclass
class Sitzung:
    konto: Konto
    # wann in dieser Sitzung zuletzt das Passwort eingegeben wurde
    bestaetigt: datetime | None
    # None = alles; "tresen" = nur der Tresen (gekoppeltes Tablet, app/libs/geraete.py)
    bereich: str | None = None
    laden: str | None = None
    kennung: str | None = None


def sitzung_anlegen(uid: str, bestaetigt: bool = True, *, bereich: str | None = None, laden: str | None = None,
                    geraet: str | None = None, conn=None) -> str:
    """Neue Sitzung, Rückgabe: der Wert fürs Cookie. bestaetigt: Passwort wurde gerade eingegeben. bereich/laden/geraet:
    gekoppeltes Tablet (app/libs/geraete.py). conn: in einer schon offenen Transaktion anlegen."""
    token = secrets.token_urlsafe(32)
    nun = jetzt()
    werte = {
        "h": hash_von(token), "uid": uid, "n": nun, "ab": nun + SITZUNG_DAUER, "b": nun if bestaetigt else None,
        "bereich": bereich, "laden": laden, "geraet": geraet, "kennung": secrets.token_urlsafe(12),
    }

    def schreiben(c) -> None:
        c.execute(_sql(
            "insert into sitzungen (hash, uid, angelegt, zuletzt, laeuft_ab, bestaetigt, bereich, laden, geraet, kennung) "
            "values (:h, :uid, :n, :n, :ab, :b, :bereich, :laden, :geraet, :kennung)"
        ), werte)
        c.execute(_sql("update konten set zuletzt_angemeldet = :n where uid = :uid"), {"n": nun, "uid": uid})

    if conn is not None:
        schreiben(conn)
    else:
        with _engine().begin() as c:
            schreiben(c)
    return token


def sitzung_lesen(token: str | None) -> Sitzung | None:
    """Sitzung zum Cookie oder None (unbekannt, abgelaufen, Konto gesperrt). Verlängert sie höchstens alle 12 Stunden."""
    if not token or len(token) > 200:
        return None
    nun = jetzt()
    with _engine().connect() as conn:
        zeile = conn.execute(_sql(
            f"select s.zuletzt, s.bestaetigt, s.bereich, s.laden, s.kennung, {', '.join('k.' + s for s in SPALTEN.split(', '))} "
            "from sitzungen s join konten k on k.uid = s.uid where s.hash = :h and s.laeuft_ab > :n"
        ), {"h": hash_von(token), "n": nun}).first()
    if zeile is None:
        return None
    zuletzt, bestaetigt, bereich, laden, kennung, *rest = zeile
    k = Konto(*rest)
    if k.gesperrt:
        return None
    if nun - zuletzt > VERLAENGERN_NACH:
        with _engine().begin() as conn:
            conn.execute(_sql("update sitzungen set zuletzt = :n, laeuft_ab = :ab where hash = :h"),
                         {"n": nun, "ab": nun + SITZUNG_DAUER, "h": hash_von(token)})
    return Sitzung(k, bestaetigt, bereich, laden, kennung)


def sitzung_pruefen(token: str | None) -> tuple[Konto, datetime | None] | None:
    """Konto zur Sitzung und wann dort zuletzt das Passwort eingegeben wurde, oder None (wie sitzung_lesen)"""
    s = sitzung_lesen(token)
    return (s.konto, s.bestaetigt) if s is not None else None


def sitzung_bestaetigen(token: str) -> None:
    with _engine().begin() as conn:
        conn.execute(_sql("update sitzungen set bestaetigt = now() where hash = :h"), {"h": hash_von(token)})


def sitzung_beenden(token: str | None) -> None:
    if token:
        with _engine().begin() as conn:
            conn.execute(_sql("delete from sitzungen where hash = :h"), {"h": hash_von(token)})


def sitzungen_beenden(uid: str, ausser: str | None = None) -> int:
    """Alle Geräte abmelden (Sperren, Passwort geändert), auf Wunsch bis auf die eigene Sitzung"""
    with _engine().begin() as conn:
        return conn.execute(
            _sql("delete from sitzungen where uid = :uid and hash <> :ausser"),
            {"uid": uid, "ausser": hash_von(ausser) if ausser else ""},
        ).rowcount


def frisch_bestaetigt(bestaetigt: datetime | None) -> bool:
    return bestaetigt is not None and jetzt() - bestaetigt <= BESTAETIGT_DAUER


# --- Einmal-Links -----------------------------------------------------------------------------------------------------


def link_anlegen(k: Konto, zweck: str) -> str:
    """Code für einen Link aus einer Mail (zweck: passwort | bestaetigen). Ältere offene Links desselben Zwecks
    gelten danach nicht mehr."""
    if zweck not in LINK_DAUER:
        raise ValueError(zweck)
    code = secrets.token_urlsafe(32)
    nun = jetzt()
    with _engine().begin() as conn:
        conn.execute(_sql("delete from einmal_links where uid = :uid and zweck = :z and benutzt is null"),
                     {"uid": k.uid, "z": zweck})
        conn.execute(_sql(
            "insert into einmal_links (hash, uid, zweck, email, angelegt, laeuft_ab) values (:h, :uid, :z, :e, :n, :ab)"
        ), {"h": hash_von(code), "uid": k.uid, "z": zweck, "e": k.email, "n": nun, "ab": nun + LINK_DAUER[zweck]})
    return code


def _link(conn, code: str, zweck: str, sperren: bool):
    if not code or len(code) > 200:
        raise AnmeldeFehler("auth/invalid-action-code")
    zeile = conn.execute(_sql(
        "select l.email, l.laeuft_ab, l.benutzt, " + ", ".join("k." + s for s in SPALTEN.split(", ")) + " "
        "from einmal_links l join konten k on k.uid = l.uid where l.hash = :h and l.zweck = :z"
        + (" for update of l" if sperren else "")
    ), {"h": hash_von(code), "z": zweck}).first()
    if zeile is None:
        raise AnmeldeFehler("auth/invalid-action-code")
    email, laeuft_ab, benutzt, *rest = zeile
    k = Konto(*rest)
    if benutzt is not None or email.lower() != k.email.lower():
        raise AnmeldeFehler("auth/invalid-action-code")
    if laeuft_ab <= jetzt():
        raise AnmeldeFehler("auth/expired-action-code")
    if k.gesperrt:
        raise AnmeldeFehler("auth/user-disabled")
    return k


def link_pruefen(code: str, zweck: str) -> Konto:
    """Konto zum Link, ohne ihn zu verbrauchen (Seite „Passwort neu“ zeigt die Adresse)"""
    with _engine().connect() as conn:
        return _link(conn, code, zweck, sperren=False)


def link_einloesen(code: str, zweck: str, passwort: str | None = None) -> Konto:
    """Link verbrauchen. passwort: neues Passwort (zweck passwort). Bestätigt dabei auch die Adresse, denn der Link
    kam per Mail an sie."""
    with _engine().begin() as conn:
        k = _link(conn, code, zweck, sperren=True)
        conn.execute(_sql("update einmal_links set benutzt = now() where hash = :h"), {"h": hash_von(code)})
        werte = {"uid": k.uid, "pw": passwort_hash(passwort) if passwort else None}
        conn.execute(_sql(
            "update konten set email_bestaetigt = true, passwort = coalesce(:pw, passwort), geaendert = now() "
            "where uid = :uid"
        ), werte)
        if passwort:
            conn.execute(_sql("delete from sitzungen where uid = :uid"), {"uid": k.uid})
    return konto(k.uid)


# --- Anmelden und Registrieren ----------------------------------------------------------------------------------------


def anmelden(email: str, passwort: str, ip: str) -> tuple[Konto, str]:
    """Konto und Sitzung oder AnmeldeFehler (auth/invalid-credential, auth/user-disabled, auth/too-many-requests)"""
    email = email_normal(email)
    if not email or not passwort:
        raise AnmeldeFehler("auth/invalid-credential")
    if _zu_viele(f"mail:{email.lower()}", FEHLVERSUCHE_EMAIL) or _zu_viele(f"ip:{ip}", FEHLVERSUCHE_IP):
        raise AnmeldeFehler("auth/too-many-requests", 429)
    k = konto_per_email(email)
    if k is not None and k.passwort:
        if not passwort_stimmt(k.passwort, passwort):
            _fehlversuch(email, ip)
            raise AnmeldeFehler("auth/invalid-credential")
    else:
        k = _von_firebase(email, passwort, k)
        if k is None:
            _fehlversuch(email, ip)
            raise AnmeldeFehler("auth/invalid-credential")
    if k.gesperrt:
        raise AnmeldeFehler("auth/user-disabled", 403)
    if _ph().check_needs_rehash(k.passwort):
        k = aendern(k.uid, passwort=passwort) or k
    return k, sitzung_anlegen(k.uid)


def registrieren(email: str, passwort: str, ip: str) -> tuple[Konto, str]:
    email = email_pruefen(email)
    passwort_pruefen(passwort)
    if _zu_viele(f"neu:{ip}", REGISTRIEREN_IP, merken=True):
        raise AnmeldeFehler("auth/too-many-requests", 429)
    k = anlegen(email, passwort)
    return k, sitzung_anlegen(k.uid)


def passwort_aendern(k: Konto, neu: str, eigene_sitzung: str) -> None:
    passwort_pruefen(neu)
    aendern(k.uid, passwort=neu)
    sitzungen_beenden(k.uid, ausser=eigene_sitzung)


# --- Übernahme aus Firebase -------------------------------------------------------------------------------------------


def _firebase_post(methode: str, daten: dict) -> tuple[int, dict]:
    import requests

    antwort = requests.post(
        f"{FIREBASE_REST}:{methode}", params={"key": FIREBASE_WEB_SCHLUESSEL}, json=daten, timeout=10,
        headers={"Referer": "https://dranzeit.de/"},
    )
    try:
        return antwort.status_code, antwort.json()
    except ValueError:
        return antwort.status_code, {}


def firebase_passwort(email: str, passwort: str) -> dict | None:
    """Prüft E-Mail und Passwort bei Firebase. Treffer: {"uid", "email", "verified", "disabled"}; sonst None
    (falsch, unbekannt, Projekt weg oder nicht erreichbar)."""
    try:
        status, daten = _firebase_post("signInWithPassword", {"email": email, "password": passwort, "returnSecureToken": True})
        if status != 200 or not daten.get("localId"):
            meldung = (daten.get("error") or {}).get("message", "")
            if "USER_DISABLED" in meldung:
                return {"uid": None, "disabled": True}
            if "TOO_MANY_ATTEMPTS" in meldung:
                raise AnmeldeFehler("auth/too-many-requests", 429)
            return None
        status, info = _firebase_post("lookup", {"idToken": daten["idToken"]})
        nutzer = (info.get("users") or [{}])[0] if status == 200 else {}
        return {
            "uid": daten["localId"], "email": daten.get("email") or email,
            "verified": bool(nutzer.get("emailVerified")), "disabled": bool(nutzer.get("disabled")),
        }
    except AnmeldeFehler:
        raise
    except Exception as e:  # Netz, Firebase weg: dann eben „Passwort vergessen“
        print(f"Anmeldung: Firebase-Prüfung nicht möglich ({e.__class__.__name__})")
        return None


def _von_firebase(email: str, passwort: str, k: Konto | None) -> Konto | None:
    """Konto ohne Passwort (übernommen) oder noch gar nicht da: Passwort bei Firebase prüfen und übernehmen"""
    fb = firebase_passwort(email, passwort)
    if fb is None:
        return None
    if fb.get("disabled") and not fb.get("uid"):
        if k is not None:
            return k if k.gesperrt else aendern(k.uid, gesperrt=True)
        return None
    if k is not None and k.uid != fb["uid"]:
        print(f"Anmeldung: Konto {k.uid} und Firebase-Konto {fb['uid']} mit derselben Adresse, nicht übernommen")
        return None
    if k is None:
        try:
            k = anlegen(fb["email"], None, uid=fb["uid"], bestaetigt=fb["verified"], gesperrt=fb["disabled"], herkunft="firebase")
        except AnmeldeFehler:
            k = konto(fb["uid"])
            if k is None:
                return None
    return aendern(k.uid, passwort=passwort, email_bestaetigt=k.email_bestaetigt or fb["verified"])
