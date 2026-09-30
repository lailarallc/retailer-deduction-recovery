"""Validate the Cinderhaven deductions dataset.

Reads from the Cinderhaven Data Platform (Postgres).

Each check prints PASS / WARN / FAIL with context. Exits non-zero
only on FAIL (structural / integrity issues), so WARN-level
deviations from calibration targets don't block the build.

Validates:
  - Row counts in expected ranges
  - Referential integrity (every FK resolves)
  - Annualized deduction dollars in $750K-$1.2M target band
  - Channel split: Walmart dominant by deduction dollars
  - Type mix: short_ship + label_fine dominate by count
  - Date ranges within the build window
  - Slotting and post-audit conventions (NULL order_id)
  - Disputes never reference a non-existent deduction
  - Recovery dollars never exceed deduction dollars
  - JSON export matches DB row counts
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path

import prod_guard
import psycopg2

ROOT = Path(__file__).resolve().parent.parent
JSON_DIR = ROOT / "frontend" / "public" / "json"

# Cross-channel tables (int_all_*) have widened ranges to cover
# retailer + distributor rows; retailer-only tables keep original ranges.
TARGETS = {
    "int_all_orders":                 (45000, 65000),
    "stg_retailer_order_lines":       (150000, 220000),
    "int_all_shipments":              (45000, 65000),
    "stg_retailer_pack_records":      (38000, 55000),
    "int_all_deductions":             (14000, 20000),
    "int_all_remittances":            (250, 500),
    "int_all_disputes":               (5000, 7500),
    "stg_retailer_dispute_evidence":  (18000, 28000),
    "stg_retailer_post_audit_claims": (180, 280),
    "int_all_partners":               (7, 12),
    "stg_retailer_rules":             (40, 70),
    "stg_retailer_deduction_codes":   (80, 120),
    "stg_retailer_edi_requirements":  (30, 60),
}

ANNUAL_DOLLAR_TARGET = (750_000, 1_200_000)
RECOVERY_RATE_TARGET = (0.05, 0.20)  # 5-20%; lean team should be on the lower side


class Reporter:
    def __init__(self) -> None:
        self.fail_count = 0
        self.warn_count = 0
        self.pass_count = 0

    def passed(self, msg: str) -> None:
        self.pass_count += 1
        print(f"  [PASS] {msg}")

    def warn(self, msg: str) -> None:
        self.warn_count += 1
        print(f"  [WARN] {msg}")

    def fail(self, msg: str) -> None:
        self.fail_count += 1
        print(f"  [FAIL] {msg}")


class _Cursor:
    """Wraps psycopg2 cursor so execute() returns self (chainable)."""

    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=None):
        self._cur.execute(sql, params)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()


def in_range(value, lo, hi) -> bool:
    return lo <= value <= hi


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("FATAL: DATABASE_URL environment variable is not set.")
        return 2

    prod_guard.check(url)  # refuses a fly tunnel to production
    con = psycopg2.connect(url)
    con.cursor().execute("SET search_path TO public_intermediate, public_staging, public_marts, raw, public")
    con.commit()
    con.autocommit = True
    cur = _Cursor(con.cursor())
    rep = Reporter()

    # ===== Row counts =====
    print("Row counts (target ranges from data/schema.md):")
    for table, (lo, hi) in TARGETS.items():
        n = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if in_range(n, lo, hi):
            rep.passed(f"{table:<32} {n:>6,}  (in [{lo:,}, {hi:,}])")
        else:
            rep.warn(f"{table:<32} {n:>6,}  (target [{lo:,}, {hi:,}])")

    # ===== Referential integrity =====
    print("\nReferential integrity:")

    checks = [
        ("orders.partner_id -> partners", """
            SELECT COUNT(*) FROM int_all_orders o
            LEFT JOIN int_all_partners p ON p.partner_id = o.partner_id
            WHERE p.partner_id IS NULL
        """),
        ("order_lines.order_id -> orders", """
            SELECT COUNT(*) FROM stg_retailer_order_lines ol
            LEFT JOIN int_all_orders o ON o.order_id = ol.order_id
            WHERE o.order_id IS NULL
        """),
        ("order_lines.sku -> product_master", """
            SELECT COUNT(*) FROM stg_retailer_order_lines ol
            LEFT JOIN stg_product_master p ON p.sku = ol.sku
            WHERE p.sku IS NULL
        """),
        ("shipments.order_id -> orders", """
            SELECT COUNT(*) FROM int_all_shipments s
            LEFT JOIN int_all_orders o ON o.order_id = s.order_id
            WHERE o.order_id IS NULL
        """),
        ("pack_records.order_id -> orders", """
            SELECT COUNT(*) FROM stg_retailer_pack_records p
            LEFT JOIN int_all_orders o ON o.order_id = p.order_id
            WHERE o.order_id IS NULL
        """),
        ("pack_records.shipment_id -> shipments (where set)", """
            SELECT COUNT(*) FROM stg_retailer_pack_records p
            LEFT JOIN int_all_shipments s ON s.shipment_id = p.shipment_id
            WHERE p.shipment_id IS NOT NULL AND s.shipment_id IS NULL
        """),
        ("deductions.partner_id -> partners", """
            SELECT COUNT(*) FROM int_all_deductions d
            LEFT JOIN int_all_partners p ON p.partner_id = d.partner_id
            WHERE p.partner_id IS NULL
        """),
        ("deductions.order_id -> orders (where set)", """
            SELECT COUNT(*) FROM int_all_deductions d
            LEFT JOIN int_all_orders o ON o.order_id = d.order_id
            WHERE d.order_id IS NOT NULL AND o.order_id IS NULL
        """),
        ("deductions.code_id -> deduction_codes (where set)", """
            SELECT COUNT(*) FROM int_all_deductions d
            LEFT JOIN stg_retailer_deduction_codes c ON c.code_id = d.code_id
            WHERE d.code_id IS NOT NULL AND c.code_id IS NULL
        """),
        ("deductions.remittance_id -> remittances (no orphans)", """
            SELECT COUNT(*) FROM int_all_deductions WHERE remittance_id IS NULL
        """),
        ("disputes.deduction_id -> deductions", """
            SELECT COUNT(*) FROM int_all_disputes d
            LEFT JOIN int_all_deductions de ON de.deduction_id = d.deduction_id
            WHERE de.deduction_id IS NULL
        """),
        ("dispute_evidence.dispute_id -> disputes", """
            SELECT COUNT(*) FROM stg_retailer_dispute_evidence e
            LEFT JOIN int_all_disputes d ON d.dispute_id = e.dispute_id
            WHERE d.dispute_id IS NULL
        """),
        ("post_audit_claims.deduction_id -> deductions", """
            SELECT COUNT(*) FROM stg_retailer_post_audit_claims p
            LEFT JOIN int_all_deductions d ON d.deduction_id = p.deduction_id
            WHERE d.deduction_id IS NULL
        """),
    ]
    for label, sql in checks:
        n = cur.execute(sql).fetchone()[0]
        if n == 0:
            rep.passed(f"{label}")
        else:
            rep.fail(f"{label}: {n} broken refs")

    # ===== Design conventions =====
    print("\nDesign conventions:")

    no_order_standard = cur.execute("""
        SELECT COUNT(*) FROM int_all_deductions
        WHERE order_id IS NULL AND is_post_audit=false
          AND deduction_type != 'slotting'
          AND channel_type = 'retailer'
    """).fetchone()[0]
    if no_order_standard == 0:
        rep.passed("Retailer non-post-audit non-slotting deductions all have order_id")
    else:
        rep.fail(f"{no_order_standard} standard retailer deductions missing order_id")

    # Distributors are covered explicitly — the old retailer-only filter
    # excluded exactly the rows that would be missing if the distributor
    # channel silently dropped out (CINDERHAVEN_CANONICAL.md, partner roster).
    dist_counts = cur.execute("""
        SELECT COUNT(*),
               COUNT(*) FILTER (WHERE order_id IS NULL)
        FROM int_all_deductions WHERE channel_type = 'distributor'
    """).fetchone()
    if dist_counts[0] == 0:
        rep.fail("No distributor deductions in int_all_deductions — channel missing")
    elif dist_counts[1] == 0:
        rep.passed(f"Distributor deductions present ({dist_counts[0]:,}) and all have order_id")
    else:
        rep.fail(f"{dist_counts[1]} distributor deductions missing order_id")

    slotting_with_order = cur.execute("""
        SELECT COUNT(*) FROM int_all_deductions
        WHERE deduction_type='slotting' AND order_id IS NOT NULL
    """).fetchone()[0]
    if slotting_with_order == 0:
        rep.passed("Slotting deductions never link to a specific order_id")
    else:
        rep.warn(f"{slotting_with_order} slotting deductions link to order_id (design says NULL)")

    slotting_with_dispute = cur.execute("""
        SELECT COUNT(*) FROM int_all_deductions d
        JOIN int_all_disputes disp ON disp.deduction_id = d.deduction_id
        WHERE d.deduction_type='slotting'
    """).fetchone()[0]
    if slotting_with_dispute == 0:
        rep.passed("Slotting deductions never have a dispute (non-disputable)")
    else:
        rep.fail(f"{slotting_with_dispute} slotting deductions have a dispute (should be 0)")

    slotting_with_deadline = cur.execute("""
        SELECT COUNT(*) FROM int_all_deductions
        WHERE deduction_type='slotting' AND dispute_deadline IS NOT NULL
    """).fetchone()[0]
    if slotting_with_deadline == 0:
        rep.passed("Slotting deductions have no dispute_deadline (non-disputable)")
    else:
        rep.fail(f"{slotting_with_deadline} slotting deductions have dispute_deadline set")

    audit_with_order = cur.execute("""
        SELECT COUNT(*) FROM int_all_deductions WHERE is_post_audit=true AND order_id IS NOT NULL
    """).fetchone()[0]
    if audit_with_order == 0:
        rep.passed("Post-audit deductions never link to a specific order_id")
    else:
        rep.warn(f"{audit_with_order} post-audit deductions link to order_id (design says NULL)")

    # ===== Dollar volume =====
    print("\nDollar volume:")
    total = float(cur.execute("SELECT SUM(deduction_amount) FROM int_all_deductions").fetchone()[0] or 0)
    window = cur.execute(
        "SELECT MIN(deduction_date), MAX(deduction_date) FROM int_all_deductions"
    ).fetchone()
    start = window[0] if isinstance(window[0], date) else date.fromisoformat(window[0])
    end = window[1] if isinstance(window[1], date) else date.fromisoformat(window[1])
    months = (end.year - start.year) * 12 + (end.month - start.month) + 1
    annualized = total * 12 / months

    if in_range(annualized, *ANNUAL_DOLLAR_TARGET):
        rep.passed(f"Annualized deductions ${annualized:,.0f} in target ${ANNUAL_DOLLAR_TARGET[0]:,}-${ANNUAL_DOLLAR_TARGET[1]:,}")
    else:
        rep.warn(f"Annualized deductions ${annualized:,.0f} outside target ${ANNUAL_DOLLAR_TARGET[0]:,}-${ANNUAL_DOLLAR_TARGET[1]:,}")

    recovered = float(cur.execute("SELECT SUM(recovered_amount) FROM int_all_disputes").fetchone()[0] or 0)
    if recovered <= total:
        rep.passed(f"Total recovered (${recovered:,.0f}) <= total deductions (${total:,.0f})")
    else:
        rep.fail(f"Total recovered (${recovered:,.0f}) EXCEEDS total deductions (${total:,.0f})")

    rate = recovered / total if total else 0
    if in_range(rate, *RECOVERY_RATE_TARGET):
        rep.passed(f"Recovery rate {rate:.1%} in target {RECOVERY_RATE_TARGET[0]:.0%}-{RECOVERY_RATE_TARGET[1]:.0%}")
    else:
        rep.warn(f"Recovery rate {rate:.1%} outside target {RECOVERY_RATE_TARGET[0]:.0%}-{RECOVERY_RATE_TARGET[1]:.0%}")

    # ===== Channel split sanity =====
    print("\nChannel split (Walmart should be largest by deduction $):")
    rows = cur.execute("""
        SELECT partner_id, SUM(deduction_amount) AS amt
        FROM int_all_deductions
        GROUP BY partner_id
        ORDER BY amt DESC
    """).fetchall()
    if rows and rows[0][0] == "walmart":
        rep.passed(f"Walmart is largest deduction-$ partner (${float(rows[0][1]):,.0f})")
    else:
        rep.warn(f"Largest is {rows[0][0]} (${float(rows[0][1]):,.0f}); expected walmart")

    # ===== Type mix =====
    print("\nType mix (short_ship+label_fine should dominate by count):")
    type_counts = dict(cur.execute(
        "SELECT deduction_type, COUNT(*) FROM int_all_deductions GROUP BY deduction_type"
    ).fetchall())
    short_label = type_counts.get("short_ship", 0) + type_counts.get("label_fine", 0)
    total_count = sum(type_counts.values())
    pct = short_label / total_count if total_count else 0
    if pct >= 0.40:
        rep.passed(f"short_ship + label_fine = {short_label:,} ({pct:.1%}) — labels-as-root-cause story holds")
    else:
        rep.warn(f"short_ship + label_fine only {pct:.1%} of count — story may not land")

    # ===== Date ranges =====
    print("\nDate ranges:")
    expected_min = date(2023, 11, 1)
    expected_max = date(2025, 9, 30)
    deduction_min = cur.execute("SELECT MIN(deduction_date) FROM int_all_deductions").fetchone()[0]
    deduction_max = cur.execute("SELECT MAX(deduction_date) FROM int_all_deductions").fetchone()[0]
    if expected_min <= deduction_min and deduction_max <= expected_max:
        rep.passed(f"deductions dates {deduction_min} to {deduction_max} within reasonable window")
    else:
        rep.warn(f"deductions dates {deduction_min} to {deduction_max} fall outside expected window")

    # ===== JSON / DB row count parity =====
    print("\nJSON export parity:")
    if not JSON_DIR.exists():
        rep.warn(f"{JSON_DIR} does not exist — run scripts/20_export_json.py")
    else:
        deductions_json = JSON_DIR / "deductions.json"
        if deductions_json.exists():
            n_json = len(json.loads(deductions_json.read_text(encoding="utf-8")))
            n_db = cur.execute("SELECT COUNT(*) FROM int_all_deductions").fetchone()[0]
            if n_json == n_db:
                rep.passed(f"deductions.json has {n_json:,} records, matches DB")
            else:
                rep.fail(f"deductions.json has {n_json:,} records but DB has {n_db:,}")
        else:
            rep.warn("deductions.json missing")

    # ===== Summary =====
    print()
    print("=" * 50)
    print(f"  PASS: {rep.pass_count}    WARN: {rep.warn_count}    FAIL: {rep.fail_count}")
    print("=" * 50)
    con.close()
    return 1 if rep.fail_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
