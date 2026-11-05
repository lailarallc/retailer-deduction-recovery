import { useMemo } from "react";
import type { Deduction } from "../types";
import { OUTCOME_COLORS, rootCauseFor, readableOutcome } from "../sankey/domain";
import { formatCount, formatDollars } from "../data";
import { partnerLabel } from "../partnerLabels";
import "./CausationTraceView.css";

interface Props {
  tracedDeductionId: string | null;
  cohort: Deduction[];
  onChange: (id: string | null) => void;
}

type Severity = "ok" | "warn" | "fail" | "neutral";

interface TimelineEvent {
  dateLabel: string;
  step: string;
  detail: React.ReactNode;
  severity: Severity;
  flags?: string[];
}

export default function CausationTraceView({
  tracedDeductionId,
  cohort,
  onChange,
}: Props) {
  const sorted = useMemo(
    () => [...cohort].sort((a, b) => b.amount - a.amount),
    [cohort]
  );
  const currentIdx = sorted.findIndex(
    (d) => d.deduction_id === tracedDeductionId
  );
  const current = currentIdx >= 0 ? sorted[currentIdx] : null;

  if (!current) {
    return (
      <section className="trace section">
        <h2>Causation trace</h2>
        <p className="section-description">
          Choose an order and see its full timeline from left to right: the
          purchase order, how it was packed, what label was used, how it
          shipped, what the retailer received, what deduction was taken,
          whether a dispute was attempted, and the final outcome. Each step
          shows what actually happened and flags where things went wrong.
          This is different from the explorer — the explorer shows one
          deduction's six failure layers in parallel, while this view shows
          one order's life sequentially.
        </p>
        <p className="trace-context section-context">
          The explorer shows one deduction's six failure layers in parallel;
          the trace shows the same order's story chronologically — what
          happened, in what sequence, and where things broke down.
        </p>
        <div className="trace-empty section-empty">
          <p>
            Pick a deduction in the explorer above and use{" "}
            <strong>Trace this order →</strong> to follow it from PO through
            outcome.
          </p>
        </div>
      </section>
    );
  }

  const total = sorted.length;
  const goPrev = () =>
    onChange(sorted[(currentIdx - 1 + total) % total].deduction_id);
  const goNext = () => onChange(sorted[(currentIdx + 1) % total].deduction_id);
  const goRandom = () =>
    onChange(sorted[Math.floor(Math.random() * total)].deduction_id);
  const clear = () => onChange(null);

  if (!current.order && !current.shipment && !current.pack_record) {
    return (
      <section className="trace section">
        <header className="trace-header section-header">
          <div>
            <h2>Causation trace</h2>
            <p className="section-description">
              Choose an order and see its full timeline from left to right: the
              purchase order, how it was packed, what label was used, how it
              shipped, what the retailer received, what deduction was taken,
              whether a dispute was attempted, and the final outcome. Each step
              shows what actually happened and flags where things went wrong.
              This is different from the explorer — the explorer shows one
              deduction's six failure layers in parallel, while this view shows
              one order's life sequentially.
            </p>
            <p className="trace-context section-context">
              Trace <strong>{currentIdx + 1}</strong> of{" "}
              <strong>{formatCount(total)}</strong> in the current cohort.
            </p>
          </div>
          <div className="trace-nav nav-row">
            <button className="nav-btn" onClick={goPrev} aria-label="Previous trace">
              ← Prev
            </button>
            <button className="nav-btn" onClick={goRandom}>Random</button>
            <button className="nav-btn" onClick={goNext} aria-label="Next trace">
              Next →
            </button>
            <button
              onClick={clear}
              className="nav-btn trace-clear"
              aria-label="Clear trace"
              title="Clear trace"
            >
              ×
            </button>
          </div>
        </header>

        <div className="trace-summary">
          <span className="trace-summary-id">{current.deduction_id}</span>
          <span className="trace-sep">·</span>
          <span>{partnerLabel(current.retailer, true)}</span>
          <span className="trace-sep">·</span>
          <span className="trace-summary-type">
            {current.deduction_type.replace(/_/g, " ")}
          </span>
          <span className="trace-sep">·</span>
          <span className="trace-summary-amt">
            {formatDollars(current.amount)}
          </span>
        </div>

        <div className="trace-empty section-empty">
          <p>
            No order, shipment, or pack records are linked to this
            deduction — the causation chain cannot be reconstructed.
            Use <strong>← Prev</strong> or <strong>Next →</strong> to
            find a deduction with a traceable order.
          </p>
        </div>
      </section>
    );
  }

  const events = buildEvents(current);

  return (
    <section className="trace section">
      <header className="trace-header">
        <div>
          <h2>Causation trace</h2>
          <p className="section-description">
            Choose an order and see its full timeline from left to right: the
            purchase order, how it was packed, what label was used, how it
            shipped, what the retailer received, what deduction was taken,
            whether a dispute was attempted, and the final outcome. Each step
            shows what actually happened and flags where things went wrong.
            This is different from the explorer — the explorer shows one
            deduction's six failure layers in parallel, while this view shows
            one order's life sequentially.
          </p>
          <p className="trace-context section-context">
            Following one order chronologically — what happened, in what
            sequence, and where things broke down. Trace{" "}
            <strong>{currentIdx + 1}</strong> of{" "}
            <strong>{formatCount(total)}</strong> in the current cohort.
          </p>
        </div>
        <div className="trace-nav">
          <button onClick={goPrev} aria-label="Previous trace">
            ← Prev
          </button>
          <button onClick={goRandom}>Random</button>
          <button onClick={goNext} aria-label="Next trace">
            Next →
          </button>
          <button
            onClick={clear}
            className="trace-clear"
            aria-label="Clear trace"
            title="Clear trace"
          >
            ×
          </button>
        </div>
      </header>

      <div className="trace-summary">
        <span className="trace-summary-id">{current.deduction_id}</span>
        <span className="trace-sep">·</span>
        <span>{partnerLabel(current.retailer, true)}</span>
        <span className="trace-sep">·</span>
        <span className="trace-summary-type">
          {current.deduction_type.replace(/_/g, " ")}
        </span>
        <span className="trace-sep">·</span>
        <span className="trace-summary-rc">{rootCauseFor(current)}</span>
        {current.order && (
          <>
            <span className="trace-sep">·</span>
            <span className="trace-summary-po">
              PO {current.order.po_number}
            </span>
          </>
        )}
        <span className="trace-sep">·</span>
        <span className="trace-summary-amt">
          {formatDollars(current.amount)}
        </span>
      </div>

      <ol className="trace-timeline">
        {events.map((evt, i) => (
          <li key={i} className={`trace-event sev-${evt.severity}`}>
            <div className="trace-date">{evt.dateLabel}</div>
            <div className="trace-marker">
              <span className="trace-dot" />
            </div>
            <div className="trace-body">
              <div className="trace-step">{evt.step}</div>
              <div className="trace-detail">{evt.detail}</div>
              {evt.flags && evt.flags.length > 0 && (
                <div className="trace-flags">
                  {evt.flags.map((f) => (
                    <span key={f} className="trace-flag">
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- event builders ----

function buildEvents(d: Deduction): TimelineEvent[] {
  if (d.is_post_audit) return buildPostAuditEvents(d);
  return buildStandardEvents(d);
}

function buildOrderChainEvents(d: Deduction): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (d.order) {
    events.push({
      dateLabel: d.order.po_date,
      step: "PO placed",
      detail: (
        <>
          <strong>{partnerLabel(d.retailer, true)}</strong> issued PO{" "}
          <strong>{d.order.po_number}</strong> — {formatCount(d.order.total_units)}{" "}
          units, {formatDollars(d.order.total_value)}.
        </>
      ),
      severity: "neutral",
    });
  }

  if (d.pack_record) {
    const notScannable = d.pack_record.label_scannable === false;
    const pickPackOff = d.pack_record.units_pick_pack_match === false;
    const paperOnly = d.pack_record.evidence_format === "handwritten";
    const packSeverity: Severity =
      notScannable || pickPackOff
        ? "fail"
        : paperOnly
        ? "warn"
        : "ok";
    const flags: string[] = [];
    if (notScannable) flags.push("non-scannable label");
    if (pickPackOff) flags.push("pack/pick mismatch");
    if (paperOnly) flags.push("paper evidence");

    events.push({
      dateLabel: d.pack_record.pack_date ?? d.order?.requested_ship_date ?? "—",
      step: "Pack & label",
      detail: (
        <>
          {formatCount(d.pack_record.units_picked)} picked →{" "}
          {formatCount(d.pack_record.units_packed)} packed.
          {d.pack_record.label_scannable ? (
            " Label scannable."
          ) : (
            <>
              {" "}
              <span className="bad">Label not scannable.</span>
            </>
          )}{" "}
          Verification:{" "}
          {d.pack_record.pack_verification.replace(/_/g, " ")} —{" "}
          {d.pack_record.evidence_format.replace(/_/g, " ")} evidence.
        </>
      ),
      severity: packSeverity,
      flags,
    });
  }

  if (d.shipment) {
    const asnLate = d.shipment.asn_sent_late;
    const asnMissing = !d.shipment.asn_sent;
    const sevShip: Severity = asnMissing
      ? "fail"
      : asnLate
      ? "warn"
      : "ok";
    const shipFlags: string[] = [];
    if (asnMissing) shipFlags.push("ASN missing");
    else if (asnLate) shipFlags.push("ASN late");

    events.push({
      dateLabel: d.shipment.ship_date,
      step: "Shipped",
      detail: (
        <>
          Tendered to <strong>{d.shipment.carrier}</strong> —{" "}
          {formatCount(d.shipment.units_shipped)} units
          {d.shipment.pallets_shipped != null && (
            <>, {formatCount(d.shipment.pallets_shipped)} pallets</>
          )}.{" "}
          {asnMissing ? (
            <span className="bad">No ASN sent.</span>
          ) : asnLate ? (
            <span className="bad">ASN sent late.</span>
          ) : (
            "ASN on time."
          )}
        </>
      ),
      severity: sevShip,
      flags: shipFlags,
    });

    if (d.shipment.delivery_date) {
      events.push({
        dateLabel: d.shipment.delivery_date,
        step: "Delivered & received",
        detail: (
          <>
            Delivered {d.shipment.delivery_date}.
            {d.shipment.bol_number && (
              <> BOL {d.shipment.bol_number}.</>
            )}
          </>
        ),
        severity: "neutral",
      });
    }
  }

  return events;
}

function buildStandardEvents(d: Deduction): TimelineEvent[] {
  const events = buildOrderChainEvents(d);

  // Deduction issued
  const dedFlags: string[] = [];
  if (d.is_vague) dedFlags.push("vague");
  events.push({
    dateLabel: d.deduction_date,
    step: "Deduction issued",
    detail: (
      <>
        <strong>{partnerLabel(d.retailer, true)}</strong> deducted{" "}
        <strong>{formatDollars(d.amount)}</strong>
        {d.code ? (
          <>
            {" "}
            — code <strong>{d.code.code}</strong> ({d.code.name}).
          </>
        ) : (
          "."
        )}
      </>
    ),
    severity: "fail",
    flags: dedFlags,
  });

  // Dispute attempt
  if (d.dispute) {
    if (d.dispute.filed_date) {
      const evidenceCount = d.dispute.evidence?.length ?? 0;
      const noEvidence = d.dispute.evidence_quality === "none";
      const weak = d.dispute.evidence_quality === "weak" ||
        d.dispute.evidence_quality === "handwritten_only";
      const sevFile: Severity =
        noEvidence ? "fail" : weak ? "warn" : "ok";
      const fileFlags: string[] = [];
      if (weak) fileFlags.push("weak evidence");
      if (noEvidence) fileFlags.push("no evidence");

      events.push({
        dateLabel: d.dispute.filed_date,
        step: "Dispute filed",
        detail: (
          <>
            Filed via{" "}
            {d.dispute.filing_method?.replace(/_/g, " ") ?? "—"} with{" "}
            <strong>{evidenceCount}</strong> item
            {evidenceCount === 1 ? "" : "s"} (
            {d.dispute.evidence_quality.replace(/_/g, " ")}).{" "}
            ~{d.dispute.labor_hours.toFixed(1)} labor hours.
          </>
        ),
        severity: sevFile,
        flags: fileFlags,
      });
    } else {
      events.push({
        dateLabel: "(not filed)",
        step: "Dispute opened, never submitted",
        detail: (
          <>
            Dispute record exists in the system but was never filed with{" "}
            {partnerLabel(d.retailer)}.
          </>
        ),
        severity: "fail",
      });
    }

    if (d.dispute.closed_date || d.dispute.outcome !== "pending") {
      const recovered = d.dispute.recovered_amount > 0;
      const outcomeReadable = readableOutcome(d.dispute.outcome);
      events.push({
        dateLabel: d.dispute.closed_date
          ?? d.dispute.filed_date
          ?? d.deduction_date,
        step: d.dispute.closed_date ? "Outcome" : "Outcome (date unknown)",
        detail: (
          <>
            <strong
              style={{
                color: OUTCOME_COLORS[outcomeReadable] ?? "var(--ink)",
              }}
            >
              {outcomeReadable}
            </strong>
            .{" "}
            {recovered ? (
              <>
                {formatDollars(d.dispute.recovered_amount)} recovered against{" "}
                {formatDollars(d.amount)} deducted.
              </>
            ) : (
              <>
                Nothing recovered against {formatDollars(d.amount)} deducted.
              </>
            )}
          </>
        ),
        severity: recovered ? "ok" : "fail",
      });
    } else if (d.dispute.outcome === "pending") {
      events.push({
        dateLabel: "(open)",
        step: "Outcome",
        detail: <>Pending — no resolution from {partnerLabel(d.retailer)}.</>,
        severity: "neutral",
      });
    }
  } else {
    events.push({
      dateLabel: "(never filed)",
      step: "No dispute",
      detail: (
        <>
          {d.dispute_deadline ? (
            <>Deadline {d.dispute_deadline} passed without a filing. </>
          ) : (
            <>No published dispute window — no clock pressure, no recovery. </>
          )}
          <strong>{formatDollars(d.amount)}</strong> written off.
        </>
      ),
      severity: "fail",
    });
  }

  return events;
}

function buildPostAuditEvents(d: Deduction): TimelineEvent[] {
  const events = buildOrderChainEvents(d);
  const pa = d.post_audit;

  if (pa) {
    events.push({
      dateLabel: `${pa.audit_period_start} → ${pa.audit_period_end}`,
      step: "Audit period",
      detail: (
        <>
          {pa.auditor_name ? (
            <>
              <strong>{pa.auditor_name}</strong> reviewed{" "}
            </>
          ) : (
            "Reviewed "
          )}
          {pa.lookback_months} months of transactions for{" "}
          <strong>{partnerLabel(d.retailer)}</strong>. Claim type:{" "}
          {pa.claim_type.replace(/_/g, " ")}.
        </>
      ),
      severity: "warn",
    });
  }

  events.push({
    dateLabel: d.deduction_date,
    step: "Retroactive clawback",
    detail: (
      <>
        Post-audit deduction of <strong>{formatDollars(d.amount)}</strong>
        {d.code ? (
          <>
            {" "}
            — code <strong>{d.code.code}</strong>.
          </>
        ) : (
          "."
        )}{" "}
        <span className="muted">
          Post-audit claims reference the original transaction but need
          their own documentation chain to defend.
        </span>
      </>
    ),
    severity: "fail",
  });

  if (d.dispute) {
    events.push({
      dateLabel: d.dispute.filed_date ?? "(not filed)",
      step: "Dispute attempt",
      detail: (
        <>
          {d.dispute.filed_date ? "Filed" : "Opened but not filed"} —{" "}
          {d.dispute.evidence_quality.replace(/_/g, " ")},{" "}
          {d.dispute.evidence?.length ?? 0} item
          {(d.dispute.evidence?.length ?? 0) === 1 ? "" : "s"}.
        </>
      ),
      severity: "warn",
    });

    events.push({
      dateLabel: d.dispute.closed_date ?? "(open)",
      step: "Outcome",
      detail: (
        <>
          {readableOutcome(d.dispute.outcome)}.{" "}
          {d.dispute.recovered_amount > 0 ? (
            <>{formatDollars(d.dispute.recovered_amount)} recovered.</>
          ) : (
            <>Nothing recovered.</>
          )}
        </>
      ),
      severity: d.dispute.recovered_amount > 0 ? "ok" : "fail",
    });
  } else {
    events.push({
      dateLabel: "(never filed)",
      step: "No dispute",
      detail: (
        <>
          Post-audit clawbacks rarely get challenged.{" "}
          <strong>{formatDollars(d.amount)}</strong> written off.
        </>
      ),
      severity: "fail",
    });
  }

  return events;
}

