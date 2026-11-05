# Retailer Deduction Recovery — Handoff Log

Session-by-session state. Updated by /log mid-session and /wrap at
session end.

For durable choices, see DECISIONS.md.
For the current work arc, see PLAN.md.
For things that didn't work, see FAILURES.md.

---

## 2025-05-07 — Project initialized

**Started from:** New project setup. 95% confidence interview
completed in chat.

**Did:** Ran full project interview covering business case, domain
context (five compounding failures: visibility, root cause/process
gaps, evidence quality, evidence accessibility, timeliness),
deduction taxonomy, prospect profile (CEO who likes playing with
data, friend referral, Cinderhaven modeled on real prospect),
technology decisions (React + HTML, static JSON, Netlify), feature
list (ten features including Sankey flow, recovery simulation,
cost-to-dispute filter, post-audit risk exposure, origin point
clustering), and interaction design (connected views, zoom-on-click
Sankey, discoverable cost data). Created CLAUDE.md, DECISIONS.md,
HANDOFF.md, PLAN.md, FAILURES.md, and chat project instructions.
Nine initial decisions captured.

**State:** All workflow docs created and ready to copy into repo.
Repo exists on GitHub (retailer-deduction-recovery). No code yet.
First arc defined in PLAN.md: full build — data extension through
all ten features to deployed demo.

**Next:** Copy workflow files into repo. Begin first PLAN.md task:
research retailer-specific dispute processes, deadlines, portals,
and deduction codes.

---

## 2026-05-07 19:16

**What changed:** Added research/retailers/ notes for Walmart, Costco,
Whole Foods, UNFI, KeHE, Wegmans, Sprouts; checked off first Phase 1
task in PLAN.md.

**Why:** First Phase 1 task. Research grounds the deduction data
schema (next task) in real retailer behavior, with explicit
verification gaps so synthetic-data choices flag confirmed vs.
inferred.

**State:** Seven retailer research files committed (e9534ec) with
citations and verification gaps. whole-foods.md currently includes
Amazon Vendor Central context, but Cinderhaven sells into WFM
directly, not as a 1P Amazon vendor — that file needs Amazon scope
removed before it informs the schema.

**Next:** Trim Amazon Vendor Central content from whole-foods.md
(WFM-only scope); then design the deduction data schema (Phase 1
task 2).

---

## 2026-05-07 19:48

**What changed:** Designed deduction data schema (data/schema.md) —
13 new tables extending cinderhaven-data without replacing the base
chargebacks table; volume target $750K–$1.2M annualized.

**Why:** Phase 1 task 2. Schema feeds the next task (Python data
generation). Decisions and tradeoffs documented in data/schema.md
"Design choices" section.

**State:** Schema spec committed (0e7221a + 6664365). PLAN.md task 2
checked. whole-foods.md trimmed to WFM-only earlier (b8ae067). Base
`chargebacks` table preserved; new tables layer on with order-grain.
No code yet.

**Next:** Phase 1 task 3 — build Python scripts to extend the
cinderhaven-data SQLite database with the new tables. Start with
static seeds (retailers, retailer_rules, deduction_codes,
edi_requirements) before generating orders/shipments/deductions.

---

## 2026-05-07 20:33

**What changed:** End-to-end synthetic deduction dataset built —
orders/pack/ship/deductions/remittances/disputes/post-audit, ~$1.4M
deduction value, 8.6% recovery rate. Six of eight Phase 1 tasks now
complete.

**Why:** Phase 1 tasks 4, 5, 6 (deductions, disputes, pack/ship). Data
is the foundation for the React app's connected views; numbers had to
land in realistic ranges (3-5% of revenue, lots of handwritten
evidence, low recovery) before the demo would tell the right story.

**State:** `python scripts/build_deductions_db.py --force --full`
rebuilds the entire deduction-extended DB end-to-end. Counts: 5,838
orders / 30,127 lines / 5,838 pack_records / 5,838 shipments / 3,333
deductions (incl. 41 post-audit) / 553 remittances / 1,505 disputes /
3,303 dispute_evidence / 41 post_audit_claims. Cinderhaven-data base
tables untouched (90/902/12,507/386). Two Phase 1 tasks remain: JSON
export and dataset validation.

**Next:** Phase 1 task 7 — build the JSON export script that
transforms the SQLite extended DB into the static JSON files the
React app will consume. Then task 8 (validate) before Phase 2 (React
scaffold + Sankey).

---

## 2026-05-07 20:56

**What changed:** Phase 1 complete — JSON export and validator
landed. Three JSON files in data/json/ (summary, deductions,
retailers); 36-check validator passes clean.

**Why:** Closes out the data foundation. Phase 2 needs static JSON
to render against, and the validator gives confidence the
distributions are honest before the demo locks in.

**State:** All eight Phase 1 tasks checked off in PLAN.md. Running
`python scripts/build_deductions_db.py --full` end-to-end now also
exports JSON and runs the validator (36 PASS / 0 WARN / 0 FAIL).
Caught and fixed one bug — post_audit_claims was setting is_vague=1
on non-vague rows. Phase 2 untouched.

**Next:** Phase 2 task 1 — set up React project, build system, and
Netlify deploy config. Frontend will live in a `frontend/` (or
`app/`) subdirectory and consume data/json/ at build time.

---

## 2026-05-07 21:44

**What changed:** Phase 2 complete — Sankey 6-layer flow with
click-to-zoom, color-blind-safe outcome layer, and selection-state
architecture wired through KPIs and tables for connected views.

