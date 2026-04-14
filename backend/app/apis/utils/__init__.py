from datetime import datetime
from typing import Optional, Tuple, Union, Dict, Any
from fastapi import APIRouter

# Leerer Router, damit das Modul als API-Modul erkannt wird
router = APIRouter()

def convert_timestamp_to_datetime(timestamp: Union[Dict[str, Any], datetime, Any]) -> Optional[datetime]:
    """
    Konvertiert verschiedene Timestamp-Formate in ein datetime-Objekt.
    Unterstützt:
    - Firestore-Timestamp als Dict mit 'seconds'-Schlüssel
    - Firestore-Timestamp-Objekte mit seconds-Attribut
    - Python datetime-Objekte
    - Firestore DatetimeWithNanoseconds-Objekte
    - String-Timestamps (ISO-Format)
    
    Returns None für nicht erkannte Formate.
    """
    try:
        # Handling None values
        if timestamp is None:
            return None
            
        # Log the timestamp type for debugging
        timestamp_type = type(timestamp).__name__
        
        # If it's already a datetime object, just return it (normalizing timezone if needed)
        if isinstance(timestamp, datetime):
            if timestamp.tzinfo is not None:
                return timestamp.replace(tzinfo=None)
            return timestamp
        
        # Handle string timestamps first for better reliability
        if isinstance(timestamp, str):
            try:
                # Handle ISO format strings
                clean_timestamp = timestamp.rstrip('Z')
                
                # Remove any timezone info for consistent parsing
                if '+' in clean_timestamp:
                    clean_timestamp = clean_timestamp.split('+')[0]
                
                # Try with 'T' format
                if 'T' in clean_timestamp:
                    parsed_dt = datetime.fromisoformat(clean_timestamp)
                    if parsed_dt.tzinfo is not None:
                        parsed_dt = parsed_dt.replace(tzinfo=None)
                    return parsed_dt
                else:
                    # Try to replace space with T for cases like "2023-01-01 12:00:00"
                    parsed_dt = datetime.fromisoformat(clean_timestamp.replace(' ', 'T'))
                    if parsed_dt.tzinfo is not None:
                        parsed_dt = parsed_dt.replace(tzinfo=None)
                    return parsed_dt
            except ValueError as e:
                print(f"First attempt parsing string timestamp '{timestamp}' failed: {str(e)}")
                
                # Second attempt with dateutil if available
                try:
                    from dateutil import parser
                    parsed_dt = parser.parse(timestamp)
                    if parsed_dt.tzinfo is not None:
                        parsed_dt = parsed_dt.replace(tzinfo=None)
                    return parsed_dt
                except (ImportError, ValueError) as e2:
                    print(f"Second attempt parsing string timestamp failed: {str(e2)}")
                    
                    # Last resort for string parsing
                    try:
                        # Try common date formats manually
                        formats = [
                            "%Y-%m-%dT%H:%M:%S",
                            "%Y-%m-%d %H:%M:%S",
                            "%Y/%m/%d %H:%M:%S",
                            "%d.%m.%Y %H:%M:%S",
                            "%Y-%m-%d",
                        ]
                        
                        for fmt in formats:
                            try:
                                return datetime.strptime(timestamp, fmt)
                            except ValueError:
                                continue
                    except Exception as e3:
                        print(f"Final attempt parsing string timestamp failed: {str(e3)}")
        
        # Handle Firestore DatetimeWithNanoseconds objects
        if timestamp_type == 'DatetimeWithNanoseconds':
            # Most reliable way - convert to a string in ISO format and parse
            try:
                dt_str = str(timestamp)
                # Handle various timestamp string formats
                dt_str = dt_str.rstrip('Z')  # Remove trailing Z if present
                if 'T' in dt_str:
                    dt = datetime.fromisoformat(dt_str)
                else:
                    dt = datetime.fromisoformat(dt_str.replace(' ', 'T'))
                if dt.tzinfo is not None:
                    dt = dt.replace(tzinfo=None)
                return dt
            except (ValueError, TypeError):
                # Fallback: Try accessing attributes directly
                try:
                    return datetime(
                        year=timestamp.year,
                        month=timestamp.month,
                        day=timestamp.day,
                        hour=timestamp.hour,
                        minute=timestamp.minute,
                        second=timestamp.second,
                        microsecond=0
                    )
                except (AttributeError, TypeError):
                    pass
            
            # Another fallback: Try accessing _seconds and _nanoseconds
            try:
                if hasattr(timestamp, '_seconds'):
                    seconds = timestamp._seconds
                    # Convert nanoseconds to microseconds by dividing by 1000
                    if hasattr(timestamp, '_nanoseconds'):
                        microseconds = timestamp._nanoseconds // 1000
                    else:
                        microseconds = 0
                    return datetime.fromtimestamp(seconds).replace(microsecond=microseconds)
            except (AttributeError, TypeError):
                pass
            
            # Final fallback for DatetimeWithNanoseconds
            try:
                dt = datetime.fromtimestamp(timestamp.timestamp())
                if dt.tzinfo is not None:
                    dt = dt.replace(tzinfo=None)
                return dt
            except (AttributeError, TypeError):
                # Use current time as last resort
                return datetime.now()
        
        # Handle Firebase/Firestore Timestamp objects
        if hasattr(timestamp, 'seconds'):
            try:
                seconds = timestamp.seconds
                if hasattr(timestamp, 'nanoseconds'):
                    microseconds = timestamp.nanoseconds // 1000
                    return datetime.fromtimestamp(seconds).replace(microsecond=microseconds)
                return datetime.fromtimestamp(seconds)
            except (AttributeError, TypeError):
                pass
        
        # Handle dictionary format with 'seconds' key
        if isinstance(timestamp, dict) and 'seconds' in timestamp:
            try:
                seconds = timestamp['seconds']
                microseconds = 0
                if 'nanoseconds' in timestamp:
                    microseconds = timestamp['nanoseconds'] // 1000
                return datetime.fromtimestamp(seconds).replace(microsecond=microseconds)
            except (TypeError, ValueError):
                pass
        
        # If we got here, the format is unrecognized
        print(f"Unrecognized timestamp format: {timestamp_type} - {str(timestamp)[:100]}")
        return None
        
    except Exception as e:
        # Something unexpected happened
        timestamp_type = type(timestamp).__name__
        print(f"Error in convert_timestamp_to_datetime: {str(e)}")
        print(f"Problematic timestamp type: {timestamp_type}")
        print(f"Timestamp value: {str(timestamp)[:100]}..." if isinstance(timestamp, str) and len(str(timestamp)) > 100 else f"Timestamp value: {timestamp}")
        print(f"Timestamp dir: {dir(timestamp)[:200]}..." if len(dir(timestamp)) > 200 else f"Timestamp dir: {dir(timestamp)}")
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