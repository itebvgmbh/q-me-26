"""Eigene Anmeldung: Konten, Sitzungen, Einmal-Links (Stufe 4, app/libs/anmeldung.py)

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-04

- konten: je Konto eine Zeile. uid ist die bisherige Firebase-ID (übernommene Konten) oder eine neue im selben Format,
  damit alle Verweise in den Daten (owner, userId, customerId …) gültig bleiben. passwort ist ein Argon2id-Hash oder
  leer: Dann prüft die erste Anmeldung das Passwort noch bei Firebase, oder die Person setzt es per Mail neu.
  E-Mail-Adressen sind ohne Rücksicht auf Groß- und Kleinschreibung eindeutig.
- sitzungen: angemeldete Geräte. Im Cookie steht ein Zufallswert, hier nur sein SHA-256. bestaetigt: wann das
  Passwort in dieser Sitzung zuletzt eingegeben wurde (Passwort ändern geht nur kurz danach).
- einmal_links: Links aus Mails (Passwort neu, Adresse bestätigen), ebenfalls nur als Hash. email: die Adresse, für
  die der Link gilt; ändert sich die Adresse des Kontos, gilt er nicht mehr.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        create table konten (
            uid text collate "C" primary key,
            email text not null,
            passwort text,
            email_bestaetigt boolean not null default false,
            gesperrt boolean not null default false,
            name text,
            herkunft text not null default 'dranzeit',
            angelegt timestamptz not null default now(),
            zuletzt_angemeldet timestamptz,
            geaendert timestamptz not null default now()
        )
        """
    )
    op.execute("create unique index konten_email on konten (lower(email))")
    op.execute(
        """
        create table sitzungen (
            hash text collate "C" primary key,
            uid text collate "C" not null references konten (uid) on delete cascade,
            angelegt timestamptz not null default now(),
            zuletzt timestamptz not null default now(),
            laeuft_ab timestamptz not null,
            bestaetigt timestamptz
        )
        """
    )
    op.execute("create index sitzungen_uid on sitzungen (uid)")
    op.execute(
        """
        create table einmal_links (
            hash text collate "C" primary key,
            uid text collate "C" not null references konten (uid) on delete cascade,
            zweck text not null,
            email text not null,
            angelegt timestamptz not null default now(),
            laeuft_ab timestamptz not null,
            benutzt timestamptz
        )
        """
    )
    op.execute("create index einmal_links_uid on einmal_links (uid)")


def downgrade() -> None:
    op.execute("drop table einmal_links")
    op.execute("drop table sitzungen")
    op.execute("drop table konten")
