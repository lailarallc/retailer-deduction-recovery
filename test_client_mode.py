"""Client-mode tests for retailer-deduction-recovery.

Adversarial fixtures per checklist §6: clean file (must render clean), missing
required column (blocked path), empty file, headers-only, duplicate headers,
BOM+semicolon, Excel-mangled identifier read as text, mixed date formats
(disclosed, never silently coerced), optional columns absent (disclosed as data
limitations), misnamed headers mapped via engagement.yml, negative / duplicate-key
detection, the --final watermark drop, and a 100k-row scale run.

All fixture brands/retailers are obviously-fictional placeholders — never a real
third party (the Wegmans-fixture lesson, checklist §3/§4).

Skipped if lailara_engagement isn't installed.
"""

import pytest

pytest.importorskip("lailara_engagement")

from lailara_engagement.errors import ReadError  # noqa: E402
import client_mode  # noqa: E402

# A client engagement config (demo: true so tests never trip the deploy guard).
# "Meridian Farms" and the Regional-style retailers are invented placeholders.
_CONFIG = """
client: {name: Meridian Farms}
engagement: {id: MER-2026-08}
as_of_date: 2026-07-31
demo: true
basis: {window_months: 37, window_label: "Jan 2023 - Jan 2026"}
columns:
  deduction_id: "Deduction #"
  deduction_type: "Reason Code"
  amount: ["Deduction Amt", "Amount"]
  deduction_date: "Remit Date"
  retailer: "Customer"
  dispute_filed: "Disputed On"
  recovered_amount: "Recovered $"
  dispute_outcome: "Result"
  labor_hours: "Labor Hrs"
"""

# A minimal config that maps only the canonical names (identity mapping).
_CONFIG_IDENTITY = """
client: {name: Harborline Foods}
engagement: {id: HAR-2026-08}
as_of_date: 2026-07-31
demo: true
basis: {window_months: 37, window_label: "Jan 2023 - Jan 2026"}
columns:
  deduction_id: deduction_id
  deduction_type: deduction_type
  amount: amount
  deduction_date: deduction_date
"""


@pytest.fixture
def cfg(tmp_path):
    p = tmp_path / "engagement.demo.yml"
    p.write_text(_CONFIG, encoding="utf-8")
    return str(p)


@pytest.fixture
def cfg_identity(tmp_path):
    p = tmp_path / "engagement.demo.yml"
    p.write_text(_CONFIG_IDENTITY, encoding="utf-8")
    return str(p)


def _write(tmp_path, name, text, encoding="utf-8"):
    p = tmp_path / name
    p.write_bytes(text.encode(encoding) if isinstance(text, str) else text)
    return str(p)


# Client headers matching _CONFIG's mapping.
_CLEAN = (
    "Deduction #,Reason Code,Deduction Amt,Remit Date,Customer,Disputed On,Recovered $,Result,Labor Hrs\n"
    "D001,short_ship,1200.50,2025-03-14,Harborline Markets,2025-04-01,600.00,partial,3.5\n"
    "D002,label_fine,800.00,2025-04-02,Cedarwood Foods,,0,,0\n"
    "D003,damaged,450.25,2025-05-10,Valleybrook Markets,2025-05-20,450.25,won,2.0\n"
    "D004,short_ship,300.00,2025-06-01,Harborline Markets,,0,,0\n"
    "D005,pallet_fine,150.00,2025-06-15,Cedarwood Foods,2025-07-01,0,lost,1.5\n"
)


def test_clean_file_renders_clean_and_reports(cfg, tmp_path):
    src = _write(tmp_path, "ledger.csv", _CLEAN)
    out = str(tmp_path / "client-output")
    result = client_mode.run(cfg, src, out)
    assert result["status"] == "ok"
    assert result["count"] == 5
    assert result["total_dollar"] == pytest.approx(2900.75, abs=0.01)
    # recovered 1050.25 / total 2900.75
    assert result["recovery_rate"] == pytest.approx(0.3621, abs=0.001)

    html = open(result["report"], encoding="utf-8").read()
    assert "Meridian Farms" in html
    assert "#f5f3ee" in html                       # branded canvas
    assert "SHA-256" in html                        # provenance footer
    assert "DRAFT" in html                          # draft watermark
    assert "37 months" in html                      # window printed
    assert "Jan 2023 - Jan 2026" in html            # window label printed
    # Both recovery bases labeled (the P1 lesson): never a bare unlabeled rate.
    assert "all</strong> deduction dollars" in html
    assert "disputed</strong> dollars" in html


def test_recovery_shown_on_both_bases(cfg, tmp_path):
    src = _write(tmp_path, "ledger.csv", _CLEAN)
    out = str(tmp_path / "out")
    result = client_mode.run(cfg, src, out)
    import json
    s = json.load(open(result["summary_json"], encoding="utf-8"))
    t = s["totals"]
    # recovered/total (portfolio) vs recovered/disputed (filed) — distinct, both present
    assert t["recovery_rate"] == pytest.approx(1050.25 / 2900.75, abs=1e-4)
    assert t["recovered_of_disputed_rate"] == pytest.approx(1050.25 / 1800.75, abs=1e-4)
    assert t["recovery_rate"] != t["recovered_of_disputed_rate"]


def test_annualized_uses_config_window(cfg, tmp_path):
    src = _write(tmp_path, "ledger.csv", _CLEAN)
    out = str(tmp_path / "out")
    result = client_mode.run(cfg, src, out)
    import json
    t = json.load(open(result["summary_json"], encoding="utf-8"))["totals"]
    assert t["annualized_dollar"] == pytest.approx(2900.75 * 12 / 37, abs=0.01)