**Why:** Sankey is the demo's centerpiece. With the selection-state
architecture lifted into App.tsx, every Phase 3 feature view can
plug into the same filter signal without re-architecting.

**State:** Vite + React + TS scaffold under `frontend/`, dev server
runs from `npm run dev`, build passes, Netlify config at root. The
landing page renders 4 KPIs, the Sankey, and by_type / by_retailer
tables. Click any Sankey node or band → KPIs and both tables
recompute from the filtered cohort, the clicked path stays at full
opacity while everything else fades to ~4%. Outcome layer uses
hue-distinct colors so the four lost_* variants are
deuteranopia/protanopia-safe. Playwright screenshot scripts (default
+ clicked) live in `frontend/` for visual verification.

**Next:** Phase 3 task 1 — deduction explorer. Click a single
Sankey node or table row → drill-down panel showing one deduction
with all six layers (the deduction itself, visibility/pattern, root
cause, evidence quality, accessibility, timeliness) plus its order /
shipment / pack record / dispute chain.

---

## 2026-05-07 22:16

**What changed:** Phase 2 polish landed — Economist palette, serif
typography at 18/16/15px minimums, table split into retailer +
distributor, full-bleed Sankey with reversed teal gradient,
simplified outcome colors (red/green/gray), and a deduction-type
dropdown bidirectionally synced with the Sankey selection.

**Why:** Locked in the visual language and interaction pattern
before nine Phase 3 features inherit them. Cheaper to fix the
foundation now than to repaint nine views later.

**State:** Landing page is the centerpiece — KPIs, dropdown filter,
full-bleed Sankey with click-to-zoom, and three tables (by type,
by retailer, by distributor) all driven off a single `selection`
state. Hover and click both work; tables and KPIs recompute from the
filtered cohort. Playwright screenshot scripts in `frontend/`
(default, click, dropdown) verify behavior visually. Phase 3 not
started.

**Next:** Phase 3 task 1 — deduction explorer. Build a six-layer
drill-down view below the Sankey that surfaces, for the currently
selected cohort, the deduction itself / visibility-pattern / root
cause / evidence quality / accessibility / timeliness. Plugs into
the same `selection` state — no architectural change needed.

---

## 2026-05-07 22:40

**What changed:** Deduction explorer landed — 3-column 6-card
drill-down below the Sankey, with prev/next/random nav and
cause-specific prose for each root-cause variant.

**Why:** First Phase 3 feature done. The explorer turns "I see a
red band on the Sankey" into "I'm looking at deduction DED-X, here
is exactly what happened and why" without a context switch.

**State:** ExplorerView reads cohort from the same `selection`
state the Sankey/dropdown share. Cards 1-6 render the deduction
itself, peer-group context, root cause + prose, evidence quality
and missing items, accessibility + retrieval cost, and color-coded
timeliness with outcome. Cohort resets to top whenever the filter
changes. Verified via Playwright that filter → cohort → explorer
all stay in sync; zero console errors.

**Next:** Phase 3 task 2 — causation tracing. Pick a single order
from the explorer (or jump in independently) and walk its full
chain: PO → pack record → label decision → ship → BOL → receiving
→ deduction → dispute attempt → outcome. The explorer shows one
deduction's six layers in parallel; causation tracing shows one
order's life sequentially.

---

## 2026-05-07 22:43 — /wrap

**Started from:** Project just initialized, no code or data.

**Did:** Built end-to-end. Phase 1 (research, schema, generation
pipeline, JSON export, validator) → Phase 2 (Vite/React/TS scaffold,
d3-sankey 6-layer flow, click-to-zoom, Economist palette + serif
typography, dropdown filter, retailer/distributor table split,
selection-state architecture wiring KPIs and tables) → Phase 3 task 1
(deduction explorer with 3-col 6-card drill-down, prev/next/random
nav, root-cause prose).

**State:** Local DB rebuildable end-to-end via
`python scripts/build_deductions_db.py --full` (36 PASS / 0 FAIL).
React app at http://localhost:5173/: KPIs / dropdown / Sankey /
explorer / 3 tables, all driven off a single `selection` state.
Origin/master fast-forwarded with ~25 commits since init. Phases 1
and 2 done; Phase 3 task 1 done; 8 Phase 3 features remaining.

