// Demo golden lock (domain layer) — retailer-deduction-recovery.
//
// The Python golden (tests/test_demo_golden.py) byte-locks the committed
// JSON. This locks the *TypeScript domain logic* that turns that JSON into
// the numbers the app renders: computeKpis() and buildSankeyData(). If the
// domain code drifts, the demo would show different figures even from
// identical data — this catches that.
//
// It loads the real committed artifacts (not the mocked minimal fixtures
// App.test.tsx uses) and asserts the domain functions reproduce the exported
// summary totals exactly.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { Deduction, Summary } from "./types";
import { computeKpis } from "./computeKpis";
import { buildSankeyData } from "./sankey/domain";

const JSON_DIR = resolve(process.cwd(), "public", "json");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(JSON_DIR, name), "utf-8")) as T;
}

const summary = load<Summary>("summary.json");
const deductions = load<Deduction[]>("deductions.json");

describe("demo golden — domain layer reproduces exported summary", () => {
  const kpis = computeKpis(deductions);
  const t = summary.totals;

  it("computeKpis count/dollar match the summary backlog", () => {
    expect(kpis.count).toBe(16917);
    expect(kpis.count).toBe(t.deductions_count);
    expect(kpis.dollar).toBeCloseTo(t.deductions_dollar, 2);
  });

  it("computeKpis dispute counts and recovered dollars match", () => {
    expect(kpis.disputedCount).toBe(t.disputes_filed);
    expect(kpis.disputedCount).toBe(6011);
    expect(kpis.recovered).toBeCloseTo(t.disputes_recovered, 2);
    expect(kpis.recovered).toBeCloseTo(196694.71, 2);
  });

  it("computeKpis never-filed cohort matches", () => {
    expect(kpis.noDisputeCount).toBe(t.deductions_no_dispute_count);
    expect(kpis.noDisputeCount).toBe(10906);
    expect(kpis.noDisputeDollar).toBeCloseTo(t.deductions_no_dispute_dollar, 2);
  });

  it("labor hours reproduce the summary (rounded to its 1dp)", () => {
    expect(kpis.laborHours).toBeCloseTo(t.labor_hours, 0);
  });

  it("hero basis: recovered / disputed dollars ~= 42%", () => {
    const disputedDollars = kpis.dollar - kpis.noDisputeDollar;
    expect(kpis.recovered / disputedDollars).toBeCloseTo(0.419, 3);
  });

  it("hero basis: recovered / total dollars ~= 15%", () => {
    expect(kpis.recovered / kpis.dollar).toBeCloseTo(0.146, 3);
  });

  it("annualized FTE ~= 1.7 (whole-window labor annualized x12/37/2080)", () => {
    const annualizedFte = (kpis.laborHours * 12) / summary.window.months / 2080;
    expect(Math.round(annualizedFte * 10) / 10).toBe(1.7);
  });
});

describe("demo golden — Sankey excludes slotting, totals stable", () => {
  // Mirror SankeyView's exact pipeline: the view filters slotting out of
  // the cohort BEFORE calling buildSankeyData (SankeyView.tsx:58-69), since
  // slotting is a negotiated cost shown in a callout, not a flow through the
  // failure funnel.
  const operational = deductions.filter((d) => d.deduction_type !== "slotting");
  const sankey = buildSankeyData(operational);

  it("total link flow at layer 0->1 equals non-slotting positive backlog", () => {
    const layer0to1 = sankey.links
      .filter((l) => l.source.startsWith("0:") && l.target.startsWith("1:"))
      .reduce((sum, l) => sum + l.value, 0);
    expect(layer0to1).toBeCloseTo(1197285.64, 2);
  });

  it("no slotting node enters the rendered Sankey", () => {
    expect(sankey.nodes.some((n) => n.label === "Slotting")).toBe(false);
  });
});
