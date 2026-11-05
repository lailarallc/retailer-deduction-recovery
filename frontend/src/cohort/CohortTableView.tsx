import { useMemo, useState } from "react";
import type { Deduction } from "../types";
import { disputeReadinessFor, TYPE_LABELS, readableOutcome } from "../sankey/domain";
import { formatDollars } from "../data";
import { partnerLabel } from "../partnerLabels";
import "./CohortTableView.css";

interface Props {
  cohort: Deduction[];
  onSelectDeduction: (id: string) => void;
  activeDeductionId?: string | null;
}

type SortKey =
  | "deduction_id"
  | "date"
  | "retailer"
  | "type"
  | "amount"
  | "readiness"
  | "outcome"
  | "retrieval_hours";

interface SortState {
  key: SortKey;
  desc: boolean;
}

const PAGE_SIZE = 25;

function retrievalHours(d: Deduction): number | null {
  return d.dispute?.labor_hours ?? null;
}

function outcomeLabel(d: Deduction): string {
  if (!d.dispute) return "Never filed";
  return readableOutcome(d.dispute.outcome);
}

function getSortValue(d: Deduction, key: SortKey): string | number {
  switch (key) {
    case "deduction_id": return d.deduction_id;
    case "date": return d.deduction_date;
    case "retailer": return partnerLabel(d.retailer, true);
    case "type": return TYPE_LABELS[d.deduction_type] || d.deduction_type;
    case "amount": return d.amount;
    case "readiness": return disputeReadinessFor(d);
    case "outcome": return outcomeLabel(d);
    case "retrieval_hours": return retrievalHours(d) ?? -1;
  }
}

export default function CohortTableView({ cohort, onSelectDeduction, activeDeductionId }: Props) {
  const [sort, setSort] = useState<SortState>({ key: "amount", desc: true });
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const arr = [...cohort];
    arr.sort((a, b) => {
      const av = getSortValue(a, sort.key);
      const bv = getSortValue(b, sort.key);
      if (av < bv) return sort.desc ? 1 : -1;
      if (av > bv) return sort.desc ? -1 : 1;
      return 0;
    });
    return arr;
  }, [cohort, sort]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, desc: !prev.desc } : { key, desc: true }
    );
    setPage(0);
  }

  function sortIndicator(key: SortKey) {
    if (sort.key !== key) return null;
    return sort.desc ? " ↓" : " ↑";
  }

  function ariaSort(key: SortKey): "ascending" | "descending" | "none" {
    if (sort.key !== key) return "none";
    return sort.desc ? "descending" : "ascending";
  }

  function handleSortKey(e: React.KeyboardEvent, key: SortKey) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSort(key);
    }
  }

  if (cohort.length === 0) return null;

  return (
    <section className="cohort-table-section">
      <h2>Cohort detail</h2>
      <p className="section-description">
        {sorted.length} deductions in the current view. Click any row to
        inspect it in the explorer below. Click a column header to sort.
      </p>

      <div className="cohort-table-wrap table-scroll">
        <table className="cohort-table data-table">
          <colgroup>
            <col className="col-id" />
            <col className="col-date" />
            <col className="col-retailer" />
            <col className="col-type" />
            <col className="col-amount" />
            <col className="col-readiness" />
            <col className="col-outcome" />
            <col className="col-retrieval" />
          </colgroup>
          <thead>
            <tr>
              <th tabIndex={0} role="columnheader" aria-sort={ariaSort("deduction_id")} onClick={() => toggleSort("deduction_id")} onKeyDown={(e) => handleSortKey(e, "deduction_id")}>
                ID{sortIndicator("deduction_id")}
              </th>
              <th tabIndex={0} role="columnheader" aria-sort={ariaSort("date")} onClick={() => toggleSort("date")} onKeyDown={(e) => handleSortKey(e, "date")}>
                Date{sortIndicator("date")}
              </th>
              <th tabIndex={0} role="columnheader" aria-sort={ariaSort("retailer")} onClick={() => toggleSort("retailer")} onKeyDown={(e) => handleSortKey(e, "retailer")}>
                Retailer{sortIndicator("retailer")}
              </th>
              <th tabIndex={0} role="columnheader" aria-sort={ariaSort("type")} onClick={() => toggleSort("type")} onKeyDown={(e) => handleSortKey(e, "type")}>
                Type{sortIndicator("type")}
              </th>
              <th className="num" tabIndex={0} role="columnheader" aria-sort={ariaSort("amount")} onClick={() => toggleSort("amount")} onKeyDown={(e) => handleSortKey(e, "amount")}>
                Amount{sortIndicator("amount")}
              </th>
              <th tabIndex={0} role="columnheader" aria-sort={ariaSort("readiness")} onClick={() => toggleSort("readiness")} onKeyDown={(e) => handleSortKey(e, "readiness")}>
                Readiness{sortIndicator("readiness")}
              </th>
              <th tabIndex={0} role="columnheader" aria-sort={ariaSort("outcome")} onClick={() => toggleSort("outcome")} onKeyDown={(e) => handleSortKey(e, "outcome")}>
                Outcome{sortIndicator("outcome")}
              </th>
              <th className="num" tabIndex={0} role="columnheader" aria-sort={ariaSort("retrieval_hours")} onClick={() => toggleSort("retrieval_hours")} onKeyDown={(e) => handleSortKey(e, "retrieval_hours")}>
                Retrieval hrs{sortIndicator("retrieval_hours")}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((d) => (
              <tr
                key={d.deduction_id}
                onClick={() => onSelectDeduction(d.deduction_id)}
                className={d.deduction_id === activeDeductionId ? "active-row" : ""}
              >
                <td className="mono">{d.deduction_id.slice(0, 8)}</td>
                <td>{d.deduction_date}</td>
                <td>{partnerLabel(d.retailer, true)}</td>
                <td>{TYPE_LABELS[d.deduction_type] || d.deduction_type}</td>
                <td className="num">{formatDollars(d.amount)}</td>
                <td>{disputeReadinessFor(d)}</td>
                <td>{outcomeLabel(d)}</td>
                <td className="num">
                  {retrievalHours(d) != null
                    ? retrievalHours(d)!.toFixed(1)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="cohort-table-pagination">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ← Prev
          </button>
          <span>
            Page {safePage + 1} of {totalPages}
          </span>
          <button disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
