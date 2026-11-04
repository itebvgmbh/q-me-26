"""
Läden, ihre Bilder, die Kundenliste und das eigene Konto über das Backend (requirements/eigene-datenbank.md, Stufe 2).
Gegenstück zu frontend/src/utils/firestore/shops.ts, storage.ts, customers.ts, user-profile-service.ts. Die Rechte sind
die aus firestore.rules:

- **Läden:**
  - Lesen darf jeder. Die öffentliche Fassung kommt ohne Inhaber-Konto, Startklar-Merker und Onboarding-Mails, und vom
    Abo nur Tarif und Stand.
  - Anlegen nur für sich selbst, als Gratis-Laden mit Testphase. Die Tarif-Felder setzt das Backend, nicht der Browser.
  - Ändern nur der Inhaber, nie Tarif-Felder, Inhaber oder Anlegedatum.
- **Bilder** (Logo, Fotos der Personen): hochladen nur der Inhaber. Sie liegen auf dem Server (QME_DATEIEN_DIR), nicht
  mehr in Firebase Storage.
- **Kundenliste:** lesen und anlegen Inhaber und Team. Neue Einträge sind nie mit einem Konto verbunden; das macht
  das Backend über den Kunden-Link.
- **Profil** (users/{uid}): nur das eigene. Die Rolle nur customer, shopOwner oder employee.
- **Eigene Termine und Angebote** („Früher dran“): nur die des eigenen Kontos.
"""

from __future__ import annotations

import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import store
from app.i18n import merke
from app.libs.plans import TRIAL_DAYS

SHOPS = "shops"
PRIVAT_LADEN = ("owner", "onboarding", "onboardingMails")
PLAN_FELDER = ("plan", "billing", "trialEndsAt", "founder", "founderSince", "grant", "suspended")
ABO_FELDER = ("plan", "interval", "status", "cancelAtPeriodEnd", "currentPeriodEnd")
ROLLEN = ("customer", "shopOwner", "employee")
KUNDE_GEHEIM = ("activationTokenHash", "activationToken", "activationExpires")
MAX_BILD = 5 * 1024 * 1024
BILDNAME = re.compile(r"^[a-f0-9]{32}\.(png|jpg|webp)$")


class LadenFehler(Exception):
    def __init__(self, status: int, text):
        super().__init__(text)
        self.status = status
        self.text = text


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


# --- Läden -----------------------------------------------------------------------------------------------------------


def laden_oeffentlich(shop_id: str, daten: dict) -> dict:
    laden = {"id": shop_id, **{k: v for k, v in daten.items() if k not in PRIVAT_LADEN and k not in ("billing", "suspended")}}
    if isinstance(daten.get("billing"), dict):
        laden["billing"] = {k: daten["billing"][k] for k in ABO_FELDER if k in daten["billing"]}
    if daten.get("suspended"):
        gesperrt = daten["suspended"]
        laden["suspended"] = {"at": gesperrt.get("at")} if isinstance(gesperrt, dict) else True
    return laden


def laden_roh(db, shop_id: str) -> dict | None:
    snap = db.collection(SHOPS).document(shop_id).get()
    return (snap.to_dict() or {}) if snap.exists else None


def alle_laeden(db) -> list[dict]:
    return sorted((laden_oeffentlich(d.id, d.to_dict() or {}) for d in db.collection(SHOPS).stream()), key=lambda s: s["id"])


def eigene_laeden(db, uid: str) -> list[dict]:
    abfrage = db.collection(SHOPS).where(filter=store.FieldFilter("owner", "==", uid))
    return sorted(({"id": d.id, **(d.to_dict() or {})} for d in abfrage.stream()), key=lambda s: s["id"])


