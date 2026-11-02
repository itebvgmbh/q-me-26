"""
Telefon-Assistent, öffentlich: Darf die Ladenseite neben der Nummer sagen, dass der Assistent abnimmt?

    GET /telefon-hinweis/{shop_id}   {"annahme": true} oder {"annahme": false}

Nur Ja oder Nein: Freigabe, Minuten und Nummern bleiben beim Backend (firestore.rules). Die Regel steht in
app/libs/telefon_laeden.py. Im Zweifel Nein, ein fehlender Hinweis schadet weniger als ein falscher.
"""
import logging

from fastapi import APIRouter, Response

from app.apis.firebase_utils import get_firestore_db
from app.libs import telefon as t
from app.libs import telefon_laeden as tl

log = logging.getLogger(__name__)

router = APIRouter()

CACHE_SEKUNDEN = 60


@router.get("/telefon-hinweis/{shop_id}")
def hinweis(shop_id: str, response: Response) -> dict:
    response.headers["Cache-Control"] = f"public, max-age={CACHE_SEKUNDEN}"
    if not t.ID_RE.fullmatch(shop_id):
        return {"annahme": False}
    try:
        return {"annahme": tl.nimmt_an(get_firestore_db(), shop_id)}
    except Exception:
        log.exception("Telefon-Hinweis: Laden %s nicht lesbar", shop_id)
        return {"annahme": False}