**Next:** Phase 3 task 2 — causation tracing. Sequential timeline
of one order: PO → pack → label decision → ship → BOL → receiving
→ deduction → dispute → outcome. Likely a new component (different
framing than the explorer's parallel cards); plug into the same
`selection` state. Source data already in JSON.

---

## 2026-05-08 11:24

**What changed:** Phase 3 task 2 — causation tracing landed.
`CausationTraceView` renders a chronological PO → pack → ship →
delivery → deduction → dispute → outcome timeline with severity-colored
markers; explorer gets a "Trace this order →" button that drives it.

**Why:** Second Phase 3 feature. The explorer surfaces one
deduction's six failure layers in parallel; the trace shows the same
order's story chronologically — what happened, in what sequence, and
where it broke down. Same connected-views wiring as the rest of the
app.

**State:** `tracedDeductionId` lifted into App.tsx alongside the
existing Sankey `selection` filter. ExplorerView's "Trace this order →"
button sets it; trace section auto-scrolls into view, runs its own
prev/next/random over the current cohort, resets when the cohort drops
the anchor. Standard chains render 7 timeline events with red/gold/green
dots and per-step failure flags; post-audit clawbacks get a parallel
3-event audit-period path. `frontend/screenshot-trace.mjs` verifies the
flow end to end — zero JS errors. Build passes (`npm run build`).
PLAN.md Phase 3 task 2 checked off in the same commit. 7 Phase 3
features remaining.

**Next:** Phase 3 task 3 — recovery simulation. Toggle operational
and administrative fixes (compliant labels, digital pack verification,
faster evidence retrieval, on-time dispute filing) on/off and watch
portfolio-wide recovery rate and dollar amounts shift in real time.
Plugs into the same `selection` cohort.

---

## 2026-05-08 11:42

**What changed:** Phase 3 task 3 — recovery simulation landed.
`RecoverySimulationView` presents five fix toggles with solo-impact
previews and a live current-vs-projected comparison panel against the
selection-filtered cohort.

**Why:** Third Phase 3 feature. Lets a CEO turn fixes on and off and
watch the portfolio shift in real time, so the cost of each gap
becomes discoverable through play instead of lectured.

**State:** Five toggles (compliant labels, digital pack verification,
systematic filing, deadline tracking, EDI/ASN compliance). Elimination
rules per toggle remove deductions upstream; evidence-quality-keyed
win-probability table (digital_complete 65% / digital_partial 35% /
handwritten 12% / none 5%) re-models surviving disputes whose path
actually changed — untouched disputes keep their actual recovered
amount. With all toggles on against the $1.33M portfolio: 1,650
deductions prevented, recovery rate 7.4% → 64.6%, net loss $1.23M →
$308K, $924K saved. Toggles are local view state; cohort comes from
App.tsx selection. `screenshot-sim.mjs` verifies behavior — zero JS
errors. Build passes. PLAN.md Phase 3 task 3 checked off. 6 Phase 3
features remaining.

**Next:** Phase 3 task 4 — cost-to-dispute profitability filter.
Compute per-deduction whether the labor cost of disputing exceeds the
expected recovery; surface the threshold, the deductions on each side
of it, and how the line moves as evidence quality and dispute method
change. Plugs into the same `selection` cohort.

---

## 2026-05-08 12:01

**What changed:** Phase 3 task 4 — cost-to-dispute profitability
filter landed. `CostToDisputeView` triages each unresolved deduction
into fight / marginal / write off using per-deduction expected
recovery against estimated labor cost.

**Why:** Fourth Phase 3 feature. The triage view answers the practical
"is this one worth my Tuesday afternoon?" question that turns a $1.4M
backlog into a stack a lean team can actually work.

**State:** Adjustable hourly-rate slider ($20–$100, default $42) and a
"project with digital evidence" toggle drive a live re-bucketing.
Win-probability table matches the simulation (digital_complete 65% /
digital_partial 35% / handwritten 12% / none 0% / past-deadline 0%);
labor hours by evidence quality (1.5 / 3 / 5 hr). Selectable bucket
cards drive a top-25 table sorted by EV (or by amount for write-offs)
with a "Trace →" cross-link to the causation view. Default $42/hr
across the portfolio: 110 fight ($160K, $33K expected for $13K labor),
27 marginal, 2,839 write-off ($1.04M unrecoverable); digital projection
flips this to 1,884 fight ($1.01M) / 616 write-off ($157K).
`screenshot-cost.mjs` verifies — zero JS errors. Build passes. PLAN.md
Phase 3 task 4 checked off. 5 Phase 3 features remaining.

**Next:** Phase 3 task 5 — dispute builder. Evidence-readiness view
showing what exists vs. what's needed for a single deduction, with a
mock dispute package preview (BOL / POD / packing list / promo
agreement / etc., flagged "have it" / "missing" / "lost"). Plugs into
the existing tracedDeductionId so the user can hop from triage to
dispute prep on one click.

---

## 2026-05-08 12:28

**What changed:** Phase 3 task 5 — dispute builder landed.
`DisputeBuilderView` assesses each required evidence item from the
retailer rules against Cinderhaven's actual records, scores per-
deduction readiness, and previews a mock dispute package.

**Why:** Fifth Phase 3 feature. Makes the "you don't have what you
need" problem concrete and retailer-specific — gap analysis driven
by the rules already encoded in `retailers.json`, not generic.

**State:** App.tsx now loads retailers.json alongside summary +
deductions. Per-requirement status of have_digital / have_paper /
inferable / missing produces ready / needs work / not disputable
buckets. Across the full portfolio: 334 ready / 1,533 needs work /
1,462 not disputable. Filter tabs, prev/next/random nav, two-column
requirements + mock package layout naming the retailer's portal.
Builder syncs to external `tracedDeductionId` so clicking "Trace →"
in the cost view also pivots the builder to that deduction (verified
via Playwright). "View causation trace →" cross-link pushes the
builder's current selection to the trace view. `screenshot-builder.mjs`
green; zero JS errors. Build passes. PLAN.md Phase 3 task 5 checked
off. 4 Phase 3 features remaining (timeline pressure, post-audit risk,
retailer scorecard, origin clustering).

**Next:** Phase 3 task 6 — timeline pressure view. Map each
unresolved deduction against its retailer-specific dispute deadline,
showing what's still in window, what's expiring inside the lean
team's realistic working capacity, and what's already past deadline
(auto-loss). Plugs into the same selection-filtered cohort.

---

## 2026-05-08 12:40

**What changed:** Phase 3 task 6 — timeline pressure view landed.
`TimelinePressureView` buckets unfiled, unresolved deductions by
days-to-deadline and pairs the result with an evidence-quality
cross-tab so the compounding story of the fifth failure shows up at
a glance.

**Why:** Sixth Phase 3 feature. Makes the timeliness compounding
failure concrete: a lean team running paper records loses winnable
deductions to the clock, and the dollars already gone are visible.

**State:** Five bucket tiles (Critical ≤7d / Expiring 8–30d / Active
>30d / Expired / No deadline) clickable to filter the urgent-list
table; days-to-deadline computed against TODAY (2026-05-31). Cross-
tab grid (bucket × digital/paper/missing) highlights compounding
cells (urgent + paper or missing) in red. Top-25 urgent list ordered
by days-remaining ascending, with Trace cross-link. Full-portfolio
read: 9 critical / 43 expiring / 438 active / 475 expired ($144K
already lost) / 860 no-deadline. `screenshot-pressure.mjs` green;
zero JS errors. Build passes. PLAN.md Phase 3 task 6 checked off.
3 Phase 3 features remaining (post-audit risk, retailer scorecard,
origin clustering).

**Next:** Phase 3 task 7 — post-audit risk exposure. Score each
deduction's vulnerability to a retroactive retailer-audit clawback
based on current evidence gaps. Surface dollar exposure by retailer,
deduction type, and evidence quality, and contrast against the
post-audit deductions already in the dataset.

---

## 2026-05-08 13:00

**What changed:** Phase 3 task 7 — post-audit risk exposure landed.
`PostAuditRiskView` runs an evidence-quality clawback model over
forward-looking deductions and pairs it with the 37 realized
post-audit claims already in the dataset.

**Why:** Seventh Phase 3 feature. Names the hidden threat — money
the supplier thought was settled — and ties the exposure number to
the same digital-pack lever the simulation surfaces.

**State:** Headline tile: $714K exposure (62.2% of $1.15M forward
portfolio); digital-evidence projection drops it to $115K, a $600K
reduction. Realized panel: 37 claims / $183K / avg 18.9-month
lookback / top auditor Audit Partners Limited at $87K. Retailer
breakdown merges forward exposure with realized claims — national mass retailer
$324K exposed, 14 historical claims already taken; distributor A $135K, 10
claims; distributor B $87K, 7 claims; club retailer $35K, 6 claims; natural grocer
$68K with no realized claims yet. Hardcoded retailer audit profiles
explain why. Evidence breakdown: $535K paper exposure, $174K missing
exposure, only $5K digital exposure. Trace cross-link on top-10
realized claims. `screenshot-audit.mjs` green; zero JS errors. Build
passes. PLAN.md Phase 3 task 7 checked off. 2 Phase 3 features
remaining (retailer scorecard, origin clustering).

**Next:** Phase 3 task 8 — retailer scorecard. Per-retailer view of
deduction patterns, dispute acceptance rates, deadline strictness,
deduction-type mix, and aggressiveness. Plugs into the same cohort.
Pull together the retailer-side numbers that have been ambient
across other views into one comparable scorecard.

---

## 2026-05-08 13:14

**What changed:** Phase 3 task 8 — retailer scorecard landed.
`RetailerScorecardView` renders per-retailer cards with net loss,
six metric tiles, and a behavioral profile; the per-card "Filter →"
button writes a new retailer-kind selection that drives the rest of
the app.

**Why:** Eighth Phase 3 feature. Pulls the retailer-side numbers
that were ambient across other views into one comparable scorecard
so Walmart-vs-UNFI-vs-KeHE differences read at a glance.

**State:** 10 cards in the full portfolio. Default-sort top three:
national mass retailer $557K / distributor A $227K / distributor B $159K. Sort selector toggles
net-loss / volume / recovery-rate. Selection union extended in
sankey/data.ts with `kind: "retailer"`; isOnSelectedPath and
selectionLabel updated; App.tsx looks up the retailer name for the
filter chip and special-cases the scorecard cohort so retailer
filters don't collapse the comparative view (other filter kinds
still rescope the cards — verified). screenshot-scorecard.mjs
green; zero JS errors. Build passes. PLAN.md Phase 3 task 8 checked
off. 1 Phase 3 feature remaining (origin clustering).

