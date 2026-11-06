"""Bremse je Absender für öffentliche Endpunkte (Benachrichtigungen, Nummer zurückgeben)."""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

WINDOW_SECONDS = 60
MAX_HITS = 30
_hits: dict[tuple[str, str], deque] = defaultdict(deque)


def throttle(request: Request, bucket: str = "", max_hits: int = MAX_HITS) -> None:
    """429, wenn derselbe Absender in der letzten Minute schon max_hits Anfragen geschickt hat."""
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    now = time.monotonic()
    q = _hits[(bucket, ip)]
    while q and now - q[0] > WINDOW_SECONDS:
        q.popleft()
    if len(q) >= max_hits:
        raise HTTPException(status_code=429, detail="Zu viele Anfragen. Versuch es gleich noch einmal.")
    q.append(now)
