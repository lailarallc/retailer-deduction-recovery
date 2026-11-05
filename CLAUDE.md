## Design System

Read `../lailara-design-system/LAILARA_DESIGN_SYSTEM.md` before any visual work — colors, typography, layout, components, charts, voice, interactions. It is the single source of truth.

---
# Retailer Deduction Recovery — Project Context for Claude

## What this project is

An interactive React demo that makes retailer deduction losses visible
and actionable for a specialty food manufacturer (Cinderhaven Provisions,
a fictional stand-in modeled on a real prospect). The tool takes a
backlog of unresolved deductions and traces each one through five
compounding failures — no visibility into the full picture, process
gaps generating avoidable deductions, weak evidence, inaccessible
records, and missed dispute windows — showing what's recoverable,
what's preventable, and what each operational fix is worth. Dual
purpose: working demo for a specific prospect introduction (via
friend referral) and portfolio showcase for future clients. The
prospect's CEO likes playing with data, so the tool must be
interactive and explorable, not a static report.

**Business question this project answers:** Cinderhaven has outgrown
its ability to manage retailer deductions. This project makes visible
the five compounding failures — no visibility, process gaps, weak
evidence, inaccessible records, and missed dispute windows — and
shows what each one is costing them and what it takes to fix it.

## Stack and tools

- Data source: Fly.io Postgres (cinderhaven-data-platform dbt project,
  app `cinderhaven-db`)
- Data pipeline: Python export script reads Postgres via flyctl proxy,
  writes static JSON
- Frontend: React + HTML
- Deployment: Cloudflare Pages
- No live backend — React app consumes pre-built JSON files

## Data architecture

The cinderhaven-data-platform repo is the single source of truth
(SSOT). It runs a dbt project against Fly.io Postgres (app
`cinderhaven-db`) with channel-isolated pipelines (retailer,
distributor, DTC) and cross-channel intermediate views.

This repo consumes the Postgres database via `scripts/20_export_json.py`,
which reads from the `int_all_*` intermediate views and `stg_retailer_*`
staging tables, then writes three JSON files to `frontend/public/json/`.

The SQLite file at `data/cinderhaven_deductions.db` is a stale
reference copy from an earlier pipeline — it is NOT the SSOT and
does not reflect the current dataset.

To re-export JSON from Postgres:
1. `flyctl proxy 5432:5432 -a cinderhaven-db`
2. `set POSTGRES_PASSWORD=<password from cinderhaven-data-platform/.env>`
3. `python scripts/20_export_json.py`
4. `python scripts/21_validate_dataset.py`

## Features (all ship in V1)

1. **Sankey flow** — all deductions enter at top, split through branch
   points (deduction type → root cause → evidence quality → evidence
   accessibility → dispute timeliness → outcome). Full view on landing,
   zoom into a path on click. Connected to all other views.
2. **Deduction explorer** — six-layer drill-down (the deduction itself,
   visibility/pattern, root cause, evidence quality, evidence
   accessibility, timeliness)
3. **Causation tracing** — follow a single order from label → short
   count → deduction → failed dispute
4. **Recovery simulation** — toggle operational and administrative
   fixes on/off, watch the entire portfolio shift in real time
5. **Cost-to-dispute profitability filter** — is this deduction worth
   fighting given the labor cost to dispute it