def laden_anlegen(db, uid: str, daten: dict) -> dict:
    """Neuer Laden für das eigene Konto: Gratis mit Testphase (wie newShopPlanFields im Browser)"""
    daten = {k: v for k, v in daten.items() if k not in (*PLAN_FELDER, "owner", "createdAt", "updatedAt", "id")}
    if not isinstance(daten.get("name"), str) or not daten["name"].strip():
        raise LadenFehler(400, merke("Bitte gib einen Namen ein."))
    ref = db.collection(SHOPS).document()
    if db.collection("deleted_shops").document(ref.id).get().exists:  # neue IDs sind zufällig; nur zur Sicherheit
        ref = db.collection(SHOPS).document()
    jetzt = _jetzt()
    eintrag = {**daten, "plan": "gratis", "trialEndsAt": jetzt + timedelta(days=TRIAL_DAYS), "owner": uid,
               "createdAt": jetzt, "updatedAt": jetzt}
    ref.set(eintrag)
    return {"id": ref.id, **eintrag}


def laden_aendern(db, shop_id: str, aenderung: dict) -> dict:
    """Inhaber ändert seinen Laden. Tarif-Felder, Inhaber und Anlegedatum bleiben. Karten werden zusammengeführt
    (wie setDoc mit merge im Browser), z. B. die Startklar-Merker unter onboarding."""
    aenderung = {k: v for k, v in aenderung.items() if k not in (*PLAN_FELDER, "owner", "createdAt", "updatedAt", "id")}
    if "name" in aenderung and (not isinstance(aenderung["name"], str) or not aenderung["name"].strip()):
        raise LadenFehler(400, merke("Bitte gib einen Namen ein."))
    ref = db.collection(SHOPS).document(shop_id)
    ref.set({**aenderung, "updatedAt": _jetzt()}, merge=True)
    return {"id": shop_id, **(ref.get().to_dict() or {})}


def startklar_bedient(db, shop_id: str) -> bool:
    """Hat der Laden schon jemanden aufgerufen oder fertig gemacht? (Startklar: „Erster Kunde“)"""
    abfrage = (db.collection("appointments")
               .where(filter=store.FieldFilter("shopId", "==", shop_id))
               .where(filter=store.FieldFilter("status", "in", ["in-progress", "completed"]))
               .limit(1))
    return any(True for _ in abfrage.stream())


# --- Bilder --------------------------------------------------------------------------------------------------------


def dateien_dir() -> Path:
    standard = "/var/lib/q-me/dateien" if os.name != "nt" else os.path.join(".local_data", "dateien")
    return Path(os.environ.get("QME_DATEIEN_DIR", "").strip() or standard)


def bildart(inhalt: bytes) -> str | None:
    """Endung nach dem Inhalt, nicht nach dem Namen: nur PNG, JPEG, WebP"""
    if inhalt.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if inhalt.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if len(inhalt) > 12 and inhalt[:4] == b"RIFF" and inhalt[8:12] == b"WEBP":
        return "webp"
    return None


def bild_speichern(shop_id: str, inhalt: bytes) -> str:
    """Speichert das Bild unter <dir>/<Laden>/<zufall>.<endung> und gibt den Dateinamen zurück"""
    if len(inhalt) > MAX_BILD:
        raise LadenFehler(400, merke("Das Bild ist zu groß (höchstens 5 MB)."))
    art = bildart(inhalt)
    if art is None:
        raise LadenFehler(400, merke("Bitte ein Bild als PNG, JPEG oder WebP."))
    ordner = dateien_dir() / shop_id
    ordner.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}.{art}"
    vorlaeufig = ordner / f".{name}.teil"
    vorlaeufig.write_bytes(inhalt)
    vorlaeufig.replace(ordner / name)
    return name


def bild_pfad(shop_id: str, name: str) -> Path | None:
    if not BILDNAME.match(name):
        return None
    pfad = dateien_dir() / shop_id / name
    return pfad if pfad.is_file() else None


# --- Kundenliste ---------------------------------------------------------------------------------------------------


def kunde_fuers_team(kunde_id: str, daten: dict) -> dict:
    return {**{k: v for k, v in daten.items() if k not in KUNDE_GEHEIM}, "id": kunde_id}


def kunden(db, shop_id: str) -> list[dict]:
    abfrage = db.collection("customers").where(filter=store.FieldFilter("shopId", "==", shop_id))
    return [kunde_fuers_team(d.id, d.to_dict() or {}) for d in abfrage.stream()]


