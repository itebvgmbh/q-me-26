"""Team-Einladung: Der Inhaber legt unter "Team" eine Person an und schickt ihr den Link
/staff-registration?token=…  Damit legt die Person ein Konto an (oder meldet sich mit ihrem bestehenden an)
und wird mit genau diesem Eintrag verbunden. Danach sieht sie unter "Mein Tag" ihre Kunden.

Der Link hängt am Eintrag in der Sammlung staff, nicht an der E-Mail-Adresse. Gespeichert wird nur der
SHA-256-Hash des Tokens (inviteTokenHash): Die Sammlung ist für die Buchung lesbar, das Token selbst kennt nur,
wer den Link bekommen hat. Ein neuer Link ersetzt den alten.

Öffentlich ist nur, ob der Link gilt, von welchem Laden er ist und für wen. Annehmen geht nur angemeldet und nur
einmal: Ist der Eintrag schon mit einem Konto verbunden, kann ihn kein anderes Konto mehr übernehmen.
"""

import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from google.cloud import firestore as gcf
from pydantic import BaseModel

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.libs.links import new_token, public_origin, token_hash
from app.libs.mail import MailError, branded_html, esc, send_mail
from app.libs.onboarding_mail import is_test_address
from app.libs.team import set_member

router = APIRouter()

VALID_DAYS = 14
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{16,128}")
NOT_FOUND = "Diesen Einladungslink gibt es nicht oder er wurde durch einen neueren ersetzt. Bitte deinen Laden um einen neuen."


def _aware(value) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _shop(shop_id: str) -> dict:
    if not shop_id:
        return {}
    snap = get_firestore_db().collection("shops").document(shop_id).get()
    return (snap.to_dict() or {}) if snap.exists else {}


def _staff_by_token(token: str):
    """Eintrag zum Link als (Dokument, Daten) – 404, wenn es ihn nicht oder nicht eindeutig gibt"""
    if not TOKEN_RE.fullmatch(token or ""):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    docs = list(get_firestore_db().collection("staff").where("inviteTokenHash", "==", token_hash(token)).limit(2).stream())
    if len(docs) != 1:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return docs[0], docs[0].to_dict() or {}


def _status(data: dict, now: datetime) -> str:
    if data.get("userId"):
        return "verbunden"
    expires = _aware(data.get("inviteExpires"))
    if data.get("isActive") is False or (expires and expires < now):
        return "abgelaufen"
    return "offen"


def invitation_mail(shop_name: str, person: str, link: str) -> tuple[str, str, str]:
    """Betreff, HTML und Text der Einladung"""
    subject = f"Einladung ins Team von {shop_name}"
    hallo = f"Hallo {esc(person)}," if person else "Hallo,"
    html = branded_html(
        f"Du bist ins Team von {esc(shop_name)} eingeladen",
        [
            f"{hallo} <strong>{esc(shop_name)}</strong> nutzt Dranzeit für Termine und die Warteschlange und hat dich ins Team eingeladen.",
            "Leg über den Link dein Konto an oder melde dich mit deinem bestehenden an. Danach siehst du unter „Mein Tag“ deine eigenen Kunden.",
        ],
        button_text="Einladung annehmen",
        button_url=link,
        note=f"Der Link gilt {VALID_DAYS} Tage. Fragen beantwortet dir dein Laden.",
    )
    text = (
        f"Du bist ins Team von {shop_name} eingeladen.\n\n"
        f"{shop_name} nutzt Dranzeit für Termine und die Warteschlange. "
        "Leg über diesen Link dein Konto an oder melde dich mit deinem bestehenden an:\n"
        f"{link}\n\n"
        f"Der Link gilt {VALID_DAYS} Tage. Fragen beantwortet dir dein Laden.\n"
    )
    return subject, html, text


class InviteRequest(BaseModel):
    staff_id: str
    send_email: bool = False


