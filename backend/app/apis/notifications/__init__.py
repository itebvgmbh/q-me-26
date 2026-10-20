from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
from pydantic import BaseModel, EmailStr
import databutton as db
from firebase_admin import firestore
from app.apis.firebase_utils import get_firestore_db

from fastapi import Depends
from app.auth import AuthorizedUser
from app.auth.access import require_admin, require_shop_of_owner
from app.libs.mail import branded_html, esc

router = APIRouter()

class EmailNotificationRequest(BaseModel):
    to: EmailStr
    subject: str
    content_html: str
    content_text: str
    template_data: Optional[Dict[str, Any]] = None

class StaffInvitationEmailRequest(BaseModel):
    invitation_id: str
    shop_id: str
    email: EmailStr
    invitation_link: str

@router.post("/send-email", dependencies=[Depends(require_admin)])
def send_email(request: EmailNotificationRequest) -> Dict[str, str]:
    """
    Send an email using the Databutton notify email service
    """
    try:
        # Send the email using Databutton's notify service
        db.notify.email(
            to=request.to,
            subject=request.subject,
            content_html=request.content_html,
            content_text=request.content_text,
        )
        
        return {"status": "success", "message": f"Email sent to {request.to}"}
    except Exception as e:
        print(f"Error sending email: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}") from e

@router.post("/send-staff-invitation")
async def send_staff_invitation(request: StaffInvitationEmailRequest, user: AuthorizedUser) -> Dict[str, str]:
    """
    Send a staff invitation email with a registration link
    """
    require_shop_of_owner(user, request.shop_id)
    try:
        # Get shop information
        db_client = get_firestore_db()
        shop_doc = db_client.collection('shops').document(request.shop_id).get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail=f"Shop with ID {request.shop_id} not found")
            
        shop_data = shop_doc.to_dict()
        shop_name = shop_data.get('name') or 'deinem Laden'
        
        # Update the invitation with email sent status if not using placeholder or temp ID
        if request.invitation_id != 'placeholder' and not request.invitation_id.startswith('temp-'):
            try:
                invitation_ref = db_client.collection('staff-invitations').document(request.invitation_id)
                invitation_ref.update({
                    'emailSent': True,
                    'emailSentAt': firestore.SERVER_TIMESTAMP
                })
                # Debug-Log für erfolgreiche Aktualisierung
                print(f"Invitation status updated successfully for ID: {request.invitation_id}")
            except Exception as e:
                print(f"Error updating invitation status for ID {request.invitation_id}: {str(e)}")
                # Weiter ausführen, auch wenn die Status-Aktualisierung fehlschlägt
        
        # E-Mail im Dranzeit-Design, du-Form wie in der App
        subject = f"Einladung ins Team von {shop_name}"
        content_html = branded_html(
            f"Du bist ins Team von {esc(shop_name)} eingeladen",
            [
                f"Hallo, <strong>{esc(shop_name)}</strong> nutzt Dranzeit für Termine und die Warteschlange und hat dich ins Team eingeladen.",
                "Leg dein Konto über den Link an. Danach siehst du unter „Mein Tag“ deine eigenen Kunden.",
            ],
            button_text="Einladung annehmen",
            button_url=request.invitation_link,
            note="Der Link gilt nur eine begrenzte Zeit. Fragen beantwortet dir der Inhaber des Ladens.",
        )
        content_text = (
            f"Du bist ins Team von {shop_name} eingeladen.\n\n"
            f"{shop_name} nutzt Dranzeit für Termine und die Warteschlange. "
            "Leg dein Konto über diesen Link an:\n"
            f"{request.invitation_link}\n\n"
            "Der Link gilt nur eine begrenzte Zeit. Fragen beantwortet dir der Inhaber des Ladens.\n"
        )

        # Send the email
        db.notify.email(
            to=request.email,
            subject=subject,
            content_html=content_html,
            content_text=content_text,
        )
        
        return {"status": "success", "message": f"Invitation email sent to {request.email}"}
    except Exception as e:
        print(f"Error sending staff invitation email: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send invitation email: {str(e)}") from e
