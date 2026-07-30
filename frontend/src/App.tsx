import { useEffect, useMemo, useRef, useState } from "react";
import type { Deduction, RetailersById, Summary } from "./types";
import { loadDeductions, loadRetailers, loadSummary, formatDollars, formatPercent, formatCount } from "./data";
import { isOnSelectedPath, TYPE_OPTIONS, type Selection } from "./sankey/domain";
import type { DateRange } from "./TimeRangeSelector";
import { computeKpis } from "./computeKpis";
import Kpi from "./Kpi";
import CohortBar from "./CohortBar";
import TimeRangeSelector from "./TimeRangeSelector";
import ChapterNav, { type ChapterId } from "./ChapterNav";
import SankeyView from "./sankey/SankeyView";
import CohortTableView from "./cohort/CohortTableView";
import ExplorerView from "./explorer/ExplorerView";
import CausationTraceView from "./causation/CausationTraceView";
import RecoverySimulationView from "./simulation/RecoverySimulationView";
import CostToDisputeView from "./cost/CostToDisputeView";
import DisputeBuilderView from "./builder/DisputeBuilderView";
import TimelinePressureView from "./pressure/TimelinePressureView";
import PostAuditRiskView from "./audit/PostAuditRiskView";
import RetailerScorecardView from "./scorecard/RetailerScorecardView";
import OriginClusteringView from "./origin/OriginClusteringView";
import "./App.css";

