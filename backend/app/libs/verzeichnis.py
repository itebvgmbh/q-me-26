"""Salon-Verzeichnis: Friseure und Barbershops mit eigener Seite – auch solche, die (noch) nicht bei Dranzeit sind.

Ein Eintrag (Sammlung `verzeichnis`, schreibt nur das Backend; firestore.rules hat keine Regel = im Browser zu) ist
eine öffentliche Seite unter /<kategorie>/<stadt>/<slug>, z. B. /friseur/berlin/salon-mueller. Zwei Arten:
  - ohne shopId: Salon ohne Vertrag. Angaben von seiner eigenen Webseite (Impressum, Preisliste), vom Betreiber
    geprüft und veröffentlicht. Nicht buchbar; Knöpfe „Wünsch ich mir“ (Kunden) und „Ist das dein Salon?“.
  - mit shopId: echter Dranzeit-Laden. Name, Adresse, Zeiten und Leistungen kommen live aus dem Laden.
Übernahme: Meldet sich ein Salon an, schlägt der Abgleich die Verknüpfung vor (gleiche Google-Place-ID, sonst
Name + PLZ oder Name + Lage); der Betreiber bestätigt. Die Adresse der Seite bleibt, alte leiten weiter (altePfade).

Google: Places-Inhalte dürfen nicht gespeichert werden (außer der Place-ID). Google dient nur zum Finden; gespeichert
wird, was auf der Webseite des Salons steht (app/libs/verzeichnis_import.py). Lage, Ortsteil und Bezirk kommen von
OpenStreetMap (Nominatim, höchstens ein Abruf je Sekunde).

Felder eines Eintrags:
    name, kategorie (friseur|barbershop), street, postalCode, city, ortsteil, bezirk, coordinates {latitude, longitude}
    phone, website, businessHoursByDay (wie am Laden, 0 = Sonntag), services [{name, category, price, priceFrom}]
    beschreibung, schwerpunkte [..], ohneTermin (ja|nein|""), status (entwurf|online|offline|entfernt)
    slug, stadtSlug, altePfade [..], shopId, googlePlaceId, quelle {website, seiten, gelesenAm}
    wuensche (Zahl), vorschlag {shopId, name, grund, am}, abgelehnt [shopIds]
    angelegtAm, geaendertAm, veroeffentlichtAm
"""

import math
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone
from typing import Iterable, Optional

COLLECTION = "verzeichnis"
KATEGORIEN = {"friseur": "Friseur", "barbershop": "Barbershop"}
KATEGORIEN_MEHRZAHL = {"friseur": "Friseure", "barbershop": "Barbershops"}
STATUS = ("entwurf", "online", "offline", "entfernt")
TAGE = ["so", "mo", "di", "mi", "do", "fr", "sa"]  # Index = dayOfWeek am Laden (0 = Sonntag)

# Keine eigene Seite: Läden der Testskripte und der Standardladen von seiten.cjs (app/libs/konten.py)
TEST_SHOP_IDS = {"zNS505OFvKZpFaR1vTdN"}
TEST_SHOP_NAME = re.compile(r"\(wird gleich gelöscht\)|^E2E |^Lasttest", re.I)


def now() -> datetime:
    return datetime.now(timezone.utc)


# --- Adressen der Seiten ------------------------------------------------------------------------------------------


def slugify(text: str, max_len: int = 0) -> str:
    """'Köln' → 'koeln', 'Salon Élan & Co.' → 'salon-elan-co'"""
    s = re.sub(r"['’‘´`]", "", (text or "").strip().lower())  # "Halit's" → "halits"
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if max_len and len(s) > max_len:
        s = s[:max_len].rsplit("-", 1)[0] if "-" in s[:max_len] else s[:max_len]
    return s


