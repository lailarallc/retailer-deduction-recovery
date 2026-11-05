// Distributor PO numbers carry the partner name (DPO-UNFI-, DPO-KEHE-,
// DPO--DPI-). The trace shows them beside dollar figures, so the rendered
// trace must never contain a real distributor name in any form.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { Deduction } from "../types";
import CausationTraceView from "./CausationTraceView";

const deductions = JSON.parse(
  readFileSync(resolve(process.cwd(), "public", "json", "deductions.json"), "utf-8")
) as Deduction[];

describe("causation trace hides distributor names", () => {
  for (const id of ["DIST-UNFI", "DIST-KEHE", "DIST-DPI"]) {
    it(`${id} trace renders the label, not the name`, () => {
      const cohort = deductions.filter((d) => d.retailer.id === id && d.order);
      expect(cohort.length).toBeGreaterThan(0);
      for (const d of [cohort[0], cohort[cohort.length - 1]]) {
        const { container, unmount } = render(
          <CausationTraceView tracedDeductionId={d.deduction_id} cohort={cohort} onChange={() => {}} />
        );
        const text = container.textContent ?? "";
        expect(text).toContain(`PO DPO-`);
        expect(text).toMatch(/Distributor [ABC]/);
        expect(text).not.toMatch(/UNFI|KEHE|KeHE|DPI/);
        unmount();
      }
    });
  }
});
