"""Demo golden lock — retailer-deduction-recovery.

Locks the published demo output bit-for-bit so the client-mode conversion
(and any future change) cannot silently drift the deployed site or the
portfolio numbers it advertises.

Two things are pinned:

1. **Byte-lock** — SHA-256 of the three committed JSON artifacts the app
   consumes (`summary.json`, `retailers.json`, `deductions.json`). Any byte
   change fails here. These files ARE the demo dataset; nothing in the
   engagement-ready conversion regenerates them.
2. **Headline pins** — the exact figures the live hero and KPI row render,
   with the *basis* each one is computed on spelled out. These are the
   numbers the 2026-07-31 audit flagged for mislabeling; pinning them with
   their basis is what keeps the fix from regressing.

If any assertion here fails, STOP: a golden moved. Do not re-baseline the
hashes without an explicit, logged approval — see the engagement-ready
house rules.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
JSON_DIR = ROOT / "frontend" / "public" / "json"

# --- Byte-lock: SHA-256 of the committed demo artifacts ---------------------
# Pinned 2026-08-04 against the deployed demo dataset (window 2023-01-23 →
# 2026-01-02, 16,917 deductions / $1,346,814.56).
GOLDEN_SHA256 = {
    "summary.json": "8facf69f1f983097579cf59fb19d2da5fe04598fe228322f67740788bd76ba5d",
    "retailers.json": "ec6b8c84528b5d887e40db30025b0b8057cbb0ac8904df6474eda73ef461890b",
    "deductions.json": "7de65ee9ef0f8c33348c85049cf21ebe3f649a5195fe93cbafb16bab557e0a83",
}


@pytest.fixture(scope="module")
def summary():
    return json.loads((JSON_DIR / "summary.json").read_text())


@pytest.mark.parametrize("name", sorted(GOLDEN_SHA256))
def test_demo_artifact_sha256(name):
    """Each committed demo JSON is byte-for-byte unchanged."""
    digest = hashlib.sha256((JSON_DIR / name).read_bytes()).hexdigest()
    assert digest == GOLDEN_SHA256[name], (
        f"{name} changed (sha256 {digest} != golden {GOLDEN_SHA256[name]}). "
        "A demo golden moved — STOP and report before re-baselining."
    )


class TestHeadlineNumbers:
    """The figures the live hero and KPI row render, each with its basis."""

    def test_window_is_37_months(self, summary):
        # Standardized window label: 37 calendar months (Jan 2023 – Jan 2026,
        # inclusive). The audit flagged README/schema saying "36"; the export
        # computes and renders 37, and annualization uses x12/37.
        assert summary["window"]["months"] == 37

    def test_backlog_total(self, summary):
        t = summary["totals"]
        assert t["deductions_count"] == 16917
        assert t["deductions_dollar"] == 1346814.56

    def test_annualized_is_36month_free(self, summary):
        # annualized = deductions_dollar * 12 / 37, NOT / 36. Pinned so the
        # 36-vs-37 window mislabel cannot regress the money figure.
        t = summary["totals"]
        assert t["annualized_dollar"] == 436804.72
        expected = round(t["deductions_dollar"] * 12 / 37, 2)
        assert abs(t["annualized_dollar"] - expected) < 0.01

    def test_recovery_rate_basis(self, summary):
        # "~15% of deduction dollars ever come back" = recovered / total.
        t = summary["totals"]
        assert t["recovery_rate"] == 0.146
        rate = t["disputes_recovered"] / t["deductions_dollar"]
        assert round(rate, 3) == 0.146

    def test_recovers_42pct_of_disputed_dollars(self, summary):
        # The hero's "~42%" is recovered-DOLLARS / disputed-DOLLARS (41.9%),
        # NOT a won/filed dispute count rate. This is the P1 basis the audit
        # flagged; the hero now labels it correctly ("of every disputed dollar").
        t = summary["totals"]
        disputed_dollars = t["deductions_dollar"] - t["deductions_no_dispute_dollar"]
        basis = t["disputes_recovered"] / disputed_dollars
        assert round(basis, 3) == 0.419

    def test_fte_equivalent_is_whole_window(self, summary):
        # Exported fte_equivalent is WHOLE-WINDOW labor in work-years
        # (labor_hours / 2080), documented as such in the README data
        # dictionary. The UI annualizes separately (x12/37/2080 ~= 1.75/yr).
        t = summary["totals"]
        assert t["fte_equivalent"] == 5.39
        whole_window = round(t["labor_hours"] / 2080, 2)
        assert abs(t["fte_equivalent"] - whole_window) < 0.01
        annualized_fte = t["labor_hours"] * 12 / 37 / 2080
        assert round(annualized_fte, 1) == 1.7

    def test_disputes_filed(self, summary):
        assert summary["totals"]["disputes_filed"] == 6011
        assert summary["totals"]["disputes_recovered"] == 196694.71
