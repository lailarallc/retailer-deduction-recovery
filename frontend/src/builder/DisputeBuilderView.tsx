import { useEffect, useMemo, useState } from "react";
import type {
  Deduction,
  Evidence,
  Retailer,
  RetailersById,
} from "../types";
import { formatCount, formatDollars } from "../data";
import { partnerLabel } from "../partnerLabels";
import { isOperational } from "../sankey/domain";
import "./DisputeBuilderView.css";

interface Props {
  cohort: Deduction[];
  retailers: RetailersById | null;
  tracedDeductionId: string | null;
  onTrace: (id: string) => void;
}

type Readiness = "ready" | "needs_work" | "not_disputable";
type Filter = "all" | Readiness;

const READINESS_LABEL: Record<Readiness, string> = {
  ready: "Ready to file",
  needs_work: "Needs evidence work",
  not_disputable: "Not disputable",
};

interface RequirementStatus {
  type: string;
  status: "have_digital" | "have_paper" | "inferable" | "missing";
  notes: string;
}

interface BuilderItem {
  d: Deduction;
  retailer: Retailer | null;
  reqs: RequirementStatus[];
  readiness: Readiness;
}

function inferRequirement(
  d: Deduction,
  reqType: string,
  submitted: Evidence | undefined
): RequirementStatus {
  // Trust dispute.evidence first when the deduction has been filed.
  if (submitted?.submitted) {
    if (submitted.format === "digital") {
      return {
        type: reqType,
        status: "have_digital",
        notes: submitted.notes ?? "Submitted in digital format",
      };
    }
    return {
      type: reqType,
      status: "have_paper",
      notes:
        submitted.notes ??
        `Submitted as ${submitted.format ?? "paper"} — may not meet retailer standards`,
    };
  }

  // Otherwise infer what likely exists from the pack and shipment chain.
  switch (reqType) {
    case "signed_bol":
      if (d.shipment?.bol_number) {
        if (d.pack_record?.evidence_format === "digital" || d.pack_record?.evidence_format === "photo") {
          return {
            type: reqType,
            status: "inferable",
            notes: `BOL ${d.shipment.bol_number} on file — digital record likely retrievable`,
          };
        }
        return {
          type: reqType,
          status: "have_paper",
          notes: `BOL ${d.shipment.bol_number} — paper file in office`,
        };
      }
      return {
        type: reqType,
        status: "missing",
        notes: "No BOL number on file",
      };
    case "pod":
      return {
        type: reqType,
        status: "missing",
        notes: "POD status not tracked in current data",
      };
    case "pack_log":
      if (d.pack_record) {
        if (d.pack_record.evidence_format === "digital" || d.pack_record.evidence_format === "photo") {
          return {
            type: reqType,
            status: "have_digital",
            notes: "Digital pack log on file",
          };
        }
        return {
          type: reqType,
          status: "have_paper",
          notes: "Handwritten pack notes on file",
        };
      }
      return {
        type: reqType,
        status: "missing",
        notes: "No pack record on file",
      };
    case "label_scan":
      if (d.pack_record?.label_scannable) {
        return {
          type: reqType,
          status: "have_digital",
          notes: "Scannable label — barcode on file",
        };
      }
      if (d.pack_record && !d.pack_record.label_scannable) {
        return {
          type: reqType,
          status: "missing",
          notes: "Label not scannable — no compliant scan exists to show",
        };
      }
      return {
        type: reqType,
        status: "missing",
        notes: "No label scan on file",
      };
    case "asn_confirmation":
      if (d.shipment?.asn_sent && !d.shipment.asn_sent_late) {
        return {
          type: reqType,
          status: "have_digital",
          notes: "ASN sent on time — confirmation in EDI logs",
        };
      }
      if (d.shipment?.asn_sent && d.shipment.asn_sent_late) {
        return {
          type: reqType,
          status: "have_paper",
          notes:
            "ASN sent late — confirmation exists but timing won't satisfy retailer",
        };
      }
      return {
        type: reqType,
        status: "missing",
        notes: "No ASN was sent",
      };
    case "photo":
      if (d.pack_record?.evidence_format === "photo") {
        return {
          type: reqType,
          status: "have_digital",
          notes: "Photo evidence on file",
        };
      }
      if (d.pack_record?.evidence_format === "digital") {
        return {
          type: reqType,
          status: "inferable",
          notes: "Digital pack system likely captured photos",
        };
      }
      return {
        type: reqType,
        status: "missing",
        notes: "No photographic record on file",
      };
    case "promo_agreement":
      return {
        type: reqType,
        status: "missing",
        notes: "Promo agreement contract not on file",
      };
    default:
      return {
        type: reqType,
        status: "missing",
        notes: "No record of this evidence type",
      };
  }
}

