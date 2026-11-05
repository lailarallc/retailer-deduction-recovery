import type { RetailersById } from "./types";
import type { Selection } from "./sankey/domain";
import type { DateRange } from "./TimeRangeSelector";
import { dateRangeLabel } from "./TimeRangeSelector";
import { selectionLabel } from "./sankey/domain";
import { formatCount, formatDollars } from "./data";
import { partnerLabel } from "./partnerLabels";

interface Props {
  selection: Selection | null;
  retailers: RetailersById | null;
  dateRange: DateRange;
  kpiCount: number;
  kpiDollar: number;
  onClear: () => void;
}

export default function CohortBar({
  selection,
  retailers,
  dateRange,
  kpiCount,
  kpiDollar,
  onClear,
}: Props) {
  const filterText = selection
    ? selectionLabel(
        selection,
        selection.kind === "retailer"
          ? partnerLabel(
              retailers?.[selection.retailerId]?.name ?? selection.retailerId,
              true
            )
          : undefined
      )
    : null;
  const rangeText = dateRange ? dateRangeLabel(dateRange) : null;
  const isFiltered = !!(filterText || rangeText);

  const parts: string[] = [];
  if (filterText) parts.push(filterText);
  if (rangeText) parts.push(rangeText);
  const cohortLabel = parts.length ? parts.join(" · ") : "All deductions, all time";

  return (
    <div className={isFiltered ? "cohort-bar active" : "cohort-bar"}>
      <span className="cohort-bar-label">Cohort</span>
      <span className="cohort-bar-value">{cohortLabel}</span>
      <span className="cohort-bar-count">
        {formatCount(kpiCount)} deductions • {formatDollars(kpiDollar)}
      </span>
      {isFiltered && (
        <button onClick={onClear} className="cohort-bar-clear" title="Clear all filters">
          × Clear
        </button>
      )}
    </div>
  );
}
