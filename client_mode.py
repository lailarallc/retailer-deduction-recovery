"""Client-mode CLI for retailer-deduction-recovery.

Wraps the deduction-recovery analytics with the shared ``lailara_engagement``
scaffold so a client's deduction ledger can be analyzed locally:

  * tolerant CSV/XLSX intake (identifiers as text, dates faithfully rendered),
  * a preflight that names each canonical column via ``engagement.yml`` (a Data
    Readiness Report if a required column is missing or the data isn't ready),
  * the headline recovery economics computed from the ledger — every dollar
    figure printed next to its basis and window (checklist §3), and
  * a branded, provenance-footed, draft-watermarked ``Deduction Recovery
    Summary`` plus a frontend-compatible ``summary.json`` — all written to
    ``client-output/`` only, never committed, never deployed.

The interactive per-deduction views (causation trace, dispute builder, origin
clustering, post-audit risk) need the client's operational extracts (order /
pack / shipment / evidence records), which a remittance ledger does not carry;
their absence is disclosed as a data limitation rather than silently zeroed.

Usage:
    python client_mode.py --config engagement.yml --input client-data/deductions.csv \
        --out client-output [--final]
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from lailara_engagement import (
    ColumnSpec,
    PreflightSpec,
    build_provenance,
    load_config,
    read_table,
    run_preflight,
    validation_status_label,
    write_report,
)
from lailara_engagement import palette as P
from lailara_engagement.provenance import Provenance

TOOL = "retailer-deduction-recovery"
TOOL_VERSION = "1.0"

# Values a "dispute_filed" cell can hold that mean "NOT disputed". Anything else
# non-blank (a filed date, "yes", "y", "true", "1") counts as disputed.
_NOT_DISPUTED = {"", "no", "n", "false", "0", "none", "n/a", "na"}


def _ledger_spec() -> PreflightSpec:
    """The deduction-ledger schema the analytics consume (see INPUT-SPEC.md)."""
    return PreflightSpec(
        tool=TOOL,
        version=TOOL_VERSION,
        columns=[
            ColumnSpec(name="deduction_id", dtype="identifier", required=True,
                       unique=True, description="unique deduction line id",
                       spec_ref="INPUT-SPEC §1"),
            ColumnSpec(name="deduction_type", dtype="string", required=True,
                       description="deduction reason/type bucket",
                       spec_ref="INPUT-SPEC §2"),
            ColumnSpec(name="amount", dtype="number", required=True, not_negative=True,
                       description="deduction dollar amount", spec_ref="INPUT-SPEC §3"),
            ColumnSpec(name="deduction_date", dtype="date", required=True,
                       description="remittance/deduction date", spec_ref="INPUT-SPEC §4"),
            # Optional enrichments. allow_blank=True because a blank cell is a
            # meaningful state, not a defect: a blank dispute_filed means the
            # deduction was never disputed (the core "never filed" cohort), a
            # blank recovered_amount means $0 recovered, a blank outcome means no
            # dispute yet. Flagging those as errors would block every partially-
            # disputed ledger. Absence of the whole column is disclosed separately.
            ColumnSpec(name="retailer", dtype="string", required=False, allow_blank=True,
                       description="retailer/distributor the deduction came from"),
            ColumnSpec(name="dispute_filed", dtype="string", required=False, allow_blank=True,
                       description="filed date or yes/no; blank => never filed"),
            ColumnSpec(name="recovered_amount", dtype="number", required=False, allow_blank=True,
                       not_negative=True, description="dollars recovered via dispute"),
            ColumnSpec(name="dispute_outcome", dtype="string", required=False, allow_blank=True,
                       description="won / partial / lost / pending"),
            ColumnSpec(name="dispute_deadline", dtype="date", required=False, allow_blank=True,
                       description="retailer dispute deadline"),
            ColumnSpec(name="labor_hours", dtype="number", required=False, allow_blank=True,
                       not_negative=True, description="labor hours spent on the dispute"),
        ],
    )


def _num(v: str) -> float:
    try:
        return float(str(v).strip())
    except (ValueError, TypeError):
        return 0.0


def _is_disputed(v: str) -> bool:
    return str(v).strip().casefold() not in _NOT_DISPUTED


def compute_analytics(read, report, config) -> tuple[dict, list[str]]:
    """Compute the headline deduction economics from the resolved ledger.

    Returns (summary_dict, limitations). summary_dict mirrors the schema the
    interactive app consumes (frontend/src/types.ts). limitations lists every
    analysis skipped because its optional column was absent.
    """
    frame = read.frame
    m = report.column_mapping
    window_months = int(config.basis.get("window_months") or 0) or None
    window_label = config.basis.get("window_label", "")

    def col(name):
        resolved = m.get(name)
        return frame[resolved] if resolved else None

    amount = col("amount")
    dtype_s = col("deduction_type")
    retailer_s = col("retailer")
    disp_s = col("dispute_filed")
    recovered_s = col("recovered_amount")
    outcome_s = col("dispute_outcome")
    labor_s = col("labor_hours")

    n = len(frame)
    total_dollar = 0.0
    disputes_filed = 0
    disputes_recovered = 0.0
    no_dispute_count = 0
    no_dispute_dollar = 0.0
    labor_hours = 0.0
    by_type: dict[str, dict] = {}
    by_retailer: dict[str, dict] = {}
    by_outcome: dict[str, dict] = {}

    have_dispute = disp_s is not None
    have_recovered = recovered_s is not None
    have_retailer = retailer_s is not None
    have_outcome = outcome_s is not None
    have_labor = labor_s is not None

    for i in range(n):
        amt = _num(amount.iloc[i])
        total_dollar += amt

        t = str(dtype_s.iloc[i]).strip() or "(unspecified)"
        bt = by_type.setdefault(t, {"deduction_type": t, "count": 0, "dollar": 0.0})
        bt["count"] += 1
        bt["dollar"] += amt

        disputed = have_dispute and _is_disputed(disp_s.iloc[i])
        rec = _num(recovered_s.iloc[i]) if have_recovered else 0.0
        if disputed:
            disputes_filed += 1
            disputes_recovered += rec
            if have_labor:
                labor_hours += _num(labor_s.iloc[i])
        else:
            no_dispute_count += 1
            no_dispute_dollar += amt

        if have_retailer:
            r = str(retailer_s.iloc[i]).strip() or "(unspecified)"
            br = by_retailer.setdefault(r, {"name": r, "deductions": 0, "dollar": 0.0, "recovered": 0.0})
            br["deductions"] += 1
            br["dollar"] += amt
            br["recovered"] += rec

        if have_outcome and disputed:
            o = str(outcome_s.iloc[i]).strip() or "(unspecified)"
            bo = by_outcome.setdefault(o, {"outcome": o, "count": 0, "dollar": 0.0})
            bo["count"] += 1
            bo["dollar"] += rec

    annualized = (total_dollar * 12 / window_months) if window_months else None
    recovery_rate = (disputes_recovered / total_dollar) if total_dollar else 0.0
    disputed_dollar = total_dollar - no_dispute_dollar
    recovered_of_disputed = (disputes_recovered / disputed_dollar) if disputed_dollar else None
    fte_whole_window = round(labor_hours / 2080, 2) if have_labor else None
    fte_annualized = (labor_hours * 12 / window_months / 2080) if (have_labor and window_months) else None

    for bt in by_type.values():
        bt["pct_count"] = round(bt["count"] / n, 4) if n else 0
        bt["pct_dollars"] = round(bt["dollar"] / total_dollar, 4) if total_dollar else 0
        bt["dollar"] = round(bt["dollar"], 2)
    for br in by_retailer.values():
        br["dollar"] = round(br["dollar"], 2)
        br["recovered"] = round(br["recovered"], 2)
        br["recovery_rate"] = round(br["recovered"] / br["dollar"], 4) if br["dollar"] else 0
    for bo in by_outcome.values():
        bo["dollar"] = round(bo["dollar"], 2)

    summary = {
        "window": {"months": window_months, "label": window_label},
        "totals": {
            "deductions_count": n,
            "deductions_dollar": round(total_dollar, 2),
            "annualized_dollar": round(annualized, 2) if annualized is not None else None,
            "disputes_filed": disputes_filed if have_dispute else None,
            "disputes_recovered": round(disputes_recovered, 2) if have_recovered else None,
            "recovery_rate": round(recovery_rate, 4) if have_recovered else None,
            "recovered_of_disputed_rate": round(recovered_of_disputed, 4) if recovered_of_disputed is not None else None,
            "labor_hours": round(labor_hours, 1) if have_labor else None,
            "fte_equivalent": fte_whole_window,
            "deductions_no_dispute_count": no_dispute_count if have_dispute else None,
            "deductions_no_dispute_dollar": round(no_dispute_dollar, 2) if have_dispute else None,
        },
        "by_type": sorted(by_type.values(), key=lambda x: x["dollar"], reverse=True),
        "by_retailer": sorted(by_retailer.values(), key=lambda x: x["dollar"], reverse=True) if have_retailer else [],
        "by_outcome": sorted(by_outcome.values(), key=lambda x: x["count"], reverse=True) if have_outcome else [],
        "by_evidence_quality": [],
    }

    limitations: list[str] = []
    if not have_retailer:
        limitations.append("No `retailer` column — per-retailer scorecard omitted.")
    if not have_dispute:
        limitations.append("No `dispute_filed` column — recovery rate and the never-filed cohort could not be computed.")
    if not have_recovered:
        limitations.append("No `recovered_amount` column — recovered dollars treated as $0; recovery bases omitted.")
    if not have_outcome:
        limitations.append("No `dispute_outcome` column — outcome mix (won/partial/lost) omitted.")
    if not have_labor:
        limitations.append("No `labor_hours` column — dispute labor and FTE-equivalent omitted.")
    if window_months is None:
        limitations.append("No `basis.window_months` in config — annualized figures omitted.")
    limitations.append("Ledger-only intake: causation trace, dispute builder, evidence quality, "
                       "origin clustering and post-audit views require operational extracts "
                       "(order/pack/shipment/evidence) and are out of scope for this file.")
    return summary, limitations


def _fmt_dollars(v) -> str:
    return "—" if v is None else f"${v:,.0f}"


def _fmt_pct(v) -> str:
    return "—" if v is None else f"{v * 100:.1f}%"


def _summary_html(config, summary, limitations, provenance: Provenance, *, draft: bool) -> str:
    esc = html.escape
    t = summary["totals"]
    win_label = summary["window"].get("label") or ""
    win_months = summary["window"].get("months")
    win_suffix = f"{win_months} months" + (f" ({esc(win_label)})" if win_label else "") if win_months else "full window"
    draft_class = " ll-draft" if draft else ""

    type_rows = "".join(
        f"<tr><td>{esc(b['deduction_type'])}</td><td class=num>{b['count']:,}</td>"
        f"<td class=num>{_fmt_dollars(b['dollar'])}</td><td class=num>{b['pct_dollars']*100:.1f}%</td></tr>"
        for b in summary["by_type"]
    )
    retailer_section = ""
    if summary["by_retailer"]:
        rows = "".join(
            f"<tr><td>{esc(b['name'])}</td><td class=num>{b['deductions']:,}</td>"
            f"<td class=num>{_fmt_dollars(b['dollar'])}</td>"
            f"<td class=num>{_fmt_dollars(b['recovered'])}</td>"
            f"<td class=num>{b['recovery_rate']*100:.1f}%</td></tr>"
            for b in summary["by_retailer"]
        )
        retailer_section = f"""
