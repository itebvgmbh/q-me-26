"""Team-Vermerk für die Firestore-Regeln: shops/{shopId}/members/{uid} = {staffId, at}.

Die Regeln (firestore.rules, isMember) erkennen eine Person im Team nur an diesem Vermerk – staff-Einträge haben
zufällige IDs, die Regeln können nicht nach ihnen suchen. Gesetzt wird er, sobald ein Konto mit einer aktiven Person
im Laden verbunden ist:
- beim Annehmen der Einladung (app/apis/staff_invitation),
- vom Inhaber im Browser beim Zurückholen einer Person (frontend/src/utils/firestore/staff.ts), beim Deaktivieren
  nimmt er ihn weg,
- und beim Start des Backends für alle bestehenden Teams (sync_members), damit Vermerk und Personen übereinstimmen.
Der Inhaber braucht keinen Vermerk; die Regeln erkennen ihn an shops.owner.
"""

from datetime import datetime, timezone


def member_ref(db, shop_id: str, uid: str):
    return db.collection("shops").document(shop_id).collection("members").document(uid)


def set_member(db, shop_id: str, uid: str, staff_id: str, now: datetime | None = None) -> None:
    member_ref(db, shop_id, uid).set({"staffId": staff_id, "at": now or datetime.now(timezone.utc)})


def wanted_members(staff: dict) -> dict:
    """{shopId: {uid: staffId}} aus allen staff-Einträgen: verbunden (userId) und nicht deaktiviert"""
    wanted: dict = {}
    for staff_id, s in staff.items():
        uid, shop_id = s.get("userId") or "", s.get("shopId") or ""
        if uid and shop_id and s.get("isActive", True) is not False:
            wanted.setdefault(shop_id, {})[uid] = staff_id
    return wanted


def sync_members(db, now: datetime | None = None) -> dict:
    """Vermerke an die Personen angleichen: fehlende anlegen, überzählige entfernen. Gibt die Anzahlen zurück."""
    now = now or datetime.now(timezone.utc)
    staff = {d.id: d.to_dict() or {} for d in db.collection("staff").stream()}
    wanted = wanted_members(staff)
    added = removed = 0
    for shop in db.collection("shops").stream():
        want = wanted.get(shop.id, {})
        have = {m.id: (m.to_dict() or {}).get("staffId") for m in shop.reference.collection("members").stream()}
        for uid, staff_id in want.items():
            if have.get(uid) != staff_id:
                set_member(db, shop.id, uid, staff_id, now)
                added += 1
        for uid in have:
            if uid not in want:
                member_ref(db, shop.id, uid).delete()
                removed += 1
    return {"added": added, "removed": removed}