**Next:** Phase 3 task 9 — root-cause clustering by origin point.
Group deductions by warehouse / packing line / carrier / system
signal so the user can see which physical or operational origins
are generating the most deductions. Plugs into the existing cohort;
should expose the cluster as another selection kind so the rest of
the app can scope to one origin point.

---

## 2026-05-08 13:23

**What changed:** Phase 3 task 9 — origin clustering landed.
`OriginClusteringView` clusters the cohort across five operational
dimensions and ranks them by concentration so the user can see what
fixes are targeted vs. systemic. **Phase 3 is now complete — all 9
feature views are live.**

**Why:** Last Phase 3 feature. Root-cause clustering names the
operational origins; concentration scores tell the CEO whether the
problem is "mostly Line B" or systemic.

**State:** Default concentrations: Label decision 73.6% Generic,
Pack verification 59.7% paper-note, Evidence format 59.7% paper-note,
Carrier 21% top-of-7, Packer 21% top-of-8. Selection union extended
in sankey/data.ts with `kind: "cluster"` (dimension + value);
ORIGIN_DIMENSIONS is the single source of truth used by the view,
isOnSelectedPath, clusterValueFor, and selectionLabel. Per-cluster
Filter and Trace top → cross-links work; short_ship filter rescopes
concentration scores correctly (Generic jumps to 97.6%). Phase 4
(cross-view nav check, responsive review, Netlify deploy, friend
preview) is the entire remaining arc. `screenshot-origin.mjs` green;
zero JS errors. Build passes. PLAN.md Phase 3 task 9 checked off.

