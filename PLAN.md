# Retailer Deduction Recovery — Current Work Plan

The current arc of work. Updated when the arc changes, not every
session. For session-by-session state, see HANDOFF.md.

---

## Goal

Restructure the demo from a flat 16-section scroll into a
narrative-driven, chapter-based tool that guides a CEO through
the five compounding failures — revealing the unique diagnostic
capabilities that no commercial deduction platform offers.

## Why this arc, why now

The demo is functionally complete (10 views, all connected) but
the "busy" UX is hiding the competitive advantage. The audit
(AUDIT.md, 2026-05-15) found five features unique in a 15-tool
landscape: root cause tracing, evidence quality assessment,
recovery simulation, cost-to-dispute triage, and executive
visualization. A prospect CEO opening this cold sees 16 sections
and bounces before discovering any of it. The narrative refactor
is the highest-leverage move — fixing the UX IS the strategic
differentiation.

## Business question this arc answers

Same as the original: make visible the five compounding failures
and what each one costs. This arc changes HOW the answer is
delivered — from "here are 10 tools, go explore" to "here is
what's happening, and each screen shows you why it's getting
worse."

## Tasks

### Phase A: Clear the path (< 1 hour)

- [x] Remove vestigial bottom tables — delete the 3 by-type /
      by-retailer / by-distributor tables from App.tsx (lines
      288–378). Data already visible in Sankey + scorecard. Zero
      information loss, instant noise reduction.
- [x] Rename sankey/data.ts → domain.ts — this is the shared
      domain module (Selection, isOnSelectedPath, rootCauseFor,
      etc.) imported by 7+ views. Update all imports.
- [x] Extract App.tsx inline components — pull Kpi, CohortBar,
      TimeRangeSelector, computeKpis, aggregateByType,
      aggregateByRetailer into separate files. Keeps App.tsx
      focused on layout and state before adding navigation.

### Phase B: Narrative chapter structure (main effort)

- [x] Design chapter navigation component — tab bar or chapter
      nav below the persistent header (Sankey + KPIs + filters +
      cohort bar). One piece of state: activeChapter. Only the
      active chapter's views render. Simple, no React Router.
- [x] Implement Chapter 1: The Problem — Sankey + KPIs + cohort
      table. "Here is the shape of your losses." This is the
      landing state.
- [x] Implement Chapter 2: Why This Happens — Explorer + causation
      trace + origin clustering. "Each deduction traces back to a
      specific operational failure."
- [x] Implement Chapter 3: The Evidence Gap — Dispute builder +
      post-audit risk + retailer scorecard. "You don't have what
      you need to win, and here's what that costs."
- [x] Implement Chapter 4: What to Do About It — Recovery
      simulation + cost-to-dispute + timeline pressure. "These
      fixes, in this order, recover this much money."
- [x] Wire cross-links to switch chapters — Trace →, Filter →,
      and other cross-view links navigate to the correct chapter
      when the target view lives in a different chapter. Same
      selection/trace state, just also sets activeChapter.
- [x] Verify chapter navigation end-to-end — walk every cross-link,
      filter, and drill-down path. Confirm Sankey selection +
      chapter switching compose correctly. Screenshot verification.
- [x] Responsive check — verify chapter nav works at iPad portrait
      (768), MacBook (1366), wide (1680).
- [x] Deploy updated version to Cloudflare Pages.

### Phase C: Harden

- [x] Add component tests for navigation state — chapter switching,
      cross-link chapter transitions, selection persistence across
      chapter changes.

### Phase D: Pre-preview cleanup (audit 2026-05-16)

Data bugs and duplication found in the Phase 2 internal review.
These fix credibility issues a data-curious CEO would discover.

- [x] Fix WIN_PROB discrepancy — RecoverySimulationView uses 0.05
      for "none" evidence, CostToDisputeView uses 0.0. Extract
      WIN_PROB into domain.ts as single source of truth. Decided
      on 0.05 (research-calibrated).
- [x] Pin DEMO_DATE — create a shared DEMO_DATE constant in
      domain.ts. Replace `new Date("2026-05-31")` in
      ExplorerView, CostToDisputeView, TimelinePressureView, and
      `new Date()` in disputeReadinessFor. All date comparisons
      use the same reference.
- [x] Extract shared logic to domain.ts — move readableOutcome
      (3 copies), evidenceCategoryFor (2 copies), WIN_PROB (2
      copies), EvidenceCategory type (2 copies), and DEMO_DATE
      (3 copies) into domain.ts. Single source of truth.
- [x] Delete dead code — removed legacy `.selection-chip` CSS
      (~52 LOC), `.placeholder` CSS (~20 LOC), and 16 screenshot/
      verification scripts (~1,200 LOC).

### Phase E: Friend preview + feedback