function deductionRequirements(
  d: Deduction,
  retailer: Retailer | null
): RequirementStatus[] {
  if (!retailer) return [];
  const rule = retailer.rules[d.deduction_type];
  if (!rule) return [];

  const submittedByType = new Map<string, Evidence>();
  for (const e of d.dispute?.evidence ?? []) {
    submittedByType.set(e.type, e);
  }

  return rule.evidence_required.map((reqType) =>
    inferRequirement(d, reqType, submittedByType.get(reqType))
  );
}

function readinessFor(reqs: RequirementStatus[]): Readiness {
  if (reqs.length === 0) return "not_disputable";
  let score = 0;
  for (const r of reqs) {
    if (r.status === "have_digital") score += 1;
    else if (r.status === "have_paper" || r.status === "inferable")
      score += 0.5;
  }
  const ratio = score / reqs.length;
  if (ratio >= 0.95) return "ready";
  if (ratio >= 0.5) return "needs_work";
  return "not_disputable";
}

function statusLabel(s: RequirementStatus["status"]): string {
  return {
    have_digital: "Digital, complete",
    have_paper: "Paper, may not meet standard",
    inferable: "Likely retrievable",
    missing: "Missing",
  }[s];
}

function statusMarker(s: RequirementStatus["status"]): string {
  if (s === "have_digital") return "✓";
  if (s === "have_paper" || s === "inferable") return "⚠";
  return "✗";
}

