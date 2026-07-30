"""Cinderhaven canonical data regression tests for retailer-deduction-recovery.

Verifies the baked data artifacts (SQLite + exported JSON) match the
Cinderhaven data contract.

Canonical contract (target):
    - 50 SKUs, 5 product lines, 6 retailers
    - Retailers: Walmart, Costco, Whole Foods, Sprouts, Kroger, Regional Group
    - ~$1.35M cross-channel deduction backlog (16,917 rows); retailer-only ~$1.12M.

Current state (this repo):
    - Exported JSON is canonical-current ($1,346,815 / 16,917 rows).
    - 9 trade partners in summary JSON (6 retailers + 3 distributors).
    - Baked SQLite product_master re-exported from the 50-SKU / 5-line canonical
      source; the product_line tests below assert the canonical taxonomy and pass.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "cinderhaven_deductions.db"
JSON_DIR = ROOT / "frontend" / "public" / "json"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def db():
    """Read-only connection to the baked SQLite artifact."""
    assert DB_PATH.exists(), f"Baked data artifact not found: {DB_PATH}"
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def summary():
    return json.loads((JSON_DIR / "summary.json").read_text())


@pytest.fixture(scope="module")
def retailers_json():
    return json.loads((JSON_DIR / "retailers.json").read_text())


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestCinderhavenCanonicalRegression:
    """Guard-rails for the baked Cinderhaven deduction dataset."""

    # -- Data files --------------------------------------------------------

    def test_data_files_exist(self):
        assert DB_PATH.exists(), "SQLite database missing"
        for name in ("summary.json", "retailers.json", "deductions.json"):
            assert (JSON_DIR / name).exists(), f"JSON file missing: {name}"

    # -- Backlog total -----------------------------------------------------

    def test_backlog_total_matches_canonical(self, summary):
        """Cross-channel deduction backlog vs canonical trailing_36m totals, ±2%.

        Target = deductions.retailer_total.trailing_36m +
        deductions.distributor_total.trailing_36m from
        reference/canonical_values.json, vendored from
        MsShawnP/cinderhaven-data-platform@7533264 (VERIFIED-AGAINST-PRODUCTION
        2026-07-29). Scope note: the app total is cross-channel (all 9 trading
        partners); window boundaries differ by days from the t36m cut, hence
        the check_canonical.py 2% dollar tolerance.
        """
        canon = json.loads(
            (Path(__file__).resolve().parent.parent / "reference" / "canonical_values.json").read_text()
        )
        target = (
            canon["deductions"]["retailer_total"]["trailing_36m"]
            + canon["deductions"]["distributor_total"]["trailing_36m"]
        )
        total = summary["totals"]["deductions_dollar"]
        assert abs(total - target) / target < 0.02, (
            f"Backlog ${total:,.0f} drifted >2% from canonical t36m ${target:,.0f}"
        )

    # -- Product lines (from SQLite) --------------------------------------

    def test_product_line_count(self, db):
        """Canonical: 5 product lines."""
        (count,) = db.execute(
            "SELECT COUNT(DISTINCT product_line) FROM product_master"
        ).fetchone()
        assert count == 5, f"Expected 5 product lines, got {count}"

    def test_product_line_names(self, db):
        rows = db.execute(
            "SELECT DISTINCT product_line FROM product_master ORDER BY product_line"
        ).fetchall()
        names = {r[0] for r in rows}
        expected = {"Artisan Sauces", "Pantry Staples", "Specialty Condiments", "Dried Goods", "Snack Bites"}
        assert names == expected, f"Product line mismatch: {names}"

    # -- Retailers (from JSON summary) ------------------------------------

    def test_retailer_count_in_summary(self, summary):
        """9 trade partners in the summary: 6 retailers + 3 distributors."""
        count = len(summary["by_retailer"])
        assert count == 9, f"Expected 9 trade partners, got {count}"

    def test_canonical_retailers_present(self, summary):
        """All 6 canonical retailers must appear."""
        names = {r["name"] for r in summary["by_retailer"]}
        for retailer in ("Walmart", "Costco", "Whole Foods", "Sprouts", "Kroger", "Regional Group"):
            assert retailer in names, f"Canonical retailer {retailer!r} missing"

    # -- Retailers (from JSON detail) -------------------------------------

    def test_retailer_detail_file_count(self, retailers_json):
        """retailers.json should have 5 retailer entries (Costco, Kroger, Regional, Sprouts, Walmart, Whole Foods)."""
        retailer_names = {v["name"] for v in retailers_json.values() if v["channel_type"] == "retailer"}
        expected = {"Walmart", "Costco", "Whole Foods", "Sprouts", "Kroger", "Regional Group"}
        assert retailer_names == expected, f"Retailer detail mismatch: {retailer_names}"

    # -- Deduction types ---------------------------------------------------

    def test_deduction_type_count(self, summary):
        """9 deduction types in the by_type breakdown."""
        count = len(summary["by_type"])
        assert count == 9, f"Expected 9 deduction types, got {count}"

    # -- SQLite table existence --------------------------------------------

    def test_critical_tables_exist(self, db):
        rows = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        tables = {r[0] for r in rows}
        required = {
            "product_master", "retailers", "deductions", "disputes",
            "orders", "shipments", "remittances",
        }
        missing = required - tables
        assert not missing, f"Missing tables: {missing}"