def eindeutiger_slug(name: str, belegt: set, ortsteil: str = "") -> str:
    """Slug für einen Salon in einer Stadt; bei Gleichnamigen erst mit Ortsteil, dann mit Nummer"""
    basis = slugify(name, 60) or "salon"
    if basis not in belegt:
        return basis
    if ortsteil:
        mit_teil = f"{basis}-{slugify(ortsteil, 30)}"
        if mit_teil not in belegt:
            return mit_teil
    n = 2
    while f"{basis}-{n}" in belegt:
        n += 1
    return f"{basis}-{n}"


def pfad(entry: dict) -> str:
    return f"/{entry.get('kategorie') or 'friseur'}/{entry.get('stadtSlug') or slugify(entry.get('city', ''))}/{entry.get('slug', '')}"


def ortsname(entry: dict) -> str:
    """'Berlin-Prenzlauer Berg' – so suchen Leute"""
    city, teil = (entry.get("city") or "").strip(), (entry.get("ortsteil") or "").strip()
    return f"{city}-{teil}" if city and teil and teil != city else city


# --- Branche -------------------------------------------------------------------------------------------------------

GOOGLE_KATEGORIE = [("barber_shop", "barbershop"), ("hair_salon", "friseur"), ("hair_care", "friseur")]


def kategorie_aus_google(primary: Optional[str], types: Optional[Iterable[str]], name: str = "") -> Optional[str]:
    """Nur Friseure und Barbershops gehören ins Verzeichnis; alles andere: None"""
    candidates = ([primary] if primary else []) + list(types or [])
    for google_type, kategorie in GOOGLE_KATEGORIE:
        if google_type in candidates:
            if kategorie == "friseur" and "barber" in (name or "").lower():
                return "barbershop"
            return kategorie
    return None


def kategorie_aus_name(name: str) -> str:
    return "barbershop" if "barber" in (name or "").lower() else "friseur"


def testladen(shop: dict) -> bool:
    return shop.get("id") in TEST_SHOP_IDS or bool(TEST_SHOP_NAME.search(shop.get("name") or ""))


# --- Öffnungszeiten ------------------------------------------------------------------------------------------------


def uhrzeit(value) -> str:
    """'9' → '09:00', '18.30' → '18:30', '24:00' → '23:59'; unbrauchbar → ''"""
    m = re.fullmatch(r"\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\s*", str(value or ""), re.I)
    if not m:
        return ""
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if h == 24 and mi == 0:
        return "23:59"
    if h > 23 or mi > 59:
        return ""
    return f"{h:02d}:{mi:02d}"


def stunden_aus_zeiten(tage: list) -> list:
    """[{tag: 'mo', zeiten: [{von, bis}]}] → businessHoursByDay (wie am Laden). Fehlende Tage sind zu.

    Leere Liste bleibt leer (Zeiten unbekannt). Mehrere Zeitfenster am Tag werden zu Pausen.
    """
    by_day: dict = {}
    for t in tage or []:
        day = TAGE.index(t.get("tag")) if t.get("tag") in TAGE else None
        if day is None:
            continue
        for z in t.get("zeiten") or []:
            von, bis = uhrzeit(z.get("von")), uhrzeit(z.get("bis"))
            if von and bis and bis > von:
                by_day.setdefault(day, []).append((von, bis))
    if not by_day:
        return []
    result = []
    for day in range(7):
        windows = sorted(by_day.get(day, []))
        if not windows:
            result.append({"dayOfWeek": day, "isOpen": False, "openTime": "09:00", "closeTime": "18:00", "breaks": []})
            continue
        merged = [list(windows[0])]
        for von, bis in windows[1:]:
            if von <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], bis)
            else:
                merged.append([von, bis])
        result.append({
            "dayOfWeek": day, "isOpen": True, "openTime": merged[0][0], "closeTime": merged[-1][1],
            "breaks": [{"startTime": merged[i][1], "endTime": merged[i + 1][0]} for i in range(len(merged) - 1)],
        })
    return result


# --- Übernahme: Laden und Eintrag derselbe Salon? ------------------------------------------------------------------