<section class=ll-section>
  <h2 class=ll-h2>By retailer</h2>
  <table class=ll-table><thead><tr><th>Retailer</th><th>Deductions</th><th>Dollars</th>
  <th>Recovered</th><th>Recovery rate</th></tr></thead><tbody>{rows}</tbody></table>
</section>"""

    lim_html = "".join(f"<li>{esc(x)}</li>" for x in limitations)
    rec_rate = t.get("recovery_rate")
    rec_disp = t.get("recovered_of_disputed_rate")

    # Recovery-basis block: both rates, each explicitly labeled (the P1 lesson).
    recovery_block = ""
    if rec_rate is not None or rec_disp is not None:
        recovery_block = f"""
<section class=ll-section>
  <h2 class=ll-h2>Recovery — shown on both bases</h2>
  <table class=ll-table>
    <tr><td>Recovered / <strong>all</strong> deduction dollars (portfolio recovery rate)</td>
        <td class=num>{_fmt_pct(rec_rate)}</td></tr>
    <tr><td>Recovered / <strong>disputed</strong> dollars (how well filed disputes do)</td>
        <td class=num>{_fmt_pct(rec_disp)}</td></tr>
  </table>
  <p class=ll-note>The gap between these two is the filing gap: dollars never disputed
  cannot be recovered. Reporting only the disputed-dollar rate overstates portfolio recovery.</p>
