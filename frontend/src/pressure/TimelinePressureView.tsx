import { useMemo, useState } from "react";
import type { Deduction } from "../types";
import { formatCount, formatDollars } from "../data";
import { partnerLabel } from "../partnerLabels";
import { isOperational, evidenceCategoryFor, AS_OF_DATE, type EvidenceCategory } from "../sankey/domain";
import "./TimelinePressureView.css";

interface Props {
  cohort: Deduction[];
  onTrace: (id: string) => void;
}

const AS_OF_LABEL = AS_OF_DATE.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

type Bucket = "critical" | "expiring" | "active" | "expired" | "no_deadline";

function isUnfiled(d: Deduction): boolean {
  return !d.dispute || !d.dispute.filed_date;
}

function isResolved(d: Deduction): boolean {
  return (
    d.dispute?.outcome === "won" ||
    d.dispute?.outcome === "partial"
  );
}

function daysToDeadline(d: Deduction): number | null {
  if (!d.dispute_deadline) return null;
  return Math.floor(
    (new Date(d.dispute_deadline).getTime() - AS_OF_DATE.getTime()) / DAY_MS
  );
}

function bucketFor(days: number | null): Bucket {
  if (days === null) return "no_deadline";
  if (days < 0) return "expired";
  if (days <= 7) return "critical";
  if (days <= 30) return "expiring";
  return "active";
}

const BUCKET_LABEL: Record<Bucket, string> = {
  critical: "Critical",
  expiring: "Expiring",
  active: "Active",
  expired: "Expired",
  no_deadline: "No deadline",
};

const BUCKET_RANGE: Record<Bucket, string> = {
  critical: "≤ 7 days",
  expiring: "8–30 days",
  active: "> 30 days",
  expired: "passed",
  no_deadline: "not published",
};

const EVIDENCE_LABEL: Record<EvidenceCategory, string> = {
  digital: "Digital",
  paper: "Paper",
  missing: "None / lost",
};

const BUCKET_ORDER: Bucket[] = [
  "critical",
  "expiring",
  "active",
  "expired",
  "no_deadline",
];

