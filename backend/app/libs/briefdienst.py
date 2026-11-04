"""Druck- und Versanddienstleister für Briefwellen (requirements/briefversand.md, Stufe B): PIN eBrief der PIN AG, Berlin.

Schnittstelle laut https://www.ebrief.de/api-dokumentation und https://api.ebrief.de/swagger/v1/swagger.json (Stand 04.11.2026):
  - Anmelden: GET /oauth2/token/generateBearerToken mit Basic-Auth (Benutzer und Passwort vergibt der PIN-Support),
    Antwort {GenerateBearerTokenResult}. Das Token gilt 7 Tage.
  - Einzelbrief: POST /Jobs/singleFiles {Document {FileName, FileContent (Base64)}, Attributes} → Result.Jobs[0] mit Id,
    JobStatus, PriceNetto, Documents[].Id. Ein Brief je Auftrag; er geht ohne Freigabe in den Druck. PIN liest die
    Anschrift aus dem Fenster des PDFs.
  - Stand: GET /Jobs/{id} → JobStatus, Documents[].LastEvent (DOCUMENT_SENT_BACK = unzustellbar)
  - Suche: POST /Jobs/searchJobDetails {DateFrom, DateTo, Paging} → Result.ResponseDetails[].Documents[].DocumentFileName.
    Damit fragt Dranzeit nach einem Abbruch nach, ob ein Brief angekommen ist, statt ihn ein zweites Mal zu schicken.
Antworten: {ResultCode (Ok, BadRequest, …), ErrorMessage, Result}. Attribute sind Text: "true"/"false".

Zugang (/etc/q-me.env, setzt Stefan selbst mit dem Block „PIN eBrief: Zugang eintragen“ aus deploy/README.md):
QME_PIN_BENUTZER, QME_PIN_PASSWORT für den echten Versand, QME_PIN_TEST_BENUTZER, QME_PIN_TEST_PASSWORT für die
Testumgebung (ohne: dieselben wie für den echten Versand). Jeweils auch als …_B64 (Base64, URL-sicher, ohne „=“): So
kommen Passwörter mit Sonderzeichen durch deploy/set-secret.sh, das nur Buchstaben, Ziffern, „-“ und „_“ annimmt.
"""

import base64
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

LIVE = "https://api.ebrief.de"
STAGING = "https://api.staging.ebrief.de"
TIMEOUT = 60
FEHLER_STATUS = {"ERROR_DOCUMENT", "ERROR_GENERAL", "USER_DELETED", "ROLLEDBACK", "ERROR_LIMIT_EXCEEDED"}
ZURUECK = "DOCUMENT_SENT_BACK"


class Abgelehnt(Exception):
    """PIN hat den Brief sicher nicht angenommen; Text für den Betreiber"""


class Unklar(Exception):
    """Keine eindeutige Antwort (Zeitüberschreitung, Serverfehler): Der Brief ist vielleicht angekommen"""


def _wert(name: str) -> str:
    """Klartext aus NAME oder Base64 (URL-sicher) aus NAME_B64"""
    if os.environ.get(name):
        return os.environ[name]
    roh = (os.environ.get(f"{name}_B64") or "").strip()
    if not roh:
        return ""
    try:
        return base64.urlsafe_b64decode(roh + "=" * (-len(roh) % 4)).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        print(f"Briefe: {name}_B64 ist kein gültiges Base64.")
        return ""


def _zugang(test: bool) -> Optional[tuple]:
    if test and _wert("QME_PIN_TEST_BENUTZER") and _wert("QME_PIN_TEST_PASSWORT"):
        return _wert("QME_PIN_TEST_BENUTZER"), _wert("QME_PIN_TEST_PASSWORT")
    if _wert("QME_PIN_BENUTZER") and _wert("QME_PIN_PASSWORT"):
        return _wert("QME_PIN_BENUTZER"), _wert("QME_PIN_PASSWORT")
    return None


def eingerichtet() -> dict:
    """Ob Zugangsdaten für Testumgebung und echten Versand da sind (nie die Werte selbst)"""
    return {"test": _zugang(True) is not None, "echt": _zugang(False) is not None}


def _job(daten: dict) -> dict:
    result = (daten or {}).get("Result") or {}
    jobs = result.get("Jobs") or result.get("ResponseDetails") or []
    return jobs[0] if jobs else {}


def _ergebnis(job: dict) -> dict:
    doks = job.get("Documents") or []
    preis = job.get("PriceNetto")
    return {"auftrag": str(job["Id"]), "dokument": str(doks[0]["Id"]) if doks and doks[0].get("Id") else "",
            "status": job.get("JobStatus") or "", "preis": float(preis) if preis else None}


