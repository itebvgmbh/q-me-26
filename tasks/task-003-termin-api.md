# Task — Termin-API für Läden mit Schlüssel je Laden

- **Status:** In Review (Code fertig 10.11.2026; offen: Live-Test mit echtem Schlüssel durch Stefan)
- **Touches:** backend, frontend, deploy (Caddy)
- **Requirement:** termin-api · step 1/1
- **Related:** Telefon-Assistent (`backend/app/apis/telefon`) als Vorbild für Zugang per Bearer-Token

## Context / Problem

Läden wollen Dranzeit an eigene Systeme anbinden (Webseite, Kasse, Agentur). Bisher gibt es nur Endpunkte für den
Browser mit Anmeldung (`/routes/team/…`) und den Telefon-Assistenten mit einem einzigen Token für alle Läden.

## Proposed change

- **Schlüssel** (`backend/app/libs/api_schluessel.py`, Sammlung `api_schluessel`): Format `dz_<id>_<geheim>`,
  gespeichert nur der SHA-256-Hash, Anfang zum Wiedererkennen, angelegt/zuletzt benutzt/widerrufen. Endpunkte für den
  Inhaber unter `/routes/team/laeden/{shopId}/api-schluessel` (Liste, anlegen, widerrufen).
- **Tarif-Baustein** `api` in `plans.py` und `plans.ts` (Solo, Laden, Team).
- **API** als eigene FastAPI-App (`backend/app/schnittstelle/`), eingehängt unter `/api/v1` mit eigener
  OpenAPI-Beschreibung (`/api/v1/docs`). Prüft je Anfrage Schlüssel, Laden, Sperre, Tarif und Bremse.
  - `GET /laden`, `GET /personen`
  - `GET/POST /leistungen`, `GET /leistungen/{id}`
  - `GET/POST /kunden`, `GET /kunden/{id}`
  - `GET /freie-zeiten`
  - `GET/POST /termine`, `GET /termine/{id}`, `POST /termine/{id}/verschieben`, `POST /termine/{id}/absagen`
- Buchen über die vorhandenen Bausteine: `online_platz.freier_platz`/`naechste_plaetze` für `online`,
  `buchung.create_appointment` für die Belegung, `team_termine.termin_aendern` für Verschieben und Absagen.
- **Caddy:** `handle /api/*` an das Backend (Vorlage `deploy/Caddyfile` und Server).
- **Frontend:** Kachel „Schnittstelle (API)“ unter „Laden“ → Seite `/schnittstelle` (nur Inhaber): Schlüssel anlegen,
  einmal anzeigen und kopieren, Liste, widerrufen, Link zur Beschreibung. Übersetzungen en/tr/ar.
- Laden löschen nimmt die Schlüssel mit (`konten.SHOP_COLLECTIONS`).

## Acceptance criteria

- `backend/tests/test_termin_api.py` grün: Zugang (fehlend, falsch, widerrufen, Tarif, gesperrt, fremder Laden),
  Leistungen, Kunden (ohne Doppel), freie Zeiten, Termin online/tresen, Platz weg → 409 mit Alternativen,
  „Früher dran“, Verschieben, Absagen (Kunde/Team benachrichtigen), Bremse.
- Bestehende Tests (`test_team_termine.py`, `test_telefon.py`, `test_plans.py`, `test_nummer.py`) bleiben grün.
- Produktions-Build des Frontends läuft; `dev/i18n-pruefen.mjs` ohne fehlende Übersetzungen.
- Live: Schlüssel anlegen, `GET /api/v1/laden` antwortet, `/api/v1/docs` lädt.

## Files

- neu: `backend/app/libs/api_schluessel.py`, `backend/app/schnittstelle/__init__.py`,
  `backend/tests/test_termin_api.py`, `frontend/src/pages/Schnittstelle.tsx`
- geändert: `backend/main.py`, `backend/app/apis/team_laden/__init__.py`, `backend/app/libs/plans.py`,
  `backend/app/libs/konten.py`, `backend/app/libs/throttle.py`, `frontend/src/utils/plans.ts`,
  `frontend/src/components/LadenUebersicht.tsx`, `frontend/src/user-routes.tsx`, `frontend/src/i18n/*`,
  `deploy/Caddyfile`

## Order / risk

1. Schlüssel + Tarif (klein, Grundlage). 2. API lesend. 3. API schreibend (Risiko: Doppelbuchung – über die
vorhandene Belegung abgesichert). 4. Oberfläche. 5. Caddy auf dem Server (nach `caddy validate`).