</section>"""

    fte_line = ""
    if t.get("fte_equivalent") is not None:
        ann = ""
        if win_months and t.get("labor_hours"):
            ann_val = t["labor_hours"] * 12 / win_months / 2080
            ann = f" &middot; annualized ~{ann_val:.1f} FTE (x12/{win_months})"
        fte_line = (f"<tr><td>Dispute labor</td><td class=num>{t['labor_hours']:,.0f} hrs "
                    f"&middot; {t['fte_equivalent']:.2f} FTE whole-window{ann}</td></tr>")

    return f"""<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1">
<title>Deduction Recovery Summary — {esc(config.client_name)}</title>
<style>{_css(draft)}</style></head>
<body class="{draft_class.strip()}"><main class=ll-page>
<header class=ll-header>
  <div class=ll-eyebrow>Lailara LLC &middot; Deduction Recovery</div>
  <h1 class=ll-title>Deduction Recovery Summary</h1>
  <div class=ll-client>
    <div><span class=ll-k>Client</span> {esc(config.client_name)}</div>
    <div><span class=ll-k>Engagement</span> {esc(config.engagement_id)}</div>
    <div><span class=ll-k>As of</span> {esc(config.as_of_date.isoformat())}</div>
    <div><span class=ll-k>Window</span> {win_suffix}</div>
  </div>
