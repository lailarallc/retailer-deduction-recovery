import { useMemo, useState } from "react";
import type { Deduction } from "../types";
import { formatCount, formatDollars, formatPercent } from "../data";
import { partnerLabel } from "../partnerLabels";
import { isOperational, WIN_PROB, AS_OF_DATE } from "../sankey/domain";
import "./CostToDisputeView.css";

interface Props {
  cohort: Deduction[];
  onTrace?: (id: string) => void;
}

// Hours to assemble and file a dispute, by evidence quality. Digital
// records pull straight from the system; handwritten records require
// cross-referencing notes to PO numbers and ship dates.
const HOURS_BY_QUALITY: Record<string, number> = {
  digital_complete: 1.5,
  digital_partial: 3,
  handwritten_only: 5,
  none: 0,
};

const FIGHT_THRESHOLD = 25; // EV > $25 → fight
const WRITEOFF_THRESHOLD = -25; // EV < -$25 → write off

type Bucket = "fight" | "marginal" | "writeoff";

interface Profitability {
  evidenceQuality: string;
  winProb: number;
  laborHours: number;
  laborCost: number;
  expectedRecovery: number;
  ev: number;
  bucket: Bucket;
  pastDeadline: boolean;
}

function inferEvidenceQuality(d: Deduction): string {
  if (d.dispute?.evidence_quality) {
    const q = d.dispute.evidence_quality;
    if (q === "strong") return "digital_complete";
    if (q === "moderate") return "digital_partial";
    if (q === "weak") return "handwritten_only";
    return q;
  }
  if (!d.pack_record) return "none";
  if (d.pack_record.evidence_format === "digital" || d.pack_record.evidence_format === "photo")
    return "digital_complete";
  if (d.pack_record.evidence_format === "handwritten")
    return "handwritten_only";
  return "none";
}

function isPastDeadline(d: Deduction): boolean {
  if (d.dispute?.filed_date && d.dispute_deadline) {
    return new Date(d.dispute.filed_date) > new Date(d.dispute_deadline);
  }
  if (d.dispute) return false;
  if (!d.dispute_deadline) return false;
  return new Date(d.dispute_deadline) < AS_OF_DATE;
}

function compute(
  d: Deduction,
  hourlyRate: number,
  useDigital: boolean
): Profitability {
  const evidenceQuality = useDigital
    ? "digital_complete"
    : inferEvidenceQuality(d);
  const pastDeadline = isPastDeadline(d);

  let winProb = WIN_PROB[evidenceQuality] ?? 0;
  if (pastDeadline) winProb = 0;

  const laborHours = winProb > 0 ? HOURS_BY_QUALITY[evidenceQuality] : 0;
  const laborCost = laborHours * hourlyRate;
  const expectedRecovery = d.amount * winProb;
  const ev = expectedRecovery - laborCost;

  let bucket: Bucket;
  if (winProb === 0) bucket = "writeoff";
  else if (ev > FIGHT_THRESHOLD) bucket = "fight";
  else if (ev < WRITEOFF_THRESHOLD) bucket = "writeoff";
  else bucket = "marginal";

  return {
    evidenceQuality,
    winProb,
    laborHours,
    laborCost,
    expectedRecovery,
    ev,
    bucket,
    pastDeadline,
  };
}

function bucketLabel(b: Bucket): string {
  if (b === "fight") return "Fight";
  if (b === "marginal") return "Marginal";
  return "Write off";
}

