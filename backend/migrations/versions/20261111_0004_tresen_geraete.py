"""Tresen-Tablets koppeln: Sitzungen mit Bereich, offene Kopplungen per QR-Code (app/libs/geraete.py)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-11

- sitzungen bekommt
  - bereich: leer = alles, „tresen“ = nur, was der Tresen braucht (Freigabeliste in app/libs/geraete.py, geprüft in
    databutton_app/mw/auth_mw.py),
  - laden: für welchen Laden das Tablet gekoppelt wurde,
  - geraet: Name in der Liste „Tablets am Tresen“ (z. B. „iPad“),
  - kennung: öffentliche ID der Sitzung, damit der Inhaber ein Tablet abmelden kann, ohne dass der Hash herausgeht.
- kopplungen: Ein Tablet ohne Anmeldung zeigt einen QR-Code. code ist der Hash des Werts im QR-Code (damit bestätigt
  das Handy des Inhabers), abholen der Hash eines zweiten Geheimnisses, das nur das Tablet kennt: Nur damit bekommt
  es nach der Bestätigung seine Sitzung. pruefzahl steht auf Tablet und Handy, damit niemand einen fremden QR-Code
  bestätigt. Eine Kopplung gilt 10 Minuten und nur einmal.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        'alter table sitzungen add column bereich text, add column laden text, add column geraet text, '
        'add column kennung text collate "C"'
    )
    op.execute("create unique index sitzungen_kennung on sitzungen (kennung) where kennung is not null")
    op.execute(
        """
        create table kopplungen (
            code text collate "C" primary key,
            abholen text collate "C" not null unique,
            pruefzahl text not null,
            geraet text,
            angelegt timestamptz not null default now(),
            laeuft_ab timestamptz not null,
            uid text collate "C" references konten (uid) on delete cascade,
            laden text,
            bestaetigt timestamptz,
            abgeholt timestamptz
        )
        """
    )
    op.execute("create index kopplungen_angelegt on kopplungen (angelegt)")


def downgrade() -> None:
    op.execute("drop table kopplungen")
    op.execute("drop index sitzungen_kennung")
    op.execute("alter table sitzungen drop column kennung, drop column geraet, drop column laden, drop column bereich")
