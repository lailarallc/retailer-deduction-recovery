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
    "summary.json": "40af74810d16bf5a685b56c50cd37c37256fa1b70f84fe6e685721d6e967951f",
    "retailers.json": "5cf439d91c594c479f56e7a7e0a78fe1445c0f6cdfd817521259207242259d9a",
    "deductions.json": "7de65ee9ef0f8c33348c85049cf21ebe3f649a5195fe93cbafb16bab557e0a83",
}


# The headline pins read the platform's canon keys (vendored by
# scripts/refresh_canonical.py), never a typed value (owner, 2026-11-17).
CANON = json.loads((ROOT / "reference" / "canonical_values.json").read_text(encoding="utf-8"))


def canon(key):
    node = CANON
    for part in key.split("."):
        node = node[part]
    return node


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

    def test_backlog_count(self, summary):
        assert summary["totals"]["deductions_count"] == canon("deductions.cross_channel_rows.all_time")

    # The committed JSON was exported 2026-07-30 through an older path that
    # summed in floats: it holds .56 and .27 where the database's exact sums
    # give .55 and .26 (the current export, run on the harness 2026-11-17,
    # writes .55 / .26). The JSON refreshes when this repo's export next runs
    # with its own reader login (plan U12). strict: once it refreshes, these
    # pass and the xfail itself fails, so the marker is removed then.
    @pytest.mark.xfail(strict=True, reason="committed JSON predates the exact-sum export; refreshes at U12")
    def test_backlog_total(self, summary):
        assert summary["totals"]["deductions_dollar"] == canon("deductions.cross_channel_total.all_time")

    @pytest.mark.xfail(strict=True, reason="committed JSON predates the exact-sum export; refreshes at U12")
    def test_uncontested_total(self, summary):
        t = summary["totals"]
        assert t["deductions_no_dispute_count"] == canon("deductions.cross_channel_uncontested_rows.all_time")
        assert t["deductions_no_dispute_dollar"] == canon("deductions.cross_channel_uncontested_total.all_time")

    def test_annualized_is_36month_free(self, summary):
        # annualized = deductions_dollar * 12 / 37, NOT / 36, so the 36-vs-37
        # window mislabel cannot regress the money figure.
        t = summary["totals"]
        assert t["annualized_dollar"] == canon("deductions.cross_channel_annualized.all_time")
        expected = round(t["deductions_dollar"] * 12 / 37, 2)
        assert abs(t["annualized_dollar"] - expected) < 0.01

    def test_recovery_rate_basis(self, summary):
        # "~15% of deduction dollars ever come back" = recovered / total.
        t = summary["totals"]
        key = canon("deductions_recovery.cross_channel_recovered_per_deduction_pct.all_time")
        assert round(t["recovery_rate"] * 100, 1) == round(key, 1)

    def test_recovers_42pct_of_disputed_dollars(self, summary):
        # The hero's "~42%" is recovered-DOLLARS / disputed-DOLLARS, NOT a
        # won/filed dispute count rate (the P1 basis the audit flagged).
        t = summary["totals"]
        disputed_dollars = t["deductions_dollar"] - t["deductions_no_dispute_dollar"]
        basis = t["disputes_recovered"] / disputed_dollars
        key = canon("deductions_recovery.cross_channel_recovered_per_disputed_pct.all_time")
        assert round(basis * 100, 2) == key

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
        assert summary["totals"]["disputes_filed"] == canon("disputes.cross_channel_filed.all_time")
        assert summary["totals"]["disputes_recovered"] == canon("disputes.cross_channel_recovered.all_time")
