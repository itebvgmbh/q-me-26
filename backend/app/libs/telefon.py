"""Telefon-Assistent ohne Datenbank: Rufnummern, Zeiten zum Vorlesen, Platz-Kennung, Öffnungszeiten.

Die Schnittstelle für die Sprach-KI steht in app/apis/telefon. Getestet in tests/test_telefon.py.
"""

import base64
import hashlib
import hmac
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Sequence, Tuple
from xml.sax.saxutils import escape

WOCHENTAGE = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")
MONATE = ("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember")
# Firestore zählt die Wochentage ab Sonntag = 0, die Ansage beginnt mit Montag
FIRESTORE_TAGE = (1, 2, 3, 4, 5, 6, 0)

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
# Rufnummer → Laden: telefon_leitungen/{+49…} = {shopId, nummer}; nur das Backend liest und schreibt (Betreiber-Bereich)
LEITUNGEN = "telefon_leitungen"
# Stand je Laden und laufende Anrufe: app/libs/telefon_laeden.py
LAEDEN = "telefon_laeden"
ANRUFE = "telefon_anrufe"
FREIMINUTEN = 30  # Testminuten: so viel hat ein Laden frei, bevor er den Zusatz bucht
ANRUF_ZU_ENDE = ("completed", "busy", "failed", "no-answer", "canceled")
ANNEHMEN, ANSAGE = "annehmen", "ansage"

# Zusatz (Stefan, 02.11.2026): 29 € netto im Monat mit 100 Minuten, danach 0,20 € je Minute. Gezählt wird sekundengenau,
# die Summe des Abrechnungsmonats wird auf volle Minuten aufgerundet. Kostendeckel je Laden, ohne Angabe 59 €.
# Gleich wie frontend/src/utils/telefon-assistent.ts und deploy/stripe-setup.py (Preise bei Stripe).
GRUNDPREIS_CENT = 2900
INKLUSIV_MINUTEN = 100
MINUTENPREIS_CENT = 20
DECKEL_STANDARD = 59  # Euro netto im Monat, Grundpreis eingerechnet
DECKEL_MIN, DECKEL_MAX = 29, 500
WARNSTUFEN = (80, 100)  # Prozent: Mail an den Inhaber und Hinweis auf seinen Seiten
# Stand des Stripe-Abos für den Zusatz (zusatz.status in telefon_laeden)
GEBUCHT = ("active", "trialing")
ZAHLUNG_OFFEN = ("past_due", "unpaid", "incomplete")
# Warum der Assistent nicht abnimmt. Der Anrufer hört immer dieselbe Ansage, der Grund ist für den Inhaber.
GESPERRT, AUS, NICHT_FREI, TEST_VERBRAUCHT, DECKEL, GEKUENDIGT, ZAHLUNG = (
    "gesperrt", "aus", "nicht_frei", "test_verbraucht", "deckel", "gekuendigt", "zahlung",
)
MAX_GENANNT = 3  # so viele Leistungen nennt die Begrüßung, mehr hört am Telefon niemand zu Ende
STOERUNG = "Das ist eine automatische Ansage. Gerade ist niemand erreichbar. Bitte versuchen Sie es später noch einmal. Auf Wiederhören."


def e164(nummer) -> Optional[str]:
    """Rufnummer in einer Schreibweise: '030 123456', '+49 (0)30 123456', '004930…', '4930…' → '+4930123456'.

    Unterdrückte oder unlesbare Nummern ('anonymous', '{{system__caller_id}}', leer) → None.
    Ohne + und ohne führende 0 gilt die Nummer als schon mit Ländervorwahl (so liefern sie manche Anbieter).
    """
    if not nummer:
        return None
    text = str(nummer).strip().replace("(0)", "")
    digits = re.sub(r"\D", "", text)
    if not digits:
        return None
    if not text.startswith("+"):
        if digits.startswith("00"):
            digits = digits[2:]
        elif digits.startswith("0"):
            digits = "49" + digits[1:]
    if not 8 <= len(digits) <= 15 or digits.startswith("0"):
        return None
    return "+" + digits


