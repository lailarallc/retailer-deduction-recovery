"""Export the Cinderhaven deductions data to static JSON files
that the React app will consume.

Reads from the Cinderhaven Data Platform (Postgres).

Three files in frontend/public/json/:
  - summary.json        Top-line metrics for the landing view.
  - deductions.json     Denormalized array of all deductions with
                         linked order / pack / shipment / dispute /
                         dispute_evidence. The workhorse for the
                         explorer, Sankey flow, causation tracing,
                         simulation, and timeline pressure features.
  - retailers.json      Retailer metadata + rules + codes + EDI
                         requirements for retailer-card rendering.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import date
from decimal import Decimal
from pathlib import Path

import prod_guard
import psycopg2
import psycopg2.extensions
import psycopg2.extras

DEC2FLOAT = psycopg2.extensions.new_type(
    psycopg2.extensions.DECIMAL.values,
    'DEC2FLOAT',
    lambda value, curs: float(value) if value is not None else None,
)
psycopg2.extensions.register_type(DEC2FLOAT)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "json"


class _ChainCursor:
    """Wraps a psycopg2 RealDictCursor so execute() returns self (chainable)."""

    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=None):
        self._cur.execute(sql, params)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()


class _Connection:
    """Wraps psycopg2 connection to return chainable dict cursors."""

    def __init__(self, dsn: str):
        self._conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.RealDictCursor)
        self._conn.cursor().execute("SET search_path TO public_intermediate, public_staging, public_marts, raw, public")
        self._conn.commit()
        self._conn.autocommit = True

    def cursor(self):
        return _ChainCursor(self._conn.cursor())

    def close(self):
        self._conn.close()


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pw = os.environ.get("POSTGRES_PASSWORD", "")
        url = f"postgresql://postgres:REDACTED@localhost:5432/cinderhaven"
    prod_guard.check(url)  # refuses a fly tunnel to production
    return _Connection(url)


def build_summary(con) -> dict:
    cur = con.cursor()

    window = cur.execute(
        "SELECT MIN(deduction_date) AS start, MAX(deduction_date) AS end FROM int_all_deductions"
    ).fetchone()
    window_start = window["start"] if isinstance(window["start"], date) else date.fromisoformat(window["start"])
    window_end = window["end"] if isinstance(window["end"], date) else date.fromisoformat(window["end"])
    # Inclusive distinct-calendar-month count: Jan 2023 → Jan 2026 = 37 (both
    # partial end months count). This is the annualization divisor (×12/months)
    # and the "(N months)" shown in the UI subtitle.
    window_months = (window_end.year - window_start.year) * 12 + (window_end.month - window_start.month) + 1

    totals_row = cur.execute("""
        SELECT
            COUNT(*) AS deductions_count,
            ROUND(SUM(deduction_amount), 2) AS deductions_dollar
        FROM int_all_deductions
    """).fetchone()

    disputes_row = cur.execute("""
        SELECT
            COUNT(*) AS disputes_filed,
            ROUND(SUM(recovered_amount), 2) AS disputes_recovered,
            ROUND(SUM(labor_hours), 1) AS labor_hours
        FROM int_all_disputes
    """).fetchone()

    orders_row = cur.execute("""
        SELECT
            COUNT(*) AS orders_count,
            ROUND(SUM(total_value), 2) AS orders_dollar
        FROM int_all_orders
        WHERE po_date BETWEEN %s AND %s
    """, (window_start.isoformat(), window_end.isoformat())).fetchone()

    recovery_rate = (disputes_row["disputes_recovered"] or 0) / (totals_row["deductions_dollar"] or 1)
    annualized = (totals_row["deductions_dollar"] or 0) * 12 / window_months
    # Whole-window labor expressed in work-years (total hours / 2080), NOT an
    # annual FTE count. The UI ignores this field and annualizes on its own:
    # labor_hours × 12 / window.months / 2080 (App.tsx kpiFte, ≈1.75).
    fte = (disputes_row["labor_hours"] or 0) / 2080.0

    by_type = []
    for row in cur.execute("""
        SELECT deduction_type, COUNT(*) AS count, ROUND(SUM(deduction_amount), 2) AS dollar
        FROM int_all_deductions
        GROUP BY deduction_type
        ORDER BY dollar DESC
    """).fetchall():
        row["pct_count"] = round(row["count"] / totals_row["deductions_count"], 4)
        row["pct_dollars"] = round(row["dollar"] / totals_row["deductions_dollar"], 4)
        by_type.append(row)

    by_retailer = []
    for row in cur.execute("""
        SELECT
            d.partner_id,
            r.name,
            r.channel_type,
            COUNT(*) AS deductions,
            ROUND(SUM(d.deduction_amount), 2) AS dollar,
            ROUND(SUM(disp.recovered_amount), 2) AS recovered
        FROM int_all_deductions d
        JOIN int_all_partners r ON r.partner_id = d.partner_id
        LEFT JOIN int_all_disputes disp ON disp.deduction_id = d.deduction_id
        GROUP BY d.partner_id, r.name, r.channel_type
        ORDER BY dollar DESC
    """).fetchall():
        recovered = row["recovered"] or 0
        row["recovered"] = round(recovered, 2)
        row["recovery_rate"] = round(recovered / row["dollar"], 4) if row["dollar"] else 0
        by_retailer.append(row)

    by_outcome = []
    for row in cur.execute("""
        SELECT outcome, COUNT(*) AS count, ROUND(SUM(recovered_amount), 2) AS dollar
        FROM int_all_disputes
        GROUP BY outcome
        ORDER BY count DESC
    """).fetchall():
        by_outcome.append(row)

    by_evidence_quality = []
    for row in cur.execute("""
        SELECT evidence_quality, COUNT(*) AS count
        FROM int_all_disputes
        GROUP BY evidence_quality
        ORDER BY count DESC
    """).fetchall():
        by_evidence_quality.append(row)

    deductions_no_dispute = cur.execute("""
        SELECT COUNT(*) AS n, ROUND(SUM(d.deduction_amount), 2) AS dollar
        FROM int_all_deductions d
        LEFT JOIN int_all_disputes disp ON disp.deduction_id = d.deduction_id
        WHERE disp.dispute_id IS NULL
    """).fetchone()

    summary = {
        "window": {
            "start": window["start"],
            "end": window["end"],
            "months": window_months,
        },
        "totals": {
            "deductions_count": totals_row["deductions_count"],
            "deductions_dollar": totals_row["deductions_dollar"],
            "annualized_dollar": round(annualized, 2),
            "disputes_filed": disputes_row["disputes_filed"],
            "disputes_recovered": disputes_row["disputes_recovered"] or 0,
            "recovery_rate": round(recovery_rate, 4),
            "labor_hours": disputes_row["labor_hours"] or 0,
            "fte_equivalent": round(fte, 2),
            "orders_count": orders_row["orders_count"],
            "orders_dollar": orders_row["orders_dollar"],
            "deductions_no_dispute_count": deductions_no_dispute["n"],
            "deductions_no_dispute_dollar": deductions_no_dispute["dollar"] or 0,
        },
        "by_type": by_type,
        "by_retailer": by_retailer,
        "by_outcome": by_outcome,
        "by_evidence_quality": by_evidence_quality,
    }
    return summary


def build_deductions(con) -> list[dict]:
    cur = con.cursor()

    # Pre-fetch the lookups that will be repeatedly joined
    partners = {r["partner_id"]: r for r in cur.execute("SELECT * FROM int_all_partners").fetchall()}
    codes = {c["code_id"]: c for c in cur.execute("SELECT * FROM stg_retailer_deduction_codes").fetchall()}
    orders = {o["order_id"]: o for o in cur.execute("SELECT * FROM int_all_orders").fetchall()}
    pack_records = {p["order_id"]: p for p in cur.execute("SELECT * FROM stg_retailer_pack_records").fetchall()}
    shipments = {s["order_id"]: s for s in cur.execute("SELECT * FROM int_all_shipments").fetchall()}
    disputes = {d["deduction_id"]: d for d in cur.execute("SELECT * FROM int_all_disputes").fetchall()}

    # dispute_evidence grouped by dispute_id
    evidence_by_dispute: dict[str, list[dict]] = defaultdict(list)
    for ev in cur.execute("SELECT * FROM stg_retailer_dispute_evidence").fetchall():
        ev_clean = {
            "type": ev["evidence_type"],
            "submitted": bool(ev["was_submitted"]),
            "required": bool(ev["was_required"]),
            "format": ev["evidence_format"],
            "notes": ev["notes"],
        }
        evidence_by_dispute[ev["dispute_id"]].append(ev_clean)

    # post_audit_claims by deduction_id
    audit_by_deduction = {a["deduction_id"]: a for a in cur.execute("SELECT * FROM stg_retailer_post_audit_claims").fetchall()}

    out = []
    for d in cur.execute("SELECT * FROM int_all_deductions").fetchall():
        partner = partners.get(d["partner_id"], {})
        code = codes.get(d["code_id"]) if d.get("code_id") else None
        order = orders.get(d["order_id"]) if d["order_id"] else None
        pack = pack_records.get(d["order_id"]) if d["order_id"] else None
        shipment_id = order.get("order_id") if order else None
        shipment = shipments.get(shipment_id) if shipment_id else None
        dispute = disputes.get(d["deduction_id"])
        audit = audit_by_deduction.get(d["deduction_id"])

        record = {
            "deduction_id": d["deduction_id"],
            "deduction_type": d["deduction_type"],
            "amount": d["deduction_amount"],
            "deduction_date": d["deduction_date"],
            "dispute_deadline": d.get("dispute_deadline"),
            "is_post_audit": bool(d.get("is_post_audit")),
            "remittance_id": d["remittance_id"],
            "channel_type": d["channel_type"],
            "retailer": {
                "id": partner.get("partner_id"),
                "name": partner.get("name"),
                "channel_type": partner.get("channel_type"),
            },
            "code": {
                "id": code["code_id"],
                "code": code["code"],
                "name": code["code_name"],
                "is_published": bool(code["is_published"]),
            } if code else None,
            "order": {
                "order_id": order["order_id"],
                "po_number": order["po_number"],
                "po_date": order["po_date"],
                "total_units": order["total_units"],
                "total_value": order["total_value"],
                "requested_ship_date": order.get("requested_ship_date"),
            } if order else None,
            "pack_record": {
                "pack_date": pack["pack_date"],
                "label_scannable": bool(pack["label_scannable"]),
                "pack_verification": pack["pack_verification"],
                "evidence_format": pack["evidence_format"],
                "units_picked": pack["units_picked"],
                "units_packed": pack["units_packed"],
            } if pack else None,
            "shipment": {
                "shipment_id": shipment["shipment_id"],
                "ship_date": shipment["ship_date"],
                "delivery_date": shipment["delivery_date"],
                "carrier": shipment["carrier"],
                "bol_number": shipment.get("bol_number"),
                "asn_sent": bool(shipment.get("asn_sent")),
                "asn_sent_late": bool(shipment.get("asn_sent_late")),
                "units_shipped": shipment["units_shipped"],
                "pallets_shipped": shipment.get("pallets_shipped"),
            } if shipment else None,
            "dispute": {
                "dispute_id": dispute["dispute_id"],
                "filed_date": dispute["filed_date"],
                "filing_method": dispute.get("filing_method"),
                "evidence_quality": dispute.get("evidence_quality"),
                "outcome": dispute["outcome"],
                "recovered_amount": dispute["recovered_amount"],
                "closed_date": dispute["closed_date"],
                "labor_hours": dispute["labor_hours"],
                "evidence": evidence_by_dispute.get(dispute["dispute_id"], []),
            } if dispute else None,
            "post_audit": {
                "claim_id": audit["claim_id"],
                "auditor_name": audit["auditor_name"],
                "audit_period_start": audit["audit_period_start"],
                "audit_period_end": audit["audit_period_end"],
                "claim_type": audit["claim_type"],
                "lookback_months": audit["lookback_months"],
            } if audit else None,
        }
        out.append(record)
    return out


def build_retailers(con) -> dict:
    cur = con.cursor()

    rules_by_retailer: dict[str, dict[str, dict]] = defaultdict(dict)
    for r in cur.execute("SELECT * FROM stg_retailer_rules").fetchall():
        evidence_list = [e.strip() for e in (r["evidence_required"] or "").split(",") if e.strip()]
        rules_by_retailer[r["retailer_id"]][r["deduction_type"]] = {
            "dispute_window_days": r["dispute_window_days"],
            "auto_deduct": bool(r["auto_deduct"]),
            "evidence_required": evidence_list,
            "typical_recovery_rate": r["typical_recovery_rate"],
            "notes": r["notes"],
        }

    codes_by_retailer: dict[str, list[dict]] = defaultdict(list)
    for c in cur.execute("SELECT * FROM stg_retailer_deduction_codes ORDER BY retailer_id, code").fetchall():
        codes_by_retailer[c["retailer_id"]].append({
            "code_id": c["code_id"],
            "code": c["code"],
            "name": c["code_name"],
            "deduction_type": c["deduction_type"],
            "is_published": bool(c["is_published"]),
        })

    edi_by_retailer: dict[str, list[dict]] = defaultdict(list)
    for e in cur.execute("SELECT * FROM stg_retailer_edi_requirements ORDER BY retailer_id, category").fetchall():
        edi_by_retailer[e["retailer_id"]].append({
            "category": e["category"],
            "requirement": e["requirement"],
            "penalty_if_violated": e["penalty_if_violated"],
            "is_verified": bool(e["is_verified"]),
            "source_url": e["source_url"],
        })

    out = {}
    # All nine trading partners, with their true channel_type — distributors
    # are not retailers with a different label (CINDERHAVEN_CANONICAL.md,
    # partner roster). Rules/codes/EDI remain retailer-keyed; distributors
    # legitimately carry empty maps until distributor rulebooks are modeled.
    for r in cur.execute("SELECT * FROM int_all_partners ORDER BY partner_id").fetchall():
        rid = r["partner_id"]
        out[rid] = {
            "name": r["name"],
            "channel_type": r["channel_type"],
            "dispute_portal_name": r["dispute_portal_name"],
            "dispute_portal_url": r["dispute_portal_url"],
            "dispute_method": r["dispute_method"],
            "notes": r["notes"],
            "rules": rules_by_retailer.get(rid, {}),
            "codes": codes_by_retailer.get(rid, []),
            "edi_requirements": edi_by_retailer.get(rid, []),
        }
    return out


def _json_default(obj):
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def write_json(obj, path: Path, indent: int | None = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        if indent is None:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False, default=_json_default)
        else:
            json.dump(obj, f, indent=indent, ensure_ascii=False, default=_json_default)
    size_kb = path.stat().st_size / 1024
    print(f"  Wrote {path.relative_to(ROOT)}  ({size_kb:,.1f} KB)")


def main() -> None:
    con = connect()
    try:
        print("Exporting JSON...")

        summary = build_summary(con)
        write_json(summary, OUT_DIR / "summary.json", indent=2)

        deductions = build_deductions(con)
        # Compact format — 3,300+ records would 1.5x in size with indent
        write_json(deductions, OUT_DIR / "deductions.json", indent=None)

        retailers = build_retailers(con)
        write_json(retailers, OUT_DIR / "retailers.json", indent=2)

        print()
        print(f"Records:")
        print(f"  summary       — top-line metrics, type & retailer & outcome breakdowns")
        print(f"  deductions    — {len(deductions):,} records, denormalized with linked tables")
        print(f"  retailers     — {len(retailers):,} retailers with rules, codes, EDI requirements")
    finally:
        con.close()


if __name__ == "__main__":
    main()