export default function App() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [deductions, setDeductions] = useState<Deduction[] | null>(null);
  const [retailers, setRetailers] = useState<RetailersById | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(null);
  const [tracedDeductionId, setTracedDeductionId] = useState<string | null>(null);
  const [focusedDeductionId, setFocusedDeductionId] = useState<string | null>(null);
  const [activeChapter, setActiveChapter] = useState<ChapterId>(1);
  const traceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([loadSummary(), loadDeductions(), loadRetailers()])
      .then(([s, d, r]) => {
        setSummary(s);
        setDeductions(d);
        setRetailers(r);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const filteredDeductions = useMemo(() => {
    if (!deductions) return deductions;
    if (!selection && !dateRange) return deductions;
    return deductions.filter((d) => {
      if (selection && !isOnSelectedPath(d, selection)) return false;
      if (dateRange) {
        if (d.deduction_date < dateRange.start) return false;
        if (d.deduction_date > dateRange.end) return false;
      }
      return true;
    });
  }, [deductions, selection, dateRange]);

  useEffect(() => {
    if (
      tracedDeductionId &&
      filteredDeductions &&
      !filteredDeductions.some((d) => d.deduction_id === tracedDeductionId)
    ) {
      setTracedDeductionId(null);
    }
  }, [filteredDeductions, tracedDeductionId]);

  useEffect(() => {
    if (tracedDeductionId && traceRef.current) {
      traceRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [tracedDeductionId]);

  const dropdownValue = useMemo(() => {
    if (!selection || selection.kind !== "node") return "all";
    const [layerStr, ...rest] = selection.nodeId.split(":");
    if (layerStr !== "0") return "all";
    const label = rest.join(":");
    return TYPE_OPTIONS.includes(label) ? label : "all";
  }, [selection]);

  function onDropdownChange(value: string) {
    if (value === "all") setSelection(null);
    else setSelection({ kind: "node", nodeId: `0:${value}` });
  }

  function traceAndNavigate(id: string | null) {
    setTracedDeductionId(id);
    if (id) setActiveChapter(2);
  }

  function focusAndNavigate(id: string | null) {
    setFocusedDeductionId(id);
    if (id) setActiveChapter(2);
  }

  const filteredKpis = useMemo(
    () => {
      if (!filteredDeductions) return null;
      const anyF = !!(selection || dateRange);
      return anyF ? computeKpis(filteredDeductions) : null;
    },
    [selection, dateRange, filteredDeductions]
  );

  if (error) return <div className="error">Error loading data: {error}</div>;
  if (!summary || !deductions) return <div className="loading">Loading…</div>;

  const { totals } = summary;
  const kpiCount = filteredKpis?.count ?? totals.deductions_count;
  const kpiDollar = filteredKpis?.dollar ?? totals.deductions_dollar;
  const filterMonths = dateRange
    ? Math.max(1, Math.round((new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime()) / (30.44 * 86_400_000)))
    : summary.window.months;
  const kpiAnnualized = filteredKpis ? (kpiDollar * 12 / filterMonths) : totals.annualized_dollar;
  const kpiRecovered = filteredKpis?.recovered ?? totals.disputes_recovered;
  const kpiRecoveryRate = kpiDollar ? kpiRecovered / kpiDollar : 0;
  const kpiNoDisputeCount = filteredKpis?.noDisputeCount ?? totals.deductions_no_dispute_count;
  const kpiNoDisputeDollar = filteredKpis?.noDisputeDollar ?? totals.deductions_no_dispute_dollar;
  const kpiLaborHours = filteredKpis?.laborHours ?? totals.labor_hours;
  const kpiFte = (kpiLaborHours * 12 / summary.window.months) / 2080;
  const kpiDisputedCount = filteredKpis?.disputedCount ?? totals.disputes_filed;

  return (
    <div className="lailara-page">
      <header className="lailara-header">
        <nav className="lailara-nav-inner">
          <a href="https://lailarallc.com" className="lailara-wordmark" target="_blank" rel="noopener noreferrer">Lailara LLC</a>
          <span className="lailara-tool-name">Retailer Deduction Recovery</span>
        </nav>
      </header>
      <main className="lailara-main">
    <div className="app">
      <header>
        <h1>Cinderhaven Provisions — Retailer Deductions</h1>
        <p className="hero-lede">
          Cinderhaven wins ~42% of the disputes it files. The problem isn&apos;t
          winning — it&apos;s filing: roughly two-thirds of deductions are written
          off without a fight, so only ~15% of deduction dollars ever come back.
          This tool traces each of the ${(summary.totals.deductions_dollar / 1e6).toFixed(2)}M
          in deductions through the five compounding failures that keep the money
          unclaimed — and what each operational fix is worth.
        </p>
        <p className="subtitle">
          Synthetic dataset · window {summary.window.start} to {summary.window.end} ({summary.window.months} months)
        </p>
      </header>

      <CohortBar
        selection={selection}
        retailers={retailers}
        dateRange={dateRange}
        kpiCount={kpiCount}
        kpiDollar={kpiDollar}
        onClear={() => {
          setSelection(null);
          setDateRange(null);
        }}
      />

      <section className="kpi-row">
        <Kpi label="Total deductions" value={formatDollars(kpiDollar)} sub={`annualized ${formatDollars(kpiAnnualized)} · ~$25M revenue`} />
        <Kpi label="Recovery rate" value={formatPercent(kpiRecoveryRate)} sub={`${formatDollars(kpiRecovered)} recovered`} />
        <Kpi
          label={kpiDisputedCount > 0 ? "Labor on disputes" : "Dispute labor"}
          value={`${formatCount(Math.round(kpiLaborHours))} hrs`}
          sub={kpiDisputedCount > 0
            ? `from ${formatCount(kpiDisputedCount)} filed · ~${kpiFte.toFixed(1)} FTE`
            : "no disputes filed in this cohort"}
        />
        <Kpi label="Undisputed losses" value={formatDollars(kpiNoDisputeDollar)} sub={`${formatCount(kpiNoDisputeCount)} deductions never filed`} negative />
      </section>

      <div className="filter-row">
        <div className="type-selector">
          <label htmlFor="type-filter">Filter by deduction type</label>
          <select
            id="type-filter"
            value={dropdownValue}
            onChange={(e) => onDropdownChange(e.target.value)}
          >
            <option value="all">All deductions</option>
            {TYPE_OPTIONS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <TimeRangeSelector
          windowStart={summary.window.start}
          windowEnd={summary.window.end}
          value={dateRange}
          onChange={setDateRange}
        />
      </div>

      <ChapterNav active={activeChapter} onChange={setActiveChapter} />

      {activeChapter === 1 && (
        <>
          <SankeyView deductions={filteredDeductions ?? deductions} selection={selection} onSelect={setSelection} />
          <CohortTableView
            cohort={filteredDeductions ?? deductions}
            onSelectDeduction={focusAndNavigate}
            activeDeductionId={focusedDeductionId}
          />
        </>
      )}

      {activeChapter === 2 && (
        <>
          <ExplorerView
            cohort={filteredDeductions ?? deductions}
            allDeductions={deductions}
            onTrace={setTracedDeductionId}
            tracedDeductionId={tracedDeductionId}
            focusedDeductionId={focusedDeductionId}
          />

          <div ref={traceRef}>
            <CausationTraceView
              tracedDeductionId={tracedDeductionId}
              cohort={filteredDeductions ?? deductions}
              onChange={setTracedDeductionId}
            />
          </div>

          <OriginClusteringView
            cohort={
              selection?.kind === "cluster"
                ? deductions
                : filteredDeductions ?? deductions
            }
            activeCluster={
              selection?.kind === "cluster"
                ? { dimension: selection.dimension, value: selection.value }
                : null
            }
            onSelectCluster={(dimension, value) =>
              setSelection(
                dimension && value
                  ? { kind: "cluster", dimension, value }
                  : null
              )
            }
            onTrace={setTracedDeductionId}
          />
        </>
      )}

      {activeChapter === 3 && (
        <>
          <DisputeBuilderView
            cohort={filteredDeductions ?? deductions}
            retailers={retailers}
            tracedDeductionId={tracedDeductionId}
            onTrace={traceAndNavigate}
          />

          <PostAuditRiskView
            cohort={filteredDeductions ?? deductions}
            onTrace={traceAndNavigate}
          />

          <RetailerScorecardView
            cohort={
              selection?.kind === "retailer"
                ? deductions
                : filteredDeductions ?? deductions
            }
            retailers={retailers}
            activeRetailerId={
              selection?.kind === "retailer" ? selection.retailerId : null
            }
            onSelectRetailer={(id) =>
              setSelection(id ? { kind: "retailer", retailerId: id } : null)
            }
          />
        </>
      )}

      {activeChapter === 4 && (
        <>
          <RecoverySimulationView cohort={filteredDeductions ?? deductions} />

          <CostToDisputeView
            cohort={filteredDeductions ?? deductions}
            onTrace={traceAndNavigate}
          />

          <TimelinePressureView
            cohort={filteredDeductions ?? deductions}
            onTrace={traceAndNavigate}
          />
        </>
      )}
    </div>
      </main>
      <footer className="lailara-footer">
        <div className="lailara-footer-inner">
          <p>Built by <a href="https://lailarallc.com" target="_blank" rel="noopener noreferrer">Lailara LLC</a></p>
          <p className="lailara-footer-note">Data: Cinderhaven Provisions synthetic dataset.</p>
        </div>
      </footer>
    </div>
  );
}
