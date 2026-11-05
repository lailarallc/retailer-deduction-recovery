import { useMemo, useState } from "react";
import type { Deduction } from "../types";
import { formatCount, formatDollars, formatPercent } from "../data";
import { partnerLabel } from "../partnerLabels";
import { isOperational, evidenceCategoryFor, type EvidenceCategory } from "../sankey/domain";
import "./PostAuditRiskView.css";

interface Props {
  cohort: Deduction[];
  onTrace: (id: string) => void;
}

// Probability an auditor successfully claws back this dollar amount
// given the supplier's current evidence quality. Calibrated against
// the research notes in research/retailers/ — auditors win the lion's
// share of the time when the supplier has only paper or no records,
// and almost never when records are digital and timestamped.
const AUDIT_RISK: Record<EvidenceCategory, number> = {
  digital: 0.1,
  paper: 0.6,
  missing: 0.85,
};

const EVIDENCE_LABEL: Record<EvidenceCategory, string> = {
  digital: "Digital, complete",
  paper: "Paper / handwritten",
  missing: "None or lost",
};

// Retailer audit profiles — short, research-grounded notes that explain
// why the exposure sits where it sits. Keyed by retailer.id as it appears
// in the data (RET-*/DIST-*). Anything not listed gets a generic note.
const AUDIT_PROFILE: Record<string, string> = {
  "RET-WALMART":
    "Third-party email-based audits, 12–24 month lookback, large dollar averages.",
  "RET-COSTCO":
    "Regular GFSI compliance audits; chargebacks deducted from future payments.",
  "DIST-UNFI": "Audit deductions can be pulled directly from future invoices.",
  "DIST-KEHE": "Pass-through audits from the underlying retailers.",
  "RET-WHOLEFOODS": "Parent-company audit capabilities; strict quality program.",
};

interface RetailerRow {
  id: string;
  name: string;
  total: number;
  exposure: number;
  exposurePct: number;
  realizedCount: number;
  realizedDollars: number;
  profile: string;
}

interface EvidenceRow {
  category: EvidenceCategory;
  count: number;
  dollars: number;
  exposure: number;
}

