"""
Telefon-Assistent, öffentlich: Bei welchen Läden kann man per Telefon buchen?

    GET /telefon-hinweis   {"laeden": ["Laden-ID", …]}

Nur die IDs: Freigabe, Minuten und Nummern bleiben beim Backend (firestore.rules). Die Regel steht in
app/libs/telefon_laeden.py. Im Zweifel keiner, eine fehlende Option schadet weniger als eine falsche.
"""
import logging

from fastapi import APIRouter, Response

from app import seo
from app.apis.firebase_utils import get_firestore_db
from app.libs import telefon_laeden as tl

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/telefon-hinweis")
def hinweis(response: Response) -> dict:
    response.headers["Cache-Control"] = f"public, max-age={seo.CACHE_SECONDS}"
    try:
        return {"laeden": seo._cached("telefon-hinweis", lambda: tl.nehmen_an(get_firestore_db()))}
    except Exception:
        log.exception("Telefon-Hinweis: Läden nicht lesbar")
        return {"laeden": []}