6. **Dispute builder** — evidence readiness view (what exists vs.
   what's needed), not a full CMS
7. **Timeline pressure** — deductions mapped against retailer-specific
   dispute deadlines
8. **Post-audit risk exposure** — based on current evidence gaps, what's
   vulnerable to retroactive clawback in a retailer audit
9. **Retailer scorecard** — who deducts most, who accepts disputes,
   deadline strictness, deduction patterns
10. **Root cause clustering by origin point** — which warehouse, line,
    carrier, or system is generating deductions

## Design principles

- One tool with connected views, not separate pages. Click a deduction
  in the explorer → causation trace loads → one click to recovery
  simulation with that gap pre-selected. Data flows through the tool
  the way the problem flows through the business.
- Cost of gaps is discoverable through exploration, not lectured.
  The numbers are present in the causation trace and simulations,
  but the headline is the story of what happened to the order.
- Interactive enough for a data-curious CEO to explore on their own
  without a walkthrough.
- Charts readable by non-data-scientist, non-researcher audiences.

## The five compounding failures (narrative structure)

1. **Visibility** — no one sees the full picture, just individual
   shocks ("The national mass retailer deducted $36k"). No dashboards, no trending, no
   categorization. All reactive and episodic.
2. **Root cause / process gaps** — noncompliant labels (one generic
   label missing required fields instead of retailer-specific
   compliant labels), no pack verification, EDI requirements not
   followed (case labels, pack labels), pallet noncompliance.
3. **Evidence quality** — documentation is handwritten notes ("order
   #X was packed and sent on Y date"), not digital records with
   compliant label scans, signed PODs, or pack verification logs.
4. **Evidence accessibility** — even finding the paper and
   cross-referencing handwritten notes to order numbers, ship dates,
   and system records is a massive time sink.
5. **Timeliness** — lean staff + time-consuming evidence retrieval =
   disputes miss retailer deadlines, turning winnable claims into
   automatic losses.

Each compounds the next. Bad labels create more deductions, which
overwhelm a lean team, which means late disputes, which means even
the ones with decent evidence get rejected on timing.

## Deduction taxonomy

- Short ship (real or perceived — often perceived due to improper
  labels causing hand counts or estimates at receiving)
- Labeling noncompliance fines (wrong format, missing required fields,
  can't be scanned)
- Pallet/shipping material noncompliance
- Damaged product
- Late delivery penalties
- Promo disputes (retailer claims wrong promo, wrong amount, or
  promo not running at time of claim)
- Vague/undecodable deductions ("Code 99: Miscellaneous", "promo
  -$4k" with no PO or time period reference)

## Cinderhaven context

- ~$25M specialty food brand, 50 SKUs, five product lines (Artisan Sauces, Pantry Staples, Specialty Condiments, Dried Goods, Snack Bites)
- Retailers: Walmart, Costco, Whole Foods, regional chains,
  UNFI/KeHE distribution, DTC
- Company has focused energy on growth and outgrown its capacity to
  handle deductions at scale
- Staff is very lean — disputes happen whenever someone can get to
  them, not systematically
- Company uses one generic label across all retailers instead of
  retailer-specific compliant labels
- No digital pack verification — evidence is handwritten paper notes
- Remittances arrive via mix of EDI, portals, paper checks depending
  on retailer
- Deductions are currently treated as "just how it is" rather than
  as a fixable operational problem

## V2 (out of scope for this build)

- Live backend with client data upload
- Real dispute submission workflow
- This may become a client deliverable, not just a demo

## Project files

- CLAUDE.md (this file) — permanent rules and facts
- DECISIONS.md — durable choices and reasoning
- HANDOFF.md — current session state
- PLAN.md — current work arc
- FAILURES.md — things tried that didn't work

Read PLAN.md and HANDOFF.md at session start. DECISIONS.md and
FAILURES.md as relevant.

## Voice and standards

- Economist style for written deliverables: sober, declarative,
  data-forward
- No marketing voice or consultant filler ("leverage," "synergy,"
  "best-in-class," "unlock," "drive value")
- No hedging that softens a real finding
- Charts must be readable by non-data-scientist, non-researcher
  audiences
- UI copy should be plain, direct, industry-appropriate — not
  software-marketing speak

## Rules

### Honesty and judgment

- Say "I don't know" or "I can't verify this" instead of guessing.
  This applies to industry context, technical claims, what code did,
  and anything else.
- Tell me what I need to hear, not what I want to hear. If a decision
  looks wrong, say so. If code I wrote has problems, say so. Honest
  assessment, not validation.
- If a rule in this file is too vague to verify whether you're
  following it, flag it for revision rather than guessing at compliance.

### Building and proposing

- No speculative abstractions. If something isn't needed right now,
  don't build it. Helper functions get added when called by real code,
  not in anticipation. Parameters get added when there's a second use
  case, not the first.
- When proposing a tool, library, or approach, present at least two
  alternatives with tradeoffs, even if one is clearly preferred. Do
  not propose a single solution and move on. The default failure mode
  is taking the route with less friction instead of the route that
  best fits the project — challenge yourself before proposing.
- Tie proposals back to the business question this project is
  answering. If you can't connect a proposal to that question, the
  proposal is probably fluff and should be reconsidered.

### How to work the project

- Work in vertical slices, not horizontal phases. Build one section
  end-to-end (data → export → React component → connected views)
  before moving to the next.
- Do not start tasks outside the current PLAN.md arc without flagging
  it to the user first.
- Do not refactor unrelated code unprompted.
- Do not rename things unless asked.

## Working with PLAN.md

PLAN.md defines the current arc of work. Read it at session start.

- Mark tasks complete as they're finished, in the same commit as the
  work
- If a task is wrong-sized, in the wrong order, or no longer relevant,
  flag it rather than silently restructuring
- "Out of scope" items are decisions, not suggestions — do not pull
  them into the current arc without explicit user approval

## Session reminders

### Reminding the user to /log

Prompt the user to run /log when:

- A meaningful change just landed (file written, bug fixed, feature
  added, decision made)
- A natural pause point is reached (about to switch tasks, finished a
  chunk of work)
- Roughly 30-45 minutes have passed since the last /log and real work
  has happened since then

Format as a clearly separated note. Do not nag — one suggestion per
trigger.

### Reminding the user to /wrap

Prompt the user to run /wrap when:

- Context usage crosses 65%
- The user says anything that suggests they're stopping
- A natural milestone is reached
- 90+ minutes have passed and work is winding down

Format as a clearly separated note. Do not nag.

### Session start protocol

1. Read CLAUDE.md, PLAN.md, and HANDOFF.md
2. If HANDOFF.md's most recent entry is more than 24 hours old AND
   there are uncommitted changes, flag this — the previous session
   may have ended without /wrap
3. Briefly state the starting point from HANDOFF.md so the user
   confirms you're caught up
4. Confirm the current PLAN.md arc is still active

## Defaults

- Default to flagging gaps rather than filling with plausible-sounding
  but unverified content
- Default to short responses unless the task is substantive
- Default to asking before promoting a log entry to a DECISIONS.md
  entry
- Default to answering, not offering to answer

Never write secrets, tokens, or passwords into tracked files, READMEs, or commit messages — use environment variables and secret stores only.
