"""Telefon-Assistent je Laden: zugelassen, eingeschaltet, Ladennummer, verbrauchte Minuten, gebuchter Zusatz.

telefon_laeden/{Laden-ID}: nur das Backend liest und schreibt das.
    freigegeben     darf die Testminuten nutzen: vom Betreiber freigegeben oder vom Inhaber gestartet („Kostenlos testen“)
    freiminuten     Testminuten, danach nur noch die Ansage, bis der Zusatz gebucht ist
    gesperrt        der Betreiber hat den Assistenten für diesen Laden gesperrt
    aktiv           der Inhaber hat ihn eingeschaltet (/telefon-assistent)
    anschluss       Nummer des Ladens, die auf uns umleitet (+49…)
    status          "wartet" bis zum ersten Anruf von dort, dann "aktiv"
    sekunden        verbrauchte Gesprächszeit insgesamt (zählt für die Testminuten)
    zusatz          gebuchter Zusatz, Stand des Stripe-Abos (app/libs/telefon_abrechnung.py):
                    {status, subscriptionId, customerId, modus, periodeStart, periodeEnde, cancelAtPeriodEnd}
    periode, periodeSekunden, gemeldet
                    Gesprächszeit im Abrechnungsmonat, der am Zeitstempel periode beginnt, und wie viele Minuten davon
                    Stripe schon kennt
    deckel          Kostendeckel in Euro netto im Monat, ohne Angabe 59
    gewarnt         {"80": Monat, "100": Monat}: schon per Mail gewarnt (Monat = periode, für die Testminuten "test")
telefon_anrufe/{CallSid}: laufender Anruf → Laden, bis Twilio das Ende meldet. Ohne Anrufernummer.
meta/telefon: {offen}  Der Betreiber hat den Assistenten für alle Läden geöffnet (Betreiber-Bereich). Bis dahin sehen
                       ihn nur Läden, die er freigegeben hat.
"""
import math
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from app.i18n import merke
from app.libs import telefon as t
from app.libs.plans import ACTIVE_BILLING, PAID_PLANS, has_feature, is_suspended

WARTET_TAGE = 7  # so lange hält ein Laden eine Nummer ohne Probeanruf, danach darf sie ein anderer eintragen
META = ("meta", "telefon")
# Zählen und Melden nacheinander: Das Backend läuft in einem Prozess, zwei Anrufe enden aber gleichzeitig
SPERRE = threading.RLock()


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


def offen(db) -> bool:
    """Hat der Betreiber den Assistenten für alle Läden geöffnet?"""
    snap = db.collection(META[0]).document(META[1]).get()
    return bool((snap.to_dict() or {}).get("offen")) if snap.exists else False


def oeffnen(db, wert: bool) -> None:
    db.collection(META[0]).document(META[1]).set({"offen": bool(wert), "updatedAt": _jetzt()}, merge=True)


def hat_abo(shop: dict) -> bool:
    """Laufendes Tarif-Abo bei Stripe (ab Solo): Voraussetzung zum Zubuchen"""
    billing = shop.get("billing") or {}
    return billing.get("plan") in PAID_PLANS and billing.get("status") in ACTIVE_BILLING


def zugelassen(daten: dict) -> bool:
    """Darf der Laden den Assistenten einrichten? Testminuten freigegeben oder Zusatz gebucht, und nicht gesperrt"""
    return not daten.get("gesperrt") and bool(daten.get("freigegeben") or t.zusatz(daten).get("status"))


def _iso(zeitstempel) -> Optional[str]:
    return datetime.fromtimestamp(int(zeitstempel), tz=timezone.utc).isoformat() if zeitstempel else None


