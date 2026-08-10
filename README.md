# Retailer Deduction Recovery

An interactive tool that traces a specialty food manufacturer's retailer deductions through five compounding operational failures — and shows what is recoverable, what is preventable, and what each fix is worth.

**Live:** https://deductions.lailarallc.com

## What it does

Cinderhaven Provisions is a fictional ~$25M specialty food brand selling through Walmart, Costco, Whole Foods, UNFI, KeHE, and regional chains. The company has outgrown its ability to manage retailer deductions at scale: staff is lean, disputes happen whenever someone can get to them, and deductions are treated as a cost of doing business.

This tool takes a $1.35M backlog across 16,917 deductions and makes the problem visible. It traces each deduction from its type through root cause, evidence quality, evidence accessibility, and dispute timeliness to its outcome — the five compounding failures: no visibility, process gaps, weak evidence, inaccessible records, and missed dispute windows.

Ten connected views are organized into four narrative chapters: **The Problem** (Sankey flow and KPIs), **Why This Happens** (explorer, causation trace, origin clustering), **The Evidence Gap** (dispute builder, post-audit risk, retailer scorecard), and **What to Do About It** (recovery simulation, cost-to-dispute triage, timeline pressure). All ten views share a single selection state — click a Sankey band, pick a deduction type, or filter by retailer, and every view updates from the same cohort.

| View | What it shows |
|---|---|
| Sankey flow | All deductions split by type, dispute readiness, and outcome; click to zoom |
| Deduction explorer | Six-card drill-down: the deduction, peer context, root cause, evidence quality, accessibility, timeliness |
| Causation trace | One order's chronological chain: PO, pack, ship, delivery, deduction, dispute, outcome |
| Recovery simulation | Toggle five operational fixes on/off; with five evidence-quality fixes, recovery on strong-evidence disputes rises from ~42% to ~65% per disputed dollar |
| Cost-to-dispute triage | Per-deduction expected recovery vs. labour cost; fight / marginal / write-off buckets |
| Dispute builder | Evidence readiness per retailer's rules: what exists, what is missing, what is inferable |
| Timeline pressure | Deductions mapped against retailer-specific dispute deadlines; expired dollar exposure |
| Post-audit risk | Forward-looking clawback exposure by retailer and evidence quality, paired with realized post-audit claims |
| Retailer scorecard | Per-retailer comparison: deduction volume, recovery rate, deadline strictness, patterns |
| Origin clustering | Deductions grouped by carrier, label decision, pack verification, and evidence format |

## Why it matters

In the modeled portfolio, only ~15% of deduction dollars are recovered — not because disputes fail, but because most are never filed. Only ~35% of deductions are ever disputed, and each retailer has its own deadlines, portal workflows, deduction codes, and evidence requirements, so a deduction that sits unexamined for a few weeks quietly becomes unrecoverable.

For an executive, the tool answers the questions that decide whether deduction management is worth staffing: how much of the backlog is actually winnable, which operational fixes move recovery the most, which deductions are worth the labour to fight, and which retailers' behaviour justifies a harder conversation.

## Quick start

```bash
cd frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`. The app loads pre-built JSON from `frontend/public/json/`; no backend or database connection required.

To re-export JSON from Postgres:

```bash
flyctl proxy 5432:5432 -a cinderhaven-db
# in a separate terminal:
python scripts/20_export_json.py
python scripts/21_validate_dataset.py
```

## Tech stack

- **Frontend** — React 19 (Vite), TypeScript, D3 + d3-sankey for the Sankey diagram, custom SVG/HTML for remaining views
- **Data pipeline** — Python export script reads Fly.io Postgres (cinderhaven-data-platform) via flyctl proxy and writes three static JSON files the app consumes (summary, deductions, retailers)
- **Hosting** — Cloudflare Pages (static site, no backend)
- **Testing** — Vitest + React Testing Library (59 unit tests covering domain logic, navigation state, and component rendering)

## Project structure

```
data/               SQLite database and schema docs
research/retailers/ Per-retailer deduction process notes (Walmart, Costco, WFM, UNFI, KeHE, etc.)
scripts/            Python pipeline: JSON export, validation
frontend/
  public/json/      Pre-built JSON consumed by the app
  src/              One directory per view: sankey, explorer, causation,
                    simulation, cost, builder, pressure, audit, scorecard, origin
```

## Data notes

All data is synthetic. Cinderhaven Provisions is a fictional company. Retailer dispute processes, deadlines, and deduction codes are modelled on publicly documented policies but may not reflect current terms.

Data dictionary note: in `summary.json`, `totals.fte_equivalent` is whole-window labor expressed in work-years (`labor_hours` / 2080), not an annual FTE count — the app's FTE KPI annualizes separately (`labor_hours` × 12 / `window.months` / 2080).

**Canonical baseline:** 50 SKUs · 5 product lines (AS·PS·SC·DG·SB) · 6 retailers (Walmart·Costco·Whole Foods·Sprouts·Kroger·Regional Group) · 3 distributors (UNFI·KeHE·DPI Northwest). All 9 trading partners are in scope; Shopify DTC is excluded (no deduction process). Data window: January 2023 to January 2026 (37 calendar months, inclusive — matches the export's `window.months`; annualized figures use ×12/37). The dataset contains 16,917 deductions ($1.35M) across nine deduction types: short ship, labelling noncompliance, pallet noncompliance, damaged product, late delivery, promo disputes, pricing error, spoilage, and slotting (negotiated, non-disputable).

## Client engagement use

The deployed demo above renders the committed Cinderhaven dataset. To analyze a
**client's own deduction ledger** in place — validated, never committed, never
deployed — use client mode (see [INPUT-SPEC.md](INPUT-SPEC.md) for the intake file):

```bash
pip install -e ../engagement-template/lib      # the shared lailara_engagement scaffold
python client_mode.py --config engagement.yml --input client-data/deductions.csv \
    --out client-output [--final]
```

It runs a preflight on the client file: a missing required column (or data that
isn't ready) produces a branded **Data Readiness Report** naming exactly what's
wrong, instead of results. On a clean file it writes, to `client-output/` (gitignored):

- `deduction-recovery-summary.html` — branded, provenance-footed (input SHA-256,
  row counts, `as_of_date`, config hash, validation status), DRAFT-watermarked
  until `--final`. Every dollar figure prints its basis and window; recovery is
  shown on both bases (recovered / all dollars, and recovered / disputed dollars).
- `json/summary.json` — the headline analytics in the app's schema, for an optional
  local build (never deployed).

Client identity, window, basis, and column mapping all come from `engagement.yml`
(copy [`engagement.demo.yml`](engagement.demo.yml)); no client value is hardcoded.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [Lailara LLC](https://lailarallc.com) — data hygiene and analytics consulting for specialty food brands scaling into national retail.