export default function PostAuditRiskView({ cohort, onTrace }: Props) {
  const [useDigital, setUseDigital] = useState(false);

  // Forward-looking exposure scope: open / non-post-audit, disputable
  // deductions. Already-realized post-audit claims appear in the
  // "Already happened" panel. Slotting is a negotiated cost — auditors
  // don't claw back agreed placement fees, so it's out of the model.
  const forward = useMemo(
    () => cohort.filter((d) => !d.is_post_audit && isOperational(d)),
    [cohort]
  );
  const realized = useMemo(
    () => cohort.filter((d) => d.is_post_audit),
    [cohort]
  );

  const totalDollars = useMemo(
    () => forward.reduce((s, d) => s + d.amount, 0),
    [forward]
  );

  const exposure = useMemo(() => {
    let total = 0;
    for (const d of forward) {
      const ev = useDigital ? "digital" : evidenceCategoryFor(d);
      total += d.amount * AUDIT_RISK[ev];
    }
    return total;
  }, [forward, useDigital]);

  // Always-on baseline (toggle off) used to show the reduction delta.
  const baselineExposure = useMemo(() => {
    let total = 0;
    for (const d of forward) {
      total += d.amount * AUDIT_RISK[evidenceCategoryFor(d)];
    }
    return total;
  }, [forward]);

  const evidenceRows: EvidenceRow[] = useMemo(() => {
    const rows: Record<EvidenceCategory, EvidenceRow> = {
      digital: { category: "digital", count: 0, dollars: 0, exposure: 0 },
      paper: { category: "paper", count: 0, dollars: 0, exposure: 0 },
      missing: { category: "missing", count: 0, dollars: 0, exposure: 0 },
    };
    for (const d of forward) {
      const ev = evidenceCategoryFor(d);
      rows[ev].count++;
      rows[ev].dollars += d.amount;
      rows[ev].exposure += d.amount * AUDIT_RISK[ev];
    }
    return [rows.digital, rows.paper, rows.missing];
  }, [forward]);

  const retailerRows: RetailerRow[] = useMemo(() => {
    const acc = new Map<string, RetailerRow>();
    function ensure(id: string, name: string): RetailerRow {
      let row = acc.get(id);
      if (!row) {
        row = {
          id,
          name,
          total: 0,
          exposure: 0,
          exposurePct: 0,
          realizedCount: 0,
          realizedDollars: 0,
          profile: AUDIT_PROFILE[id] ?? "",
        };
        acc.set(id, row);
      }
      return row;
    }
    for (const d of forward) {
      const row = ensure(d.retailer.id, partnerLabel(d.retailer, true));
      row.total += d.amount;
      const ev = useDigital ? "digital" : evidenceCategoryFor(d);
      row.exposure += d.amount * AUDIT_RISK[ev];
    }
    for (const d of realized) {
      const row = ensure(d.retailer.id, partnerLabel(d.retailer, true));
      row.realizedCount++;
      row.realizedDollars += d.amount;
    }
    for (const row of acc.values()) {
      row.exposurePct = row.total ? row.exposure / row.total : 0;
    }
    return [...acc.values()].sort((a, b) => b.exposure - a.exposure);
  }, [forward, realized, useDigital]);

  const realizedSummary = useMemo(() => {
    const total = realized.reduce((s, d) => s + d.amount, 0);
    let lookbackSum = 0;
    let lookbackCount = 0;
    const auditorTotals = new Map<string, number>();
    for (const d of realized) {
      const lb = d.post_audit?.lookback_months;
      if (lb != null) {
        lookbackSum += lb;
        lookbackCount++;
      }
      const auditor = d.post_audit?.auditor_name;
      if (auditor) {
        auditorTotals.set(
          auditor,
          (auditorTotals.get(auditor) ?? 0) + d.amount
        );
      }
    }
    let topAuditor: { name: string; dollars: number } | null = null;
    for (const [name, dollars] of auditorTotals.entries()) {
      if (!topAuditor || dollars > topAuditor.dollars) {
        topAuditor = { name, dollars };
      }
    }
    return {
      count: realized.length,
      dollars: total,
      avgClaim: realized.length ? total / realized.length : 0,
      avgLookback: lookbackCount ? lookbackSum / lookbackCount : 0,
      topAuditor,
    };
  }, [realized]);

  const topRealized = useMemo(() => {
    return [...realized].sort((a, b) => b.amount - a.amount).slice(0, 10);
  }, [realized]);

  if (cohort.length === 0) {
    return (
      <section className="audit section">
        <h2>Post-audit risk exposure</h2>
        <p className="section-description">
          Large retailers periodically audit suppliers' past
          shipments. If labels, pack records, or documentation don't match
          their specs, they can deduct money retroactively — even on orders
          that were originally accepted. This view looks at every open
          deduction in the current cohort, checks what evidence Cinderhaven
          has on file, and calculates the dollar exposure if a retailer
          audited today. Deductions with no digital records and noncompliant
          labels are the highest risk.
        </p>
        <p className="audit-empty section-empty">No deductions in the current cohort.</p>
      </section>
    );
  }

  const exposurePct = totalDollars ? exposure / totalDollars : 0;
  const reduction = baselineExposure - exposure;

  return (
    <section className="audit">
      <header className="audit-header">
        <div>
          <h2>Post-audit risk exposure</h2>
          <p className="section-description">
            Large retailers periodically audit suppliers' past
            shipments. If labels, pack records, or documentation don't
            match their specs, they can deduct money retroactively — even
            on orders that were originally accepted. This view looks at
            every open deduction in the current cohort, checks what
            evidence Cinderhaven has on file, and calculates the dollar
            exposure if a retailer audited today. Deductions with no
            digital records and noncompliant labels are the highest risk.
          </p>
          <p className="audit-context section-context">
            Third-party auditors show up months after the original transaction
            and pull historical records. The supplier's defense is whatever
            evidence is on file. The number below: how much of the current
            cohort an auditor could plausibly claw back if they walked in
            tomorrow.
          </p>
        </div>
      </header>

      <div className="audit-headline">
        <div className="audit-headline-main">
          <div className="audit-headline-label">Exposed to clawback</div>
          <div className="audit-headline-num">{formatDollars(exposure)}</div>
          <div className="audit-headline-sub">
            {formatPercent(exposurePct)} of {formatDollars(totalDollars)} in{" "}
            {formatCount(forward.length)} forward-looking deductions
          </div>
          {useDigital && reduction > 0 && (
            <div className="audit-headline-delta">
              −{formatDollars(reduction)} reduction vs. current evidence
            </div>
          )}
        </div>
        <label className="audit-toggle">
          <input
            type="checkbox"
            checked={useDigital}
            onChange={() => setUseDigital((v) => !v)}
          />
          <span>
            <strong>Project with digital evidence</strong>
            <span className="muted">
              {" "}
              — recompute exposure assuming every record is digital and
              timestamped (the recovery simulation's digital pack toggle).
            </span>
          </span>
        </label>
      </div>

      <div className="audit-realized">
        <header className="audit-section-head">
          <h3>Already happened</h3>
          <p className="audit-section-desc">
            Concrete examples in the current cohort. These post-audit claims
            were taken — not projected, taken. Same evidence gaps drive the
            forward-looking number above.
          </p>
        </header>
        {realizedSummary.count === 0 ? (
          <p className="audit-realized-empty">
            No post-audit claims in the current cohort.
          </p>
        ) : (
          <>
            <div className="audit-realized-grid">
              <Stat
                label="Realized claims"
                value={formatCount(realizedSummary.count)}
              />
              <Stat
                label="Realized dollars"
                value={formatDollars(realizedSummary.dollars)}
              />
              <Stat
                label="Avg per claim"
                value={formatDollars(realizedSummary.avgClaim)}
              />
              <Stat
                label="Avg lookback"
                value={`${realizedSummary.avgLookback.toFixed(1)} mo`}
              />
            </div>
            {realizedSummary.topAuditor && (
              <p className="audit-realized-auditor">
                Most aggressive auditor:{" "}
                <strong>{realizedSummary.topAuditor.name}</strong> —{" "}
                {formatDollars(realizedSummary.topAuditor.dollars)} clawed
                back.
              </p>
            )}
            {topRealized.length > 0 && (
              <table className="audit-realized-table data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Retailer</th>
                    <th>Auditor</th>
                    <th>Period</th>
                    <th className="num">Lookback</th>
                    <th className="num">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {topRealized.map((d) => (
                    <tr key={d.deduction_id}>
                      <td className="audit-id">{d.deduction_id}</td>
                      <td>{partnerLabel(d.retailer, true)}</td>
                      <td>{d.post_audit?.auditor_name ?? "—"}</td>
                      <td>
                        {d.post_audit
                          ? `${d.post_audit.audit_period_start} → ${d.post_audit.audit_period_end}`
                          : "—"}
                      </td>
                      <td className="num">
                        {d.post_audit?.lookback_months ?? "—"} mo
                      </td>
                      <td className="num">{formatDollars(d.amount)}</td>
                      <td>
                        <button
                          className="audit-trace-btn trace-btn"
                          onClick={() => onTrace(d.deduction_id)}
                        >
                          Trace →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="audit-by-retailer">
        <header className="audit-section-head">
          <h3>Where the exposure sits</h3>
          <p className="audit-section-desc">
            Different retailers run different audit playbooks. The national mass
            retailer's third-party teams come in months later by email;
            distributor A deducts directly from future invoices; distributor B
            passes audits through from its underlying retailers.
          </p>
        </header>
        <table className="audit-retailer-table data-table">
          <thead>
            <tr>
              <th>Retailer</th>
              <th className="num">Cohort $</th>
              <th className="num">Exposure $</th>
              <th className="num">Exposure %</th>
              <th className="num">Realized claims</th>
              <th>Audit profile</th>
            </tr>
          </thead>
          <tbody>
            {retailerRows.map((r) => (
              <tr key={r.id}>
                <td className="audit-retailer-name">{r.name}</td>
                <td className="num">{formatDollars(r.total)}</td>
                <td className="num">
                  <strong>{formatDollars(r.exposure)}</strong>
                </td>
                <td
                  className={`num ${
                    r.exposurePct >= 0.5 ? "audit-high" : ""
                  }`}
                >
                  {formatPercent(r.exposurePct)}
                </td>
                <td className="num">
                  {r.realizedCount > 0 ? (
                    <>
                      {formatCount(r.realizedCount)}
                      <span className="muted">
                        {" "}
                        · {formatDollars(r.realizedDollars)}
                      </span>
                    </>
                  ) : (
                    <span className="muted">none</span>
                  )}
                </td>
                <td className="audit-profile">
                  {r.profile || (
                    <span className="muted">No specific profile on file.</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="audit-by-evidence">
        <header className="audit-section-head">
          <h3>What's driving the exposure</h3>
          <p className="audit-section-desc">
            Risk score per evidence bucket: digital records resist clawbacks,
            paper records lose, missing records are gone on contact.
          </p>
        </header>
        <table className="audit-evidence-table data-table">
          <thead>
            <tr>
              <th>Evidence</th>
              <th className="num">Count</th>
              <th className="num">Cohort $</th>
              <th className="num">Risk score</th>
              <th className="num">Exposure $</th>
            </tr>
          </thead>
          <tbody>
            {evidenceRows.map((r) => (
              <tr key={r.category} className={`evidence-${r.category}`}>
                <td>
                  <span
                    className={`audit-evidence-marker marker-${r.category}`}
                  >
                    ●
                  </span>{" "}
                  {EVIDENCE_LABEL[r.category]}
                </td>
                <td className="num">{formatCount(r.count)}</td>
                <td className="num">{formatDollars(r.dollars)}</td>
                <td className="num">
                  {formatPercent(AUDIT_RISK[r.category])}
                </td>
                <td className="num">
                  <strong>{formatDollars(r.exposure)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="audit-stat">
      <div className="audit-stat-label">{label}</div>
      <div className="audit-stat-value">{value}</div>
    </div>
  );
}