def kunde_anlegen(db, daten: dict) -> dict:
    """Neuer Eintrag in der Kundenliste, nie mit einem Konto verbunden. Gibt es die E-Mail im Laden schon, diesen Eintrag."""
    daten = {k: v for k, v in daten.items() if k not in (*KUNDE_GEHEIM, "userId", "isActive", "id", "createdAt", "updatedAt", "activatedAt")}
    if not isinstance(daten.get("name"), str) or not daten["name"].strip():
        raise LadenFehler(400, merke("Bitte gib einen Namen ein."))
    email = daten.get("email")
    if isinstance(email, str) and email.strip():
        vorhanden = (db.collection("customers")
                     .where(filter=store.FieldFilter("email", "==", email))
                     .where(filter=store.FieldFilter("shopId", "==", daten["shopId"])).limit(1).stream())
        for d in vorhanden:
            return kunde_fuers_team(d.id, d.to_dict() or {})
    ref = db.collection("customers").document()
    jetzt = _jetzt()
    eintrag = {"id": ref.id, **daten, "isActive": False, "createdAt": jetzt, "updatedAt": jetzt}
    ref.set(eintrag)
    return kunde_fuers_team(ref.id, eintrag)


# --- Eigenes Konto ---------------------------------------------------------------------------------------------------


def profil(db, uid: str) -> dict | None:
    snap = db.collection("users").document(uid).get()
    return (snap.to_dict() or {}) if snap.exists else None


def profil_anlegen(db, uid: str, email: str, rolle: str, sprache: str | None) -> dict:
    """Profil anlegen, wenn es noch keins gibt (sonst das vorhandene) – in einer Transaktion wie im Browser"""
    if rolle not in ROLLEN:
        raise LadenFehler(400, merke("Ungültige Angaben zur Person."))
    ref = db.collection("users").document(uid)
    jetzt = _jetzt()
    frisch = {"uid": uid, "email": email or "", "role": rolle, "createdAt": jetzt, "updatedAt": jetzt}
    if sprache:
        frisch["language"] = sprache

    @store.transactional
    def run(tx):
        snap = ref.get(transaction=tx)
        if snap.exists:
            return snap.to_dict() or {}
        tx.set(ref, frisch)
        return frisch

    return run(db.transaction())


def profil_aendern(db, uid: str, aenderung: dict) -> dict:
    aenderung = {k: v for k, v in aenderung.items() if k not in ("uid", "createdAt", "updatedAt")}
    if "role" in aenderung and aenderung["role"] not in ROLLEN:
        raise LadenFehler(400, merke("Ungültige Angaben zur Person."))
    ref = db.collection("users").document(uid)
    ref.set({**aenderung, "updatedAt": _jetzt()}, merge=True)
    return ref.get().to_dict() or {}


def eigene_termine(db, uid: str) -> list[dict]:
    abfrage = db.collection("appointments").where(filter=store.FieldFilter("customerId", "==", uid))
    return [{"id": d.id, **(d.to_dict() or {})} for d in abfrage.stream()]


def eigener_termin(db, uid: str, termin_id: str) -> dict | None:
    snap = db.collection("appointments").document(termin_id).get()
    termin = (snap.to_dict() or {}) if snap.exists else None
    return {"id": termin_id, **termin} if termin and termin.get("customerId") == uid else None


def eigene_angebote(db, uid: str) -> list[dict]:
    abfrage = (db.collection("earlier_slot_notifications")
               .where(filter=store.FieldFilter("userId", "==", uid))
               .where(filter=store.FieldFilter("isAccepted", "==", False)))
    return [{"id": d.id, **(d.to_dict() or {})} for d in abfrage.stream()]


def eigenes_angebot(db, uid: str, angebot_id: str) -> dict | None:
    snap = db.collection("earlier_slot_notifications").document(angebot_id).get()
    angebot = (snap.to_dict() or {}) if snap.exists else None
    return {"id": angebot_id, **angebot} if angebot and angebot.get("userId") == uid else None
