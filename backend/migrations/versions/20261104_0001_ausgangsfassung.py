"""Ausgangsfassung: noch keine Tabellen, nur die Erweiterung für den Ausschluss von Doppelbuchungen

Revision ID: 0001
Revises:
Create Date: 2026-11-04

Bis Stufe 3 (requirements/eigene-datenbank.md) liegen alle Daten in Firestore. Diese Fassung legt nur fest, dass das
Schema ab jetzt über Alembic geführt wird, und stellt btree_gist sicher: Damit kann PostgreSQL später Termine derselben
Person mit überlappender Zeit selbst ablehnen (EXCLUDE USING gist).
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Auf dem Server legt deploy/datenbank.sh einrichten die Erweiterung als Administrator an; hier nur, wo sie fehlt
    # (Tests, neue Umgebungen). btree_gist ist eine vertrauenswürdige Erweiterung: der Eigentümer der Datenbank darf das.
    # Als DO-Block statt Abfrage in Python, damit auch "alembic upgrade head --sql" (ohne Verbindung) geht
    op.execute(
        """
        do $$
        begin
            if not exists (select 1 from pg_extension where extname = 'btree_gist') then
                create extension btree_gist;
            end if;
        end
        $$
        """
    )


def downgrade() -> None:
    # Die Erweiterung bleibt: Spätere Tabellen hängen an ihr, und entfernen dürfte sie nur der Administrator
    pass
