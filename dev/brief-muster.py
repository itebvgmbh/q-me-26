"""Musterbrief an einen Salon als PDF, ohne Firebase und ohne echten Code: python dev/brief-muster.py [Ziel.pdf] [Wünsche] [freie Plätze]

Zum Ansehen, wenn sich Text oder Blatt ändern (backend/app/libs/brief.py). Der echte Brief kommt aus dem Betreiber-Bereich.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from app.libs import brief  # noqa: E402

ziel = sys.argv[1] if len(sys.argv) > 1 else "brief-muster.pdf"
wuensche = int(sys.argv[2]) if len(sys.argv) > 2 else 7
frei = int(sys.argv[3]) if len(sys.argv) > 3 else 84
eintrag = {
    "name": "Salon Musterfrau", "kategorie": "friseur", "street": "Musterstraße 12", "postalCode": "13507", "city": "Berlin", "ortsteil": "Tegel",
    "stadtSlug": "berlin", "slug": "salon-musterfrau", "status": "online", "wuensche": wuensche, "quelle": {"website": "https://salon-musterfrau.example/"},
}
jetzt = datetime.now(timezone.utc)
with open(ziel, "wb") as f:
    f.write(brief.pdf(eintrag, "ABCDE-FGHJK", jetzt + timedelta(days=180), "https://dranzeit.de", frei, jetzt))
print(ziel)
