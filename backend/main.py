import os
import pathlib
import json
import dotenv
from fastapi import FastAPI, APIRouter, Depends

dotenv.load_dotenv()

from databutton_app.mw.auth_mw import get_authorized_user


def get_router_config() -> dict:
    try:
        # Note: This file is not available to the agent
        cfg = json.loads(open("routers.json").read())
    except:
        return False
    return cfg


def is_auth_disabled(router_config: dict, name: str) -> bool:
    return router_config["routers"][name]["disableAuth"]


def import_api_routers() -> APIRouter:
    """Create top level router including all user defined endpoints."""
    routes = APIRouter(prefix="/routes")

    router_config = get_router_config()

    src_path = pathlib.Path(__file__).parent

    # Import API routers from "src/app/apis/*/__init__.py"
    apis_path = src_path / "app" / "apis"

    api_names = [
        p.relative_to(apis_path).parent.as_posix()
        for p in apis_path.glob("*/__init__.py")
    ]

    api_module_prefix = "app.apis."

    for name in api_names:
        print(f"Importing API: {name}")
        try:
            api_module = __import__(api_module_prefix + name, fromlist=[name])
            api_router = getattr(api_module, "router", None)
            if isinstance(api_router, APIRouter):
                routes.include_router(
                    api_router,
                    dependencies=(
                        []
                        if is_auth_disabled(router_config, name)
                        else [Depends(get_authorized_user)]
                    ),
                )
        except Exception as e:
            print(e)
            continue

    print(routes.routes)

    return routes


def create_app() -> FastAPI:
    """Create the app. This is called by uvicorn with the factory option to construct the app object."""
    app = FastAPI()
    app.include_router(import_api_routers())
    # Fehlermeldungen (detail) in der Sprache der Anfrage (app/i18n)
    from app.i18n import uebersetzte_fehler

    uebersetzte_fehler(app)

    # Stadtseiten, sitemap.xml (app/seo.py), Salon-Verzeichnis (app/verzeichnis_seiten.py), Hilfe (app/hilfe) und
    # Einbau-Kasten (app/einbau.py): unter eigenem Pfad (Caddy leitet ihn weiter) und unter /routes/seo
    from app import einbau, hilfe, seo, vergleich, verzeichnis_seiten

    app.include_router(seo.router)
    app.include_router(seo.router, prefix="/routes/seo")
    app.include_router(verzeichnis_seiten.router)
    app.include_router(verzeichnis_seiten.router, prefix="/routes/seo")
    app.include_router(hilfe.router)
    app.include_router(hilfe.router, prefix="/routes/seo")
    app.include_router(einbau.router)
    app.include_router(einbau.router, prefix="/routes/seo")
    app.include_router(vergleich.router)
    app.include_router(vergleich.router, prefix="/routes/seo")

    # Termin-API der Läden mit eigener Beschreibung (/api/v1/docs), Zugang per Schlüssel je Laden (app/schnittstelle)
    from app import schnittstelle

    app.mount("/api/v1", schnittstelle.app)

    for route in app.routes:
        if hasattr(route, "methods"):
            for method in route.methods:
                print(f"{method} {route.path}")

    # Anmeldung über die eigene Sitzung (app/libs/anmeldung.py, databutton_app/mw/auth_mw.py), nicht mehr über Firebase

    @app.on_event("startup")
    def datenbank_melden() -> None:
        # PostgreSQL (app/libs/datenbank.py): bis Stufe 3 nur der Befund im Log, die Daten liegen noch in Firestore
        from app.libs.datenbank import zustand

        print(f"Datenbank: {zustand()}")

    @app.on_event("startup")
    def autostart_scheduler() -> None:
        # "Früher dran" braucht den Hintergrunddienst; vorher musste ihn jemand nach
        # jedem Neustart von Hand starten. Ohne Datenbank (QME_DATABASE_URL) bleibt er aus.
        from app.libs.datenbank import database_url

        if os.environ.get("QME_SCHEDULER_AUTOSTART", "1") != "1":
            print("Scheduler autostart disabled (QME_SCHEDULER_AUTOSTART)")
        elif not database_url():
            print("Scheduler autostart skipped: no database (QME_DATABASE_URL)")
        else:
            from app.apis.schedulers import start_scheduler_thread

            start_scheduler_thread()
            print("Scheduler autostarted")

            # "Gleich dran", "Du bist dran" und Termin-Erinnerungen (app/libs/notify_worker.py)
            from app.libs.notify_worker import start_notify_worker

            start_notify_worker()
            print("Notify worker autostarted")

            # Team-Vermerke für die Firestore-Regeln an die Personen angleichen (app/libs/team.py), Kontaktdaten der
            # Personen vom öffentlichen Eintrag zu den Kontaktdaten des Ladens umziehen (app/libs/staff_contacts.py)
            import threading

            def sync_team() -> None:
                from app.apis.firebase_utils import get_firestore_db

                try:
                    from app.libs.team import sync_members

                    print(f"Team-Vermerke abgeglichen: {sync_members(get_firestore_db())}")
                except Exception as e:  # Start des Dienstes nie daran scheitern lassen
                    print(f"Team-Vermerke nicht abgeglichen: {e}")
                try:
                    from app.libs.staff_contacts import migrate

                    print(f"Kontaktdaten des Teams umgezogen: {migrate(get_firestore_db())} Personen")
                except Exception as e:
                    print(f"Kontaktdaten des Teams nicht umgezogen: {e}")
                try:
                    from app.libs import shop_privat

                    print(f"Stripe-IDs und Sperr-Konten nach privat umgezogen: {shop_privat.migrate(get_firestore_db())} Läden")
                except Exception as e:
                    print(f"Stripe-IDs und Sperr-Konten nicht umgezogen: {e}")

            threading.Thread(target=sync_team, daemon=True).start()

            # Öffentliche Kurzfassung der Termine anlegen und laufend abgleichen (app/libs/public_appointments.py)
            from app.libs.public_appointments import start_public_sync

            start_public_sync()

            # Webhooks der Termin-API: Änderungen an Terminen melden und zustellen (app/libs/webhooks.py)
            from app.libs.webhooks import start_webhooks

            start_webhooks()

    return app


app = create_app()
# trigger reload