@router.post("/staff-invitation")
def create_invitation(body: InviteRequest, request: Request, user: AuthorizedUser) -> dict:
    """Neuen Einladungslink für einen Eintrag im Team; mit send_email auch gleich per E-Mail.

    Der Link kommt immer zurück, auch wenn die E-Mail nicht rausging – dann steht in email_problem, warum."""
    db = get_firestore_db()
    ref = db.collection("staff").document(body.staff_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Diese Person gibt es nicht mehr. Lade die Seite neu.")
    staff = snap.to_dict() or {}
    require_shop_of_owner(user, staff.get("shopId", ""))
    name = staff.get("name") or "Die Person"
    if staff.get("userId"):
        raise HTTPException(status_code=409, detail=f"{name} hat schon ein Konto und sieht „Mein Tag“.")
    if staff.get("isActive") is False:
        raise HTTPException(status_code=409, detail=f"{name} ist deaktiviert. Hol sie zuerst zurück ins Team.")
    email = (staff.get("email") or "").strip()
    if body.send_email and not email:
        raise HTTPException(status_code=400, detail="Für die E-Mail fehlt die Adresse. Trag sie unter „Bearbeiten“ ein und speichere.")

    token = new_token()
    link = f"{public_origin(request)}/staff-registration?token={token}"
    expires = datetime.now(timezone.utc) + timedelta(days=VALID_DAYS)
    ref.update(
        {
            "inviteTokenHash": token_hash(token),
            "inviteCreatedAt": gcf.SERVER_TIMESTAMP,
            "inviteExpires": expires,
            "inviteEmailSentAt": gcf.DELETE_FIELD,
            "inviteEmailTo": gcf.DELETE_FIELD,
            "updatedAt": gcf.SERVER_TIMESTAMP,
        }
    )

    email_sent, email_problem = False, ""
    if body.send_email and is_test_address(email):
        # Testläden (dev/fixtures.py, Oberflächentests): keine echte Mail an reservierte Domains
        email_problem = "An Testadressen wie example.com verschickt Dranzeit keine E-Mails."
    elif body.send_email:
        shop_name = _shop(staff.get("shopId", "")).get("name") or "deinem Laden"
        subject, html, text = invitation_mail(shop_name, staff.get("name", ""), link)
        try:
            email_sent = send_mail(email, subject, html, text)
            if not email_sent:
                email_problem = "Der E-Mail-Versand ist gerade nicht eingerichtet."
        except MailError as e:
            print(f"Team-Einladung an {email} nicht verschickt: {e}")
            email_problem = "Die E-Mail konnte nicht verschickt werden."
        if email_sent:
            ref.update({"inviteEmailSentAt": gcf.SERVER_TIMESTAMP, "inviteEmailTo": email})

    return {"link": link, "expires": expires.isoformat(), "email_sent": email_sent, "email_problem": email_problem}


@router.get("/staff-invitation/{token}")
def invitation_info(token: str) -> dict:
    """Für die Seite /staff-registration vor dem Anmelden: gilt der Link, von welchem Laden, für wen?"""
    _, data = _staff_by_token(token)
    shop = _shop(data.get("shopId", ""))
    return {
        "status": _status(data, datetime.now(timezone.utc)),
        "shopName": shop.get("name") or "Dein Laden",
        "name": data.get("name") or "",
        "email": data.get("email") or "",
    }


@router.post("/staff-invitation/{token}")
def accept_invitation(token: str, user: AuthorizedUser) -> dict:
    """Eintrag mit dem angemeldeten Konto verbinden; das Konto bekommt die Rolle Mitarbeiter (Inhaber bleiben Inhaber)"""
    doc, data = _staff_by_token(token)
    shop_id = data.get("shopId", "")
    shop = _shop(shop_id)
    shop_name = shop.get("name") or "Dein Laden"
    result = {"shopName": shop_name, "staffId": doc.id}

    if data.get("userId"):
        if data["userId"] == user.sub:
            set_member(get_firestore_db(), shop_id, user.sub, doc.id)  # zweiter Klick holt einen fehlenden Vermerk nach
            return result
        raise HTTPException(status_code=409, detail="Diese Einladung wurde schon mit einem anderen Konto angenommen.")
    if _status(data, datetime.now(timezone.utc)) == "abgelaufen":
        raise HTTPException(status_code=410, detail="Die Einladung gilt nicht mehr. Bitte deinen Laden um einen neuen Link.")
    if shop.get("owner") == user.sub:
        raise HTTPException(
            status_code=409,
            detail="Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die eingeladene Person mit ihrem eigenen Konto.",
        )

    db = get_firestore_db()
    for other in db.collection("staff").where("userId", "==", user.sub).stream():
        o = other.to_dict() or {}
        if o.get("shopId") == shop_id and o.get("isActive") is not False:
            raise HTTPException(status_code=409, detail=f"Dein Konto steht im Team von {shop_name} schon als {o.get('name') or 'andere Person'}.")

    # Erst das Profil, zuletzt der Eintrag: Bricht es dazwischen ab, holt ein zweiter Klick den Rest
    users = db.collection("users").document(user.sub)
    profile = users.get()
    email = (getattr(user, "email", None) or "").strip()
    if not profile.exists:
        users.set({"uid": user.sub, "email": email, "role": "employee", "createdAt": gcf.SERVER_TIMESTAMP, "updatedAt": gcf.SERVER_TIMESTAMP})
    elif (profile.to_dict() or {}).get("role") not in ("employee", "shopOwner"):
        # Kundenkonto: wird Mitarbeiterkonto, "Meine Termine" bleibt erreichbar
        users.update({"role": "employee", "updatedAt": gcf.SERVER_TIMESTAMP})

    update = {"userId": user.sub, "inviteAcceptedAt": gcf.SERVER_TIMESTAMP, "updatedAt": gcf.SERVER_TIMESTAMP}
    if not (data.get("email") or "").strip() and email:
        update["email"] = email
    doc.reference.update(update)
    # Team-Vermerk für die Firestore-Regeln (Kundenliste, Termine im Laden), app/libs/team.py
    set_member(db, shop_id, user.sub, doc.id)
    return result