**Next:** Phase 4 task 1 — cross-view navigation check. Walk every
filter / drill-down / trace cross-link end-to-end and verify the
state transitions remain coherent across all 9 feature views. List
any rough edges; fix what's worth fixing before the responsive
check.

---

## 2026-05-08 14:02

**What changed:** Phase 4 polish landed — three bug fixes (sort,
sticky cohort bar, time range filter) plus end-to-end cross-view
nav verification and responsive pass at iPad / laptop / wide.

**Why:** Get the demo presentable before Netlify deploy. The polish
items came from a visual review and the two existing PLAN tasks
gated on them.

**State:** Scorecard sort renamed Recovery rate → Worst recovery
(ASC) so the visible-reorder works (Green Basket Market top, not
Walmart). `CohortBar` replaces the conditional selection-chip —
sticky top:0, always-visible, shows combined filter + time range.
`TimeRangeSelector` added next to the type dropdown (6mo / 1yr /
All + custom from-to). filteredDeductions, kpiCount, byType,
byChannel all gated on "any active filter" so date-range-only
filters propagate. Combined Short-ship + Last 6 mo → 395 / $91K.
Origin tables wrapped in scroll containers and body overflow-x
hidden — iPad portrait was overflowing at 1094px, now matches
viewport. `screenshot-crossview.mjs` and `screenshot-responsive.mjs`
verify; zero JS errors. Build passes. PLAN.md Phase 4 tasks 1 and 2
checked off; task 3 (deploy) and task 4 (friend preview) remain.

**Next:** Phase 4 task 3 — deploy to Netlify. The Netlify config is
already in place (root netlify.toml points the build at
frontend/dist/); confirm `netlify deploy --prod` works against the
linked site, then capture the live URL for the friend preview hand-
off.

---

## 2026-05-08 15:56

**What changed:** Phase 4 task 3 — deployed to Netlify, live at
**https://deductions.lailarallc.com/**. Plus a Sankey
label-contrast fix riding along — dollar amounts on the darker teal
bands now meet WCAG AA contrast.

**Why:** Demo URL ready for friend preview / prospect intro. The
contrast bug surfaced during visual review of the live site —
darkest-teal-band labels had ~2.5 contrast ratio against the gray
ink-faint fill, which is unreadable.

**State:** SankeyView picks each node label's fill by WCAG contrast-
ratio comparison: relative luminance of the band color
(LAYER_COLORS[node.layer]) is computed, then dark-ink vs. white is
chosen by whichever scores higher contrast. Verified per layer via
`verify-sankey-contrast.mjs`: layers 0–2 use ink, layers 3–4 use
white, layer 5 sits in the right margin on white panel and stays
ink. The naive luminance > 0.5 heuristic mis-classifies the medium
teals — confirmed and rejected during testing. Live site bundle
hash matched the local build at deploy time. Build passes. PLAN.md
Phase 4 task 3 checked off with the URL embedded.

**Next:** Phase 4 task 4 — hand off the live URL to friend for
preview, capture feedback, and decide what (if anything) needs
fixing before the prospect intro. After that the original arc is
done.

---

## 2026-05-09 16:45 — /wrap

**Started from:** Spoilage/slotting deduction types had just been
added across the pipeline and all views (commit `e295958`). Phase 4
polish in progress — waiting on peer reviewer feedback.

**Did:** Two things this session:

1. Added plain-language section descriptions to all 10 views.
   `.section-description` class in App.css (15px, `--ink-soft`,
   780px max-width, no container). Exact user-provided copy
   inserted below each h2 in both empty-state and populated-state
   branches. Removed the old `.sankey-sub` italic paragraph
   (superseded by the new Sankey description). Verified via
   Playwright: 10 descriptions rendered, correct computed styles,
   zero JS errors.

2. Cleaned up verification artifacts. Deleted `.claude/launch.json`,
   `screenshot-sankey-top.mjs`, `screenshot-slotting-filter.mjs`
   (commit `5b4dd98`). PNGs were already gitignored — deleted from
   disk only. Confirmed `netlify.toml` already removed,
   `wrangler.jsonc` has SPA routing, DECISIONS.md Cloudflare Pages
   entry already in place.

**State:** Two commits on master ahead of origin: `e295958`
(spoilage/slotting) and `5b4dd98` (artifact cleanup). Not pushed
yet. Build passes. Dev server running on port 5174. All 10 feature
views live with section descriptions. Cloudflare Pages dashboard
configured (root: `frontend`, output: `dist`, build: `npm run
build`). Awaiting peer reviewer feedback before next moves.

**Next:** Push to origin and trigger Cloudflare Pages deploy. Then
Phase 4 task 4 — friend preview handoff. Peer reviewer feedback
may generate additional polish items before that.

---

## 2026-05-15 17:44

**What changed:** Full project audit completed (AUDIT.md). Four phases: baseline assessment, internal review (UX + Architecture), landscape scan (15 tools across 5 categories), and synthesis. Found 5 unique capabilities no competitor offers, hidden by busy 16-section flat scroll. New PLAN.md arc: narrative chapter restructure (Phase A cleanup → Phase B 4-chapter structure → Phase C harden). Archived Arc 1.

