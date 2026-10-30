"""Telefon-Assistent ohne Datenbank: Rufnummern, Zeiten zum Vorlesen, Platz-Kennung, Öffnungszeiten.

Die Schnittstelle für die Sprach-KI steht in app/apis/telefon. Getestet in tests/test_telefon.py.
"""

import re
from datetime import date, datetime, timedelta
from typing import Optional, Tuple

WOCHENTAGE = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")
MONATE = ("Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember")
# Firestore zählt die Wochentage ab Sonntag = 0, die Ansage beginnt mit Montag
FIRESTORE_TAGE = (1, 2, 3, 4, 5, 6, 0)

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
# Rufnummer → Laden: telefon_leitungen/{+49…} = {shopId, nummer}; nur das Backend liest und schreibt (Betreiber-Bereich)
LEITUNGEN = "telefon_leitungen"


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
