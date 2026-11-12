"""Inhaber löscht einen eigenen Laden (Seite „Meine Läden“ und „Laden“ → „Laden löschen“, app/apis/laden_loeschen).

Gelöscht wird genau wie im Betreiber-Bereich (app/libs/konten.py plan_deletion/execute): der Laden samt Leistungen,
Team, Pausen, Terminen, Kundenliste, Belegung, Angeboten, Push-Abos, Schlüsseln der Schnittstelle, seiner Seite im
Verzeichnis und den hochgeladenen Bildern. Vorher eine Sicherung auf dem Server (.local_data/betreiber/sicherungen),
danach ein Eintrag im Protokoll des Betreiber-Bereichs. Konten bleiben – das des Inhabers und die des Teams.

Nicht löschbar, mit Hinweis, was zu tun ist:
- solange ein Abo läuft, das nicht gekündigt ist (Stripe buchte sonst weiter ab), oder eine Zahlung offen ist.
  Ein gekündigtes Abo läuft bis zum Ende des bezahlten Zeitraums aus; der Stripe-Webhook überspringt Abos ohne Laden.
- solange der Telefon-Assistent gebucht und nicht gekündigt ist (oder seine Zahlung offen),
- der Laden der ITEBV GmbH (gegen ihn laufen die Tests).
Kunden mit kommenden Terminen bekommen keine Nachricht; die Vorschau zählt sie, damit der Inhaber vorher absagt.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.i18n import merke
from app.libs import konten, protokoll
from app.libs.konten import ITEBV_SHOP, utc

OFFEN = ("scheduled", "in-progress")


class LoeschFehler(Exception):
    def __init__(self, status: int, text):
        super().__init__(text)
        self.status = status
        self.text = text


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def hindernis(db, shop_id: str, shop: dict) -> str | None:
    """Warum der Inhaber den Laden (noch) nicht löschen kann – oder None"""
    gefunden = _hindernis(db, shop_id, shop)
    return gefunden[1] if gefunden else None


def _hindernis(db, shop_id: str, shop: dict) -> tuple[str, str] | None:
    """(Art, Text): Art sagt dem Frontend, wohin es verlinkt (tarif, telefon), Text steht im Dialog"""
    from app.libs import telefon as tel
    from app.libs.plans import ACTIVE_BILLING
    from app.libs.shop_privat import LIVE, stripe_link

    if shop_id == ITEBV_SHOP:
        return "itebv", merke("Diesen Laden kann man hier nicht löschen.")
    billing = shop.get("billing") or {}
    modus, _ = stripe_link(db, shop_id, shop)
    if billing.get("status") in ACTIVE_BILLING and modus == LIVE:
        if billing.get("status") == "past_due":
            return "tarif", merke("Für diesen Laden ist noch eine Zahlung offen. Bring das unter „Tarif“ in Ordnung – danach kannst du ihn löschen.")
        if not billing.get("cancelAtPeriodEnd"):
            return "tarif", merke("Für diesen Laden läuft noch ein Abo. Kündige es zuerst unter „Tarif“ – danach kannst du den Laden löschen.")
    zusatz = tel.zusatz(db.collection(tel.LAEDEN).document(shop_id).get().to_dict() or {})
    offen = zusatz.get("status") in tel.ZAHLUNG_OFFEN or (zusatz.get("status") in tel.GEBUCHT and not zusatz.get("cancelAtPeriodEnd"))
    if offen and (zusatz.get("modus") or LIVE) == LIVE:  # gekündigt läuft er wie das Abo einfach aus
        return "telefon", merke("Für diesen Laden ist der Telefon-Assistent gebucht. Kündige ihn zuerst unter „Telefon-Assistent“.")
    return None


def _plan(db, shop_id: str, now: datetime) -> tuple[dict, dict]:
    plan = konten.plan_deletion(db, [], [shop_id], {}, now=now, gekuendigt_ok=True)
    if not plan["shops"]:
        raise LoeschFehler(404, merke("Diesen Laden gibt es nicht mehr."))
    return plan, plan["shops"][0]


def _kommende(eintrag: dict, now: datetime) -> int:
    n = 0
    for snap in eintrag["related"].get("appointments", []):
        t = snap.to_dict() or {}
        start = utc(t.get("startTime"))
        if t.get("status") == "in-progress" or (t.get("status") == "scheduled" and start and start > now):
            n += 1
    return n


def bestaetigung(eintrag: dict) -> str:
    """Was zum Löschen eingetippt werden muss: der Name des Ladens"""
    return (eintrag["name"] or eintrag["id"]).strip()


def vorschau(db, shop_id: str, now: datetime | None = None) -> dict:
    """Was weggeht und ob es geht. Ändert nichts."""
    now = now or _jetzt()
    plan, eintrag = _plan(db, shop_id, now)
    shop = eintrag["data"]
    billing = shop.get("billing") or {}
    related = eintrag["related"]
    grund = _hindernis(db, shop_id, shop)
    aktive_personen = [s for s in related.get("staff", []) if (s.to_dict() or {}).get("isActive", True)]
    return {
        "id": shop_id,
        "name": eintrag["name"],
        "bestaetigung": bestaetigung(eintrag),
        "hindernis": grund[1] if grund else None,
        "hindernisArt": grund[0] if grund else None,
        "anzahl": {
            "kommende": _kommende(eintrag, now),
            "termine": len(related.get("appointments", [])),
            "team": len(aktive_personen),
            "leistungen": len(related.get("services", [])),
            "kunden": len(related.get("customers", [])),
        },
        "gruender": eintrag["founder"],
        # Gekündigtes Abo: bezahlt bis hier, danach endet es von selbst
        "aboEndet": utc(billing.get("currentPeriodEnd")).isoformat()
        if billing.get("cancelAtPeriodEnd") and billing.get("status") in ("active", "trialing") and utc(billing.get("currentPeriodEnd"))
        else None,
    }


def loeschen(db, user, shop_id: str, eingabe: str, now: datetime | None = None) -> dict:
    """Sicherung, löschen, nachprüfen, ins Protokoll. Der Aufrufer hat geprüft, dass der Laden dem Konto gehört."""
    now = now or _jetzt()
    plan, eintrag = _plan(db, shop_id, now)
    grund = hindernis(db, shop_id, eintrag["data"])
    if grund:
        raise LoeschFehler(409, grund)
    if plan["problems"]:  # z. B. ein Abo im Testmodus, das plan_deletion anders sieht: lieber nicht
        print(f"Laden löschen {shop_id}: abgelehnt – {' '.join(plan['problems'])}")
        raise LoeschFehler(409, merke("Dieser Laden lässt sich gerade nicht löschen. Schreib uns an hilfe@dranzeit.de."))
    wort = bestaetigung(eintrag)
    if (eingabe or "").strip().casefold() != wort.casefold():
        raise LoeschFehler(400, merke("Zum Löschen tipp genau den Namen des Ladens ein: {name}", name=wort))

    auswahl = f"Laden {eintrag['name']} ({shop_id})"
    sicherung = protokoll.save_backup(konten.backup_data(plan, auswahl, "Inhaber"), now)
    ergebnis = konten.execute(db, plan, lambda uid: None)  # keine Konten im Plan
    reste = konten.verify(db, plan, lambda uid: False)
    try:
        from app import verzeichnis_seiten

        verzeichnis_seiten.vergessen()  # die Seite des Ladens im Verzeichnis ist mit weg
    except Exception as e:  # noqa: BLE001 – Zwischenspeicher, das Löschen ist schon geschehen
        print(f"Laden löschen {shop_id}: Verzeichnis nicht neu geladen: {e}")
    protokoll.write(user, "Laden gelöscht (vom Inhaber)", {"shopIds": [shop_id], "name": auswahl},
                    after={"ergebnis": ergebnis, "sicherung": sicherung.name, "reste": reste,
                           "gruenderFrei": plan["founders"]["freed"]}, now=now)
    if reste:
        print(f"Laden löschen {shop_id}: Reste – {'; '.join(reste)}")
    return {"geloescht": True, "reste": len(reste)}
