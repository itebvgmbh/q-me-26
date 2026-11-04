"""Früher der Zugang zu Firebase (Admin SDK). Seit Stufe 5 von requirements/eigene-datenbank.md gibt es kein Firebase
mehr im Backend. Geblieben ist get_firestore_db(): Fast alle Module holen ihren Datenbank-Client hier, deshalb behält
die Funktion ihren Namen und gibt den Client der Speicher-Schicht zurück (app/store, PostgreSQL).
"""

from fastapi import APIRouter

router = APIRouter()


def get_firestore_db():
    """Der Datenbank-Client (app/store.db(), PostgreSQL); der Name ist historisch"""
    from app import store

    return store.db()