</header>
<section class=ll-banner>
  <div class=ll-score>{_fmt_dollars(t['deductions_dollar'])} in deductions</div>
  <div>{t['deductions_count']:,} lines over {win_suffix}
       &middot; annualized {_fmt_dollars(t['annualized_dollar'])}</div>
</section>
<section class=ll-section>
  <h2 class=ll-h2>Headline economics</h2>
  <table class=ll-table>
    <tr><td>Total deductions</td><td class=num>{_fmt_dollars(t['deductions_dollar'])}
        &middot; {t['deductions_count']:,} lines</td></tr>
    <tr><td>Annualized (x12/{win_months if win_months else '—'})</td>
        <td class=num>{_fmt_dollars(t['annualized_dollar'])}</td></tr>
    <tr><td>Disputes filed</td><td class=num>{'—' if t['disputes_filed'] is None else format(t['disputes_filed'], ',')}</td></tr>
    <tr><td>Recovered</td><td class=num>{_fmt_dollars(t['disputes_recovered'])}</td></tr>
    <tr><td>Never filed</td><td class=num>{'—' if t['deductions_no_dispute_count'] is None else format(t['deductions_no_dispute_count'], ',')} lines
        &middot; {_fmt_dollars(t['deductions_no_dispute_dollar'])}</td></tr>
    {fte_line}
  </table>
</section>
{recovery_block}
<section class=ll-section>
  <h2 class=ll-h2>By deduction type</h2>
  <table class=ll-table><thead><tr><th>Type</th><th>Count</th><th>Dollars</th><th>Share $</th></tr></thead>
  <tbody>{type_rows}</tbody></table>
</section>
{retailer_section}
<section class=ll-section>
  <h2 class=ll-h2>Data limitations</h2>
  <ul class=ll-limitations>{lim_html}</ul>
</section>
{provenance.to_html()}
</main></body></html>"""


def _css(draft: bool) -> str:
    draft_css = (
        ".ll-draft::before{content:'DRAFT';position:fixed;top:50%;left:50%;"
        "transform:translate(-50%,-50%) rotate(-32deg);font-family:var(--s);"
        "font-size:22vw;font-weight:700;color:rgba(204,16,10,.06);z-index:0;"
        "pointer-events:none;white-space:nowrap}" if draft else ""
    )
    return f"""