class PinEbrief:
    def __init__(self, test: bool, sitzung=None):
        self.test = test
        self.basis = STAGING if test else LIVE
        self.zugang = _zugang(test)
        self.sitzung = sitzung or requests.Session()
        self._token = ""
        self._token_bis = 0.0

    def _anmelden(self) -> str:
        if self._token and time.time() < self._token_bis:
            return self._token
        if not self.zugang:
            raise Abgelehnt("Für PIN eBrief sind keine Zugangsdaten eingerichtet.")
        try:
            r = self.sitzung.request("GET", f"{self.basis}/oauth2/token/generateBearerToken", auth=self.zugang, timeout=TIMEOUT)
        except requests.RequestException as e:
            raise Unklar(f"PIN eBrief ist nicht erreichbar ({type(e).__name__}).") from e
        if r.status_code >= 500:
            raise Unklar(f"PIN eBrief antwortet mit {r.status_code}.")
        token = (r.json() or {}).get("GenerateBearerTokenResult") if r.status_code < 400 else ""
        if not token:
            raise Abgelehnt(f"Anmeldung bei PIN eBrief abgelehnt ({r.status_code}). Zugangsdaten prüfen.")
        self._token, self._token_bis = token, time.time() + 6 * 86400
        return token

    def _aufruf(self, method: str, pfad: str, body: Optional[dict] = None, nochmal: bool = True) -> dict:
        headers = {"Authorization": f"Bearer {self._anmelden()}", "Accept": "application/json"}
        try:
            r = self.sitzung.request(method, f"{self.basis}{pfad}", json=body, headers=headers, timeout=TIMEOUT)
        except requests.RequestException as e:
            raise Unklar(f"PIN eBrief ist nicht erreichbar ({type(e).__name__}).") from e
        if r.status_code == 401 and nochmal:
            self._token = ""
            return self._aufruf(method, pfad, body, False)
        if r.status_code >= 500:
            raise Unklar(f"PIN eBrief antwortet mit {r.status_code}.")
        try:
            daten = r.json() or {}
        except ValueError:
            daten = {}
        if r.status_code >= 400:
            raise Abgelehnt(str(daten.get("ErrorMessage") or daten.get("title") or r.text[:200] or r.status_code))
        if daten.get("ResultCode") not in (None, "Ok"):
            raise Abgelehnt(str(daten.get("ErrorMessage") or daten.get("ResultCode")))
        return daten

    def senden(self, pdf: bytes, dateiname: str) -> dict:
        """Ein Brief, farbig, einseitig. Gibt {auftrag, dokument, status, preis} zurück."""
        body = {
            "Document": {"FileName": dateiname, "FileContent": base64.b64encode(pdf).decode("ascii")},
            "Attachments": [],
            "AddressInformation": None,
            "Attributes": {"IsDuplex": "false", "IsColor": "true"},
        }
        job = _job(self._aufruf("POST", "/Jobs/singleFiles", body))
        if not job.get("Id"):
            raise Unklar("PIN eBrief hat keine Auftragsnummer geliefert.")
        if job.get("JobStatus") in FEHLER_STATUS:
            raise Abgelehnt(job.get("StatusCodeMessage") or job["JobStatus"])
        return _ergebnis(job)

    def stand(self, auftrag: str) -> dict:
        job = _job(self._aufruf("GET", f"/Jobs/{int(auftrag)}"))
        dok = (job.get("Documents") or [{}])[0]
        preis = job.get("PriceNetto")
        ereignis = dok.get("LastEvent") or ""
        return {"status": job.get("JobStatus") or "", "ereignis": ereignis, "zurueck": ereignis == ZURUECK,
                "preis": float(preis) if preis else None}

    def suchen(self, dateiname: str, seit: datetime) -> Optional[dict]:
        """Auftrag zu einem Dateinamen (jeder Brief hat einen eigenen) – oder None, wenn PIN ihn nicht hat"""
        bis = datetime.now(timezone.utc) + timedelta(days=1)
        for seite in range(1, 11):
            daten = self._aufruf("POST", "/Jobs/searchJobDetails", {
                "DateFrom": seit.isoformat(), "DateTo": bis.isoformat(), "Paging": {"PageNumber": seite, "PageSize": 200}})
            jobs = ((daten.get("Result") or {}).get("ResponseDetails")) or []
            for job in jobs:
                if any(d.get("DocumentFileName") == dateiname for d in job.get("Documents") or []):
                    return _ergebnis(job)
            if len(jobs) < 200:
                return None
        return None