def twilio_signatur_ok(url: str, felder: dict, signatur: Optional[str], token: str) -> bool:
    """X-Twilio-Signature: HMAC-SHA1 über die Adresse und die Formularfelder, sortiert nach Namen"""
    if not signatur:
        return False
    daten = url + "".join(name + str(felder[name]) for name in sorted(felder))
    erwartet = base64.b64encode(hmac.new(token.encode(), daten.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(erwartet, signatur)


def minuten(sekunden) -> int:
    """Gesprächszeit in Minuten, aufgerundet: 61 Sekunden sind 2 Minuten"""
    return max(0, -(-int(sekunden or 0) // 60))


def deckel_von(daten: dict) -> int:
    """Kostendeckel des Ladens in Euro netto im Monat"""
    try:
        deckel = int(daten.get("deckel") or DECKEL_STANDARD)
    except (TypeError, ValueError):
        deckel = DECKEL_STANDARD
    return min(DECKEL_MAX, max(DECKEL_MIN, deckel))


def deckel_minuten(deckel: int) -> int:
    """So viele Minuten im Monat passen unter den Deckel: 59 € → 100 + 30 € / 0,20 € = 250"""
    return INKLUSIV_MINUTEN + max(0, int(deckel) * 100 - GRUNDPREIS_CENT) // MINUTENPREIS_CENT


def kosten_cent(minuten_im_monat: int) -> int:
    """Netto für einen Monat mit dem Zusatz"""
    return GRUNDPREIS_CENT + max(0, int(minuten_im_monat) - INKLUSIV_MINUTEN) * MINUTENPREIS_CENT


def zusatz(daten: dict) -> dict:
    """Stand des gebuchten Zusatzes (Stripe-Abo), leer, wenn nie gebucht"""
    return daten.get("zusatz") or {}


def gebucht(daten: dict) -> bool:
    return zusatz(daten).get("status") in GEBUCHT


def _zeitstempel(jetzt: Optional[datetime]) -> int:
    return int((jetzt or datetime.now(timezone.utc)).timestamp())


def periode_sekunden(daten: dict, jetzt: Optional[datetime] = None) -> int:
    """Gesprächszeit im laufenden Abrechnungsmonat des Zusatzes. Der Zähler gehört zu dem Monat, der in periode steht;
    hat Stripe schon den nächsten gemeldet (oder ist der Monat vorbei), fängt es bei 0 an."""
    z = zusatz(daten)
    start, ende = z.get("periodeStart"), z.get("periodeEnde")
    if not start or daten.get("periode") != start or (ende and _zeitstempel(jetzt) >= int(ende)):
        return 0
    return int(daten.get("periodeSekunden") or 0)


def abzurechnen(daten: dict, jetzt: Optional[datetime] = None) -> int:
    """Minuten, die Stripe für diesen Monat bekommt: aufgerundet, höchstens bis zum Deckel. Was ein Gespräch über den
    Deckel hinaus dauert, zahlt der Laden nicht."""
    return min(minuten(periode_sekunden(daten, jetzt)), deckel_minuten(deckel_von(daten)))


def testminuten(daten: dict) -> int:
    frei = daten.get("freiminuten")
    return FREIMINUTEN if frei is None else int(frei)


def grund(daten: dict, gesperrt: bool, jetzt: Optional[datetime] = None) -> Optional[str]:
    """Warum der Assistent nicht abnimmt, oder None, wenn er abnimmt. daten: Eintrag des Ladens aus telefon_laeden,
    gesperrt: der ganze Laden ist gesperrt (Betreiber-Bereich)."""
    if gesperrt or daten.get("gesperrt"):
        return GESPERRT
    if not daten.get("aktiv"):
        return AUS
    status = zusatz(daten).get("status")
    if status in GEBUCHT:
        return DECKEL if periode_sekunden(daten, jetzt) >= deckel_minuten(deckel_von(daten)) * 60 else None
    if status in ZAHLUNG_OFFEN:
        return ZAHLUNG
    if status:  # canceled, incomplete_expired, paused: gebucht war er, jetzt nicht mehr
        return GEKUENDIGT
    if not daten.get("freigegeben"):
        return NICHT_FREI
    return TEST_VERBRAUCHT if int(daten.get("sekunden") or 0) >= testminuten(daten) * 60 else None


def entscheiden(daten: dict, gesperrt: bool, jetzt: Optional[datetime] = None) -> str:
    """Nimmt die KI ab oder hört der Anrufer nur eine kurze Ansage?"""
    return ANNEHMEN if grund(daten, gesperrt, jetzt) is None else ANSAGE


def verbrauch(daten: dict, jetzt: Optional[datetime] = None) -> dict:
    """Was der Inhaber sieht und wann er gewarnt wird: Testminuten oder Minuten des Monats bis zum Deckel"""
    if zusatz(daten).get("status"):
        sekunden = periode_sekunden(daten, jetzt)
        grenze = deckel_minuten(deckel_von(daten))
        return {"art": "zusatz", "minuten": minuten(sekunden), "grenze": grenze, "anteil": sekunden / (grenze * 60),
                "kostenCent": kosten_cent(abzurechnen(daten, jetzt)), "deckel": deckel_von(daten)}
    grenze = testminuten(daten)
    sekunden = int(daten.get("sekunden") or 0)
    return {"art": "test", "minuten": minuten(sekunden), "grenze": grenze, "anteil": sekunden / (grenze * 60) if grenze else 1.0}


def warnstufe(anteil: float) -> int:
    """0, 80 oder 100 (Prozent): ab welcher Stufe der Inhaber Bescheid bekommt"""
    return next((stufe for stufe in reversed(WARNSTUFEN) if anteil >= stufe / 100), 0)


def begruessung(name: str, leistungen: Sequence[str] = (), termine: bool = True) -> str:
    """Erste Worte des Assistenten: dass er eine KI ist (Art. 50 Abs. 1 KI-Verordnung) und gleich, was man buchen kann"""
    kopf = f"Hallo, hier ist der KI-Assistent von {name}."
    if not termine:
        return f"{kopf} Ich kann Ihnen eine Nummer für heute ziehen und die Wartezeit nennen. Was darf es sein?"
    if not leistungen:
        return f"{kopf} Möchten Sie einen Termin?"
    if len(leistungen) == 1:
        return f"{kopf} Möchten Sie einen Termin für {leistungen[0]}?"
    genannt = list(leistungen[:MAX_GENANNT])
    auswahl = f"{', '.join(genannt[:-1])} oder {genannt[-1]}"
    if len(leistungen) > MAX_GENANNT:
        return f"{kopf} Möchten Sie einen Termin, zum Beispiel für {auswahl}?"
    return f"{kopf} Möchten Sie einen Termin für {auswahl}?"


def ansage_text(name: str) -> str:
    return f"Das ist eine automatische Ansage von {name}. Gerade ist niemand erreichbar. Termine können Sie online auf dranzeit punkt de buchen. Auf Wiederhören."


def twiml_ansage(text: str) -> str:
    return f'<?xml version="1.0" encoding="UTF-8"?><Response><Say language="de-DE">{escape(text)}</Say><Hangup/></Response>'


def twiml_abweisen() -> str:
    """Twilio nimmt nicht ab und berechnet nichts"""
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>'


def tag_text(day: date, heute: date) -> str:
    """'heute', 'morgen', 'übermorgen', sonst 'Donnerstag, 29. Oktober'"""
    delta = (day - heute).days
    if delta == 0:
        return "heute"
    if delta == 1:
        return "morgen"
    if delta == 2:
        return "übermorgen"
    return f"{WOCHENTAGE[day.weekday()]}, {day.day}. {MONATE[day.month - 1]}"


def am_tag(day: date, heute: date) -> str:
    """Satzanfang zu einem Tag: 'Heute', 'Morgen', 'Am Samstag, 7. November'"""
    text = tag_text(day, heute)
    return f"Am {text}" if "," in text else text.capitalize()


def laden_offen(shop: dict, day: date) -> bool:
    """Hat der Laden an diesem Tag offen? Ohne Angabe je Wochentag: ja"""
    by_day = shop.get("businessHoursByDay") or []
    dow = FIRESTORE_TAGE[day.weekday()]
    entry = next((d for d in by_day if str(d.get("dayOfWeek")) == str(dow)), None) if isinstance(by_day, list) else None
    return bool(entry.get("isOpen")) if entry else True


def arbeitet_am(person: dict, day: date) -> bool:
    """Steht der Tag in den Arbeitszeiten der Person? Ohne Eintrag gelten die Standardzeiten, dann: ja"""
    stunden = person.get("workingHours")
    if not stunden:
        return True
    dow = FIRESTORE_TAGE[day.weekday()]
    return any(h.get("dayOfWeek") == dow and h.get("isWorking", True) for h in stunden)


def uhr(stunde: int, minute: int) -> str:
    """'14 Uhr 30', '9 Uhr' – so, wie man es sagt. Ohne Doppelpunkt: Vapi macht vor der Stimme aus '14:30' sonst
    '14.30', und die liest Ziffern vor (Testanruf 27.10.2026)."""
    return f"{stunde} Uhr" + (f" {minute}" if minute else "")


def uhrzeit(t: datetime) -> str:
    return uhr(t.hour, t.minute)


def zeit_text(start: datetime, jetzt: datetime) -> str:
    """'morgen um 14 Uhr 30' (beides Ortszeit)"""
    return f"{tag_text(start.date(), jetzt.date())} um {uhrzeit(start)}"


def minuten_text(minuten: int) -> str:
    if minuten <= 1:
        return "eine Minute"
    if minuten < 60:
        return f"{minuten} Minuten"
    stunden, rest = divmod(minuten, 60)
    erst = "eine Stunde" if stunden == 1 else f"{stunden} Stunden"
    return erst if rest == 0 else f"{erst} und {rest} Minuten"


def platz_kennung(staff_id: str, start: datetime) -> str:
    """Ein Platz als ein Text, den der Assistent unverändert an /telefon/buchen zurückgibt: 'robin@2026-10-29T14:30'"""
    return f"{staff_id}@{start:%Y-%m-%dT%H:%M}"


def platz_aus_kennung(kennung: str) -> Optional[Tuple[str, datetime]]:
    """Gegenstück zu platz_kennung: (Person, Beginn als Ortszeit ohne Zeitzone) oder None"""
    staff_id, _, start = str(kennung or "").strip().partition("@")
    if not ID_RE.fullmatch(staff_id):
        return None
    try:
        when = datetime.strptime(start, "%Y-%m-%dT%H:%M")
    except ValueError:
        return None
    return staff_id, when


def ab_zeitpunkt(text: Optional[str]) -> Optional[datetime]:
    """Wunsch 'nicht vor': '2026-10-29' (ab Tagesbeginn) oder '2026-10-29T15:00' / '2026-10-29 15:00'; sonst None"""
    text = str(text or "").strip().replace(" ", "T", 1)
    for muster in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, muster)
        except ValueError:
            continue
    return None


def _hhmm(value) -> Optional[Tuple[int, int]]:
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*", str(value or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


def _spanne(von, bis) -> Optional[str]:
    """'9 bis 18 Uhr', '9 Uhr 30 bis 18 Uhr' aus '09:00' und '18:00'; unlesbar → None"""
    a, b = _hhmm(von), _hhmm(bis)
    if not a or not b:
        return None
    if a[1] == 0 and b[1] == 0:
        return f"{a[0]} bis {b[0]} Uhr"
    return f"{uhr(*a)} bis {uhr(*b)}"


def oeffnungszeiten(shop: dict) -> list:
    """Öffnungszeiten je Wochentag ab Montag zum Vorlesen, z. B. 'Montag 9 bis 18 Uhr, Pause 13 bis 14 Uhr'.

    Gleiche Felder wie die Buchung (booking-rules.ts, shopWindowForDay): businessHoursByDay, sonst das alte
    Textformat '9:00-18:00' für jeden Tag. Ohne Angabe eine leere Liste.
    """
    by_day = shop.get("businessHoursByDay") or []
    if isinstance(by_day, list) and by_day:
        lines = []
        for name, dow in zip(WOCHENTAGE, FIRESTORE_TAGE):
            entry = next((d for d in by_day if str(d.get("dayOfWeek")) == str(dow)), None)
            offen = _spanne(entry.get("openTime"), entry.get("closeTime")) if entry and entry.get("isOpen") else None
            if not offen:
                lines.append(f"{name} geschlossen")
                continue
            pausen = [p for p in (_spanne(b.get("startTime"), b.get("endTime")) for b in entry.get("breaks") or []) if p]
            lines.append(f"{name} {offen}" + (f", Pause {', '.join(pausen)}" if pausen else ""))
        return lines
    legacy = re.fullmatch(r"\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*", str(shop.get("businessHours") or ""))
    if legacy:
        return [f"täglich {_spanne(legacy.group(1), legacy.group(2))}"]
    return []


def adresse(shop: dict) -> str:
    ort = " ".join(str(shop.get(k) or "").strip() for k in ("postalCode", "city")).strip()
    teile = [str(shop.get("street") or "").strip(), ort]
    text = ", ".join(t for t in teile if t)
    return text or str(shop.get("address") or "").strip()


def ueberschneidet(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def minuten_bis(start: datetime, jetzt: datetime) -> int:
    """Ganze Minuten bis start, aufgerundet, nie negativ"""
    sekunden = (start - jetzt) / timedelta(seconds=1)
    return max(0, int(-(-sekunden // 60)))