**Why:** Demo was ideated before structured workflow. Audit retroactively applies rigor — the "busy" feeling is the #1 internal problem hiding the #1 competitive advantage. Fixing UX IS the strategic move.

**State:** AUDIT.md written with all 4 phases. PLAN.md updated: Arc 1 archived, new arc defined with Phase A (remove tables, rename domain module, extract App.tsx), Phase B (4-chapter narrative navigation), Phase C (tests + friend preview). No code changes yet — this session was analysis only.

**Next:** Phase A task 1 — remove the 3 vestigial bottom tables from App.tsx (lines 288–378). Then rename sankey/data.ts → domain.ts, then extract App.tsx inline components. All < 1 hour.

---

## 2026-05-15 18:09

**What changed:** Phase B complete — 4-chapter narrative navigation implemented (ChapterNav component, conditional chapter rendering, cross-chapter trace/focus links). All verified via dev server.

**Why:** Core deliverable of the narrative restructure arc. Transforms the flat 16-section scroll into 4 guided chapters so the five-failure story reads in sequence instead of overwhelming at once.

**State:** ChapterNav.tsx renders 4 tabs below the persistent header. App.tsx conditionally renders views by activeChapter (Ch1: Cohort, Ch2: Explorer+Causation+Origin, Ch3: Dispute+PostAudit+Scorecard, Ch4: Recovery+Cost+Timeline). Cross-links: Trace from Ch3/Ch4 → Ch2, cohort row from Ch1 → Ch2. Filters persist across tabs. Responsive at 768/1366/1680. Zero console errors. Build passes. Deploy to Cloudflare Pages pending.

**Next:** Deploy updated version to Cloudflare Pages, then Phase C — component tests for navigation state, friend preview, and feedback incorporation.

---

## 2026-05-15 20:26

**What changed:** Fixed Sankey chart bottom clipping with dynamic SVG viewBox height, plus resolved full series of visual regressions on wide viewports. All merged to master via PR #8.

**Why:** d3-sankey barycenter reordering of layer-2 nodes pushes them 260px past the fixed 700px layout extent, clipping the bottom of the chart. A static height increase failed (d3 expands to fill it); dynamic height computed from actual node positions after reordering solves it. Companion fixes: removed overflow-x:hidden that broke full-bleed pattern, constrained text elements on 2560px+ monitors, removed SVG max-width cap.

**State:** SankeyView computes viewBox height from max node Y after reordering (currently 979px). Full-bleed SVG fills viewport width; text elements capped at 1044px. PR #8 merged to master — Cloudflare Pages deploy triggered. Build passes. All 4 chapters render correctly. Phase B complete; Phase C (tests + friend preview) untouched.

**Next:** Phase C — component tests for chapter navigation state, friend preview handoff, and feedback incorporation.

---

## 2026-05-16 15:39

**What changed:** Full project audit (Phase 1-4) completed. AUDIT.md rewritten with current baseline, internal review (1 bug: WIN_PROB discrepancy, 4 important issues), updated landscape scan (Glimpse $35M raise, HighRadius AI additions, 5 unique capabilities still unmatched), and ranked next moves. PLAN.md updated: Phase A checked off, Phase D (pre-preview cleanup) added with 4 tasks, Phase E/F defined. Definition of done 7/11 checked.

**Why:** Second audit, one month after the first. The chapter restructure the first audit recommended has landed. This audit assesses the result and identifies the remaining gate to friend preview: two data bugs (WIN_PROB discrepancy, non-deterministic dates) and duplicated business logic across views.

**State:** AUDIT.md has all 4 phases. PLAN.md updated with Phases D/E/F. Build passes, 14 tests pass, 0 vulnerabilities. No code changes this session — analysis only. Competitive position stronger: 5 unique capabilities still unmatched, market validates the space.

**Next:** Phase D task 1 — fix WIN_PROB discrepancy between RecoverySimulationView (0.05) and CostToDisputeView (0.0) for "none" evidence. Extract WIN_PROB into domain.ts.

---

## 2026-05-16 15:51

**What changed:** Phase D (pre-preview cleanup) complete. Extracted WIN_PROB, DEMO_DATE, readableOutcome, evidenceCategoryFor, and EvidenceCategory to domain.ts as single source of truth. Fixed WIN_PROB data bug (CostToDisputeView had 0.0 for "none", should be 0.05). Deleted 16 Playwright scripts (~1,200 LOC) and 72 LOC dead CSS. 26 files changed, +53/−1,408 lines.

**Why:** Pre-preview gate. A data-curious CEO clicking between cost-to-dispute and recovery simulation would see contradictory numbers for the same deduction. Duplicated logic across 6 views was a maintenance hazard and a source of the discrepancy.

**State:** Build passes (305.63KB JS, 44.13KB CSS). 14 tests pass. Zero console errors. All Phase D tasks checked off in PLAN.md. Definition of done: 9/11 items complete — remaining 2 are friend preview and feedback incorporation (Phase E).

**Next:** Phase E — hand off live URL for friend preview and incorporate feedback. Deploy first if the current Cloudflare Pages build is stale.

---

## 2026-05-16 15:55 — /wrap

**Started from:** Audit (Phase 1–4) had just been logged. Phase D (pre-preview cleanup) was defined but unstarted.

**Did:** Executed all 4 Phase D tasks: extracted WIN_PROB/DEMO_DATE/readableOutcome/evidenceCategoryFor/EvidenceCategory to domain.ts, fixed the WIN_PROB 0.0→0.05 data bug, deleted 16 dead Playwright scripts and 72 LOC unused CSS. Committed, logged, pushed, opened PR #15.

