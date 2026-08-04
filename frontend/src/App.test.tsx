import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import type { Summary, Deduction, RetailersById } from "./types";

const MINIMAL_SUMMARY: Summary = {
  window: { start: "2025-01-01", end: "2025-12-31", months: 12 },
  totals: {
    deductions_count: 2,
    deductions_dollar: 5000,
    annualized_dollar: 5000,
    disputes_filed: 1,
    disputes_recovered: 500,
    recovery_rate: 0.1,
    labor_hours: 10,
    fte_equivalent: 0.005,
    orders_count: 2,
    orders_dollar: 10000,
    deductions_no_dispute_count: 1,
    deductions_no_dispute_dollar: 2500,
  },
  by_type: [],
  by_retailer: [],
  by_outcome: [],
  by_evidence_quality: [],
};

function makeDeduction(overrides: Partial<Deduction> = {}): Deduction {
  return {
    deduction_id: "DED-001",
    deduction_type: "short_ship",
    amount: 2500,
    deduction_date: "2025-06-15",
    dispute_deadline: "2025-09-15",
    is_post_audit: false,
    remittance_id: null,
    retailer: { id: "R1", name: "Walmart", channel_type: "national" },
    code: null,
    order: {
      order_id: "ORD-001",
      po_number: "PO-001",
      po_date: "2025-06-01",
      total_units: 100,
      total_value: 5000,
      requested_ship_date: "2025-06-05",
    },
    pack_record: {
      pack_date: "2025-06-04",
      label_scannable: false,
      pack_verification: "paper_note",
      evidence_format: "handwritten",
      units_picked: 100,
      units_packed: 100,
    },
    shipment: {
      shipment_id: "SH-001",
      ship_date: "2025-06-06",
      delivery_date: "2025-06-08",
      carrier: "FedEx Freight",
      bol_number: "BOL-000001",
      asn_sent: false,
      asn_sent_late: false,
      units_shipped: 100,
      pallets_shipped: 2,
    },
    dispute: {
      dispute_id: "DSP-001",
      filed_date: "2025-07-01",
      filing_method: "portal",
      evidence_quality: "weak",
      outcome: "lost_evidence",
      recovered_amount: 0,
      closed_date: "2025-08-01",
      labor_hours: 5,
      evidence: [],
    },
    post_audit: null,
    ...overrides,
  };
}

const MINIMAL_DEDUCTIONS: Deduction[] = [
  makeDeduction(),
  makeDeduction({
    deduction_id: "DED-002",
    deduction_type: "label_fine",
    amount: 2500,
    dispute: null,
  }),
];

const MINIMAL_RETAILERS: RetailersById = {
  R1: {
    name: "Walmart",
    channel_type: "national",
    dispute_portal_name: "APDP",
    dispute_portal_url: null,
    dispute_method: "portal",
    notes: "",
    rules: {
      short_ship: {
        dispute_window_days: 90,
        auto_deduct: true,
        evidence_required: ["BOL", "POD"],
        typical_recovery_rate: 0.3,
        notes: "",
      },
    },
    codes: [],
    edi_requirements: [],
  },
};

vi.mock("./data", () => ({
  loadSummary: () => Promise.resolve(MINIMAL_SUMMARY),
  loadDeductions: () => Promise.resolve(MINIMAL_DEDUCTIONS),
  loadRetailers: () => Promise.resolve(MINIMAL_RETAILERS),
  formatDollars: (n: number) => `$${n}`,
  formatPercent: (n: number) => `${(n * 100).toFixed(1)}%`,
  formatCount: (n: number) => String(n),
}));

import App from "./App";

function getChapterNav() {
  return within(document.querySelector(".chapter-nav") as HTMLElement);
}

function clickTab(label: RegExp) {
  return getChapterNav().getByText(label);
}

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => {
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
  return user;
}

describe("App chapter navigation", () => {
  it("defaults to chapter 1 on load", async () => {
    await renderApp();
    const activeTab = getChapterNav().getByText(/The Problem/).closest("button")!;
    expect(activeTab.className).toContain("active");
  });

  it("shows Sankey view in chapter 1", async () => {
    await renderApp();
    expect(document.querySelector(".sankey")).toBeInTheDocument();
  });

  it("hides chapter 2 views when chapter 1 is active", async () => {
    await renderApp();
    expect(document.querySelector(".explorer")).not.toBeInTheDocument();
  });

  it("switches to chapter 2 on tab click", async () => {
    const user = await renderApp();
    await user.click(clickTab(/Why This Happens/));

    const tab2 = getChapterNav().getByText(/Why This Happens/).closest("button")!;
    expect(tab2.className).toContain("active");
  });

  it("shows explorer in chapter 2 and hides Sankey", async () => {
    const user = await renderApp();
    await user.click(clickTab(/Why This Happens/));

    expect(document.querySelector(".explorer")).toBeInTheDocument();
    expect(document.querySelector(".sankey")).not.toBeInTheDocument();
  });

  it("preserves selection state across chapter switches", async () => {
    const user = await renderApp();

    const dropdown = screen.getByLabelText(/Filter by deduction type/);
    await user.selectOptions(dropdown, "Short ship");

    const cohortBar = document.querySelector(".cohort-bar")!;
    expect(cohortBar.textContent).toContain("Short ship");

    await user.click(clickTab(/Why This Happens/));
    expect(cohortBar.textContent).toContain("Short ship");

    await user.click(clickTab(/The Problem/));
    expect(cohortBar.textContent).toContain("Short ship");
  });

  it("shows chapter 3 views on tab click", async () => {
    const user = await renderApp();
    await user.click(clickTab(/The Evidence Gap/));

    expect(document.querySelector(".builder")).toBeInTheDocument();
  });

  it("shows chapter 4 views on tab click", async () => {
    const user = await renderApp();
    await user.click(clickTab(/What to Do About It/));

    expect(document.querySelector(".sim")).toBeInTheDocument();
  });

  it("hero states the recovery figure on the correct basis (P1 win-rate label lock)", async () => {
    // 2026-07-31 audit P1: the live hero once read "wins ~42% of the disputes
    // it files" — but 41.9% is recovered-DOLLARS / disputed-DOLLARS, not a
    // won/filed dispute-count rate. Lock the corrected basis label so it
    // can't regress. The distinct won/filed rate lives in the scorecard.
    await renderApp();
    const hero = document.querySelector(".hero-lede") as HTMLElement;
    expect(hero).toBeTruthy();
    expect(hero.textContent).toContain("of every disputed dollar");
    expect(hero.textContent).not.toMatch(/of the disputes it files/i);
  });

  it("KPIs and cohort bar persist across all chapters", async () => {
    const user = await renderApp();

    for (const label of [
      /Why This Happens/,
      /The Evidence Gap/,
      /What to Do About It/,
      /The Problem/,
    ] as const) {
      await user.click(clickTab(label));
      expect(document.querySelector(".kpi-row")).toBeInTheDocument();
      expect(document.querySelector(".cohort-bar")).toBeInTheDocument();
    }
  });
});
