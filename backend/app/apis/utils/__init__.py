from datetime import datetime
from typing import Optional, Tuple, Union, Dict, Any
from fastapi import APIRouter

# Leerer Router, damit das Modul als API-Modul erkannt wird
router = APIRouter()

def _local_naive(dt: datetime) -> datetime:
    """Zeit mit Zeitzone -> naive Ortszeit des Servers (TZ=Europe/Berlin), ohne Zeitzone unverändert."""
    return dt.astimezone().replace(tzinfo=None) if dt.tzinfo is not None else dt


def convert_timestamp_to_datetime(timestamp: Union[Dict[str, Any], datetime, Any]) -> Optional[datetime]:
    """
    Wandelt Firestore-Zeitstempel, datetime, ISO-Strings und {seconds}-Dicts in ein datetime um.

    Ergebnis ist immer NAIVE ORTSZEIT des Servers – wie datetime.now(), die Arbeitszeiten ("09:00")
    und die freien Zeiten aus available_timeslots. Vorher wurde bei Firestore-Zeitstempeln (UTC) die
    Zeitzone nur abgeschnitten statt umgerechnet: Seit der Server in deutscher Zeit läuft, lagen damit
    alle Termine für die Angebotsprüfung 1–2 Stunden zu früh (13:15 wurde zu 11:15).
    Strings ohne Zeitzone (so speichert die Angebotsprüfung earlierStartTime) gelten als Ortszeit.
    Gibt None zurück, wenn das Format unbekannt ist.
    """
    if timestamp is None:
        return None
    try:
        # Auch DatetimeWithNanoseconds von Firestore ist ein datetime (mit UTC)
        if isinstance(timestamp, datetime):
            return _local_naive(timestamp)

        if isinstance(timestamp, str):
            text = timestamp.strip()
            if text.endswith('Z'):
                text = text[:-1] + '+00:00'
            if 'T' not in text and ' ' in text:
                text = text.replace(' ', 'T', 1)
            try:
                return _local_naive(datetime.fromisoformat(text))
            except ValueError:
                pass
            try:
                from dateutil import parser
                return _local_naive(parser.parse(timestamp))
            except Exception:
                pass
            for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d"):
                try:
                    return datetime.strptime(timestamp.strip(), fmt)
                except ValueError:
                    continue
            print(f"Unrecognized timestamp string: {timestamp[:100]}")
            return None

        # Dict aus JSON ({seconds, nanoseconds}) oder Objekte mit seconds/_seconds
        if isinstance(timestamp, dict):
            seconds = timestamp.get('seconds', timestamp.get('_seconds'))
            nanos = timestamp.get('nanoseconds', timestamp.get('_nanoseconds', 0)) or 0
        else:
            seconds = getattr(timestamp, 'seconds', getattr(timestamp, '_seconds', None))
            nanos = getattr(timestamp, 'nanoseconds', getattr(timestamp, '_nanoseconds', 0)) or 0
        if seconds is not None:
            return datetime.fromtimestamp(float(seconds) + float(nanos) / 1e9)
        if hasattr(timestamp, 'timestamp'):
            return datetime.fromtimestamp(timestamp.timestamp())

        print(f"Unrecognized timestamp format: {type(timestamp).__name__} - {str(timestamp)[:100]}")
        return None
    except Exception as e:
        print(f"Error in convert_timestamp_to_datetime ({type(timestamp).__name__}): {e}")
        return None

def datetime_to_minutes(dt: datetime) -> int:
    """
    Konvertiert ein datetime-Objekt in Minuten seit Mitternacht
    """
    return dt.hour * 60 + dt.minute

def minutes_to_datetime(minutes: int, base_date: datetime) -> datetime:
    """
    Konvertiert Minuten seit Mitternacht zurück in ein datetime-Objekt
    verwendet base_date für Datum, Jahr, Monat und Tag
    """
    hour = minutes // 60
    minute = minutes % 60
    
    return datetime(
        year=base_date.year,
        month=base_date.month,
        day=base_date.day,
        hour=hour,
        minute=minute
    )

def parse_time_string(time_str: str) -> Tuple[int, int]:
    """
    Konvertiert einen Zeitstring (z.B. '09:30') in Stunden und Minuten
    """
    parts = time_str.strip().split(':')
    hour = int(parts[0])
    minute = int(parts[1]) if len(parts) > 1 else 0
    return hour, minute