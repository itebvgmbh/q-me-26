"""
Läden finden, öffentlich: Wie viele warten gerade in diesen Läden?

    GET /laden-live?ids=a,b,c   {"warten": {"a": 2, "b": 0}}

Nur die Zahl: Namen und Zeiten bleiben beim Backend (firestore.rules). Gezählt wird wie im Einbau-Kasten
(seo.waiting_now, 60 s zwischengespeichert). Nur bestehende, nicht gesperrte Läden und höchstens MAX_IDS auf
einmal – erfundene IDs lösen keine Abfragen aus. Öffnungszeiten rechnet das Frontend selbst (utils/laden-live.ts).
"""
import logging
import re

from fastapi import APIRouter, Response

from app import seo
from app.apis.firebase_utils import get_firestore_db

log = logging.getLogger(__name__)

router = APIRouter()

MAX_IDS = 40
SHOP_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def sichtbare_laeden() -> set:
    """IDs der Läden, die Kunden sehen (nicht gesperrt)"""

    def load():
        return {doc.id for doc in get_firestore_db().collection("shops").stream() if not (doc.to_dict() or {}).get("suspended")}

    return seo._cached("laden-live:ids", load)


@router.get("/laden-live")
def laden_live(ids: str, response: Response) -> dict:
    response.headers["Cache-Control"] = f"public, max-age={seo.CACHE_SECONDS}"
    gefragt = [i for i in dict.fromkeys(ids.split(",")) if SHOP_ID.match(i)][:MAX_IDS]
    try:
        bekannt = sichtbare_laeden()
        return {"warten": {i: seo.waiting_now(i) for i in gefragt if i in bekannt}}
    except Exception:
        log.exception("Laden live: Wartende nicht lesbar")
        return {"warten": {}}