def stand(db, shop_id: str, shop: dict) -> dict:
    """Was der Inhaber und der Betreiber zu sehen bekommen"""
    from app.libs.shop_privat import TEST, stripe_mode

    daten = eintrag(db, shop_id)
    eigene = eigene_nummer(db, shop_id)
    ist_offen = offen(db)
    z = t.zusatz(daten)
    verbrauch = t.verbrauch(daten)
    tarif = has_feature(shop, "telefon")
    gesperrt = bool(daten.get("gesperrt"))
    laeuft_zusatz = z.get("status") in t.GEBUCHT or z.get("status") in t.ZAHLUNG_OFFEN
    return {
        # Kachel unter „Laden“: für alle, sobald geöffnet; vorher nur, wer schon einen Eintrag hat
        "sichtbar": ist_offen or bool(daten),
        "offen": ist_offen,
        "freigegeben": zugelassen(daten),
        "gesperrt": gesperrt,
        "tarif": tarif,
        "abo": hat_abo(shop),
        "kannTesten": ist_offen and tarif and not gesperrt and not daten.get("freigegeben") and not z.get("status"),
        "kannBuchen": (ist_offen or bool(daten.get("freigegeben"))) and not gesperrt and hat_abo(shop) and not laeuft_zusatz,
        "testmodus": stripe_mode(db, shop_id) == TEST,
        "zusatz": {
            "status": z["status"],
            "kuendigtZum": _iso(z.get("periodeEnde")) if z.get("cancelAtPeriodEnd") else None,
            "periodeEnde": _iso(z.get("periodeEnde")),
        } if z.get("status") else None,
        "grund": t.grund(daten, is_suspended(shop)),
        "verbrauch": verbrauch,
        "warnung": t.warnstufe(verbrauch["anteil"]) if zugelassen(daten) else 0,
        "deckel": t.deckel_von(daten),
        "aktiv": bool(daten.get("aktiv")),
        "weitersagen": _laeuft(daten, shop, eigene),
        "status": "aktiv" if eigene else daten.get("status") or "aus",
        "anschluss": daten.get("anschluss") or "",
        "vorschlag": t.e164(shop.get("phone")) or "",
        "zielnummer": eigene or gemeinsame_nummer() or "",
        "eigeneNummer": bool(eigene),
        "minuten": math.ceil(int(daten.get("sekunden") or 0) / 60),
        "freiminuten": t.testminuten(daten),
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
    if daten.get("gesperrt"):
        raise Abgelehnt(403, merke("Der Telefon-Assistent ist für diesen Laden gesperrt. Schreib uns an hilfe@dranzeit.de."))
    if not zugelassen(daten):
        raise Abgelehnt(403, merke("Der Telefon-Assistent ist für diesen Laden noch nicht freigeschaltet."))
    nummer = t.e164(anschluss)
    if anschluss.strip() and not nummer:
        raise Abgelehnt(400, merke("Das ist keine Rufnummer (z. B. 030 1234567)."))
    eigene = eigene_nummer(db, shop_id)
    if not nummer and not eigene and aktiv:
        raise Abgelehnt(400, merke("Trag zuerst die Nummer deines Ladens ein."))
    aenderung: dict = {"shopId": shop_id, "aktiv": aktiv, "updatedAt": _jetzt()}
    if nummer != daten.get("anschluss"):
        if nummer:
            _pruefe_anschluss(db, shop_id, nummer)
        aenderung.update({"anschluss": nummer, "status": "wartet" if nummer else "aus", "wartetSeit": _jetzt() if nummer else None, "probeAm": None})
    db.collection(t.LAEDEN).document(shop_id).set(aenderung, merge=True)


def testen(db, shop_id: str, shop: dict) -> None:
    """Der Inhaber startet die Testminuten selbst (erst, wenn der Betreiber den Assistenten für alle geöffnet hat)"""
    daten = eintrag(db, shop_id)
    if daten.get("gesperrt"):
        raise Abgelehnt(403, merke("Der Telefon-Assistent ist für diesen Laden gesperrt. Schreib uns an hilfe@dranzeit.de."))
    if daten.get("freigegeben") or t.zusatz(daten).get("status"):
        return
    if not offen(db):
        raise Abgelehnt(403, merke("Der Telefon-Assistent ist für diesen Laden noch nicht freigeschaltet."))
    if not has_feature(shop, "telefon"):
        raise Abgelehnt(403, merke("Den Telefon-Assistenten gibt es ab dem Tarif Solo."))
    db.collection(t.LAEDEN).document(shop_id).set(
        {"shopId": shop_id, "freigegeben": True, "freiminuten": t.FREIMINUTEN, "testSeit": _jetzt(), "updatedAt": _jetzt()}, merge=True)


def deckel_setzen(db, shop_id: str, deckel: int) -> None:
    """Der Inhaber legt fest, wie viel der Assistent im Monat höchstens kostet (Euro netto, Grundpreis eingerechnet)"""
    if not t.DECKEL_MIN <= int(deckel) <= t.DECKEL_MAX:
        raise Abgelehnt(400, merke("Der Deckel muss zwischen {min} und {max} Euro liegen.", min=t.DECKEL_MIN, max=t.DECKEL_MAX))
    db.collection(t.LAEDEN).document(shop_id).set({"shopId": shop_id, "deckel": int(deckel), "updatedAt": _jetzt()}, merge=True)


def freigeben(db, shop_id: str, freigegeben: bool, freiminuten: int) -> None:
    """Der Betreiber lässt einen Laden zu"""
    if freiminuten < 0:
        raise Abgelehnt(400, "Die Minuten dürfen nicht negativ sein.")
    aenderung = {"shopId": shop_id, "freigegeben": freigegeben, "freiminuten": freiminuten, "updatedAt": _jetzt()}
    db.collection(t.LAEDEN).document(shop_id).set(aenderung, merge=True)


def sperren(db, shop_id: str, gesperrt: bool) -> None:
    """Der Betreiber sperrt den Assistenten für einen Laden: nur noch die Ansage, kein Testen, kein Zubuchen.
    Ein gebuchter Zusatz läuft bei Stripe weiter, bis er gekündigt ist."""
    db.collection(t.LAEDEN).document(shop_id).set({"shopId": shop_id, "gesperrt": bool(gesperrt), "updatedAt": _jetzt()}, merge=True)


def zusatz_setzen(db, shop_id: str, felder: dict) -> None:
    """Stand des Stripe-Abos für den Zusatz (Webhook, app/libs/telefon_abrechnung.py). Immer ganz, nicht Feld für Feld."""
    ref = db.collection(t.LAEDEN).document(shop_id)
    with SPERRE:
        if ref.get().exists:  # update ersetzt die Karte ganz, set(merge) würde alte Felder behalten
            ref.update({"zusatz": dict(felder) if felder else None, "updatedAt": _jetzt()})
        elif felder:
            ref.set({"shopId": shop_id, "zusatz": dict(felder), "updatedAt": _jetzt()})


def eigene_nummer_zugeordnet(db, shop_id: str) -> None:
    """Der Betreiber hat dem Laden eine eigene Nummer gegeben: Damit ist er zugelassen und eingeschaltet"""
    db.collection(t.LAEDEN).document(shop_id).set({"shopId": shop_id, "freigegeben": True, "aktiv": True, "updatedAt": _jetzt()}, merge=True)


def probeanruf(db, shop_id: str) -> None:
    """Der erste Anruf von der eingetragenen Nummer: Wer dort umleiten kann, hat Zugriff auf den Anschluss"""
    db.collection(t.LAEDEN).document(shop_id).update({"status": "aktiv", "probeAm": _jetzt(), "wartetSeit": None})


def anruf_merken(db, call_sid: str, shop_id: str) -> None:
    db.collection(t.ANRUFE).document(call_sid).set({"shopId": shop_id, "createdAt": _jetzt()})


def _monat(daten: dict, jetzt: datetime) -> dict:
    """Zusatz mit dem Abrechnungsmonat, in den ein Anruf jetzt fällt. Ist der gespeicherte Monat vorbei und die Meldung
    von Stripe noch nicht da, beginnt der nächste genau am Ende des alten (so rechnet Stripe auch)."""
    z = dict(t.zusatz(daten))
    ende = z.get("periodeEnde")
    if z.get("periodeStart") and ende and int(jetzt.timestamp()) >= int(ende):
        z.update({"periodeStart": int(ende), "periodeEnde": None})
    return z


def anruf_ende(db, call_sid: str, sekunden: int, jetzt: Optional[datetime] = None) -> Optional[str]:
    """Twilio meldet das Ende: Gesprächszeit beim Laden zählen, insgesamt und im Abrechnungsmonat des Zusatzes.
    Unbekannte Anrufe (abgewiesen, Ansage) zählen nicht. Gibt den Laden zurück, wenn gezählt wurde."""
    jetzt = jetzt or _jetzt()
    ref = db.collection(t.ANRUFE).document(call_sid)
    snap = ref.get()
    if not snap.exists:
        return None
    shop_id = (snap.to_dict() or {}).get("shopId")
    ref.delete()
    if not shop_id or sekunden <= 0:
        return None
    with SPERRE:
        daten = eintrag(db, shop_id)
        aenderung: dict = {
            "shopId": shop_id,
            "sekunden": int(daten.get("sekunden") or 0) + sekunden,
            "anrufe": int(daten.get("anrufe") or 0) + 1,
            "letzterAnruf": jetzt,
        }
        z = _monat(daten, jetzt)
        if z.get("periodeStart"):
            neu = daten.get("periode") != z["periodeStart"]
            if z != t.zusatz(daten):
                aenderung["zusatz"] = z
            aenderung.update({
                "periode": z["periodeStart"],
                "periodeSekunden": (0 if neu else int(daten.get("periodeSekunden") or 0)) + sekunden,
                "gemeldet": 0 if neu else int(daten.get("gemeldet") or 0),
            })
        db.collection(t.LAEDEN).document(shop_id).set(aenderung, merge=True)
    return shop_id