export default function CostToDisputeView({ cohort, onTrace }: Props) {
  const [hourlyRate, setHourlyRate] = useState(42);
  const [useDigital, setUseDigital] = useState(false);
  const [activeBucket, setActiveBucket] = useState<Bucket>("fight");

  // Triage focuses on unresolved, disputable deductions. Already-won
  // disputes are settled. Slotting is a negotiated cost — not subject
  // to a fight/skip decision.
  const unresolved = useMemo(
    () =>
      cohort.filter(
        (d) =>
          isOperational(d) &&
          d.dispute?.outcome !== "won" &&
          d.dispute?.outcome !== "partial"
      ),
    [cohort]
  );

  const current = useMemo(
    () =>
      unresolved.map((d) => ({
        d,
        p: compute(d, hourlyRate, useDigital),
      })),
    [unresolved, hourlyRate, useDigital]
  );

  const digital = useMemo(
    () =>
      useDigital
        ? null
        : unresolved.map((d) => ({ d, p: compute(d, hourlyRate, true) })),
    [unresolved, hourlyRate, useDigital]
  );

  const buckets = useMemo(() => {
    const out = {
      fight: { count: 0, dollars: 0, expected: 0, labor: 0 },
      marginal: { count: 0, dollars: 0, expected: 0, labor: 0 },
      writeoff: { count: 0, dollars: 0, expected: 0, labor: 0 },
    };
    for (const { d, p } of current) {
      const b = out[p.bucket];
      b.count++;
      b.dollars += d.amount;
      b.expected += p.expectedRecovery;
      b.labor += p.laborCost;
    }
    return out;
  }, [current]);

  const shift = useMemo(() => {
    if (!digital) return null;
    let count = 0;
    let dollars = 0;
    for (let i = 0; i < current.length; i++) {
      if (
        current[i].p.bucket === "writeoff" &&
        digital[i].p.bucket === "fight"
      ) {
        count++;
        dollars += current[i].d.amount;
      }
    }
    return { count, dollars };
  }, [current, digital]);

  const items = useMemo(() => {
    return current
      .filter((item) => item.p.bucket === activeBucket)
      .sort((a, b) => {
        if (activeBucket === "writeoff") {
          return b.d.amount - a.d.amount;
        }
        return b.p.ev - a.p.ev;
      });
  }, [current, activeBucket]);

  if (cohort.length === 0) {
    return (
      <section className="cost section">
        <h2>Cost to dispute</h2>
        <p className="section-description">
          Every deduction is scored by whether it's worth disputing. The
          calculation compares the deduction amount against the estimated
          labor cost to gather evidence and file — factoring in how hard
          the evidence is to find and the likelihood of winning based on
          evidence quality and the retailer's track record. Deductions sort
          into three buckets: worth fighting, borderline, and don't bother.
          Use this to decide where limited staff time goes first.
        </p>
        <p className="cost-empty section-empty">No deductions in the current cohort.</p>
      </section>
    );
  }
  if (unresolved.length === 0) {
    return (
      <section className="cost section">
        <h2>Cost to dispute</h2>
        <p className="section-description">
          Every deduction is scored by whether it's worth disputing. The
          calculation compares the deduction amount against the estimated
          labor cost to gather evidence and file — factoring in how hard
          the evidence is to find and the likelihood of winning based on
          evidence quality and the retailer's track record. Deductions sort
          into three buckets: worth fighting, borderline, and don't bother.
          Use this to decide where limited staff time goes first.
        </p>
        <p className="cost-empty section-empty">
          Nothing to triage — the cohort either holds only slotting
          (negotiated costs, not disputable) or every operational deduction
          is already resolved.
        </p>
      </section>
    );
  }

  return (
    <section className="cost">
      <header className="cost-header">
        <div>
          <h2>Cost to dispute</h2>
          <p className="section-description">
            Every deduction is scored by whether it's worth disputing. The
            calculation compares the deduction amount against the estimated
            labor cost to gather evidence and file — factoring in how hard
            the evidence is to find and the likelihood of winning based on
            evidence quality and the retailer's track record. Deductions
            sort into three buckets: worth fighting, borderline, and don't
            bother. Use this to decide where limited staff time goes first.
          </p>
          <p className="cost-context section-context">
            For each unresolved deduction, expected recovery (amount × win
            probability) versus labor to assemble and file. Three buckets —
            fight, marginal, write off — driven by current evidence quality
            and the hourly rate you set. {formatCount(unresolved.length)}{" "}
            deductions in scope.
          </p>
        </div>
      </header>

      <div className="cost-controls">
        <div className="cost-control">
          <label htmlFor="cost-rate">
            Hourly cost ($/hr fully loaded)
          </label>
          <div className="cost-control-row">
            <input
              id="cost-rate"
              type="range"
              min={20}
              max={100}
              step={1}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(parseInt(e.target.value, 10))}
            />
            <strong className="cost-control-value">${hourlyRate}/hr</strong>
          </div>
        </div>
        <label className="cost-control cost-control-toggle">
          <input
            type="checkbox"
            checked={useDigital}
            onChange={() => setUseDigital((v) => !v)}
          />
          <span>
            <strong>Project with digital evidence</strong> — what if every
            deduction had digital_complete records? Recomputes the same
            triage assuming Cinderhaven had implemented digital pack
            verification.
          </span>
        </label>
      </div>

      <div className="cost-buckets">
        {(["fight", "marginal", "writeoff"] as const).map((b) => {
          const data = buckets[b];
          const isActive = activeBucket === b;
          return (
            <button
              key={b}
              className={`cost-bucket cost-bucket-${b} ${
                isActive ? "active" : ""
              }`}
              onClick={() => setActiveBucket(b)}
            >
              <div className="cost-bucket-name">{bucketLabel(b)}</div>
              <div className="cost-bucket-count">{formatCount(data.count)}</div>
              <div className="cost-bucket-sub">
                <span className="muted">deductions · </span>
                {formatDollars(data.dollars)}
                <span className="muted"> at stake</span>
              </div>
              <div className="cost-bucket-foot">
                {b === "fight" && (
                  <>
                    Expected recovery{" "}
                    <strong>{formatDollars(data.expected)}</strong>
                    <span className="muted">
                      {" "}
                      for {formatDollars(data.labor)} labor
                    </span>
                  </>
                )}
                {b === "marginal" && (
                  <>
                    Net EV{" "}
                    <strong>
                      {formatDollars(data.expected - data.labor)}
                    </strong>
                    <span className="muted"> · judgment call</span>
                  </>
                )}
                {b === "writeoff" && (
                  <>
                    <strong>{formatDollars(data.dollars)}</strong> currently
                    unrecoverable
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {!useDigital && shift && shift.count > 0 && (
        <div className="cost-shift">
          <strong>
            {formatCount(shift.count)} write-offs ({formatDollars(shift.dollars)})
          </strong>{" "}
          would become worth fighting with digital evidence.{" "}
          <button
            className="cost-shift-link"
            onClick={() => setUseDigital(true)}
          >
            See the shift →
          </button>
        </div>
      )}

      <div className="cost-table-wrapper">
        <header className="cost-table-header">
          <h3>{bucketLabel(activeBucket)}</h3>
          <span className="cost-table-count">
            {formatCount(items.length)} deductions ·{" "}
            {activeBucket === "writeoff"
              ? "largest dollars first"
              : "highest EV first"}
            {items.length > 25 && (
              <span className="muted"> · showing top 25</span>
            )}
          </span>
        </header>
        <div className="cost-table-scroll table-scroll">
          <table className="cost-table data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Retailer</th>
                <th>Type</th>
                <th>Evidence</th>
                <th className="num">Amount</th>
                <th className="num">Win %</th>
                <th className="num">Labor</th>
                <th className="num">Expected EV</th>
                {onTrace && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 25).map(({ d, p }) => (
                <tr key={d.deduction_id}>
                  <td className="cost-id">{d.deduction_id}</td>
                  <td>{partnerLabel(d.retailer, true)}</td>
                  <td>{d.deduction_type.replace(/_/g, " ")}</td>
                  <td>
                    {p.evidenceQuality.replace(/_/g, " ")}
                    {p.pastDeadline && (
                      <span className="cost-deadline-flag"> · past deadline</span>
                    )}
                  </td>
                  <td className="num">{formatDollars(d.amount)}</td>
                  <td className="num">{formatPercent(p.winProb)}</td>
                  <td className="num">
                    {p.laborHours > 0
                      ? `${p.laborHours.toFixed(1)} hr`
                      : <span className="muted">—</span>}
                  </td>
                  <td className={`num cost-ev cost-ev-${p.bucket}`}>
                    {formatDollars(p.ev)}
                  </td>
                  {onTrace && (
                    <td>
                      <button
                        className="cost-trace-btn trace-btn"
                        onClick={() => onTrace(d.deduction_id)}
                      >
                        Trace →
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={onTrace ? 9 : 8} className="empty">
                    No deductions in this bucket.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
