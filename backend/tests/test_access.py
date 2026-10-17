"""
Tests für app/auth/access.py: Wer ist Betreiber der App? Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_access.py
"""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException  # noqa: E402

from app.auth.access import is_admin, require_admin  # noqa: E402


def with_env(**values):
    def wrap(fn):
        def run():
            saved = {k: os.environ.get(k) for k in values}
            os.environ.update(values)
            try:
                fn()
            finally:
                for k, v in saved.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v
        run.__name__ = fn.__name__
        return run
    return wrap


def user(sub, email=None):
    return SimpleNamespace(sub=sub, email=email)


@with_env(QME_ADMIN_EMAILS='', QME_ADMIN_UIDS='')
def test_ohne_eintrag_gibt_es_keinen_betreiber():
    assert not is_admin(user('abc', 'chef@example.com'))
    try:
        require_admin(user('abc', 'chef@example.com'))
        assert False, 'hätte 403 geben müssen'
    except HTTPException as e:
        assert e.status_code == 403


@with_env(QME_ADMIN_EMAILS=' Chef@Example.com , zweite@example.com', QME_ADMIN_UIDS='')
def test_betreiber_per_email_ohne_gross_klein():
    assert is_admin(user('x', 'chef@example.com'))
    assert is_admin(user('y', 'ZWEITE@example.com'))
    assert not is_admin(user('z', 'kunde@example.com'))
    assert not is_admin(user('z', None))
    require_admin(user('x', 'chef@example.com'))  # kein Fehler


@with_env(QME_ADMIN_EMAILS='', QME_ADMIN_UIDS='uid123')
def test_betreiber_per_uid():
    assert is_admin(user('uid123'))
    assert not is_admin(user('uid124'))
    assert not is_admin(None)


if __name__ == '__main__':
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith('test_') and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f'OK   {name}')
        except AssertionError as e:
            failed += 1
            print(f'FEHL {name}: {e}')
    print(f'{len(tests) - failed}/{len(tests)} bestanden')
    sys.exit(1 if failed else 0)
