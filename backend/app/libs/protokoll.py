"""Protokoll und Sicherungen des Betreiber-Bereichs (app/apis/betreiber) – auf dem Server, nicht in Firestore.

Firestore ist ohne Anmeldung lesbar. Gründe, Notizen und Sicherungen gelöschter Daten gehören deshalb nicht dorthin,
sondern in den Datenordner des Dienstes (.local_data, als einziger Ordner für ihn beschreibbar, deploy/q-me.service):

    .local_data/betreiber/protokoll.jsonl              eine Zeile je Eingriff: wer, wann, was, vorher, nachher
    .local_data/betreiber/sicherungen/*.json            Stand vor dem Löschen (wie deploy/konten-aufraeumen.py)

Anderer Ort über QME_BETREIBER_DIR (für Tests).
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from app.libs.konten import _plain


def base_dir() -> Path:
    return Path(os.environ.get("QME_BETREIBER_DIR", ".local_data/betreiber"))


def _private_file(path: Path) -> None:
    """Nur für den Dienst lesbar – es stehen Namen und E-Mail-Adressen darin"""
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def write(user, action: str, target: dict, reason: str = "", before=None, after=None, now: datetime | None = None) -> dict:
    """Eingriff festhalten. target z. B. {"shopId": "…", "name": "…"} oder {"uid": "…", "email": "…"}"""
    entry = {
        "at": (now or datetime.now(timezone.utc)).isoformat(),
        "by": getattr(user, "email", None) or getattr(user, "sub", ""),
        "byUid": getattr(user, "sub", ""),
        "action": action,
        "target": _plain(target),
    }
    if reason:
        entry["reason"] = reason
    if before is not None:
        entry["before"] = _plain(before)
    if after is not None:
        entry["after"] = _plain(after)
    path = base_dir() / "protokoll.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    if new:
        _private_file(path)
    print(f"Betreiber {entry['by']}: {action} {json.dumps(entry['target'], ensure_ascii=False)}")
    return entry


def read(limit: int = 200, shop_id: str = "", uid: str = "") -> list:
    """Neueste zuerst, auf Wunsch nur zu einem Laden oder Konto"""
    path = base_dir() / "protokoll.jsonl"
    if not path.exists():
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue  # halb geschriebene Zeile
            target = entry.get("target") or {}
            if shop_id and target.get("shopId") != shop_id and shop_id not in (target.get("shopIds") or []):
                continue
            if uid and target.get("uid") != uid and uid not in (target.get("uids") or []):
                continue
            rows.append(entry)
    return rows[::-1][:limit]


def blocked_accounts() -> set:
    """Konten, die der Betreiber einzeln gesperrt hat. Entsperren eines Ladens lässt sie gesperrt."""
    path = base_dir() / "gesperrte-konten.json"
    if not path.exists():
        return set()
    try:
        return set(json.loads(path.read_text(encoding="utf-8")))
    except ValueError:
        return set()


def set_blocked(uid: str, blocked: bool) -> None:
    uids = blocked_accounts()
    if (uid in uids) == blocked:
        return
    uids = (uids | {uid}) if blocked else (uids - {uid})
    path = base_dir() / "gesperrte-konten.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sorted(uids)), encoding="utf-8")
    _private_file(path)


def save_backup(data: dict, now: datetime | None = None) -> Path:
    folder = base_dir() / "sicherungen"
    folder.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S-%f")
    path = folder / f"sicherung-{stamp}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    _private_file(path)
    return path