export default function DisputeBuilderView({
  cohort,
  retailers,
  tracedDeductionId,
  onTrace,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [index, setIndex] = useState(0);

  // Slotting is a negotiated cost — not disputable, no requirements,
  // never appears in the builder. Filter it out at the source.
  const operationalCohort = useMemo(
    () => cohort.filter(isOperational),
    [cohort]
  );

  const items: BuilderItem[] = useMemo(() => {
    return operationalCohort.map((d) => {
      const retailer = retailers ? retailers[d.retailer.id] ?? null : null;
      const reqs = deductionRequirements(d, retailer);
      const readiness = readinessFor(reqs);
      return { d, retailer, reqs, readiness };
    });
  }, [operationalCohort, retailers]);

  const counts = useMemo(() => {
    const c = { all: items.length, ready: 0, needs_work: 0, not_disputable: 0 };
    for (const it of items) c[it.readiness]++;
    return c;
  }, [items]);

  const sorted = useMemo(() => {
    const filtered =
      filter === "all"
        ? items
        : items.filter((it) => it.readiness === filter);
    return [...filtered].sort((a, b) => b.d.amount - a.d.amount);
  }, [items, filter]);

  // Reset to top of list whenever the cohort or filter changes.
  useEffect(() => {
    setIndex(0);
  }, [cohort, filter]);

  // When something else activates a trace anchor (cost view's "Trace →",
  // explorer's "Trace this order →"), sync the builder's pointer to it
  // so the user can see both views on the same deduction.
  useEffect(() => {
    if (!tracedDeductionId) return;
    const i = sorted.findIndex(
      (s) => s.d.deduction_id === tracedDeductionId
    );
    if (i >= 0 && i !== index) setIndex(i);
  }, [tracedDeductionId, sorted, index]);

  if (sorted.length === 0) {
    return (
      <section className="builder section">
        <h2>Dispute builder</h2>
        <p className="section-description">
          Pick a deduction and see two columns side by side: what evidence a
          winning dispute requires (signed proof of delivery, compliant label
          scan, pack verification log, photos) and what Cinderhaven actually
          has on file for that order (usually a handwritten note). Missing
          items are flagged. This is a mock-up of the dispute package — what
          it would look like if Cinderhaven had the records, versus what
          they can actually submit today.
        </p>
        <div className="builder-filter">
          <FilterTab
            label={`All (${formatCount(counts.all)})`}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterTab
            label={`Ready (${formatCount(counts.ready)})`}
            active={filter === "ready"}
            onClick={() => setFilter("ready")}
            variant="ok"
          />
          <FilterTab
            label={`Needs work (${formatCount(counts.needs_work)})`}
            active={filter === "needs_work"}
            onClick={() => setFilter("needs_work")}
            variant="warn"
          />
          <FilterTab
            label={`Not disputable (${formatCount(counts.not_disputable)})`}
            active={filter === "not_disputable"}
            onClick={() => setFilter("not_disputable")}
            variant="bad"
          />
        </div>
        <p className="builder-empty section-empty">
          {operationalCohort.length === 0 && cohort.length > 0
            ? "Current cohort is slotting only — negotiated costs aren't disputable, so the builder has nothing to assemble."
            : "No deductions match the current filter."}
        </p>
      </section>
    );
  }

  const safeIdx = Math.min(index, sorted.length - 1);
  const item = sorted[safeIdx];
  const goPrev = () =>
    setIndex((i) => (i - 1 + sorted.length) % sorted.length);
  const goNext = () => setIndex((i) => (i + 1) % sorted.length);
  const goRandom = () => setIndex(Math.floor(Math.random() * sorted.length));

  return (
    <section className="builder">
      <header className="builder-header section-header">
        <div>
          <h2>Dispute builder</h2>
          <p className="section-description">
            Pick a deduction and see two columns side by side: what evidence
            a winning dispute requires (signed proof of delivery, compliant
            label scan, pack verification log, photos) and what Cinderhaven
            actually has on file for that order (usually a handwritten
            note). Missing items are flagged. This is a mock-up of the
            dispute package — what it would look like if Cinderhaven had
            the records, versus what they can actually submit today.
          </p>
          <p className="builder-context section-context">
            Evidence readiness for one deduction at a time. The retailer's
            requirements on the left, what Cinderhaven actually has on the
            right. The mock package shows what a properly assembled
            submission would include.
          </p>
        </div>
        <div className="builder-nav nav-row">
          <button className="nav-btn" onClick={goPrev} aria-label="Previous deduction">
            ← Prev
          </button>
          <button className="nav-btn" onClick={goRandom}>Random</button>
          <button className="nav-btn" onClick={goNext} aria-label="Next deduction">
            Next →
          </button>
        </div>
      </header>

      <div className="builder-filter">
        <FilterTab
          label={`All (${formatCount(counts.all)})`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <FilterTab
          label={`Ready (${formatCount(counts.ready)})`}
          active={filter === "ready"}
          onClick={() => setFilter("ready")}
          variant="ok"
        />
        <FilterTab
          label={`Needs work (${formatCount(counts.needs_work)})`}
          active={filter === "needs_work"}
          onClick={() => setFilter("needs_work")}
          variant="warn"
        />
        <FilterTab
          label={`Not disputable (${formatCount(counts.not_disputable)})`}
          active={filter === "not_disputable"}
          onClick={() => setFilter("not_disputable")}
          variant="bad"
        />
      </div>

      <div className="builder-summary">
        <div className="builder-summary-id">
          <strong>{item.d.deduction_id}</strong>
          <span className="muted">
            {" "}
            · {partnerLabel(item.d.retailer, true)}
          </span>
          <span className="muted">
            {" "}
            · {item.d.deduction_type.replace(/_/g, " ")}
          </span>
          {item.d.code && (
            <span className="muted"> · code {item.d.code.code}</span>
          )}
          <span className="muted"> · {formatDollars(item.d.amount)}</span>
          <span className="muted">
            {" "}
            · {safeIdx + 1} of {formatCount(sorted.length)}
          </span>
        </div>
        <div className={`builder-readiness builder-readiness-${item.readiness}`}>
          {READINESS_LABEL[item.readiness]}
        </div>
      </div>

      <div className="builder-grid">
        <div className="builder-section">
          <h3>
            Requirements
            <span className="muted">
              {" "}
              ({item.retailer ? partnerLabel(item.d.retailer, true) : "retailer"} ·{" "}
              {item.d.deduction_type.replace(/_/g, " ")})
            </span>
          </h3>
          {item.reqs.length === 0 ? (
            <p className="muted builder-no-rules">
              No retailer rules on file for this deduction type. The dispute
              would proceed on whatever evidence Cinderhaven could produce,
              with no published bar to clear.
            </p>
          ) : (
            <table className="builder-reqs data-table">
              <thead>
                <tr>
                  <th>Required</th>
                  <th>What Cinderhaven has</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {item.reqs.map((r) => (
                  <tr key={r.type} className={`req-row status-${r.status}`}>
                    <td className="req-type">{r.type.replace(/_/g, " ")}</td>
                    <td className="req-notes">{r.notes}</td>
                    <td className="req-status">
                      <span className={`req-marker status-${r.status}`}>
                        {statusMarker(r.status)}
                      </span>{" "}
                      {statusLabel(r.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="builder-section">
          <h3>Mock dispute package</h3>
          {item.retailer ? (
            <p className="builder-mock-desc">
              What a properly assembled submission to{" "}
              <strong>{partnerLabel(item.d.retailer)}</strong>{" "}
              {item.retailer.dispute_portal_name && (
                <>
                  via <strong>{item.retailer.dispute_portal_name}</strong>{" "}
                </>
              )}
              would include:
            </p>
          ) : (
            <p className="builder-mock-desc muted">
              Retailer rules for {partnerLabel(item.d.retailer)} not on file.
            </p>
          )}
          <ul className="builder-mock">
            {item.reqs.map((r) => (
              <li key={r.type} className={`mock-item status-${r.status}`}>
                <span className="mock-checkbox">
                  {r.status === "have_digital" ? "☑" : "☐"}
                </span>
                <div>
                  <div className="mock-title">{r.type.replace(/_/g, " ")}</div>
                  <div className="mock-detail">{mockDetailFor(r)}</div>
                </div>
              </li>
            ))}
          </ul>
          {item.readiness !== "ready" && (
            <p className="builder-upgrade">
              {item.readiness === "needs_work"
                ? "Switching to digital pack verification (recovery simulation toggle) would close most of these gaps."
                : "Without digital pack records, this deduction cannot be defended on its current evidence."}
            </p>
          )}
          {item.d.order && (
            <div className="builder-actions">
              <button
                className="builder-action-btn"
                onClick={() => onTrace(item.d.deduction_id)}
              >
                View causation trace →
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function mockDetailFor(r: RequirementStatus): string {
  if (r.status === "have_digital")
    return "Ready — attach from system at submission";
  if (r.status === "have_paper")
    return `Have it but ${r.notes.toLowerCase()} — needs scanning and clean-up`;
  if (r.status === "inferable")
    return `Need to retrieve — ${r.notes.toLowerCase()}`;
  return `Missing — ${r.notes.toLowerCase()}`;
}

function FilterTab({
  label,
  active,
  onClick,
  variant,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  variant?: "ok" | "warn" | "bad";
}) {
  const cls = ["builder-filter-tab"];
  if (active) cls.push("active");
  if (variant) cls.push(`variant-${variant}`);
  return (
    <button className={cls.join(" ")} onClick={onClick}>
      {label}
    </button>
  );
}
