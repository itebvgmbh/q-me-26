"""Speicher-Schicht auf PostgreSQL (requirements/eigene-datenbank.md, Stufe 3).

Derselbe kleine Teil von Firestore wie in app/store/__init__.py beschrieben, auf einer Tabelle `dokumente`
(migrations/versions/…_0002_dokumente.py): je Dokument eine Zeile mit Pfad der Sammlung, ID und Inhalt als jsonb.
Gilt, wenn QME_SPEICHER=postgres gesetzt ist; sonst bleibt Firestore. Wie sich beides verhalten muss, hält
tests/test_speicher_vertrag.py fest – die Verträge laufen gegen beide.

So bildet der Client Firestore nach:
- **Werte:** Zeitpunkte stehen als {"__zeit": "2026-11-04T09:30:15.123456Z"} (UTC, feste Länge) im jsonb. So sortieren
  und vergleichen sie sich als Text richtig und bleiben von Text wie "10:00" getrennt. Zurück kommen sie als datetime
  in UTC; Zeiten ohne Zone gelten als UTC.
- **Abfragen:** Gleichheit und `in` als Enthaltensein (`daten @> …`, GIN-Index), Bereiche nur innerhalb desselben
  Typs, Sortierung nach Firestores Typ-Reihenfolge (null < Wahrheitswert < Zahl < Zeitpunkt < Text < Liste < Karte),
  ohne Angabe nach ID. Wer nach einem Feld sortiert oder es mit <, >= … vergleicht, findet nur Dokumente mit dem Feld.
- **Schreiben:** Jeder Schreibvorgang liest das Dokument, rechnet den neuen Stand in Python aus (merge, Punkt-Pfade,
  SERVER_TIMESTAMP, DELETE_FIELD, Increment – die Sonderwerte aus google.cloud.firestore gelten auch hier) und schreibt
  ihn zurück, alles in einer Transaktion mit SERIALIZABLE. Konflikte laufen neu an.
- **Transaktionen:** Lesen über `ref.get(transaction=tx)`, Schreiben gesammelt bis zum Ende. Bei Konflikt läuft die ganze
  Funktion noch einmal (wie bei Firestore), nach `max_attempts` Versuchen kommt `Aborted`.
- **Live-Abfragen:** Jeder Schreibvorgang meldet sich per `NOTIFY dokumente` mit Sammlung und ID. Ein Thread je Prozess
  hört zu, rechnet betroffene Abfragen neu und ruft `on_snapshot` mit allen Treffern, den Änderungen und der Lesezeit.
  Zur Sicherheit rechnet er alle 30 Sekunden ohnehin neu.
"""

from __future__ import annotations

import enum
import json
import logging
import random
import re
import secrets
import string
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

# Dieselben Sonderwerte und Fehler wie für Firestore (app/store/__init__.py), damit der übrige Code nichts merkt
from app.store import DELETE_FIELD, SERVER_TIMESTAMP, Aborted, Conflict, Increment, NotFound

log = logging.getLogger("q-me.speicher")

UTC = timezone.utc
KANAL = "dokumente"
ID_ZEICHEN = string.ascii_letters + string.digits
# Feldnamen kommen aus dem Code, nie vom Browser; trotzdem nur, was sich gefahrlos in SQL schreiben lässt
FELD = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")
# Wiederholbare Fehler: Serialisierung, Verklemmung, gleichzeitig angelegt
WIEDERHOLEN = {"40001", "40P01", "23505"}
ASCENDING = "ASCENDING"
DESCENDING = "DESCENDING"
NEU_RECHNEN_SEKUNDEN = 30


# --- Werte ------------------------------------------------------------------------------------------------------------


def _zeit_text(wert: datetime) -> str:
    if wert.tzinfo is None:
        wert = wert.replace(tzinfo=UTC)
    return wert.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def kodieren(wert: Any) -> Any:
    """Python-Wert → JSON für jsonb (Zeitpunkte als {"__zeit": …})"""
    if isinstance(wert, datetime):
        return {"__zeit": _zeit_text(wert)}
    if isinstance(wert, dict):
        return {str(k): kodieren(v) for k, v in wert.items()}
    if isinstance(wert, (list, tuple)):
        return [kodieren(v) for v in wert]
    if wert is None or isinstance(wert, (bool, int, float, str)):
        return wert
    raise TypeError(f"Wert lässt sich nicht speichern: {type(wert).__name__}")