**State:** PR #15 open against master (3 commits, −1,253 net lines). Build passes, 14 tests pass, zero console errors. PLAN.md Phases A–D complete. Definition of done 9/11 — remaining 2 are friend preview and feedback (Phase E). Arc is blocked on friend feedback, expected next week.

**Next:** Merge PR #15. When friend feedback arrives, start Phase E — incorporate feedback, then conditionally do Phase F polish items based on what the friend flags.

---

## 2026-05-17 16:10 — /wrap

**Started from:** Data source substantially rebuilt (cinderhaven-data expanded from 3K to 13.5K deductions, $1.5M to $10.8M, 23 to 36 months). Needed to verify app math still holds.

**Did:** Full data-change audit. Fixed FTE annualization bug (showed 12.5 instead of correct 4.2 FTE/year). Updated README numbers. Investigated deduction-to-revenue ratio (16.4%) and promo share (45%) — web research confirmed both are within industry norms for an unmanaged $25M brand.

**State:** App renders correctly with new 13,496-deduction dataset. All views, null guards, KPIs verified. 14 tests pass, TypeScript clean. AUDIT.md rewritten. One commit on worktree branch (06eaa0e). Cloudflare Pages deploy may be stale.

**Next:** Phase E — deploy to Cloudflare Pages if stale, then hand off live URL for friend preview.

---

## 2026-05-17 17:30 — /wrap

**Started from:** Phase D complete, data audit wrapped. Full-project code review requested.

**Did:** 6-agent code review of entire frontend (~9K lines). Fixed 14 findings: enabled strict mode (zero new errors), fixed ExplorerView crash on cohort shrink, fixed addMonthsISO date overflow, fixed KPI annualization with date filters, wrapped computeKpis in useMemo, fixed simulation model null deadline handling, removed dead code, eliminated duplicate formatting/clustering calls, added JSON fetch validation, documented design system deviation.

**State:** All 14 tests pass, TypeScript strict clean, Vite build succeeds, zero console errors. App is review-hardened and ready for friend preview.

**Next:** Hand off to friend for Phase E preview. Highest-value remaining coding work: domain.ts unit tests (P0 testing gap) and verifying brotli compression of 19MB JSON in production.

---

## 2026-05-20 — /wrap

**Started from:** Code review had flagged P0 schema misalignment
(upstream cinderhaven-data changed 15 fields, evidence quality
values, and added pricing_error type). Fixes were in progress.

**Did:**
1. Completed P0 schema alignment — fixed "moderate" evidence
   quality mapping in CostToDisputeView (`inferEvidenceQuality`
   now maps moderate → digital_partial, 224 disputes affected).
   Added pricing_error prose to ExplorerView's `rootCauseProse`.
   Browser audit confirmed zero unmapped evidence values and
   correct Sankey flow conservation.
2. Added 45 domain logic unit tests (Phase F task 4) — covers
   `disputeReadinessFor`, `buildSankeyData`, `isOnSelectedPath`,
   `computeKpis`, `evidenceCategoryFor`, `rootCauseFor`,
   `selectionLabel`, `isOperational`. Suite now 59 tests / 3 files.

**State:** Two commits pushed to origin (`004ae75` schema fix,
`1ca035c` domain tests). 59 tests pass, TypeScript strict clean,
Vite build succeeds (305KB JS, 55KB CSS). Cloudflare Pages should
have auto-deployed from push. PLAN.md Phase F task 4 checked off.

**Next:** Phase E — hand off live URL for friend preview. All
coding work is done. Remaining PLAN.md items: friend preview (E),
3 optional Phase F polish tasks (CSS custom properties, CSS
consolidation, keyboard accessibility) — do only if friend
feedback calls for them.

---

## 2026-05-22 — /wrap

**Started from:** All coding work complete (Phases A–D, 59 tests,
review-hardened). Blocked on friend preview (Phase E).

**Did:** Deploy + housekeeping + data reconciliation. Deployed to
Cloudflare Pages (current). Updated README (chapter nav, Vitest).
Fixed 2 moderate npm vulnerabilities. Updated project health tracker.
Reconciled JSON files against Fly.io Postgres SSOT — exact match on
deductions (15,898), disputes (6,141), all type breakdowns. Committed
JSON so git matches deployed state. Documented Fly.io Postgres as
SSOT in CLAUDE.md and DECISIONS.md; marked local SQLite as stale
reference.

**State:** App live at deductions.lailarallc.com. JSON
reconciled against Postgres. 0 npm vulnerabilities. Documentation
reflects actual data pipeline (Fly.io Postgres, not SQLite). 4
commits pushed to origin. Still blocked on friend preview.

**Next:** Phase E — hand off live URL to friend for preview. No
coding work unless feedback generates it. Phase F polish gated on
feedback.

---

## 2026-06-25 — /wrap

**Started from:** 6-step canonical reconciliation + design system
audit arc defined from prior session. Steps 1–2 already complete
(JSON re-export confirmed, DEMO_DATE replaced with live date).

**Did:**
1. README reconciled against CINDERHAVEN_CANONICAL.md — 9 deviations
   fixed ($1.59M→$1.35M, 22,425→16,917, partner list expanded,
   recovery phrasing corrected, post-audit $974K removed, pipeline
   refs updated, duplicate data contract removed, type list updated,
   footer matched template). Commit `5484699`.
