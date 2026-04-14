from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
from pydantic import BaseModel, EmailStr
import databutton as db
from firebase_admin import firestore
from app.apis.firebase_utils import get_firestore_db

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

@router.post("/send-email")
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
async def send_staff_invitation(request: StaffInvitationEmailRequest) -> Dict[str, str]:
    """
    Send a staff invitation email with a registration link
    """
    try:
        # Get shop information
        db_client = get_firestore_db()
        shop_doc = db_client.collection('shops').document(request.shop_id).get()
        
        if not shop_doc.exists:
            raise HTTPException(status_code=404, detail=f"Shop with ID {request.shop_id} not found")
            
        shop_data = shop_doc.to_dict()
        shop_name = shop_data.get('name', 'Ihr Shop')
        
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
        
        # Create the email content
        subject = f"Einladung zur Mitarbeiterregistrierung für {shop_name}"
        
        # HTML email content
        content_html = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #4f46e5; padding: 20px; text-align: center; color: white;">
                <h1>Willkommen bei Q-ME</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none;">
                <h2>Sie wurden als Mitarbeiter zu {shop_name} eingeladen</h2>
                <p>Sehr geehrte(r) Mitarbeiter(in),</p>
                <p>Sie wurden eingeladen, sich bei der Q-ME Terminmanagement-Plattform als Mitarbeiter für <strong>{shop_name}</strong> zu registrieren.</p>
                <p>Um Ihre Registrierung abzuschließen, klicken Sie bitte auf den folgenden Link:</p>
                <div style="margin: 30px 0; text-align: center;">
                    <a href="{request.invitation_link}" style="background-color: #4f46e5; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; font-weight: bold;">Registrierung abschließen</a>
                </div>
                <p>Oder kopieren Sie diesen Link in Ihren Browser:</p>
                <p style="background-color: #f5f5f5; padding: 10px; word-break: break-all;">{request.invitation_link}</p>
                <p>Dieser Link ist nur für eine begrenzte Zeit gültig. Bitte schließen Sie Ihre Registrierung bald ab.</p>
                <p>Bei Fragen wenden Sie sich bitte an den Shop-Inhaber.</p>
                <p>Mit freundlichen Grüßen,<br>Das Q-ME Team</p>
            </div>
            <div style="background-color: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666;">
                <p>Dies ist eine automatisch generierte E-Mail. Bitte antworten Sie nicht auf diese Nachricht.</p>
            </div>
        </div>
        """
        
        # Plain text version
        content_text = f"""
        Willkommen bei Q-ME
        
        Sie wurden als Mitarbeiter zu {shop_name} eingeladen
        
        Sehr geehrte(r) Mitarbeiter(in),
        
        Sie wurden eingeladen, sich bei der Q-ME Terminmanagement-Plattform als Mitarbeiter für {shop_name} zu registrieren.
        
        Um Ihre Registrierung abzuschließen, besuchen Sie bitte den folgenden Link:
        {request.invitation_link}
        
        Dieser Link ist nur für eine begrenzte Zeit gültig. Bitte schließen Sie Ihre Registrierung bald ab.
        
        Bei Fragen wenden Sie sich bitte an den Shop-Inhaber.
        
        Mit freundlichen Grüßen,
        Das Q-ME Team
        
        Dies ist eine automatisch generierte E-Mail. Bitte antworten Sie nicht auf diese Nachricht.
        """
        
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
