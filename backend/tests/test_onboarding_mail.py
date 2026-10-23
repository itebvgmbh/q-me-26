"""
Tests für app/libs/onboarding_mail.py: Welche Start-Mail bekommt ein Laden wann, und was steht drin?
Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_onboarding_mail.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.libs import onboarding_mail as om  # noqa: E402

NOW = datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)
BASE = "https://dranzeit.de"


def shop(created_days_ago: float, **extra) -> dict:
    created = NOW - timedelta(days=created_days_ago)
    return {"name": "Salon <Eva>", "owner": "u1", "createdAt": created, "trialEndsAt": created + timedelta(days=30), **extra}


def test_willkommen_nur_am_anfang_und_einmal():
    assert om.due_mails(shop(0.1), NOW, has_entries=False) == ["willkommen"]
    assert om.due_mails(shop(0.1, onboardingMails={"willkommen": NOW}), NOW, has_entries=False) == []
    assert "willkommen" not in om.due_mails(shop(3), NOW, has_entries=True)


def test_erinnerung_nur_ohne_eintraege_zwischen_tag_2_und_7():
    assert om.due_mails(shop(3, onboardingMails={"willkommen": NOW}), NOW, has_entries=False) == ["erinnerung"]
    assert om.due_mails(shop(3, onboardingMails={"willkommen": NOW}), NOW, has_entries=True) == []
    assert om.due_mails(shop(1, onboardingMails={"willkommen": NOW}), NOW, has_entries=False) == []
    assert om.due_mails(shop(8, onboardingMails={"willkommen": NOW}), NOW, has_entries=False) == []


def test_testende_fuenf_tage_vorher_ohne_abo():
    s = shop(26, onboardingMails={"willkommen": NOW, "erinnerung": NOW})
    assert om.due_mails(s, NOW, has_entries=True) == ["testende"]
    assert om.due_mails({**s, "onboardingMails": {"testende": NOW}}, NOW, has_entries=True) == []
    assert om.due_mails(shop(20), NOW, has_entries=True) == []  # noch 10 Tage
    assert om.due_mails(shop(31), NOW, has_entries=True) == []  # schon vorbei
    paid = {**s, "billing": {"plan": "laden", "status": "active"}}
    assert om.due_mails(paid, NOW, has_entries=True) == []


def test_alter_laden_ohne_testende_feld_nutzt_tarifstart():
    # Läden von vor den Tarifen: Testphase bis TARIFF_LAUNCH + 30 Tage (plans.trial_end)
    old = {"name": "Alt", "owner": "u2", "createdAt": datetime(2026, 5, 1, tzinfo=timezone.utc)}
    end = om.trial_end(old)
    assert om.due_mails(old, end - timedelta(days=3), has_entries=True) == ["testende"]


def test_testadressen_bekommen_nichts():
    assert om.is_test_address("q-me-test-1@example.com")
    assert om.is_test_address("x@laden.test")
    assert om.is_test_address("")
    assert not om.is_test_address("eva@salon-eva.de")


def test_texte_maskiert_und_mit_naechstem_schritt():
    subject, html, text = om.compose("willkommen", shop(0.1), NOW, BASE)
    assert subject == "Willkommen bei Dranzeit – Salon <Eva> ist startklar"
    assert "Salon &lt;Eva&gt;" in html and "<Eva>" not in html
    assert f"{BASE}/shop-dashboard" in html and "30 Tage" in html
    assert "hilfe@dranzeit.de" in html and "Zum Tresen" in text
    _, html, _ = om.compose("erinnerung", shop(3), NOW, BASE)
    assert "nur einmal" in html and "Nächste Nummer aufrufen" in html
    subject, html, _ = om.compose("testende", shop(26), NOW, BASE)
    assert subject.startswith("Deine Testphase endet am ") and "Noch 4 Tage" in html and "100 Kunden" in html
    _, html, _ = om.compose("testende", shop(86, founder=True, trialEndsAt=NOW + timedelta(days=4)), NOW, BASE)
    assert "19 €" in html and "Gründer" in html


class _Doc:
    def __init__(self, id, data, store):
        self.id, self._data, self._store = id, data, store
        self.reference = self

    def to_dict(self):
        return dict(self._data)

    def update(self, fields):
        self._store.append((self.id, fields))


class _Query:
    def __init__(self, docs):
        self._docs = docs

    def where(self, *_):
        return self

    def limit(self, *_):
        return self

    def stream(self):
        return iter(self._docs)


class _Db:
    def __init__(self, shops, appts=()):
        self.updates = []
        self._shops = [_Doc(i, d, self.updates) for i, d in shops.items()]
        self._appts = list(appts)

    def collection(self, name):
        return _Query(self._shops if name == "shops" else self._appts)


def test_run_once_verschickt_und_markiert():
    sent = []
    om.mail_configured = lambda: True
    om.send_mail = lambda to, subject, html, text, reply_to="": sent.append((to, subject, reply_to)) or True
    om._owner_email = lambda s: "eva@salon-eva.de" if s["owner"] == "u1" else "t@example.com"
    first = shop(10)
    second = shop(0.1)  # zweiter Laden desselben Inhabers: kein zweites Willkommen
    test = {**shop(0.1), "owner": "u9"}
    db = _Db({"a": first, "b": second, "t": test})
    assert om.run_once(db, BASE, NOW) == 0
    assert sent == [] and db.updates == []
    db = _Db({"b": second})
    assert om.run_once(db, BASE, NOW) == 1
    assert sent[0][0] == "eva@salon-eva.de" and sent[0][2] == "hilfe@dranzeit.de"
    assert db.updates == [("b", {"onboardingMails.willkommen": NOW})]


def test_run_once_ohne_schluessel_nichts():
    om.mail_configured = lambda: False
    assert om.run_once(_Db({"b": shop(0.1)}), BASE, NOW) == 0


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
