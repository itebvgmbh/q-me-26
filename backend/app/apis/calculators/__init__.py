from typing import List
from datetime import datetime
from app.apis.models import TimeSlot
from fastapi import APIRouter

# Leerer Router, damit das Modul als API-Modul erkannt wird
router = APIRouter()

def calculate_available_timeslots(
    day_start: datetime, 
    day_end: datetime, 
    appointments: list, 
    breaks: dict, 
    service_duration: int,
    service_setup_time: int = 0,
    slot_interval_minutes: int = None  # Dynamisch basierend auf Service-Dauer
) -> List[TimeSlot]:
    """
    Vollständig optimierte Berechnung von verfügbaren Zeitslots mit einem Bitmap/Array-Ansatz.
    Diese Version ist komplett neugestaltet für maximale Performance:
    1. Verwendet ein Bitmap für den ganzen Tag (1 Minute pro Slot)
    2. Behandelt Appointments und Breaks in einem einzigen Durchlauf
    3. Konvertiert Uhrzeiten direkt in Minuten-Indizes
    4. Minimiert String-Konvertierungen und Objekterstellungen
    """
    # Performance-optimierter Algorithmus für Zeitslot-Berechnung
    
    # Berechne das Slot-Intervall basierend auf der Service-Dauer
    if slot_interval_minutes is None:
        slot_interval_minutes = service_duration
    
    # Total time needed for the service = duration + setup time
    total_service_time = service_duration + service_setup_time
    
    # =====================================================================
    # 1. Direkte Umwandlung in Minuten für maximale Performance
    # =====================================================================
    
    # Ein Tag hat 24 * 60 = 1440 Minuten
    minutes_in_day = 24 * 60
    
    # Initialisiere ein Array mit 1440 Slots (1 pro Minute)
    # Alle Minuten standardmäßig als nicht verfügbar markieren (0)
    availability = [0] * minutes_in_day
    
    # Konvertiere Tag-Start und -Ende in Minuten-Indizes
    day_start_minutes = day_start.hour * 60 + day_start.minute
    day_end_minutes = day_end.hour * 60 + day_end.minute
    
    print(f"Working hours for day: {day_start_minutes} to {day_end_minutes} minutes")
    
    # Markiere NUR die Arbeitszeiten als verfügbar (1)
    for i in range(day_start_minutes, day_end_minutes):
        availability[i] = 1
    
    # =====================================================================
    # 2. Optimierte Verarbeitung von Terminen und Pausen
    # =====================================================================
    
    # Alle Termine und Pausen in eine gemeinsame Liste legen
    # und in einem einzigen Durchlauf verarbeiten
    all_blocked_periods = []
    
    for appt in appointments:
        try:
            # Extrahiere Start- und Endzeit (in Minuten seit Mitternacht)
            # Konvertiere alle Formate direkt in das Format, das wir brauchen
            if isinstance(appt.get('startTime'), dict) and 'seconds' in appt.get('startTime', {}):
                start_datetime = datetime.fromtimestamp(appt['startTime']['seconds'])
                end_datetime = datetime.fromtimestamp(appt['endTime']['seconds'])
            elif hasattr(appt.get('startTime'), 'seconds'):
                start_datetime = datetime.fromtimestamp(appt['startTime'].seconds)
                end_datetime = datetime.fromtimestamp(appt['endTime'].seconds)
            elif isinstance(appt.get('startTime'), datetime):
                start_datetime = appt['startTime']
                end_datetime = appt['endTime']
                if start_datetime.tzinfo:
                    start_datetime = start_datetime.replace(tzinfo=None)
                if end_datetime.tzinfo:
                    end_datetime = end_datetime.replace(tzinfo=None)
            elif isinstance(appt.get('startTime'), str):
                try:
                    # Versuche, den String in ein Datetime-Objekt zu konvertieren
                    start_str = appt['startTime'].rstrip('Z')
                    end_str = appt['endTime'].rstrip('Z')
                    
                    # Entferne Zeitzoneninformationen für konsistentes Parsing
                    if '+' in start_str:
                        start_str = start_str.split('+')[0]
                    if '+' in end_str:
                        end_str = end_str.split('+')[0]
                    
                    if 'T' in start_str:
                        start_datetime = datetime.fromisoformat(start_str)
                    else:
                        start_datetime = datetime.fromisoformat(start_str.replace(' ', 'T'))
                        
                    if 'T' in end_str:
                        end_datetime = datetime.fromisoformat(end_str)
                    else:
                        end_datetime = datetime.fromisoformat(end_str.replace(' ', 'T'))
                        
                    print(f"Converted string timestamps: {start_datetime} to {end_datetime}")
                except ValueError as e:
                    print(f"Error converting timestamp strings: {e}")
                    # Wenn die erste Methode fehlschlägt, verwenden wir dateutil als Fallback
                    try:
                        from dateutil import parser
                        start_datetime = parser.parse(appt['startTime'])
                        end_datetime = parser.parse(appt['endTime'])
                        print(f"Converted string timestamps using dateutil: {start_datetime} to {end_datetime}")
                    except (ImportError, ValueError) as e2:
                        print(f"Error using dateutil for parsing: {e2}")
                        # Dritte Methode: Versuche häufige Formate
                        try:
                            formats = [
                                "%Y-%m-%dT%H:%M:%S",
                                "%Y-%m-%d %H:%M:%S",
                                "%Y/%m/%d %H:%M:%S",
                                "%d.%m.%Y %H:%M:%S",
                            ]
                            
                            for fmt in formats:
                                try:
                                    start_datetime = datetime.strptime(appt['startTime'], fmt)
                                    end_datetime = datetime.strptime(appt['endTime'], fmt)
                                    print(f"Converted timestamps using format {fmt}")
                                    break
                                except ValueError:
                                    continue
                            else:  # Wird nur ausgeführt, wenn kein break erfolgt
                                print("Failed to parse timestamp using all formats")
                                continue
                        except Exception as e3:
                            print(f"All timestamp parsing methods failed: {e3}")
                            continue
            else:
                # Unbekanntes Format überspringen
                continue
                
            # Prüfe, ob der Termin heute ist
            if start_datetime.date() != day_start.date() and end_datetime.date() != day_start.date():
                continue
                
            # Umwandlung in Minuten seit Mitternacht
            start_minutes = start_datetime.hour * 60 + start_datetime.minute
            end_minutes = end_datetime.hour * 60 + end_datetime.minute
            
            # Zur Liste der blockierten Perioden hinzufügen
            all_blocked_periods.append((start_minutes, end_minutes))
            
        except Exception as e:
            print(f"Fehler bei Termin-Verarbeitung: {str(e)}")
            
    
    # Prüfe, ob breaks ein Dictionary oder eine Liste ist
    if isinstance(breaks, dict):
        # Verarbeite reguläre Pausen aus dem Dictionary
        regular_breaks = breaks.get('regular_breaks', [])
        recurring_breaks = breaks.get('recurring_breaks', [])
        
        # 1. Verarbeite reguläre Pausen
        for break_item in regular_breaks:
            try:
                # Ähnliche Logik wie bei Terminen
                if isinstance(break_item.get('startTime'), dict) and 'seconds' in break_item.get('startTime', {}):
                    start_datetime = datetime.fromtimestamp(break_item['startTime']['seconds'])
                    end_datetime = datetime.fromtimestamp(break_item['endTime']['seconds'])
                elif hasattr(break_item.get('startTime'), 'seconds'):
                    start_datetime = datetime.fromtimestamp(break_item['startTime'].seconds)
                    end_datetime = datetime.fromtimestamp(break_item['endTime'].seconds)
                elif isinstance(break_item.get('startTime'), datetime):
                    start_datetime = break_item['startTime']
                    end_datetime = break_item['endTime']
                    if start_datetime.tzinfo:
                        start_datetime = start_datetime.replace(tzinfo=None)
                    if end_datetime.tzinfo:
                        end_datetime = end_datetime.replace(tzinfo=None)
                else:
                    continue
                    
                # Prüfe, ob die Pause heute ist
                if start_datetime.date() != day_start.date() and end_datetime.date() != day_start.date():
                    continue
                    
                # Umwandlung in Minuten
                start_minutes = start_datetime.hour * 60 + start_datetime.minute
                end_minutes = end_datetime.hour * 60 + end_datetime.minute
                
                # Zur Liste der blockierten Perioden hinzufügen
                all_blocked_periods.append((start_minutes, end_minutes))
                
            except Exception as e:
                print(f"Fehler bei regulärer Pausen-Verarbeitung: {str(e)}")
        
        # 2. Verarbeite wiederkehrende Pausen
        # Wiederkehrende Pausen haben startTime und endTime als Strings "HH:MM"
        for recurring_break in recurring_breaks:
            try:
                # Verarbeite nur aktive wiederkehrende Pausen
                if not recurring_break.get('active', True):
                    continue
                    
                # Extrahiere Start- und Endzeit als String (Format: "HH:MM")
                start_time_str = recurring_break.get('startTime')
                end_time_str = recurring_break.get('endTime')
                
                if not start_time_str or not end_time_str:
                    continue
                    
                # Konvertiere Zeitstrings in Minuten
                start_hour, start_minute = map(int, start_time_str.split(':'))
                end_hour, end_minute = map(int, end_time_str.split(':'))
                
                start_minutes = start_hour * 60 + start_minute
                end_minutes = end_hour * 60 + end_minute
                
                # Zur Liste der blockierten Perioden hinzufügen
                all_blocked_periods.append((start_minutes, end_minutes))
                print(f"Added recurring break from {start_time_str} to {end_time_str}")
                
            except Exception as e:
                print(f"Fehler bei wiederkehrender Pausen-Verarbeitung: {str(e)}")
    else:
        # Altes Format: breaks ist eine Liste
        # Verarbeite alle Pausen
        for break_item in breaks:
            try:
                # Ähnliche Logik wie bei Terminen
                if isinstance(break_item.get('startTime'), dict) and 'seconds' in break_item.get('startTime', {}):
                    start_datetime = datetime.fromtimestamp(break_item['startTime']['seconds'])
                    end_datetime = datetime.fromtimestamp(break_item['endTime']['seconds'])
                elif hasattr(break_item.get('startTime'), 'seconds'):
                    start_datetime = datetime.fromtimestamp(break_item['startTime'].seconds)
                    end_datetime = datetime.fromtimestamp(break_item['endTime'].seconds)
                elif isinstance(break_item.get('startTime'), datetime):
                    start_datetime = break_item['startTime']
                    end_datetime = break_item['endTime']
                    if start_datetime.tzinfo:
                        start_datetime = start_datetime.replace(tzinfo=None)
                    if end_datetime.tzinfo:
                        end_datetime = end_datetime.replace(tzinfo=None)
                else:
                    continue
                    
                # Prüfe, ob die Pause heute ist
                if start_datetime.date() != day_start.date() and end_datetime.date() != day_start.date():
                    continue
                    
                # Umwandlung in Minuten
                start_minutes = start_datetime.hour * 60 + start_datetime.minute
                end_minutes = end_datetime.hour * 60 + end_datetime.minute
                
                # Zur Liste der blockierten Perioden hinzufügen
                all_blocked_periods.append((start_minutes, end_minutes))
                
            except Exception as e:
                print(f"Fehler bei Pausen-Verarbeitung: {str(e)}")
    
    
    # Blockiere alle Zeiträume in einem einzigen Durchlauf
    for start_min, end_min in all_blocked_periods:
        # Begrenze auf die Tagesgrenzen
        start_min = max(0, start_min)
        end_min = min(minutes_in_day - 1, end_min)
        
        # Markiere als nicht verfügbar
        for i in range(start_min, end_min):
            availability[i] = 0
    
    # =====================================================================
    # 3. Optimierte Erzeugung der Zeitslots
    # =====================================================================
    
    # Verwende Arrays statt komplexer Objekte für bessere Performance
    available_slots = []
    requested_date = day_start.date()
    
    # Vorkonfigurierte Slots erstellen - nur innerhalb der Arbeitszeiten
    # Füge Sicherheitsabstand hinzu, damit keine Slots außerhalb der Arbeitszeiten generiert werden
    
    # Anstatt feste Intervalle zu verwenden, suchen wir nach verfügbaren Zeitbereichen
    minute = day_start_minutes
    while minute <= day_end_minutes - total_service_time:
        # Überprüfe explizit, ob der Slot komplett innerhalb der Arbeitszeiten liegt
        if minute < day_start_minutes or minute + total_service_time > day_end_minutes:
            minute += 1
            continue
            
        # Schnelle Prüfung, ob der gesamte Slot verfügbar ist
        is_slot_available = True
        for i in range(minute, minute + total_service_time):
            if i >= len(availability) or availability[i] == 0:
                is_slot_available = False
                # Wenn wir einen besetzten Slot finden, springen wir direkt zum Ende dieses Blocks
                # und setzen von dort aus fort, anstatt nur um einen Slot weiterzugehen
                next_minute = i
                while next_minute < len(availability) and availability[next_minute] == 0:
                    next_minute += 1
                minute = next_minute
                break
                
        if not is_slot_available:
            # Wenn wir hier sind, haben wir bereits minute auf den nächsten potenziell verfügbaren Slot gesetzt
            continue
        
        # Zeitslot erzeugen (nur bei Bedarf datetime-Objekte erstellen)
        slot_hour = minute // 60
        slot_minute = minute % 60
        
        # Direktes Erstellen der Zeitobjekte
        start_time = datetime(
            year=requested_date.year,
            month=requested_date.month,
            day=requested_date.day,
            hour=slot_hour,
            minute=slot_minute
        )
        
        end_time = datetime(
            year=requested_date.year,
            month=requested_date.month,
            day=requested_date.day,
            hour=(minute + total_service_time) // 60,
            minute=(minute + total_service_time) % 60
        )
        
        # Zeitslot zum Ergebnis hinzufügen
        available_slots.append(
            TimeSlot(
                start_time=start_time,
                end_time=end_time,
                is_available=is_slot_available
            )
        )
        
        # Gehe zum nächsten Zeitslot entsprechend des konfigurierten Intervalls
        minute += slot_interval_minutes
    
    # Ende der Berechnung
    print(f"Generated {len(available_slots)} slots")
    return available_slots