:root{{--s:{P.LL_SERIF};--f:{P.LL_SANS}}}
*{{box-sizing:border-box}}
body{{margin:0;background:{P.LL_CANVAS};color:{P.LL_TEXT};font-family:var(--f);line-height:1.6}}
.ll-page{{position:relative;z-index:1;max-width:{P.LL_MAX_WIDTH};margin:0 auto;padding:48px 24px}}
.ll-header{{border-bottom:1px solid {P.LL_GRIDLINE};padding-bottom:24px;margin-bottom:24px}}
.ll-eyebrow{{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:{P.LL_RED};font-weight:600}}
.ll-title{{font-family:var(--s);font-weight:700;color:{P.LL_INK};font-size:34px;margin:8px 0 16px}}
.ll-client{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 24px;font-size:14px}}
.ll-k{{display:block;color:{P.LL_TEXT_SEC};font-size:11px;text-transform:uppercase;letter-spacing:.04em}}
.ll-banner{{border-radius:2px;padding:16px 20px;margin-bottom:32px;background:{P.LL_SG_SURFACE};color:{P.LL_SG_DARK}}}
.ll-score{{font-family:var(--s);font-weight:700;font-size:22px}}
.ll-section{{margin:0 0 32px}}
.ll-h2{{font-family:var(--s);font-weight:700;color:{P.LL_INK};font-size:22px;
margin:0 0 12px;padding-bottom:6px;border-bottom:1px solid {P.LL_GRIDLINE}}}
.ll-note{{font-size:13px;color:{P.LL_TEXT_SEC};margin-top:8px}}
.ll-table{{width:100%;border-collapse:collapse;font-size:14px}}
.ll-table th{{text-align:left;background:{P.LL_CHICAGO};color:#fff;padding:8px 12px}}
.ll-table td{{padding:8px 12px;border-bottom:1px solid {P.LL_GRIDLINE}}}
.ll-limitations{{margin:0;padding-left:20px}}.ll-limitations li{{margin-bottom:6px}}
.num{{text-align:right;font-variant-numeric:tabular-nums}}
.ll-provenance{{margin-top:40px;background:{P.LL_CARD_BG};color:{P.LL_CARD_TEXT};
padding:20px 24px;border-radius:2px;font-size:13px}}
.ll-prov-title{{font-family:var(--s);font-weight:700;font-size:16px;margin-bottom:8px}}
.ll-provenance div{{margin-bottom:4px;color:{P.LL_CARD_SUBTITLE}}}
.ll-provenance strong{{color:{P.LL_CARD_TEXT}}}
.ll-prov-inputs{{width:100%;border-collapse:collapse;margin-top:8px}}
.ll-prov-inputs th{{text-align:left;border-bottom:1px solid rgba(255,255,255,.12);
padding:4px 8px;color:{P.LL_CARD_MUTED}}}
.ll-prov-inputs td{{padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.08);color:{P.LL_CARD_SUBTITLE}}}
.ll-prov-brand{{margin-top:12px;font-family:var(--s);color:{P.LL_CARD_MUTED}}}
{draft_css}
@media print{{body{{background:#fff}}}}
"""


def run(config_path: str, input_path: str, out_dir: str, *, final: bool = False) -> dict:
    config = load_config(config_path)
    read = read_table(input_path)
    spec = _ledger_spec()
    report = run_preflight(read, spec, config)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    provenance = build_provenance(
        tool=TOOL, tool_version=TOOL_VERSION, inputs=[read], config=config,
        validation_status=validation_status_label(report.status, report.n_warnings),
    )

    # Preflight gate: a missing required column (or hard-fail threshold) -> Data
    # Readiness Report, no results.
    if not report.passed:
        paths = write_report(report, config, str(out), provenance=provenance,
                             draft=not final, basename="data-readiness-report",
                             title="Deduction Data Readiness Report")
        return {"status": "blocked", "readiness_report": paths["html"]}

    summary, limitations = compute_analytics(read, report, config)

    json_dir = out / "json"
    json_dir.mkdir(parents=True, exist_ok=True)
    (json_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    summary_path = out / "deduction-recovery-summary.html"
    summary_path.write_text(_summary_html(config, summary, limitations, provenance, draft=not final),
                            encoding="utf-8")

    return {
        "status": "ok",
        "total_dollar": summary["totals"]["deductions_dollar"],
        "count": summary["totals"]["deductions_count"],
        "recovery_rate": summary["totals"]["recovery_rate"],
        "report": str(summary_path),
        "summary_json": str(json_dir / "summary.json"),
        "n_warnings": report.n_warnings,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="deduction-recovery client mode",
                                 description="Analyze a client deduction ledger in engagement mode.")
    ap.add_argument("--config", required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="client-output")
    ap.add_argument("--final", action="store_true")
    args = ap.parse_args(argv)
    result = run(args.config, args.input, args.out, final=args.final)
    if result["status"] == "blocked":
        print(f"BLOCKED — data not ready. See {result['readiness_report']}")
        return 3
    rr = result["recovery_rate"]
    rr_str = "—" if rr is None else f"{rr * 100:.1f}%"
    print(f"analyzed {result['count']:,} deductions (${result['total_dollar']:,.0f}); "
          f"recovery rate {rr_str}"
          + (f"; {result['n_warnings']} warning(s)" if result["n_warnings"] else ""))
    print(f"report  -> {result['report']}\nsummary -> {result['summary_json']}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
