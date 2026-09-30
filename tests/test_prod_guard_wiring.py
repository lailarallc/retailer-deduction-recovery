"""The prod guard sits in front of every Postgres read in scripts/.

scripts/20_export_json.py and scripts/21_validate_dataset.py read DATABASE_URL
(20 falls back to localhost:5432 even without one) -- a `fly proxy` tunnel to
production when one is open. These tests fake a flyctl listener, run each
script as __main__, and assert nothing connects.
"""

import pathlib
import runpy
import sys

import pytest

psycopg2 = pytest.importorskip("psycopg2")

SCRIPTS = pathlib.Path(__file__).parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

import prod_guard  # noqa: E402  (scripts/prod_guard.py, as the scripts import it)


@pytest.fixture
def fly_tunnel(monkeypatch):
    seen = []
    monkeypatch.delenv("ALLOW_PROD_DB", raising=False)
    monkeypatch.setattr(prod_guard, "_listener", lambda port: seen.append(port) or "flyctl")
    monkeypatch.setattr(psycopg2, "connect", lambda *a, **kw: pytest.fail("connected"))
    return seen


@pytest.mark.parametrize("script", ["20_export_json.py", "21_validate_dataset.py"])
def test_script_refuses_fly_tunnel(fly_tunnel, monkeypatch, script):
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost:5432/db")
    with pytest.raises(prod_guard.ProdDatabaseError):
        runpy.run_path(str(SCRIPTS / script), run_name="__main__")
    assert fly_tunnel == [5432]


def test_export_fallback_url_refuses_fly_tunnel(fly_tunnel, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    with pytest.raises(prod_guard.ProdDatabaseError):
        runpy.run_path(str(SCRIPTS / "20_export_json.py"), run_name="__main__")
    assert fly_tunnel == [5432]