- [ ] Friend preview — hand off for feedback.
- [ ] Incorporate feedback.

### Phase F: Post-feedback polish (do only if needed)

Prioritize based on friend feedback. Don't do preemptively.

- [x] CSS custom properties — promote 8+ hardcoded hex values
      (#F1F2F4, #eef0f2, etc.) to :root custom properties.
- [x] CSS pattern consolidation — extract shared table, section,
      button, and tab patterns into App.css. ~465 LOC reduction.
- [x] Keyboard accessibility — add tabIndex, role, onKeyDown to
      Sankey interactive elements and sortable table headers.
- [x] Domain logic tests — cover disputeReadinessFor,
      buildSankeyData, isOnSelectedPath, computeKpis.
- [x] Performance — hoist O(n²) totalDollars in
      OriginClusteringView, add useMemo to computeKpis in App.tsx,
      eliminate duplicate clustersFor() call, use pre-computed
      highlightedNodeSet for O(1) node highlight.

---

## Decomposition: Narrative chapter restructure

Goal: Transform the flat 16-section scroll into 4 narrative
chapters with persistent Sankey/KPIs and cross-chapter navigation.

### Phase A — Clear the path (all independent, < 30 min each)

- [x] **A1: Remove vestigial bottom tables**
    - Depends on: none
    - Delete the 3 `<section className="break">` blocks in App.tsx
      (by-type, by-retailer, by-distributor tables) and the
      `byRetailer` / `byDistributor` derived values, `byType` /
      `byChannel` useMemos, and `aggregateByType` /
      `aggregateByRetailer` functions they depend on.
    - Done when: `npm run build` passes, dev server renders with
      no bottom tables, zero console errors.

- [x] **A2: Rename sankey/data.ts → domain.ts**
    - Depends on: none
    - Move `frontend/src/sankey/data.ts` →
      `frontend/src/sankey/domain.ts`. Update imports in 10 files:
      App.tsx, SankeyView.tsx, ExplorerView.tsx,
      CausationTraceView.tsx, CohortTableView.tsx,
      RecoverySimulationView.tsx, CostToDisputeView.tsx,
      DisputeBuilderView.tsx, TimelinePressureView.tsx,
      PostAuditRiskView.tsx, OriginClusteringView.tsx.
    - Done when: `npm run build` passes, all imports resolve.

- [x] **A3: Extract App.tsx inline components**
    - Depends on: A1 (so the extracted code matches the cleaned-up
      state, not the pre-deletion state)
    - Pull into separate files:
      `Kpi.tsx`, `CohortBar.tsx`, `TimeRangeSelector.tsx`,
      `computeKpis.ts` (if aggregation functions survive A1).
    - App.tsx after extraction should be: data loading, state,
      layout, and view rendering — no business logic functions or
      standalone UI components.
    - Done when: `npm run build` passes, App.tsx < 300 lines,
      dev server renders identically.

### Phase B — Narrative chapters (sequential)

- [x] **B1: Add chapter state + ChapterNav component**
    - Depends on: A3
    - Add `activeChapter: 1|2|3|4` state to App.tsx (default 1).
      Create `ChapterNav.tsx` — a tab bar with 4 labeled tabs:
      "The Problem" / "Why This Happens" / "The Evidence Gap" /
      "What to Do About It". Render it below the persistent header
      (KPIs + filters + cohort bar), above the view area.
      Clicking a tab sets activeChapter. No conditional rendering
      yet — all views still render below.
    - Done when: tab bar renders, clicking tabs changes the active
      state (visible via active-tab styling), all existing views
      still render below, `npm run build` passes.

- [x] **B2: Group views into 4 chapters**
    - Depends on: B1
    - Wrap view groups in conditional blocks keyed on
      activeChapter. The persistent header (Sankey, KPIs, filters,
      cohort bar) stays outside the conditional — always visible.
      Chapter contents:
        - Ch1: CohortTableView (Sankey is persistent, not in a
          chapter)
        - Ch2: ExplorerView + CausationTraceView +
          OriginClusteringView
        - Ch3: DisputeBuilderView + PostAuditRiskView +
          RetailerScorecardView
        - Ch4: RecoverySimulationView + CostToDisputeView +
          TimelinePressureView
    - Done when: each tab shows only its chapter's views, all 10
      views accessible across the 4 tabs, selection/filter state
      persists across tab switches, `npm run build` passes.

- [x] **B3: Wire cross-links to switch chapters**
    - Depends on: B2
    - When `tracedDeductionId` is set from a view outside Ch2
      (CostToDisputeView in Ch4, DisputeBuilderView in Ch3,
      TimelinePressureView in Ch4, PostAuditRiskView in Ch3),
      also set activeChapter to 2 so the trace view is visible.
    - When `focusedDeductionId` is set from CohortTableView
      (Ch1), also set activeChapter to 2 so the explorer is
      visible.
    - Approach: wrap `setTracedDeductionId` and
      `setFocusedDeductionId` in helper functions that also set
      the chapter, then pass those helpers as the `onTrace` /
      `onSelectDeduction` props.
    - Done when: clicking "Trace →" from cost-to-dispute (Ch4)
      switches to Ch2 and shows the trace; clicking a row in the
      cohort table (Ch1) switches to Ch2 and shows the explorer
      focused on that deduction; `npm run build` passes.

- [x] **B4: End-to-end verification + responsive + deploy**
    - Depends on: B3
    - Walk every filter path: dropdown → Sankey click → scorecard
      filter → origin filter → time range. Confirm KPIs, cohort
      bar, and Sankey update across all chapters.
    - Walk every cross-link: Trace → from Ch3 and Ch4, cohort
      table row from Ch1, explorer Trace → within Ch2.
    - Responsive check at 768 / 1366 / 1680 — chapter nav must
      not overflow or stack poorly.
    - Deploy to Cloudflare Pages.
    - Done when: all cross-links land on the correct chapter,
      all filters compose across chapters, responsive at 3
      viewports, live on Cloudflare Pages, zero console errors.

---

## Out of scope for this arc

- Live backend / API
- Client data upload functionality
- Real dispute submission workflows
- User authentication
- Mobile-first design (responsive is fine, not required)
- Adding new views — the problem is too many sections, not too few
- React Router or URL-based routing — four chapters with local state
- Guided tour or onboarding overlay — the narrative structure should
  make the tool self-explanatory

## Definition of done for this arc

- [x] Demo opens to Chapter 1 (The Problem) — Sankey + KPIs only
- [x] CEO can navigate forward through 4 chapters that tell the
      five-failure story in sequence
- [x] Cross-links between views switch chapters automatically
- [x] Sankey, KPIs, filters, and cohort bar stay persistent across
      all chapters
- [x] No view is lost — all 10 features are accessible, just
      organized into chapters instead of a flat scroll
- [x] Responsive at iPad / MacBook / wide viewports
- [x] Deployed to Cloudflare Pages
- [x] No data discrepancies between views (WIN_PROB, dates)
- [x] Shared domain logic in one place (no duplicated functions)
- [ ] Friend has previewed and given feedback
- [ ] Feedback incorporated

---

## Arc history

When an arc completes, archive its goal, completion date, and outcome
here. Then start a new arc above. Provides continuity without bloating
the active plan.

### Arc 1: Build the demo (2025-05-07 → 2026-05-13)
**Goal:** Build the extended synthetic dataset and deliver all ten
interactive features in a deployable React app consuming static JSON.
**Outcome:** Functionally complete. All 10 views built and connected,
synthetic dataset validated (3,333 deductions, $1.4M, 36 checks pass),
deployed to Cloudflare Pages. Friend preview still pending. Audit
(2026-05-15) found the demo has five unique capabilities in a 15-tool
competitive landscape — but the flat 16-section scroll hides them.
Arc 2 addresses this.

---

## Improvement History

### 2026-09-23 — Audit (health check only)
- **Findings:** 1 critical, 4 important, 4 nice-to-have
- **Top concerns:** client_mode.py prints a false 0.0% recovery rate (and a headline Recovered of $0) when a ledger has `recovered_amount` but no `dispute_filed` column, while the by-retailer table shows the real recovered dollars; rows with recovered dollars but a blank dispute_filed are likewise dropped from the total but kept per retailer. frontend/package.json `deploy`/`preview` still run `wrangler deploy` (the Worker path that left the live site ~2 months stale), and CI deploys without running the full 72-test Vitest suite or lint (eslint currently fails: 31 errors, 23 in SankeyView.tsx). HANDOFF.md last entry 2026-07-18 with ~27 commits since (client mode, canon gate, golden lock, Pages fix); PLAN.md arc and DECISIONS.md do not reflect that work.
- **Nice-to-have:** README says 59 tests (actual 72) and calls data/ a SQLite database (Postgres is SSOT); requirements.txt omits pytest and lailara_engagement; loose root files (plan-revision.md, test_client_mode.py outside tests/); summary.json by_outcome `dollar` is recovered dollars, not deduction dollars.
- **Checks run:** Vitest 72/72 pass; pytest 34/34 pass; tsc -b clean; eslint 31 errors; canonical drift gate clean; engagement guard clean; no secrets found (.env.example uses the default local placeholder). Manual security/code-quality/data-correctness pass replaced /security-review, /ce:review and data-science-reviewer.
- **Action taken:** Audit only — no fixes this session
- **Next review:** 2026-12-22