def dekodieren(wert: Any) -> Any:
    if isinstance(wert, dict):
        if len(wert) == 1 and isinstance(wert.get("__zeit"), str):
            return datetime.strptime(wert["__zeit"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)
        return {k: dekodieren(v) for k, v in wert.items()}
    if isinstance(wert, list):
        return [dekodieren(v) for v in wert]
    return wert


def _ist_karte(wert: Any) -> bool:
    return isinstance(wert, dict)


def _sonderwerte(wert: Any, jetzt: datetime, alt: Any = None) -> Any:
    """SERVER_TIMESTAMP und Increment in neuen Werten auflösen (auch in Karten); alt: bisheriger Wert dort"""
    if wert is SERVER_TIMESTAMP:
        return jetzt
    if isinstance(wert, Increment):
        basis = alt if isinstance(alt, (int, float)) and not isinstance(alt, bool) else 0
        return basis + wert.value
    if _ist_karte(wert):
        return {k: _sonderwerte(v, jetzt, (alt or {}).get(k) if _ist_karte(alt) else None) for k, v in wert.items() if v is not DELETE_FIELD}
    if isinstance(wert, list):
        return [_sonderwerte(v, jetzt) for v in wert]
    return wert


def _zusammenfuehren(alt: dict, neu: dict, jetzt: datetime) -> dict:
    """set(…, merge=True): Karten werden zusammengeführt, alles andere ersetzt"""
    ergebnis = dict(alt)
    for k, v in neu.items():
        if v is DELETE_FIELD:
            ergebnis.pop(k, None)
        elif _ist_karte(v) and v:
            ergebnis[k] = _zusammenfuehren(alt[k] if _ist_karte(alt.get(k)) else {}, v, jetzt)
        elif _ist_karte(v):
            ergebnis[k] = alt[k] if _ist_karte(alt.get(k)) else {}
        else:
            ergebnis[k] = _sonderwerte(v, jetzt, alt.get(k))
    return ergebnis


def _pfad(feld: str) -> list[str]:
    teile = feld.split(".")
    for t in teile:
        if not FELD.match(t):
            raise ValueError(f"Ungültiger Feldname: {feld!r}")
    return teile


def _aktualisieren(alt: dict, aenderung: dict, jetzt: datetime) -> dict:
    """update(…): Schlüssel sind Feld-Pfade mit Punkten; ohne Punkt wird das ganze Feld ersetzt"""
    ergebnis = deepcopy(alt)
    for feld, v in aenderung.items():
        teile = _pfad(feld)
        ziel = ergebnis
        for t in teile[:-1]:
            if not _ist_karte(ziel.get(t)):
                if v is DELETE_FIELD:
                    ziel = None
                    break
                ziel[t] = {}
            ziel = ziel[t]
        if ziel is None:
            continue
        if v is DELETE_FIELD:
            ziel.pop(teile[-1], None)
        else:
            ziel[teile[-1]] = _sonderwerte(v, jetzt, ziel.get(teile[-1]))
    return ergebnis


def neue_id() -> str:
    return "".join(secrets.choice(ID_ZEICHEN) for _ in range(20))


# --- SQL für Abfragen -------------------------------------------------------------------------------------------------


def _sql_pfad(teile: list[str]) -> str:
    return "'{" + ",".join(teile) + "}'"


def _rang(ausdruck: str) -> str:
    """Firestores Reihenfolge der Typen"""
    return (
        f"case jsonb_typeof({ausdruck}) when 'null' then 0 when 'boolean' then 1 when 'number' then 2 "
        f"when 'string' then 4 when 'array' then 8 "
        f"when 'object' then case when {ausdruck} ? '__zeit' then 3 else 9 end end"
    )


class _Sql:
    def __init__(self):
        self.params: dict[str, Any] = {}

    def param(self, wert: Any) -> str:
        name = f"p{len(self.params)}"
        self.params[name] = wert
        return f":{name}"

    def json(self, wert: Any) -> str:
        return f"cast({self.param(json.dumps(kodieren(wert), ensure_ascii=False))} as jsonb)"


def _enthalten(teile: list[str], wert: Any) -> Any:
    """{"a": {"b": wert}} für daten @> …"""
    for t in reversed(teile):
        wert = {t: wert}
    return wert


def _gleich(sql: _Sql, teile: list[str], wert: Any) -> str:
    if wert is None or isinstance(wert, (bool, int, float, str, datetime)):
        return f"daten @> {sql.json(_enthalten(teile, wert))}"
    return f"(daten #> {_sql_pfad(teile)}) = {sql.json(wert)}"


def _vergleich(sql: _Sql, teile: list[str], op: str, wert: Any) -> str:
    feld = f"(daten #> {_sql_pfad(teile)})"
    if isinstance(wert, bool):
        return f"(jsonb_typeof({feld}) = 'boolean' and cast({feld} as boolean) {op} {sql.param(wert)})"
    if isinstance(wert, (int, float)):
        return f"(jsonb_typeof({feld}) = 'number' and cast({feld} as numeric) {op} {sql.param(wert)})"
    if isinstance(wert, datetime):
        return f"((daten #>> {_sql_pfad(teile + ['__zeit'])}) collate \"C\" {op} {sql.param(_zeit_text(wert))})"
    if isinstance(wert, str):
        return f"(jsonb_typeof({feld}) = 'string' and (daten #>> {_sql_pfad(teile)}) collate \"C\" {op} {sql.param(wert)})"
    raise ValueError(f"Vergleich {op} mit {type(wert).__name__} geht nicht")


def _sortierung(teile: list[str], richtung: str) -> list[str]:
    feld = f"(daten #> {_sql_pfad(teile)})"
    r = "desc" if richtung == DESCENDING else "asc"
    return [
        f"{_rang(feld)} {r}",
        f"case when jsonb_typeof({feld}) = 'boolean' then cast({feld} as boolean) end {r}",
        f"case when jsonb_typeof({feld}) = 'number' then cast({feld} as numeric) end {r}",
        f"(daten #>> {_sql_pfad(teile + ['__zeit'])}) collate \"C\" {r}",
        f"(case when jsonb_typeof({feld}) = 'string' then (daten #>> {_sql_pfad(teile)}) end) collate \"C\" {r}",
    ]


# --- Pfade, Dokumente, Abfragen ----------------------------------------------------------------------------------------


class DocumentSnapshot:
    def __init__(self, reference: "DocumentReference", daten: dict | None):
        self.reference = reference
        self._daten = daten

    @property
    def id(self) -> str:
        return self.reference.id

    @property
    def exists(self) -> bool:
        return self._daten is not None

    def to_dict(self) -> dict | None:
        return deepcopy(self._daten) if self._daten is not None else None

    def get(self, feld: str) -> Any:
        wert: Any = self._daten or {}
        for t in feld.split("."):
            if not _ist_karte(wert) or t not in wert:
                raise KeyError(feld)
            wert = wert[t]
        return deepcopy(wert)


class DocumentReference:
    def __init__(self, client: "Client", sammlung: str, doc_id: str):
        self._client = client
        self._sammlung = sammlung
        self.id = doc_id

    @property
    def path(self) -> str:
        return f"{self._sammlung}/{self.id}"

    @property
    def parent(self) -> "CollectionReference":
        return CollectionReference(self._client, self._sammlung)

    def collection(self, name: str) -> "CollectionReference":
        return CollectionReference(self._client, f"{self.path}/{name}")

    def get(self, transaction: "Transaction | None" = None, **_: Any) -> DocumentSnapshot:
        if transaction is not None:
            return transaction._lesen(self)
        with self._client.engine.connect() as conn:
            return DocumentSnapshot(self, _lesen(conn, self))

    def set(self, daten: dict, merge: bool = False) -> None:
        self._client._schreiben([("set", self, daten, merge)])

    def update(self, daten: dict) -> None:
        self._client._schreiben([("update", self, daten, False)])

    def create(self, daten: dict) -> None:
        self._client._schreiben([("create", self, daten, False)])

    def delete(self) -> None:
        self._client._schreiben([("delete", self, None, False)])

    def __eq__(self, other: object) -> bool:
        return isinstance(other, DocumentReference) and other.path == self.path

    def __hash__(self) -> int:
        return hash(self.path)

    def __repr__(self) -> str:
        return f"DocumentReference({self.path!r})"


class Query:
    ASCENDING = ASCENDING
    DESCENDING = DESCENDING

    def __init__(self, client: "Client", sammlung: str, filter_=(), sortierung=(), grenze: int | None = None):
        self._client = client
        self._sammlung = sammlung
        self._filter = tuple(filter_)
        self._sortierung = tuple(sortierung)
        self._grenze = grenze

    def where(self, field_path: str | None = None, op_string: str | None = None, value: Any = None, *, filter: Any = None) -> "Query":  # noqa: A002
        if filter is not None:
            field_path, op_string, value = filter.field_path, filter.op_string, filter.value
        if op_string not in ("==", "<", "<=", ">", ">=", "in"):
            raise ValueError(f"Abfrage mit {op_string!r} wird nicht unterstützt")
        if op_string == "in" and not isinstance(value, (list, tuple)):
            raise ValueError("in braucht eine Liste")
        return Query(self._client, self._sammlung, self._filter + ((_pfad(field_path), op_string, value),), self._sortierung, self._grenze)

    def order_by(self, field_path: str, direction: str = ASCENDING) -> "Query":
        return Query(self._client, self._sammlung, self._filter, self._sortierung + ((_pfad(field_path), direction),), self._grenze)

    def limit(self, count: int) -> "Query":
        return Query(self._client, self._sammlung, self._filter, self._sortierung, int(count))

    def _sql(self) -> tuple[str, dict]:
        sql = _Sql()
        bedingungen = [f"sammlung = {sql.param(self._sammlung)}"]
        ungleich: list[list[str]] = []
        for teile, op, wert in self._filter:
            if op == "==":
                bedingungen.append(_gleich(sql, teile, wert))
            elif op == "in":
                bedingungen.append("(" + " or ".join(_gleich(sql, teile, w) for w in wert) + ")" if wert else "false")
            else:
                bedingungen.append(_vergleich(sql, teile, op, wert))
                if teile not in ungleich:
                    ungleich.append(teile)
        sortierung = list(self._sortierung)
        # Wie Firestore: ein Bereich sortiert nach seinem Feld, wenn nichts anderes angegeben ist
        for teile in ungleich:
            if not any(s[0] == teile for s in sortierung):
                sortierung.append((teile, sortierung[-1][1] if sortierung else ASCENDING))
        teile_sql = []
        for teile, richtung in sortierung:
            bedingungen.append(f"(daten #> {_sql_pfad(teile)}) is not null")
            teile_sql.extend(_sortierung(teile, richtung))
        letzte = sortierung[-1][1] if sortierung else ASCENDING
        teile_sql.append(f"id {'desc' if letzte == DESCENDING else 'asc'}")
        text = f"select id, daten from dokumente where {' and '.join(bedingungen)} order by {', '.join(teile_sql)}"
        if self._grenze is not None:
            text += f" limit {max(0, self._grenze)}"
        return text, sql.params

    def _abrufen(self, conn) -> list[DocumentSnapshot]:
        from sqlalchemy import text

        abfrage, params = self._sql()
        zeilen = conn.execute(text(abfrage), params).all()
        return [DocumentSnapshot(DocumentReference(self._client, self._sammlung, z.id), dekodieren(z.daten)) for z in zeilen]

    def stream(self, transaction: "Transaction | None" = None) -> Iterable[DocumentSnapshot]:
        if transaction is not None:
            return iter(transaction._abfragen(self))
        with self._client.engine.connect() as conn:
            return iter(self._abrufen(conn))

    def get(self, transaction: "Transaction | None" = None) -> list[DocumentSnapshot]:
        return list(self.stream(transaction=transaction))

    def on_snapshot(self, callback: Callable) -> "Watch":
        return self._client._lauscher().anmelden(self, callback)


class CollectionReference(Query):
    def __init__(self, client: "Client", pfad: str):
        teile = pfad.strip("/").split("/")
        if len(teile) % 2 != 1:
            raise ValueError(f"Kein Pfad einer Sammlung: {pfad!r}")
        super().__init__(client, "/".join(teile))

    @property
    def id(self) -> str:
        return self._sammlung.rsplit("/", 1)[-1]

    @property
    def path(self) -> str:
        return self._sammlung

    @property
    def parent(self) -> DocumentReference | None:
        if "/" not in self._sammlung:
            return None
        oben, doc_id = self._sammlung.rsplit("/", 2)[0], self._sammlung.rsplit("/", 2)[1]
        return DocumentReference(self._client, oben, doc_id)

    def document(self, document_id: str | None = None) -> DocumentReference:
        doc_id = document_id or neue_id()
        if "/" in doc_id:
            raise ValueError("ID ohne /")
        return DocumentReference(self._client, self._sammlung, doc_id)

    def add(self, daten: dict) -> tuple[datetime, DocumentReference]:
        ref = self.document()
        ref.create(daten)
        return datetime.now(UTC), ref


# --- Lesen und Schreiben in SQL ---------------------------------------------------------------------------------------


def _lesen(conn, ref: DocumentReference) -> dict | None:
    from sqlalchemy import text

    zeile = conn.execute(
        text("select daten from dokumente where sammlung = :s and id = :i"), {"s": ref._sammlung, "i": ref.id}
    ).first()
    return dekodieren(zeile.daten) if zeile is not None else None


def _anwenden(conn, vorgaenge: list[tuple], stand: dict[DocumentReference, dict | None] | None = None) -> None:
    """Schreibvorgänge nacheinander auf den Stand anwenden und das Ergebnis in die Tabelle schreiben (in conn)."""
    from sqlalchemy import text

    stand = {} if stand is None else stand
    jetzt = datetime.now(UTC)
    geaendert: list[DocumentReference] = []
    for art, ref, daten, merge in vorgaenge:
        if ref not in stand:
            stand[ref] = _lesen(conn, ref)
        alt = stand[ref]
        if art == "delete":
            neu = None
        elif art == "create":
            if alt is not None:
                raise Conflict(f"Dokument gibt es schon: {ref.path}")
            neu = _sonderwerte(daten, jetzt)
        elif art == "update":
            if alt is None:
                raise NotFound(f"Kein Dokument zum Ändern: {ref.path}")
            neu = _aktualisieren(alt, daten, jetzt)
        elif merge:
            neu = _zusammenfuehren(alt or {}, daten, jetzt)
        else:
            neu = _sonderwerte(daten, jetzt)
        stand[ref] = neu
        if ref not in geaendert:
            geaendert.append(ref)
    for ref in geaendert:
        neu = stand[ref]
        params = {"s": ref._sammlung, "i": ref.id}
        if neu is None:
            conn.execute(text("delete from dokumente where sammlung = :s and id = :i"), params)
        else:
            params["d"] = json.dumps(kodieren(neu), ensure_ascii=False)
            conn.execute(
                text(
                    "insert into dokumente (sammlung, id, daten, geaendert) values (:s, :i, cast(:d as jsonb), now()) "
                    "on conflict (sammlung, id) do update set daten = excluded.daten, geaendert = now()"
                ),
                params,
            )
        conn.execute(text("select pg_notify(:k, :n)"), {"k": KANAL, "n": json.dumps({"s": ref._sammlung, "i": ref.id})})


def _wiederholbar(fehler: Exception) -> bool:
    orig = getattr(fehler, "orig", fehler)
    return getattr(orig, "sqlstate", None) in WIEDERHOLEN


class Transaction:
    """Transaktion wie bei Firestore: lesen, dann schreiben; alles oder nichts, bei Konflikt noch einmal"""

    def __init__(self, client: "Client", max_attempts: int = 5):
        self._client = client
        self._max_attempts = max(1, int(max_attempts))
        self._conn = None
        self._vorgaenge: list[tuple] = []
        self._stand: dict[DocumentReference, dict | None] = {}

    def _lesen(self, ref: DocumentReference) -> DocumentSnapshot:
        if self._conn is None:
            raise ValueError("Transaktion läuft nicht (Funktion mit @store.transactional aufrufen)")
        daten = _lesen(self._conn, ref)
        self._stand[ref] = daten
        return DocumentSnapshot(ref, deepcopy(daten))

    def _abfragen(self, query: Query) -> list[DocumentSnapshot]:
        if self._conn is None:
            raise ValueError("Transaktion läuft nicht (Funktion mit @store.transactional aufrufen)")
        return query._abrufen(self._conn)

    def get(self, ref_or_query, **_: Any):
        if isinstance(ref_or_query, DocumentReference):
            return iter([self._lesen(ref_or_query)])
        return iter(self._abfragen(ref_or_query))

    def set(self, ref: DocumentReference, daten: dict, merge: bool = False) -> None:
        self._vorgaenge.append(("set", ref, daten, merge))

    def update(self, ref: DocumentReference, daten: dict) -> None:
        self._vorgaenge.append(("update", ref, daten, False))

    def create(self, ref: DocumentReference, daten: dict) -> None:
        self._vorgaenge.append(("create", ref, daten, False))

    def delete(self, ref: DocumentReference) -> None:
        self._vorgaenge.append(("delete", ref, None, False))

    def ausfuehren(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        for versuch in range(1, self._max_attempts + 1):
            self._vorgaenge, self._stand = [], {}
            conn = self._client.engine.connect().execution_options(isolation_level="SERIALIZABLE")
            try:
                with conn.begin():
                    self._conn = conn
                    ergebnis = fn(self, *args, **kwargs)
                    # Gelesenes zählt als Stand; was nicht gelesen wurde, liest _anwenden selbst
                    _anwenden(conn, self._vorgaenge, dict(self._stand))
                return ergebnis
            except Exception as e:
                if not _wiederholbar(e):
                    raise
                if versuch == self._max_attempts:
                    raise Aborted(f"Transaktion nach {versuch} Versuchen abgebrochen (Konflikt)") from e
                time.sleep(random.uniform(0.01, 0.05) * versuch)
            finally:
                self._conn = None
                conn.close()
        raise Aborted("Transaktion abgebrochen")


class WriteBatch:
    def __init__(self, client: "Client"):
        self._client = client
        self._vorgaenge: list[tuple] = []

    def set(self, ref: DocumentReference, daten: dict, merge: bool = False) -> None:
        self._vorgaenge.append(("set", ref, daten, merge))

    def update(self, ref: DocumentReference, daten: dict) -> None:
        self._vorgaenge.append(("update", ref, daten, False))

    def create(self, ref: DocumentReference, daten: dict) -> None:
        self._vorgaenge.append(("create", ref, daten, False))

    def delete(self, ref: DocumentReference) -> None:
        self._vorgaenge.append(("delete", ref, None, False))

    def commit(self) -> list:
        vorgaenge, self._vorgaenge = self._vorgaenge, []
        if vorgaenge:
            self._client._schreiben(vorgaenge)
        return []

    def __len__(self) -> int:
        return len(self._vorgaenge)


def transactional(fn: Callable) -> Callable:
    """Gegenstück zu google.cloud.firestore.transactional für Transaction aus diesem Modul"""

    def ausfuehren(transaction: Transaction, *args: Any, **kwargs: Any) -> Any:
        return transaction.ausfuehren(fn, *args, **kwargs)

    return ausfuehren


# --- Live-Abfragen ----------------------------------------------------------------------------------------------------


class ChangeType(enum.Enum):
    ADDED = 1
    MODIFIED = 2
    REMOVED = 3


class DocumentChange:
    def __init__(self, art: ChangeType, document: DocumentSnapshot):
        self.type = art
        self.document = document


class Watch:
    def __init__(self, lauscher: "Lauscher", query: Query, callback: Callable):
        self._lauscher = lauscher
        self.query = query
        self.callback = callback
        self._closed = False
        self.stand: dict[str, DocumentSnapshot] | None = None

    def unsubscribe(self) -> None:
        self._closed = True
        self._lauscher.abmelden(self)

    def neu_rechnen(self) -> None:
        if self._closed:
            return
        lesezeit = datetime.now(UTC)
        with self._lauscher.client.engine.connect() as conn:
            docs = self.query._abrufen(conn)
        neu = {d.id: d for d in docs}
        alt = self.stand
        aenderungen = []
        if alt is None:
            aenderungen = [DocumentChange(ChangeType.ADDED, d) for d in docs]
        else:
            for d in docs:
                vorher = alt.get(d.id)
                if vorher is None:
                    aenderungen.append(DocumentChange(ChangeType.ADDED, d))
                elif vorher._daten != d._daten:
                    aenderungen.append(DocumentChange(ChangeType.MODIFIED, d))
            aenderungen.extend(DocumentChange(ChangeType.REMOVED, v) for k, v in alt.items() if k not in neu)
        erster = alt is None
        self.stand = neu
        if (erster or aenderungen) and not self._closed:
            self.callback(docs, aenderungen, lesezeit)


class Lauscher:
    """Ein Thread je Prozess: LISTEN dokumente, betroffene Abfragen neu rechnen (siehe Kopf der Datei)"""

    def __init__(self, client: "Client"):
        self.client = client
        self._lock = threading.Lock()
        self._watches: list[Watch] = []
        self._offen: set[Watch] = set()
        self._wecker = threading.Event()
        self._thread: threading.Thread | None = None
        self._hoerer: threading.Thread | None = None

    def anmelden(self, query: Query, callback: Callable) -> Watch:
        watch = Watch(self, query, callback)
        with self._lock:
            self._watches.append(watch)
            self._offen.add(watch)
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._rechnen_schleife, name="speicher-live", daemon=True)
                self._thread.start()
            if self._hoerer is None or not self._hoerer.is_alive():
                self._hoerer = threading.Thread(target=self._hoeren_schleife, name="speicher-listen", daemon=True)
                self._hoerer.start()
        self._wecker.set()
        return watch

    def abmelden(self, watch: Watch) -> None:
        with self._lock:
            if watch in self._watches:
                self._watches.remove(watch)
            self._offen.discard(watch)

    def _betroffen(self, sammlung: str | None) -> None:
        with self._lock:
            for w in self._watches:
                if sammlung is None or w.query._sammlung == sammlung:
                    self._offen.add(w)
        self._wecker.set()

    def _rechnen_schleife(self) -> None:
        naechste_runde = time.monotonic() + NEU_RECHNEN_SEKUNDEN
        while True:
            self._wecker.wait(timeout=1.0)
            self._wecker.clear()
            if time.monotonic() >= naechste_runde:
                naechste_runde = time.monotonic() + NEU_RECHNEN_SEKUNDEN
                self._betroffen(None)
            time.sleep(0.02)  # mehrere Hinweise kurz hintereinander zusammenfassen
            with self._lock:
                offen, self._offen = list(self._offen), set()
            for w in offen:
                try:
                    w.neu_rechnen()
                except Exception:  # nie den Thread sterben lassen; die nächste Runde versucht es wieder
                    log.exception("Live-Abfrage nicht neu gerechnet (%s)", w.query._sammlung)
                    with self._lock:
                        if w in self._watches:
                            self._offen.add(w)

    def _hoeren_schleife(self) -> None:
        import psycopg

        from app.libs import datenbank

        while True:
            try:
                with psycopg.connect(datenbank.psycopg_url(), autocommit=True, connect_timeout=5) as conn:
                    conn.execute(f"listen {KANAL}")
                    # Nach (Neu-)Verbinden alles neu rechnen: in der Lücke kann etwas passiert sein
                    self._betroffen(None)
                    while True:
                        for hinweis in conn.notifies(timeout=5.0):
                            try:
                                sammlung = json.loads(hinweis.payload).get("s")
                            except ValueError:
                                sammlung = None
                            self._betroffen(sammlung)
            except Exception:
                log.exception("LISTEN %s unterbrochen, verbinde neu", KANAL)
                time.sleep(3)


# --- Client -----------------------------------------------------------------------------------------------------------


class Client:
    def __init__(self, engine=None):
        if engine is None:
            from app.libs import datenbank

            engine = datenbank.engine()
        self.engine = engine
        self._lauscher_obj: Lauscher | None = None
        self._lauscher_lock = threading.Lock()

    def collection(self, pfad: str) -> CollectionReference:
        return CollectionReference(self, pfad)

    def document(self, pfad: str) -> DocumentReference:
        teile = pfad.strip("/").split("/")
        if len(teile) % 2 != 0:
            raise ValueError(f"Kein Pfad eines Dokuments: {pfad!r}")
        return DocumentReference(self, "/".join(teile[:-1]), teile[-1])

    def transaction(self, max_attempts: int = 5, **_: Any) -> Transaction:
        return Transaction(self, max_attempts=max_attempts)

    def batch(self) -> WriteBatch:
        return WriteBatch(self)

    def _schreiben(self, vorgaenge: list[tuple], versuche: int = 10) -> None:
        for versuch in range(1, versuche + 1):
            conn = self.engine.connect().execution_options(isolation_level="SERIALIZABLE")
            try:
                with conn.begin():
                    _anwenden(conn, vorgaenge)
                return
            except Exception as e:
                if not _wiederholbar(e) or versuch == versuche:
                    if _wiederholbar(e):
                        raise Aborted(f"Schreiben nach {versuch} Versuchen abgebrochen (Konflikt)") from e
                    raise
                time.sleep(random.uniform(0.01, 0.05) * versuch)
            finally:
                conn.close()

    def _lauscher(self) -> Lauscher:
        with self._lauscher_lock:
            if self._lauscher_obj is None:
                self._lauscher_obj = Lauscher(self)
            return self._lauscher_obj
