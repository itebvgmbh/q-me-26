"""
Kundenkartei des Ladens (Seite „Kunden“ im Frontend, pages/Kunden.tsx): je Eintrag der Kundenliste (Sammlung customers)
Kennzahlen aus seinen Terminen, der Verlauf mit Preis und die Notizen des Teams.

Welche Termine zu einem Eintrag gehören, steht in telefon_kunden.termine_von:
- customerId = ID des Eintrags: vom Laden für diesen Kunden eingetragen oder vom Telefon-Assistenten gebucht
- customerId = verbundenes Konto: selbst mit Konto gebucht
- kundeId = ID des Eintrags: Nummer oder Termin ohne Konto, über die Handynummer zugeordnet (app/apis/nummer) oder am
  Tresen mit „Kunde zuordnen“. Ein eigenes Feld, weil customerId bei Nummern ohne Konto leer bleiben muss: Sonst
  ließen sie sich mit dem Schlüssel aus dem Link nicht mehr absagen oder ins Konto übernehmen (app/apis/nummer, _ticket).

Notizen stehen am Eintrag selbst: notiz (für das ganze Team, z. B. „mag es kurz“) und besuchsnotizen[terminId]
(z. B. die Farbrezeptur von diesem Besuch). Damit verschwinden sie mit dem Eintrag (app/libs/privacy.py). Sie gehen nur
an Inhaber und Team über diese Kartei, nie über die Kundenliste (die liest auch das Tablet am Tresen,
laeden.kunde_fuers_team), nie an den Kunden und nie an den Telefon-Assistenten. Notizen ändern nicht updatedAt: Die
Löschfrist läuft ab dem letzten Termin, nicht ab der letzten Notiz.

Kennzahlen und Notizen gehören zum Tarif ab Solo (Feature „kartei“); ohne bleibt es bei Liste und Terminen.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Iterable, Optional

from app.i18n import merke
from app.libs import telefon as t
from app.libs import telefon_kunden as tk
from app.libs.schedule import aware

KUNDEN = "customers"
NOTIZ_FELDER = ("notiz", "notizGeaendert", "besuchsnotizen")
NOTIZ_MAX = 2000
NAME_MAX = 80
KONTAKT_MAX = 120
VERLAUF = 200  # so viele Termine zeigt die Kundenseite


class KarteiFehler(Exception):
    def __init__(self, status: int, text):
        super().__init__(text)
        self.status = status
        self.text = text


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def _zeit(wert) -> Optional[datetime]:
    return aware(wert) if isinstance(wert, datetime) else None


def ohne_notizen(daten: dict) -> dict:
    return {k: v for k, v in daten.items() if k not in NOTIZ_FELDER}


def preis(termin: dict, preise: dict) -> float:
    """Preis am Termin (Listenpreis beim Buchen), sonst der heutige Listenpreis der Leistung"""
    wert = termin.get("price")
    if not isinstance(wert, (int, float)) or isinstance(wert, bool):
        wert = preise.get(termin.get("serviceId"))
    try:
        return max(0.0, float(wert or 0))
    except (TypeError, ValueError):
        return 0.0


def _haeufigste(werte: Iterable[str]) -> str:
    zaehler = Counter(w for w in werte if w)
    if not zaehler:
        return ""
    # Bei Gleichstand der zuerst gezählte (die Termine kommen neueste zuerst)
    return zaehler.most_common(1)[0][0]


def kennzahlen(termine: list[dict], preise: dict, leistungen: dict, personen: dict, jetzt: datetime) -> dict:
    """Aus den Terminen einer Person (neueste zuerst): Besuche = vorbei und nicht abgesagt; Umsatz = Summe der Preise
    dieser Besuche laut Preisliste (bezahlt wird im Laden, das sieht Dranzeit nicht)."""
    besuche, kommend = [], []
    abgesagt = nicht_gekommen = 0
    for a in termine:
        start = _zeit(a.get("startTime"))
        if start is None:
            continue
        if a.get("status") == "cancelled":
            if a.get("noShow"):
                nicht_gekommen += 1
            else:
                abgesagt += 1
        elif start <= jetzt or a.get("status") in ("in-progress", "completed"):
            besuche.append((start, a))
        else:
            kommend.append((start, a))
    besuche.sort(key=lambda e: e[0], reverse=True)
    zahlen = {
        "besuche": len(besuche),
        "umsatz": round(sum(preis(a, preise) for _, a in besuche), 2),
        "abgesagt": abgesagt,
        "nichtGekommen": nicht_gekommen,
        "zuletzt": besuche[0][0] if besuche else None,
        "erster": besuche[-1][0] if besuche else None,
        "naechster": min(s for s, _ in kommend) if kommend else None,
        "abstandTage": None,
        "lieblingsLeistung": "",
        "lieblingsPerson": "",
    }
    if len(besuche) >= 2:
        zahlen["abstandTage"] = round((besuche[0][0] - besuche[-1][0]).total_seconds() / 86400 / (len(besuche) - 1))
        zahlen["lieblingsLeistung"] = _haeufigste(leistungen.get(a.get("serviceId"), "") for _, a in besuche)
        zahlen["lieblingsPerson"] = _haeufigste(personen.get(a.get("staffId"), "") for _, a in besuche)
    return zahlen


def _leistungen(db, shop_id: str) -> tuple[dict, dict]:
    """(ID → Name, ID → Preis), auch ausgeblendete Leistungen (für alte Termine)"""
    namen, preise = {}, {}
    for d in db.collection("services").where("shopId", "==", shop_id).stream():
        s = d.to_dict() or {}
        namen[d.id] = str(s.get("name") or "").strip()
        preise[d.id] = s.get("price")
    return namen, preise


def _personen(db, shop_id: str) -> dict:
    return {d.id: str((d.to_dict() or {}).get("name") or "").strip() for d in db.collection("staff").where("shopId", "==", shop_id).stream()}


def _eintrag_fuers_team(kunde_id: str, daten: dict) -> dict:
    from app.libs.laeden import kunde_fuers_team

    return kunde_fuers_team(kunde_id, daten)


def liste(db, shop_id: str, mit_zahlen: bool, jetzt: Optional[datetime] = None) -> list[dict]:
    """Alle Einträge des Ladens; mit_zahlen (Tarif mit Kartei) samt Kennzahlen. Liest alle Termine des Ladens einmal."""
    jetzt = jetzt or _jetzt()
    kunden = [(d.id, d.to_dict() or {}) for d in db.collection(KUNDEN).where("shopId", "==", shop_id).stream()]
    if not mit_zahlen:
        return [_eintrag_fuers_team(kid, k) for kid, k in kunden]
    # Termin → Eintrag: über die ID des Eintrags (customerId, kundeId) und über das verbundene Konto
    zu_eintrag: dict[str, str] = {}
    for kid, k in kunden:
        zu_eintrag[kid] = kid
        if k.get("userId"):
            zu_eintrag.setdefault(k["userId"], kid)
    termine: dict[str, dict[str, dict]] = {kid: {} for kid, _ in kunden}
    for d in db.collection("appointments").where("shopId", "==", shop_id).stream():
        a = d.to_dict() or {}
        # Zugeordnet (kundeId) geht vor: Am Tresen umgehängt zählt der Termin nur noch beim neuen Eintrag
        schluessel = a.get("kundeId") or a.get("customerId")
        kid = zu_eintrag.get(schluessel) if isinstance(schluessel, str) else None
        if kid:
            termine[kid][d.id] = a
    namen, preise = _leistungen(db, shop_id)
    personen = _personen(db, shop_id)
    ergebnis = []
    for kid, k in kunden:
        eintrag = _eintrag_fuers_team(kid, k)
        eintrag["hatNotiz"] = bool(str(k.get("notiz") or "").strip())
        eintrag["kennzahlen"] = kennzahlen(list(termine[kid].values()), preise, namen, personen, jetzt)
        ergebnis.append(eintrag)
    return ergebnis


def eintrag_des_ladens(db, shop_id: str, kunde_id: str) -> tuple:
    """(Referenz, Daten) des Eintrags, wenn er zu diesem Laden gehört, sonst 404"""
    ref = db.collection(KUNDEN).document(kunde_id)
    snap = ref.get()
    kunde = (snap.to_dict() or {}) if snap.exists else {}
    if not snap.exists or kunde.get("shopId") != shop_id:
        raise KarteiFehler(404, merke("Diesen Kunden gibt es nicht mehr."))
    return ref, kunde


def karte(db, shop_id: str, kunde_id: str, mit_kartei: bool, jetzt: Optional[datetime] = None) -> dict:
    """Kundenseite: Eintrag, Termine (neueste zuerst) mit Preis; mit Kartei dazu Kennzahlen und Notizen"""
    jetzt = jetzt or _jetzt()
    _, kunde = eintrag_des_ladens(db, shop_id, kunde_id)
    namen, preise = _leistungen(db, shop_id)
    personen = _personen(db, shop_id)
    alle = tk.termine_von(db, shop_id, kunde_id, kunde)
    besuchsnotizen = kunde.get("besuchsnotizen") if mit_kartei and isinstance(kunde.get("besuchsnotizen"), dict) else {}
    termine = []
    for tid, a in alle[:VERLAUF]:
        notiz = besuchsnotizen.get(tid) if isinstance(besuchsnotizen.get(tid), dict) else {}
        termine.append({
            "id": tid, "startTime": a.get("startTime"), "endTime": a.get("endTime"), "status": a.get("status"),
            "type": a.get("type"), "source": a.get("source"), "referenceCode": a.get("referenceCode"),
            "noShow": bool(a.get("noShow")), "leistung": namen.get(a.get("serviceId"), ""),
            "person": personen.get(a.get("staffId"), ""), "preis": preis(a, preise),
            "zugeordnet": a.get("kundeId") == kunde_id,
            **({"notiz": str(notiz.get("text") or ""), "notizGeaendert": notiz.get("geaendert")} if notiz else {}),
        })
    ergebnis = {"kunde": _eintrag_fuers_team(kunde_id, kunde), "termine": termine, "kartei": mit_kartei}
    if mit_kartei:
        ergebnis["kunde"].update(notiz=str(kunde.get("notiz") or ""), notizGeaendert=kunde.get("notizGeaendert"))
        ergebnis["kennzahlen"] = kennzahlen([a for _, a in alle], preise, namen, personen, jetzt)
    return ergebnis


def _text(wert, grenze: int, fehler) -> str:
    if wert is None:
        return ""
    if not isinstance(wert, str):
        raise KarteiFehler(400, fehler)
    text = wert.strip()
    if len(text) > grenze:
        raise KarteiFehler(400, fehler)
    return text


def aendern(db, shop_id: str, kunde_id: str, aenderung: dict, mit_kartei: bool, jetzt: Optional[datetime] = None) -> dict:
    """Name, Telefon, E-Mail (Inhaber und Team) und mit Kartei die Notiz fürs Team. Die E-Mail eines verbundenen
    Kontos bleibt: Sie gehört dem Konto."""
    jetzt = jetzt or _jetzt()
    ref, kunde = eintrag_des_ladens(db, shop_id, kunde_id)
    erlaubt = {"name", "phone", "email", "notiz"}
    if not isinstance(aenderung, dict) or not aenderung or set(aenderung) - erlaubt:
        raise KarteiFehler(400, merke("Das lässt sich hier nicht ändern."))
    update: dict = {}
    if "name" in aenderung:
        name = " ".join(_text(aenderung["name"], NAME_MAX, merke("Bitte gib einen Namen ein.")).split())
        if not name:
            raise KarteiFehler(400, merke("Bitte gib einen Namen ein."))
        update["name"] = name
    if "phone" in aenderung:
        telefon = _text(aenderung["phone"], KONTAKT_MAX, merke("Diese Telefonnummer ist zu lang."))
        if telefon and not t.e164(telefon):
            raise KarteiFehler(400, merke("Diese Telefonnummer können wir nicht lesen."))
        update["phone"] = telefon
    if "email" in aenderung:
        if kunde.get("userId"):
            raise KarteiFehler(400, merke("Die E-Mail-Adresse gehört zum verbundenen Konto und lässt sich hier nicht ändern."))
        email = _text(aenderung["email"], KONTAKT_MAX, merke("Diese E-Mail-Adresse ist zu lang.")).lower()
        if email and ("@" not in email or " " in email):
            raise KarteiFehler(400, merke("Bitte gib eine gültige E-Mail-Adresse ein."))
        update["email"] = email
    if update:
        update["updatedAt"] = jetzt
    if "notiz" in aenderung:
        if not mit_kartei:
            raise KarteiFehler(403, merke("Notizen gehören zum Tarif Solo."))
        update["notiz"] = _text(aenderung["notiz"], NOTIZ_MAX, merke("Die Notiz ist zu lang (höchstens 2000 Zeichen)."))
        update["notizGeaendert"] = jetzt
    ref.update(update)
    return {**kunde, **update}


def besuchsnotiz(db, shop_id: str, kunde_id: str, termin_id: str, text, jetzt: Optional[datetime] = None) -> dict:
    """Notiz zu einem Besuch (z. B. Farbrezeptur). Nur für Termine dieser Person; leerer Text löscht die Notiz."""
    from app import store

    jetzt = jetzt or _jetzt()
    ref, kunde = eintrag_des_ladens(db, shop_id, kunde_id)
    if termin_id not in {tid for tid, _ in tk.termine_von(db, shop_id, kunde_id, kunde)}:
        raise KarteiFehler(404, merke("Diesen Termin gibt es bei diesem Kunden nicht."))
    inhalt = _text(text, NOTIZ_MAX, merke("Die Notiz ist zu lang (höchstens 2000 Zeichen)."))
    if inhalt:
        ref.update({f"besuchsnotizen.{termin_id}": {"text": inhalt, "geaendert": jetzt}})
        return {"text": inhalt, "geaendert": jetzt}
    ref.update({f"besuchsnotizen.{termin_id}": store.DELETE_FIELD})
    return {}


def zuordnung_pruefen(db, shop_id: str, kunde_id) -> None:
    """kundeId an einem Termin (Tresen: „Kunde zuordnen“): leer zum Lösen oder ein Eintrag dieses Ladens"""
    if kunde_id in (None, ""):
        return
    if not isinstance(kunde_id, str) or not t.ID_RE.fullmatch(kunde_id):
        raise KarteiFehler(400, merke("Diesen Kunden gibt es nicht mehr."))
    snap = db.collection(KUNDEN).document(kunde_id).get()
    if not snap.exists or (snap.to_dict() or {}).get("shopId") != shop_id:
        raise KarteiFehler(400, merke("Diesen Kunden gibt es nicht mehr."))