FUELLWOERTER = {
    "friseur", "friseure", "friseursalon", "salon", "barbershop", "barber", "shop", "hair", "hairstyle", "hairstyling",
    "haar", "haare", "studio", "gmbh", "ug", "inh", "inhaber", "und", "the", "die", "der", "das", "by", "berlin", "co",
}


def name_woerter(name: str) -> set:
    return {w for w in slugify(name).split("-") if w and w not in FUELLWOERTER and len(w) > 1}


def namen_aehnlich(a: str, b: str) -> bool:
    wa, wb = name_woerter(a), name_woerter(b)
    if not wa or not wb:
        return slugify(a) == slugify(b) and bool(slugify(a))
    return len(wa & wb) / min(len(wa), len(wb)) >= 0.5


def entfernung_m(a: Optional[dict], b: Optional[dict]) -> float:
    if not a or not b or "latitude" not in a or "latitude" not in b:
        return math.inf
    lat1, lon1, lat2, lon2 = map(math.radians, (a["latitude"], a["longitude"], b["latitude"], b["longitude"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def passt_zu(entry: dict, shop: dict) -> str:
    """Grund, warum der Laden dieser Salon sein dürfte – oder ''"""
    if entry.get("googlePlaceId") and entry["googlePlaceId"] == shop.get("googlePlaceId"):
        return "gleicher Google-Eintrag"
    if not namen_aehnlich(entry.get("name", ""), shop.get("name", "")):
        return ""
    if entry.get("postalCode") and entry["postalCode"] == (shop.get("postalCode") or "").strip():
        return "ähnlicher Name, gleiche PLZ"
    if entfernung_m(entry.get("coordinates"), shop.get("coordinates")) < 100:
        return "ähnlicher Name, gleiche Lage"
    return ""


GRUND_ANFRAGE = "vom Inhaber angefragt"


def abgleich(entries: list, shops: list) -> dict:
    """Was zu tun ist, damit jeder Laden genau eine Seite hat.

    Ergebnis: {"vorschlaege": {entryId: {shopId, name, grund}}, "neu": [shop, ...]}
    - Der Inhaber hat eine Seite angefragt (Übernahme ohne Code, Feld anfrage): Vorschlag für genau diese Seite, auch wenn
      der Laden schon eine eigene Seite hat (beim Bestätigen leitet die hierher, siehe verknuepfen).
    - Sonst: Laden schon verknüpft (ein Eintrag hat seine shopId): nichts.
    - Sonst passt ein Verzeichnis-Eintrag ohne Laden zu ihm: Vorschlag (der Betreiber bestätigt), noch keine eigene Seite.
    - Sonst: neuer Eintrag für den Laden.
    """
    linked = {e.get("shopId") for e in entries if e.get("shopId")}
    offen = [e for e in entries if not e.get("shopId") and e.get("status") != "entfernt"]
    aktiv = [s for s in shops if not testladen(s)]
    ids = {s["id"] for s in aktiv}
    angefragt: dict = {}
    for e in offen:
        sid = (e.get("anfrage") or {}).get("shopId")
        if sid in ids and sid not in (e.get("abgelehnt") or []):
            angefragt.setdefault(sid, e)
    reserviert = {e["id"] for e in angefragt.values()}  # nicht über den Namen an einen anderen Laden
    vorschlaege: dict = {}
    neu = []
    for shop in aktiv:
        if shop["id"] in angefragt:
            vorschlaege[angefragt[shop["id"]]["id"]] = {"shopId": shop["id"], "name": shop.get("name", ""), "grund": GRUND_ANFRAGE}
            continue
        if shop["id"] in linked:
            continue
        treffer = None
        for e in offen:
            if shop["id"] in (e.get("abgelehnt") or []) or e["id"] in vorschlaege or e["id"] in reserviert:
                continue
            grund = passt_zu(e, shop)
            if grund:
                treffer = (e, grund)
                break
        if treffer:
            e, grund = treffer
            vorschlaege[e["id"]] = {"shopId": shop["id"], "name": shop.get("name", ""), "grund": grund}
        else:
            neu.append(shop)
    return {"vorschlaege": vorschlaege, "neu": neu}


def verknuepfen(entry: dict, shop_id: str, entries: list, st=None) -> dict:
    """Eintrag wird die Seite des Ladens (Betreiber bestätigt oder Übernahme-Code). Die Adresse der Seite bleibt.

    Hatte der Laden inzwischen eine eigene Seite (laden-<shopId> aus dem Abgleich), leitet die jetzt hierher.
    Gibt die gespeicherten Änderungen zurück.
    """
    st = st or store()
    changes = {"shopId": shop_id, "vorschlag": None, "status": "online", "geaendertAm": now()}
    if not entry.get("veroeffentlichtAm"):
        changes["veroeffentlichtAm"] = now()
    for eigene in [e for e in entries if e.get("shopId") == shop_id and e["id"] != entry["id"]]:
        if eigene.get("slug") and eigene.get("stadtSlug"):
            alt = set(changes.get("altePfade") or entry.get("altePfade") or [])
            changes["altePfade"] = sorted(alt | {pfad(eigene)} | set(eigene.get("altePfade") or []))
        st.loesche(eigene["id"])
    st.aendere(entry["id"], changes)
    return changes


# --- Speicher ------------------------------------------------------------------------------------------------------


class FirestoreStore:
    def _col(self):
        from app.apis.firebase_utils import get_firestore_db

        return get_firestore_db().collection(COLLECTION)

    def alle(self) -> list:
        return [{**(d.to_dict() or {}), "id": d.id} for d in self._col().stream()]

    def hole(self, entry_id: str) -> Optional[dict]:
        snap = self._col().document(entry_id).get()
        return {**(snap.to_dict() or {}), "id": snap.id} if snap.exists else None

    def neu(self, data: dict, entry_id: str = "") -> str:
        ref = self._col().document(entry_id) if entry_id else self._col().document()
        ref.set({k: v for k, v in data.items() if k != "id"})
        return ref.id

    def aendere(self, entry_id: str, changes: dict) -> None:
        self._col().document(entry_id).update({k: v for k, v in changes.items() if k != "id"})

    def loesche(self, entry_id: str) -> None:
        self._col().document(entry_id).delete()

    def wunsch(self, entry_id: str) -> None:
        from google.cloud import firestore as gcf

        self._col().document(entry_id).update({"wuensche": gcf.Increment(1)})

    def per_code(self, code_hash: str) -> Optional[dict]:
        """Eintrag zum Übernahme-Code (app/libs/uebernahme.py)"""
        for d in self._col().where("uebernahme.codeHash", "==", code_hash).limit(1).stream():
            return {**(d.to_dict() or {}), "id": d.id}
        return None


class MemoryStore:
    """Für Tests"""

    def __init__(self, entries: Iterable[dict] = ()):
        self.data = {e["id"]: {k: v for k, v in e.items() if k != "id"} for e in entries}
        self._n = 0

    def alle(self) -> list:
        return [{**v, "id": k} for k, v in self.data.items()]

    def hole(self, entry_id: str) -> Optional[dict]:
        return {**self.data[entry_id], "id": entry_id} if entry_id in self.data else None

    def neu(self, data: dict, entry_id: str = "") -> str:
        if not entry_id:
            self._n += 1
            entry_id = f"e{self._n}"
        self.data[entry_id] = {k: v for k, v in data.items() if k != "id"}
        return entry_id

    def aendere(self, entry_id: str, changes: dict) -> None:
        if entry_id not in self.data:
            raise KeyError(entry_id)
        self.data[entry_id].update({k: v for k, v in changes.items() if k != "id"})

    def loesche(self, entry_id: str) -> None:
        self.data.pop(entry_id, None)

    def wunsch(self, entry_id: str) -> None:
        self.data[entry_id]["wuensche"] = int(self.data[entry_id].get("wuensche") or 0) + 1

    def per_code(self, code_hash: str) -> Optional[dict]:
        return next((e for e in self.alle() if (e.get("uebernahme") or {}).get("codeHash") == code_hash), None)


_store = None


def store():
    global _store
    if _store is None:
        _store = FirestoreStore()
    return _store


def set_store(s) -> None:
    """Für Tests"""
    global _store
    _store = s


# --- OpenStreetMap: Lage, Ortsteil, Bezirk -------------------------------------------------------------------------

NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Dranzeit-Verzeichnis/1.0 (+https://dranzeit.de)"
_osm_lock = threading.Lock()
_osm_last = 0.0
_osm_cache: dict = {}


def lage_aus_osm(antwort: list) -> Optional[dict]:
    """Erster Treffer einer Nominatim-Suche (format=jsonv2, addressdetails=1) → Koordinaten, Ortsteil, Bezirk, Stadt"""
    if not antwort:
        return None
    hit = antwort[0]
    a = hit.get("address") or {}
    try:
        coords = {"latitude": round(float(hit["lat"]), 6), "longitude": round(float(hit["lon"]), 6)}
    except (KeyError, TypeError, ValueError):
        return None
    city = a.get("city") or a.get("town") or a.get("village") or a.get("municipality") or ""
    return {
        "coordinates": coords,
        "ortsteil": a.get("suburb") or a.get("quarter") or a.get("neighbourhood") or "",
        "bezirk": a.get("borough") or a.get("city_district") or "",
        "osmCity": city,
    }


def lage(street: str, postal_code: str, city: str, get=None) -> Optional[dict]:
    """Adresse → Lage über Nominatim. Höchstens ein Abruf je Sekunde (Nutzungsregeln), Ergebnisse gemerkt."""
    key = (street.strip().lower(), postal_code.strip(), city.strip().lower())
    if not any(key):
        return None
    if key in _osm_cache:
        return _osm_cache[key]
    if get is None:
        import requests

        get = requests.get
    global _osm_last
    params = {"countrycodes": "de", "format": "jsonv2", "addressdetails": 1, "limit": 1}
    if street:
        params["street"] = street
    if postal_code:
        params["postalcode"] = postal_code
    if city:
        params["city"] = city
    with _osm_lock:
        wait = 1.1 - (time.monotonic() - _osm_last)
        if wait > 0:
            time.sleep(wait)
        try:
            resp = get(NOMINATIM, params=params, headers={"User-Agent": USER_AGENT, "Accept-Language": "de"}, timeout=10)
            data = resp.json() if resp.status_code == 200 else []
        except Exception as e:  # ohne Lage geht es auch (keine Karte, kein Ortsteil)
            print(f"Verzeichnis: OpenStreetMap nicht erreichbar: {e}")
            data = None
        finally:
            _osm_last = time.monotonic()
    if data is None:
        return None
    result = lage_aus_osm(data)
    _osm_cache[key] = result
    return result


# --- Neue Einträge -------------------------------------------------------------------------------------------------


def belegte_slugs(entries: list, stadt_slug: str, ausser: str = "") -> set:
    """Slugs einer Stadt, auch frühere (alte Adressen leiten weiter und bleiben belegt)"""
    taken = set()
    for e in entries:
        if e.get("id") == ausser:
            continue
        if e.get("stadtSlug") == stadt_slug:
            taken.add(e.get("slug"))
        for alt in e.get("altePfade") or []:
            parts = alt.strip("/").split("/")
            if len(parts) == 3 and parts[1] == stadt_slug:
                taken.add(parts[2])
    return taken


def eintrag_fuer_laden(shop: dict, entries: list, geo: Optional[dict]) -> dict:
    """Seite für einen echten Laden (Abgleich). Inhalt kommt live aus dem Laden; hier nur Adresse der Seite und Lage."""
    city = (shop.get("city") or "").strip()
    stadt_slug = slugify(city)
    geo = geo or {}
    ortsteil = geo.get("ortsteil", "")
    ts = now()
    return {
        "shopId": shop["id"],
        "name": shop.get("name", ""),
        "kategorie": kategorie_aus_name(shop.get("name", "")),
        "city": city,
        "stadtSlug": stadt_slug,
        "slug": eindeutiger_slug(shop.get("name", ""), belegte_slugs(entries, stadt_slug), ortsteil),
        "ortsteil": ortsteil,
        "bezirk": geo.get("bezirk", ""),
        "status": "online",
        "angelegtAm": ts,
        "geaendertAm": ts,
        "veroeffentlichtAm": ts,
    }


def neuer_eintrag(daten: dict, entries: list) -> dict:
    """Verzeichnis-Eintrag aus geprüften Angaben (Import oder von Hand) als Entwurf"""
    city = (daten.get("city") or "").strip()
    stadt_slug = slugify(city)
    ts = now()
    entry = {
        "status": "entwurf",
        "wuensche": 0,
        "angelegtAm": ts,
        "geaendertAm": ts,
        **daten,
        "city": city,
        "stadtSlug": stadt_slug,
    }
    entry["kategorie"] = entry.get("kategorie") if entry.get("kategorie") in KATEGORIEN else kategorie_aus_name(entry.get("name", ""))
    entry["slug"] = eindeutiger_slug(entry.get("name", ""), belegte_slugs(entries, stadt_slug), entry.get("ortsteil", ""))
    return entry


def vollstaendigkeit(entry: dict) -> list:
    """Was einer Seite fehlt, damit sie mehr ist als Name und Adresse (dünne Seiten schaden bei Google)"""
    fehlt = []
    if not entry.get("street") or not entry.get("postalCode"):
        fehlt.append("Adresse")
    if not entry.get("coordinates"):
        fehlt.append("Lage")
    if not entry.get("businessHoursByDay"):
        fehlt.append("Öffnungszeiten")
    if not entry.get("services"):
        fehlt.append("Preise")
    if not (entry.get("beschreibung") or "").strip():
        fehlt.append("Beschreibung")
    return fehlt


def gehaltvoll(entry: dict) -> bool:
    """Genug Inhalt, dass Google die Seite sehen soll (sonst noindex)"""
    return bool(entry.get("businessHoursByDay") or entry.get("services") or (entry.get("beschreibung") or "").strip())


# --- Abgleich ausführen ----------------------------------------------------------------------------------------------

_abgleich_lock = threading.Lock()


def abgleich_ausfuehren(entries: list, shops: list, st=None, geo=None, max_neu: int = 5) -> list:
    """Vorschläge speichern, veraltete entfernen, Seiten für neue Läden anlegen. Gibt die aktuelle Liste zurück.

    Neue Läden höchstens max_neu je Lauf (je einer Sekunde OpenStreetMap); der Rest beim nächsten Mal.
    Die ID der Seite eines Ladens ist laden-<shopId>: zwei gleichzeitige Läufe legen sie nicht doppelt an.
    """
    st = st or store()
    geo = geo or lage
    with _abgleich_lock:
        entries = [dict(e) for e in entries]
        plan = abgleich(entries, shops)
        for e in entries:
            v = plan["vorschlaege"].get(e["id"])
            alt = e.get("vorschlag") or {}
            if v and alt.get("shopId") != v["shopId"]:
                v = {**v, "am": now()}
                st.aendere(e["id"], {"vorschlag": v})
                e["vorschlag"] = v
            elif not v and alt:
                st.aendere(e["id"], {"vorschlag": None})
                e["vorschlag"] = None
        for shop in plan["neu"][:max_neu]:
            g = geo(shop.get("street") or "", shop.get("postalCode") or "", shop.get("city") or "")
            entry = eintrag_fuer_laden(shop, entries, g)
            if g and g.get("coordinates") and not shop.get("coordinates"):
                entry["coordinates"] = g["coordinates"]
            entry_id = st.neu(entry, f"laden-{shop['id']}")
            entries.append({**entry, "id": entry_id})
            print(f"Verzeichnis: Seite für Laden {shop['id']} ({shop.get('name')!r}) angelegt: {pfad(entry)}")
    return entries