2. Deleted stale AUDIT.md. Commit `8c96246`.
3. Design system audit — read all 14 CSS files against the full
   Lailara Design System spec. Reported 14 deviations categorized
   by severity (5 breaking, 5 drift, 4 cosmetic).
4. Fixed 5 design system violations: Red-42 background fills replaced
   with surface-danger/accent-blue, focus outlines changed from
   accent-red to ink with 2px offset, border-radius added to tags.
   Commit `f6f982a`.
5. Removed 660px max-width from .section-description per user
   direction (design system prose rule doesn't apply to dashboard
   section descriptions). Commit `1387005`.
6. Fixed Sankey not responding to time range filter — SankeyView was
   receiving raw `deductions` instead of `filteredDeductions ??
   deductions`. Every other view already used the filtered array.
   Commit `0069baf`.

All commits pushed and deployed to Cloudflare Pages via manual
terminal deploy (`npx wrangler pages deploy dist
--project-name=retailer-deduction-recovery`).

**State:** App live at deductions.lailarallc.com. Working tree
clean on main, up to date with origin. 59 tests pass. Build clean.
GitHub Actions CI still broken — `CLOUDFLARE_API_TOKEN` secret
expired; manual deploy is the workaround. No other known bugs.

**Next:** Fix expired `CLOUDFLARE_API_TOKEN` in GitHub Actions
(user mentioned "Lailara LLC custom token" but hasn't updated it
yet). Phase E (friend preview) still pending. No other coding work
unless feedback generates it.

---

## 2026-06-26 — /wrap

**Started from:** All coding work complete. App deployed. Blocked on
friend preview (Phase E).

**Did:** Fixed three timeline rendering bugs found via full-dataset
scan of 16,917 deductions: (1) hid trace buttons for chainless
deductions and added CausationTraceView empty state (defensive —
no current data triggers it); (2) post-audit timelines now include
full order chain via shared `buildOrderChainEvents` helper (472
deductions went from 2-3 events to 6-8); (3) resolved disputes with
null `closed_date` now render outcome using `filed_date` as fallback
(308 deductions fixed). Also fixed NOT DISPUTABLE badge to Red-95/
Red-42 per design system. 5 commits pushed, deployed to Cloudflare
Pages.

**State:** App live at deductions.lailarallc.com. All timeline edge
cases fixed. Build passes, zero console errors. Still blocked on
friend preview.

**Next:** Phase E — hand off live URL to friend for preview. No
coding work unless feedback generates it. Phase F polish gated on
feedback.

---

## 2026-06-28 — /wrap

**Started from:** 6-fix batch defined: 3 Phase F polish tasks
(CSS tokens, CSS consolidation, keyboard accessibility), 2
cinderhaven-data-platform pipeline fixes (slotting dispute_deadline,
schema.md targets), 1 reseed/validate/re-export cycle.

**Did:** All 6 fixes committed across both repos. Phase F fully
checked off. Reseeded Fly.io Postgres (2.28M rows), dbt build
(448/457 PASS, 1 calibration error), validator 32 PASS / 0 FAIL,
JSON re-exported. CSS: 487 LOC reduction from consolidation, 47 hex
values promoted to design system tokens, keyboard accessibility
added to Sankey + 6 sortable tables.

**State:** All Phase F tasks complete. JSON matches Fly.io Postgres
SSOT (16,917 deductions). One known issue: dbt test
`assert_dispute_recovery_rates_in_band` needs tolerance widened from
±2pt to ±3pt in cinderhaven-data-platform (separate fix). 6 unpushed
commits on retailer-deduction-recovery, 1 on cinderhaven-data-platform.

**Next:** Phase E — friend preview handoff. All coding/polish work
is done. Remaining PLAN.md items: friend preview + feedback
incorporation. dbt calibration tolerance fix is a separate task.

---

## 2026-07-08 16:26

**What changed:** Removed unused off-brand `frontend/public/icons.svg` (a
Vite scaffold leftover — six social/doc sprite symbols, two with
off-palette `#aa3bff` strokes). Commit `d526524` on `audit-fixes-2026-07`.

**Why:** Same off-brand template source as the favicon replaced in
`f57fdfd`. Verified dead before deleting — no `icons.svg`, symbol-id, or
`<use>`/`xlink:href` reference anywhere in frontend/src, index.html, or
vite config; the footer is plain text. Vite was still copying it into
dist/ on every build, so a design-system-violating asset shipped unused.

**State:** File deleted and committed (1 file, 24 deletions). Working tree
clean on `audit-fixes-2026-07`. Untracked `frontend/dist/icons.svg` is a
gitignored build artifact that clears on the next `vite build`. Not
pushed. Build/tests unaffected by this change.

**Next:** Continue the audit-fixes-2026-07 batch (favicon + icons.svg done
so far); push the branch and open a PR once the audit fixes are complete.

---

## 2026-07-18 — /wrap

**Started from:** Resuming compacted context. Fix 3 (keyboard
accessibility role correction) was edited and verified but not committed.

**Did:** Committed Fix 3 — `role="button"` → `role="columnheader"` on
all 8 sortable `<th>` elements in CohortTableView.tsx. Confirmed Fixes
1 and 2 were already complete from prior commits.

**State:** All Phase F tasks complete. Build passes (310.74KB JS,
54.99KB CSS), 59 tests pass. Deployed to Cloudflare Pages. Working
tree clean on main.

**Next:** Phase E — friend preview handoff. All coding/polish work is
done. Remaining PLAN.md items: friend preview + feedback incorporation.

---
