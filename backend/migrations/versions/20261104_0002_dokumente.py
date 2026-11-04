"""Tabelle dokumente: je Firestore-Dokument eine Zeile (Stufe 3, app/store/postgres.py)

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-04

Spalten (requirements/eigene-datenbank.md, „Speichern in PostgreSQL“):
- sammlung: Pfad der Sammlung, auch Unter-Sammlungen wie shops/<id>/members
- id: die Firestore-ID
- daten: Inhalt als jsonb, Zeitpunkte als {"__zeit": "…Z"}
- geaendert: letzte Änderung

Pfad und ID mit Sortierung "C" (Bytes), wie Firestore IDs und Texte vergleicht. Indizes: der Primärschlüssel für
Sammlung und ID (auch die Reihenfolge ohne order_by), ein GIN-Index für Gleichheit (daten @> …) und einer für
Zeitbereiche auf startTime (Termine je Tag, Live-Abfragen).
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        create table dokumente (
            sammlung text collate "C" not null,
            id text collate "C" not null,
            daten jsonb not null,
            geaendert timestamptz not null default now(),
            primary key (sammlung, id)
        )
        """
    )
    op.execute("create index dokumente_gleich on dokumente using gin (daten jsonb_path_ops)")
    op.execute(
        """
        create index dokumente_start on dokumente (sammlung, ((daten #>> '{startTime,__zeit}') collate "C"))
        where (daten #>> '{startTime,__zeit}') is not null
        """
    )


def downgrade() -> None:
    op.execute("drop table if exists dokumente")
