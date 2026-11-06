"""Alembic-Umgebung: Adresse aus QME_DATABASE_URL (app/libs/datenbank.py), Fassungen in migrations/versions."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.libs.datenbank import sqlalchemy_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Tabellen werden in den Fassungen ausdrücklich beschrieben, nicht aus Modellen erzeugt
target_metadata = None


def run_migrations_offline() -> None:
    """SQL nur ausgeben (alembic upgrade head --sql), ohne Verbindung."""
    context.configure(url=sqlalchemy_url(), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(sqlalchemy_url(), poolclass=pool.NullPool, connect_args={"connect_timeout": 10})
    with connectable.connect() as connection:
        # Jede Fassung in einer eigenen Transaktion: schlägt eine fehl, bleiben die vorigen bestehen
        context.configure(connection=connection, target_metadata=target_metadata, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
