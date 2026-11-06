from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
from pydantic import BaseModel, EmailStr
import databutton as db

from fastapi import Depends
from app.auth.access import require_admin

router = APIRouter()

class EmailNotificationRequest(BaseModel):
    to: EmailStr
    subject: str
    content_html: str
    content_text: str
    template_data: Optional[Dict[str, Any]] = None

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

# Team-Einladungen (Link und E-Mail) kommen aus app/apis/staff_invitation