def test_missing_required_column_is_blocked(cfg_identity, tmp_path):
    # No column maps to `amount` -> Data Readiness Report, no results.
    src = _write(tmp_path, "bad.csv", "deduction_id,deduction_type,deduction_date\nD1,short_ship,2025-01-01\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    assert result["status"] == "blocked"
    html = open(result["readiness_report"], encoding="utf-8").read()
    assert "amount" in html.lower()


def test_empty_file_raises_readerror(cfg, tmp_path):
    src = _write(tmp_path, "empty.csv", "")
    out = str(tmp_path / "out")
    with pytest.raises(ReadError):
        client_mode.run(cfg, src, out)


def test_headers_only_is_clean_zero_rows(cfg, tmp_path):
    src = _write(tmp_path, "hdr.csv",
                 "Deduction #,Reason Code,Deduction Amt,Remit Date\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg, src, out)
    assert result["status"] == "ok"
    assert result["count"] == 0
    assert result["total_dollar"] == 0


def test_duplicate_headers_flagged(cfg_identity, tmp_path):
    src = _write(tmp_path, "dup.csv",
                 "deduction_id,deduction_type,amount,deduction_date,amount\n"
                 "D1,short_ship,100,2025-01-01,999\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    # duplicate header is a warning, not a block
    assert result["status"] == "ok"
    assert result["n_warnings"] >= 1


def test_bom_semicolon_and_identifier_as_text(cfg_identity, tmp_path):
    # BOM + semicolon delimiter + a leading-zero deduction id kept as text.
    body = ("﻿deduction_id;deduction_type;amount;deduction_date\n"
            "0012345;short_ship;100;2025-01-01\n"
            "0012346;label_fine;200;2025-02-01\n")
    src = _write(tmp_path, "bom.csv", body)
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    assert result["status"] == "ok"
    import json
    s = json.load(open(result["summary_json"], encoding="utf-8"))
    assert s["totals"]["deductions_count"] == 2


def test_excel_mangled_identifier_recovered_as_text(cfg_identity, tmp_path):
    # openpyxl reads a large numeric id as a float; the reader recovers the
    # integer string, not 6.9e11. Verified via the deduction-id uniqueness path.
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["deduction_id", "deduction_type", "amount", "deduction_date"])
    ws.append([690123456789, "short_ship", 100, "2025-01-01"])
    ws.append([690123456790, "label_fine", 200, "2025-02-01"])
    xlsx = tmp_path / "items.xlsx"
    wb.save(xlsx)
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, str(xlsx), out)
    assert result["status"] == "ok"
    assert result["count"] == 2


def test_mixed_date_formats_disclosed_not_coerced(cfg_identity, tmp_path):
    # datascope lesson: mixed date formats are disclosed as a warning, never
    # silently coerced. The run still proceeds (warning, not block).
    src = _write(tmp_path, "dates.csv",
                 "deduction_id,deduction_type,amount,deduction_date\n"
                 "D1,short_ship,100,2025-01-15\n"
                 "D2,label_fine,200,02/28/2025\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    assert result["status"] == "ok"
    assert result["n_warnings"] >= 1


def test_optional_columns_absent_are_disclosed(cfg_identity, tmp_path):
    # A ledger with only the 4 required columns: recovery/labor/retailer analyses
    # are omitted AND disclosed as data limitations, never silently zeroed.
    src = _write(tmp_path, "min.csv",
                 "deduction_id,deduction_type,amount,deduction_date\n"
                 "D1,short_ship,100,2025-01-01\n"
                 "D2,label_fine,200,2025-02-01\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    assert result["status"] == "ok"
    import json
    t = json.load(open(result["summary_json"], encoding="utf-8"))["totals"]
    assert t["disputes_filed"] is None
    assert t["recovery_rate"] is None
    html = open(result["report"], encoding="utf-8").read()
    assert "recovery rate" in html.lower() and "could not be computed" in html


def test_negative_amount_flagged(cfg_identity, tmp_path):
    src = _write(tmp_path, "neg.csv",
                 "deduction_id,deduction_type,amount,deduction_date\n"
                 "D1,short_ship,-50,2025-01-01\n"
                 "D2,label_fine,200,2025-02-01\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    # not_negative -> at least a warning surfaced
    assert result["n_warnings"] >= 1


def test_duplicate_deduction_id_flagged(cfg_identity, tmp_path):
    src = _write(tmp_path, "dupkey.csv",
                 "deduction_id,deduction_type,amount,deduction_date\n"
                 "D1,short_ship,100,2025-01-01\n"
                 "D1,label_fine,200,2025-02-01\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    # unique key violation -> hard fail by default threshold
    assert result["status"] == "blocked"
    html = open(result["readiness_report"], encoding="utf-8").read()
    assert "duplicat" in html.lower()


def test_final_flag_drops_watermark(cfg, tmp_path):
    src = _write(tmp_path, "ledger.csv", _CLEAN)
    out = str(tmp_path / "out")
    result = client_mode.run(cfg, src, out, final=True)
    html = open(result["report"], encoding="utf-8").read()
    assert "ll-draft" not in html


def test_100k_rows_scale(cfg_identity, tmp_path):
    lines = ["deduction_id,deduction_type,amount,deduction_date"]
    for i in range(100_000):
        lines.append(f"D{i},short_ship,{(i % 500) + 1}.00,2025-01-01")
    src = _write(tmp_path, "big.csv", "\n".join(lines) + "\n")
    out = str(tmp_path / "out")
    result = client_mode.run(cfg_identity, src, out)
    assert result["status"] == "ok"
    assert result["count"] == 100_000
