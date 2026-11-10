"""Alte Vergleichsseite "Buchungsplattformen für Friseure": umgezogen nach salonlotse.de (eigene Seite der ITEBV GmbH,
Repo itebvgmbh/salonlotse). Auf dranzeit.de steht an ihrer Stelle der Ersparnis-Rechner (/rechner, frontend/src/pages/Rechner.tsx).

Alte Links und Suchtreffer unter /vergleich/… leiten dauerhaft (301) dorthin weiter, damit sie nicht ins Leere laufen.
Caddy gibt /vergleich ans Backend (deploy/caddy-domain.py), die App leitet auf /routes/seo/vergleich/… (StadtWeiterleitung).
"""

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

BASE_PATH = "/vergleich"
ZIEL = "https://salonlotse.de/"

router = APIRouter(include_in_schema=False)


@router.api_route(BASE_PATH, methods=["GET", "HEAD"])
@router.api_route(BASE_PATH + "/{rest:path}", methods=["GET", "HEAD"])
def nach_salonlotse(rest: str = "") -> RedirectResponse:
    return RedirectResponse(ZIEL, status_code=301, headers={"Cache-Control": "public, max-age=86400"})
