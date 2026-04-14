import databutton as db
import json
from hashlib import md5
from typing import Optional, Dict
import time as time_module
from datetime import datetime
from fastapi import APIRouter

# Leerer Router, damit das Modul als API-Modul erkannt wird
router = APIRouter()

# Cache-Gültigkeitsdauer in Sekunden (4 Stunden)
# Längere Cache-Dauer, da Zeitslotverfügbarkeit nur durch neue Buchungen, Stornierungen
# oder Änderungen an Arbeitszeiten beeinflusst wird
CACHE_TTL = 4 * 60 * 60

def get_cache_key(request: dict) -> str:
    """Generiert einen eindeutigen Cache-Schlüssel aus den Anfrageparametern"""
    # Create a copy of the request to avoid modifying the original
    request_copy = request.copy() if isinstance(request, dict) else {}
    
    # Remove force_refresh from the key generation to ensure cache hit with or without it
    if 'force_refresh' in request_copy:
        del request_copy['force_refresh']
        
    # Sortiere die Schlüssel, um konsistente Hashes zu gewährleisten
    sorted_params = json.dumps(request_copy, sort_keys=True)
    return md5(sorted_params.encode()).hexdigest()

def get_from_cache(cache_key: str) -> Optional[Dict]:
    """Holt Daten aus dem Cache, falls vorhanden und gültig"""
    try:
        # Versuche, den Cache-Eintrag zu laden
        try:
            cache_data = db.storage.json.get(f"timeslot_cache_{cache_key}")
        except FileNotFoundError:
            return None
        
        if not cache_data:
            return None
            
        # Prüfe, ob der Cache noch gültig ist
        now = time_module.time()
        if now - cache_data.get('timestamp', 0) > CACHE_TTL:
            print(f"Cache entry expired for {cache_key}")
            return None
            
        # Add check for valid structure
        if 'data' not in cache_data:
            print(f"Invalid cache format for {cache_key} - missing 'data' field")
            return None
        
        # Log cache hit with human-readable timestamp
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{current_time}] CACHE HIT: key={cache_key}")
        
        return cache_data
    except Exception as e:
        print(f"Error reading from cache: {str(e)}")
        return None

def save_to_cache(cache_key: str, data: dict, metadata: dict = None) -> None:
    """Speichert Daten im Cache mit aktuellem Zeitstempel"""
    try:
        current_time = time_module.time()
        human_readable_time = datetime.fromtimestamp(current_time).strftime('%Y-%m-%d %H:%M:%S')
        
        cache_entry = {
            'timestamp': current_time,
            'created_at': human_readable_time,  # Human readable timestamp for debugging
            'data': data,
            'metadata': metadata or {}
        }
        db.storage.json.put(f"timeslot_cache_{cache_key}", cache_entry)
        print(f"Saved data to cache: {cache_key} at {human_readable_time}")
    except Exception as e:
        print(f"Error saving to cache: {str(e)}")
        # Cache-Fehler sollten nicht die Hauptfunktion beeinträchtigen
        pass

def invalidate_shop_date_cache(shop_id: str, date: str, staff_id: Optional[str] = None, verbose: bool = True) -> int:
    """Invalidate all cache entries for a shop and date combination.
    
    This improved implementation uses a more direct approach to identify and delete relevant cache entries:
    1. For shop-wide invalidation: Identifies entries with both shop_id and date
    2. For staff-specific invalidation: Adds staff_id to the criteria
    3. Uses a more efficient entry detection algorithm that reduces the risk of missed cache entries
    
    Args:
        shop_id: The shop ID to invalidate cache for
        date: The date string in ISO format (YYYY-MM-DD)
        staff_id: Optional staff ID to limit invalidation to a specific staff member
    """
    # Log cache invalidation with human-readable timestamp for traceability
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    if verbose:
        print(f"[{current_time}] CACHE INVALIDATION: shop={shop_id}, date={date}, staff={staff_id if staff_id else 'all'}")
    try:
        # Get list of all cache entries
        cache_entries = db.storage.json.list()
        deleted_count = 0
        
        # Create a metadata record of this invalidation for debugging
        try:
            invalidation_meta = {
                'timestamp': time_module.time(),
                'datetime': current_time,
                'shop_id': shop_id,
                'date': date,
                'staff_id': staff_id
            }
            db.storage.json.put(f"cache_invalidation_log_{int(time_module.time())}", invalidation_meta)
        except Exception as e:
            print(f"Error logging cache invalidation metadata: {e}")
        
        # Format date string consistently (ensure it's just YYYY-MM-DD)
        try:
            if 'T' in date:
                date = date.split('T')[0]
        except Exception as e:
            print(f"Error formatting date: {e}")
        
        if verbose:
            print(f"Invalidating cache for shop={shop_id}, date={date}, staff_id={staff_id if staff_id else 'all'}")
        
        # Iterate through entries and delete relevant ones
        for entry in cache_entries:
            if not entry.name.startswith('timeslot_cache_'):
                continue
                
            try:
                # Load the cache entry data
                cache_data = db.storage.json.get(entry.name)
                if not cache_data or not isinstance(cache_data, dict):
                    continue
                
                # Get metadata if available - check both metadata.request and direct data.metadata for compatibility
                metadata = cache_data.get('metadata', {})
                
                # First check if metadata contains request info directly
                if isinstance(metadata, dict) and 'request' in metadata:
                    request_data = metadata.get('request', {})
                # Legacy format: check if data contains metadata  
                elif 'data' in cache_data and isinstance(cache_data['data'], dict) and 'metadata' in cache_data['data']:
                    data_metadata = cache_data['data'].get('metadata', {})
                    request_data = data_metadata.get('request', {}) if isinstance(data_metadata, dict) else {}
                else:
                    request_data = {}
                
                # Check if this is a cache for the specified shop
                entry_shop_id = request_data.get('shop_id')
                if entry_shop_id != shop_id:
                    continue
                
                # Check if this entry is for the specified date
                # First try to get date from request metadata
                entry_date = request_data.get('date')
                if entry_date and 'T' in entry_date:
                    entry_date = entry_date.split('T')[0]
                
                # If no date in metadata or doesn't match, check timeslots
                date_matched = False
                if entry_date and entry_date == date:
                    date_matched = True
                else:
                    # Try to extract date from the first timeslot
                    # First check if data is directly in cache_data or inside a 'data' field
                    timeslots_container = cache_data.get('data', cache_data)
                    timeslots = timeslots_container.get('timeslots', [])
                    if timeslots and len(timeslots) > 0:
                        first_slot = timeslots[0]
                        slot_start = first_slot.get('start_time', '')
                        if slot_start and 'T' in slot_start:
                            slot_date = slot_start.split('T')[0]
                            if slot_date == date:
                                date_matched = True
                
                if not date_matched:
                    continue
                
                # Check staff_id if specified
                if staff_id is not None:
                    entry_staff_id = request_data.get('staff_id')
                    if entry_staff_id != staff_id:
                        continue
                
                # If we get here, this entry should be invalidated
                current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                if verbose:
                    print(f"[{current_time}] Deleting cache entry: {entry.name}")
                db.storage.json.delete(entry.name)
                deleted_count += 1
                
            except Exception as e:
                print(f"Error processing cache entry {entry.name}: {str(e)}")
                continue
        
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        if verbose:
            print(f"[{current_time}] Cache invalidation complete. Deleted {deleted_count} entries.")
        return deleted_count
        
    except Exception as e:
        print(f"Error during cache invalidation: {str(e)}")
        # Cache invalidation errors should not crash the application