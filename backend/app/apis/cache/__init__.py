"""
Zwischenspeicher für freie Zeiten (app/apis/available_timeslots), als JSON-Dateien über databutton.storage.

Laden, Tag und Person stehen im Namen jedes Eintrags (timeslots_<laden>_<tag>_<person>_<anfrage>), damit
das Leeren nach einer Buchung nur die Namen durchsehen muss. Vorher lud es dafür jeden Eintrag und schrieb
bei jedem Aufruf eine Protokolldatei cache_invalidation_log_<zeit>, die nie gelöscht wurde.
"""
import databutton as db
import json
from hashlib import md5
from typing import Optional, Dict
import time as time_module
from datetime import date as date_type, datetime
from fastapi import APIRouter

# Leerer Router, damit das Modul als API-Modul erkannt wird
router = APIRouter()

# Cache-Gültigkeitsdauer in Sekunden (4 Stunden)
# Längere Cache-Dauer, da Zeitslotverfügbarkeit nur durch neue Buchungen, Stornierungen
# oder Änderungen an Arbeitszeiten beeinflusst wird
CACHE_TTL = 4 * 60 * 60

PREFIX = "timeslots_"
# Alte Einträge (Name nur aus der Prüfsumme) und Protokolldateien – werden einmal weggeräumt
LEGACY_PREFIXES = ("timeslot_cache_", "cache_invalidation_log_")

_last_cleanup: Optional[date_type] = None


def _short(value: Optional[str]) -> str:
    """Kurzform einer ID für Dateinamen (IDs dürfen Zeichen enthalten, die im Namen stören)."""
    return md5((value or "").encode()).hexdigest()[:10]


def _day(date: str) -> str:
    """"2026-10-21T12:00:00+00:00" -> "2026-10-21" """
    return (date or "").split("T")[0]


def _prefix(shop_id: str, date: str, staff_id: Optional[str] = None) -> str:
    prefix = f"{PREFIX}{_short(shop_id)}_{_day(date)}_"
    return prefix + f"{_short(staff_id)}_" if staff_id is not None else prefix


def get_cache_key(request: dict) -> str:
    """Eindeutiger Schlüssel einer Anfrage: Laden, Tag und Person lesbar vorn, dahinter eine Prüfsumme über alles"""
    request_copy = dict(request) if isinstance(request, dict) else {}
    request_copy.pop('force_refresh', None)  # mit und ohne force_refresh derselbe Eintrag
    sorted_params = json.dumps(request_copy, sort_keys=True, default=str)
    prefix = _prefix(str(request_copy.get('shop_id') or ''), str(request_copy.get('date') or ''), request_copy.get('staff_id'))
    return prefix + md5(sorted_params.encode()).hexdigest()


def get_from_cache(cache_key: str) -> Optional[Dict]:
    """Holt Daten aus dem Cache, falls vorhanden und gültig"""
    try:
        try:
            cache_data = db.storage.json.get(cache_key)
        except FileNotFoundError:
            return None
        if not cache_data:
            return None
        if time_module.time() - cache_data.get('timestamp', 0) > CACHE_TTL:
            return None
        if 'data' not in cache_data:
            print(f"Invalid cache format for {cache_key} - missing 'data' field")
            return None
        return cache_data
    except Exception as e:
        print(f"Error reading from cache: {str(e)}")
        return None


def save_to_cache(cache_key: str, data: dict, metadata: dict = None) -> None:
    """Speichert Daten im Cache mit aktuellem Zeitstempel"""
    try:
        current_time = time_module.time()
        cache_entry = {
            'timestamp': current_time,
            'created_at': datetime.fromtimestamp(current_time).strftime('%Y-%m-%d %H:%M:%S'),
            'data': data,
            'metadata': metadata or {}
        }
        db.storage.json.put(cache_key, cache_entry)
    except Exception as e:
        # Cache-Fehler sollten nicht die Hauptfunktion beeinträchtigen
        print(f"Error saving to cache: {str(e)}")


def _cleanup(names: list) -> None:
    """Einmal am Tag: alte Einträge, Protokolldateien und vergangene Tage löschen (nur nach Namen)."""
    global _last_cleanup
    today = datetime.now().date()
    if _last_cleanup == today:
        return
    _last_cleanup = today
    removed = 0
    for name in names:
        stale = name.startswith(LEGACY_PREFIXES)
        if not stale and name.startswith(PREFIX):
            parts = name[len(PREFIX):].split("_")
            stale = len(parts) > 1 and parts[1] < today.isoformat()
        if stale:
            db.storage.json.delete(name)
            removed += 1
    if removed:
        print(f"Zwischenspeicher: {removed} alte Einträge gelöscht")


def invalidate_shop_date_cache(shop_id: str, date: str, staff_id: Optional[str] = None, verbose: bool = True) -> int:
    """Löscht alle Einträge für Laden und Tag (mit staff_id nur die dieser Person). Gibt die Anzahl zurück.

    Args:
        shop_id: Laden
        date: Tag als ISO-Text (YYYY-MM-DD, eine Uhrzeit dahinter wird ignoriert)
        staff_id: nur die Einträge dieser Person
    """
    try:
        names = [entry.name for entry in db.storage.json.list()]
        _cleanup(names)
        prefix = _prefix(shop_id, date, staff_id)
        deleted_count = 0
        for name in names:
            if name.startswith(prefix):
                db.storage.json.delete(name)
                deleted_count += 1
        if verbose:
            print(f"Zwischenspeicher geleert: shop={shop_id}, date={_day(date)}, staff={staff_id or 'all'}, {deleted_count} Einträge")
        return deleted_count
    except Exception as e:
        # Fehler beim Leeren dürfen die Anwendung nicht anhalten
        print(f"Error during cache invalidation: {str(e)}")
        return 0