export default function TimelinePressureView({ cohort, onTrace }: Props) {
  const [selectedBucket, setSelectedBucket] = useState<Bucket | "all">("all");

  // Scope: unfiled, disputable deductions that aren't already won.
  // Slotting has no dispute clock — it's a negotiated cost, exclude it.
  const items = useMemo(() => {
    return cohort
      .filter((d) => isOperational(d) && isUnfiled(d) && !isResolved(d))
      .map((d) => {
        const days = daysToDeadline(d);
        return {
          d,
          days,
          bucket: bucketFor(days),
          evidence: evidenceCategoryFor(d),
        };
      });
  }, [cohort]);

  const counts = useMemo(() => {
    const out: Record<Bucket, { count: number; dollars: number }> = {
      critical: { count: 0, dollars: 0 },
      expiring: { count: 0, dollars: 0 },
      active: { count: 0, dollars: 0 },
      expired: { count: 0, dollars: 0 },
      no_deadline: { count: 0, dollars: 0 },
    };
    for (const it of items) {
      out[it.bucket].count++;
      out[it.bucket].dollars += it.d.amount;
    }
    return out;
  }, [items]);

  const crossTab = useMemo(() => {
    const out: Record<Bucket, Record<EvidenceCategory, number>> = {
      critical: { digital: 0, paper: 0, missing: 0 },
      expiring: { digital: 0, paper: 0, missing: 0 },
      active: { digital: 0, paper: 0, missing: 0 },
      expired: { digital: 0, paper: 0, missing: 0 },
      no_deadline: { digital: 0, paper: 0, missing: 0 },
    };
    for (const it of items) {
      out[it.bucket][it.evidence] += it.d.amount;
    }
    return out;
  }, [items]);

  const list = useMemo(() => {
    let filtered =
      selectedBucket === "all"
        ? items.filter(
            (i) => i.bucket === "critical" || i.bucket === "expiring"
          )
        : items.filter((i) => i.bucket === selectedBucket);
    return [...filtered].sort((a, b) => {
      // Most urgent first (smallest positive days remaining), then amount.
      const ad = a.days ?? Number.POSITIVE_INFINITY;
      const bd = b.days ?? Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return b.d.amount - a.d.amount;
    });
  }, [items, selectedBucket]);

  if (cohort.length === 0) {
    return (
      <section className="pressure section">
        <h2>Timeline pressure</h2>
        <p className="section-description">
          Every open deduction is mapped on a horizontal timeline against
          its retailer's specific dispute deadline. Green means there's
          still time to file. Yellow means the window is closing within
          the next week. Red means the deadline has passed — that money
          is gone regardless of evidence quality. Deductions are grouped
          by retailer so you can see which retailer's deadlines are most
          urgent. Use this to triage: file the ones about to expire before
          working on the ones with time left.
        </p>
        <p className="pressure-empty section-empty">No deductions in the current cohort.</p>
      </section>
    );
  }

  const urgentCount = counts.critical.count + counts.expiring.count;
  const urgentDollars = counts.critical.dollars + counts.expiring.dollars;

  return (
    <section className="pressure section">
      <header className="pressure-header">
        <div>
          <h2>Timeline pressure</h2>
          <p className="section-description">
            Every open deduction is mapped on a horizontal timeline against
            its retailer's specific dispute deadline. Green means there's
            still time to file. Yellow means the window is closing within
            the next week. Red means the deadline has passed — that money
            is gone regardless of evidence quality. Deductions are grouped
            by retailer so you can see which retailer's deadlines are most
            urgent. Use this to triage: file the ones about to expire
            before working on the ones with time left.
          </p>
          <p className="pressure-context section-context">
            Data as of <strong>{AS_OF_LABEL}</strong>.{" "}
            <strong>{formatCount(items.length)}</strong> unfiled deductions
            still face dispute deadlines. What's actionable, what's expiring,
            what's already lost to the clock.
          </p>
        </div>
      </header>

      <div className="pressure-buckets">
        {BUCKET_ORDER.map((b) => (
          <BucketCard
            key={b}
            label={BUCKET_LABEL[b]}
            count={counts[b].count}
            dollars={counts[b].dollars}
            range={BUCKET_RANGE[b]}
            variant={b}
            active={selectedBucket === b}
            onClick={() =>
              setSelectedBucket(selectedBucket === b ? "all" : b)
            }
          />
        ))}
      </div>

      <div className="pressure-crosstab">
        <header className="pressure-section-head">
          <h3>Pressure × evidence quality</h3>
          <p className="pressure-crosstab-desc">
            Time pressure compounds with weak evidence. The fastest-expiring
            deductions are also the ones most likely to have only paper or no
            records — even filing on time wins very few of these.
          </p>
        </header>
        <table className="pressure-crosstab-table data-table">
          <thead>
            <tr>
              <th>Bucket</th>
              <th className="num">{EVIDENCE_LABEL.digital}</th>
              <th className="num">{EVIDENCE_LABEL.paper}</th>
              <th className="num">{EVIDENCE_LABEL.missing}</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {BUCKET_ORDER.map((b) => {
              const row = crossTab[b];
              const total = row.digital + row.paper + row.missing;
              if (total === 0) return null;
              const isUrgent = b === "critical" || b === "expiring";
              return (
                <tr key={b} className={`bucket-row bucket-${b}`}>
                  <td className="bucket-name">
                    {BUCKET_LABEL[b]}{" "}
                    <span className="muted">({BUCKET_RANGE[b]})</span>
                  </td>
                  <td className="num">{formatDollars(row.digital)}</td>
                  <td
                    className={`num ${
                      isUrgent && row.paper > 0 ? "compounding" : ""
                    }`}
                  >
                    {formatDollars(row.paper)}
                  </td>
                  <td
                    className={`num ${
                      isUrgent && row.missing > 0 ? "compounding" : ""
                    }`}
                  >
                    {formatDollars(row.missing)}
                  </td>
                  <td className="num">
                    <strong>{formatDollars(total)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pressure-table-wrapper">
        <header className="pressure-table-header">
          <h3>
            {selectedBucket === "all"
              ? `Urgent — file now (${formatCount(urgentCount)} · ${formatDollars(urgentDollars)})`
              : `${BUCKET_LABEL[selectedBucket]}`}
          </h3>
          <span className="pressure-table-count">
            {formatCount(list.length)} deductions ·{" "}
            {selectedBucket === "expired" ? "ordered by days lost" : "ordered by days remaining"}
            {list.length > 25 && (
              <span className="muted"> · showing top 25</span>
            )}
          </span>
        </header>
        <div className="pressure-table-scroll table-scroll">
          <table className="pressure-table data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Retailer</th>
                <th>Type</th>
                <th>Evidence</th>
                <th className="num">Amount</th>
                <th className="num">Deadline</th>
                <th className="num">Days</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 25).map(({ d, bucket, evidence, days }) => (
                <tr key={d.deduction_id} className={`row-${bucket}`}>
                  <td className="pressure-id">{d.deduction_id}</td>
                  <td>{partnerLabel(d.retailer, true)}</td>
                  <td>{d.deduction_type.replace(/_/g, " ")}</td>
                  <td>{EVIDENCE_LABEL[evidence]}</td>
                  <td className="num">{formatDollars(d.amount)}</td>
                  <td className="num">{d.dispute_deadline ?? "—"}</td>
                  <td className={`num pressure-days pressure-days-${bucket}`}>
                    {days === null
                      ? "—"
                      : days < 0
                      ? `${-days}d ago`
                      : `${days}d`}
                  </td>
                  <td>
                    <button
                      className="pressure-trace-btn trace-btn"
                      onClick={() => onTrace(d.deduction_id)}
                    >
                      Trace →
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
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

interface BucketCardProps {
  label: string;
  count: number;
  dollars: number;
  range: string;
  variant: Bucket;
  active: boolean;
  onClick: () => void;
}

function BucketCard({
  label,
  count,
  dollars,
  range,
  variant,
  active,
  onClick,
}: BucketCardProps) {
  return (
    <button
      className={`pressure-bucket pressure-bucket-${variant} ${
        active ? "active" : ""
      }`}
      onClick={onClick}
    >
      <div className="pressure-bucket-name">{label}</div>
      <div className="pressure-bucket-count">{formatCount(count)}</div>
      <div className="pressure-bucket-sub">
        <strong>{formatDollars(dollars)}</strong>
        <span className="muted"> at stake</span>
      </div>
      <div className="pressure-bucket-range">{range}</div>
    </button>
  );
}
