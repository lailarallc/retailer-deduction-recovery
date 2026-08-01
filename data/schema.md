# Deduction Data Schema

Design for the deduction-tracking tables that extend the
`cinderhaven_product_master.db` SQLite database from the
[cinderhaven-data](https://github.com/MsShawnP/cinderhaven-data) repo.

This document is the design spec; the next task (Phase 1 task 3) is to
implement these tables in Python scripts that run against the cloned
base database.

Sources of truth: research notes under `research/retailers/` for
retailer-specific behavior; the base repo's existing tables for SKU,
store, and chargeback semantics.

---

## Design choices

### Extend, don't replace

The base `chargebacks` table is keyed by `(month, retailer, reason, amount, sku)` — monthly grain, no order or PO reference. Other Cinderhaven portfolio projects likely read it, so we keep it intact. New tables add **order-level granularity** and **dispute/evidence/timeline detail**. The new `deductions` table aggregates to chargebacks-compatible totals; both can coexist.

**Alternative considered:** promote `chargebacks` to the new `deductions` table and rebuild the chargebacks aggregate as a view. **Rejected** because it risks breaking other portfolio consumers and the migration cost outweighs the benefit for V1.

### Order-grain primary keys

Deductions, disputes, evidence, pack records all hang off `orders` and `order_lines`, which the base does not have. POs from retailers to Cinderhaven are the natural unit for causation tracing (label → short count → deduction → failed dispute) — this is feature #3 of the demo.

**Alternative considered:** invoice-grain. **Rejected** because real deduction disputes start with the PO / shipment, not the invoice — Walmart Code 22 ("merchandise billed not shipped") is a comparison between PO/ASN and what receiving counted, not an invoice issue.

### Separate retailer rules table

Dispute deadlines, portals, and methods vary by retailer × deduction type and change over time. They live in `retailer_rules`, not embedded in `deductions`. This makes the recovery simulation feature (toggling fixes) cleaner — adjusting "what if KeHE deadline were 6 months instead of 48 hours" is a single rule edit.

### Snapshot dates, no versioning in V1

Retailer rules are stored as a current snapshot. No effective-from / effective-to columns. **Why:** demo scope, no live audit trail needed. **Tradeoff:** if a retailer changes a deadline mid-window, we can't model the transition. **Acceptable** because synthetic data isn't trying to replay history at that fidelity.

### Vague deductions are first-class

Per CLAUDE.md, real remittances include vague entries ("Code 99: Miscellaneous", "promo -$4k" with no PO reference). The schema allows `deductions.order_id`, `deductions.deduction_code`, and `deductions.po_reference` to be NULL. A `vague` flag and a free-text `remittance_description` capture what the supplier actually saw.

---

## Tables

### 1. `retailers`

Canonical reference table. The base uses retailer as a free-text column on `stores`, `chargebacks`, and `distribution_log` — we promote it to a keyed table without removing the existing free-text columns (they continue to work via name match).

| Column | Type | Notes |
|---|---|---|
| `retailer_id` | TEXT PK | Stable slug: `walmart`, `costco`, `whole_foods`, `unfi`, `kehe`, `wegmans`, `sprouts` |
| `name` | TEXT NOT NULL | Display name matching base tables (e.g., "Whole Foods") |
| `channel_type` | TEXT NOT NULL | `retailer` or `distributor` |
| `dispute_portal_name` | TEXT | "APDP", "K-Solve", "VIP / Smartsheet", etc. |
| `dispute_portal_url` | TEXT | Public URL when documented |
| `dispute_method` | TEXT | `portal`, `email_excel`, `email_buyer`, `mixed` |
| `notes` | TEXT | Short summary of behavior, links into `research/retailers/<slug>.md` |

Initial rows: walmart, costco, whole_foods, unfi, kehe, wegmans, sprouts, dtc.

### 2. `retailer_rules`

Per-retailer × deduction-type rules. One row per (retailer, deduction_type).

| Column | Type | Notes |
|---|---|---|
| `retailer_id` | TEXT NOT NULL | FK → retailers |
| `deduction_type` | TEXT NOT NULL | `short_ship`, `label_fine`, `pallet_fine`, `damaged`, `late_delivery`, `promo_billback`, `vague` |
| `dispute_window_days` | INTEGER | NULL where retailer doesn't publish a window |
| `auto_deduct` | BOOLEAN | TRUE if retailer deducts before notification (Walmart APDP, Amazon, KeHE UDR) |
| `evidence_required` | TEXT | Comma list: `signed_bol`, `pod`, `pack_log`, `label_scan`, `promo_agreement` |
| `typical_recovery_rate` | REAL | 0–1 — for recovery simulation. Inferred where unverified; flag in `notes` |
| `notes` | TEXT | "verified" / "inferred / industry norm" with brief justification |

`PRIMARY KEY (retailer_id, deduction_type)`.

### 3. `deduction_codes`

Retailer-specific deduction codes (Walmart Code 22, KeHE UDR, etc.). Some retailers don't publish codes — those rows use a generic `<retailer>_<type>` placeholder so the demo can still display a code.

| Column | Type | Notes |
|---|---|---|
| `code_id` | TEXT PK | `walmart_22`, `kehe_udr`, `wholefoods_shortage`, etc. |
| `retailer_id` | TEXT NOT NULL | FK → retailers |
| `code` | TEXT NOT NULL | Code as it appears on remittance ("22", "UDR", "Code 99") |
| `name` | TEXT NOT NULL | "Merchandise billed not shipped" |
| `deduction_type` | TEXT NOT NULL | Maps to `retailer_rules.deduction_type` |
| `is_published` | BOOLEAN | TRUE if code is in a public Walmart/KeHE doc; FALSE for inferred codes (Whole Foods, Costco, regional) |

Initial seed: 12 Walmart codes, 8 KeHE codes, plus inferred placeholders for Costco, Whole Foods, Sprouts, Kroger, Regional Group. UNFI uses three-letter codes that aren't fully public — model a few representative ones flagged `is_published=FALSE`.

### 4. `orders`

Purchase orders from retailers to Cinderhaven. New table — the base has no order grain.

| Column | Type | Notes |
|---|---|---|
| `order_id` | TEXT PK | Synthetic: `<retailer>-<seq>` e.g., `WMT-2025-008419` |
| `retailer_id` | TEXT NOT NULL | FK → retailers |
| `po_number` | TEXT NOT NULL | The retailer-issued PO (may differ from order_id format) |
| `po_date` | DATE NOT NULL | Date the PO was issued |
| `requested_ship_date` | DATE NOT NULL | When Cinderhaven needs to ship by |
| `requested_delivery_window_start` | DATE | Walmart-style on-time window start |
| `requested_delivery_window_end` | DATE | Walmart-style on-time window end |
| `dc_id` | TEXT | Retailer's destination DC identifier |
| `total_units` | INTEGER NOT NULL | Sum of order_lines.units |
| `total_value` | REAL NOT NULL | Sum of order_lines.line_total |

Indexes: `po_number`, `(retailer_id, po_date)`.

### 5. `order_lines`

Line items per order.

| Column | Type | Notes |
|---|---|---|
| `order_line_id` | INTEGER PK AUTOINCREMENT | |
| `order_id` | TEXT NOT NULL | FK → orders |
| `sku` | TEXT NOT NULL | FK → product_master.sku |
| `units_ordered` | INTEGER NOT NULL | Cases ordered |
| `unit_price` | REAL NOT NULL | Wholesale price at order time (from sku_costs × retailer multiplier) |
| `line_total` | REAL NOT NULL | units_ordered × unit_price |

Indexes: `order_id`, `sku`.

### 6. `shipments`

What was actually shipped against an order. One row per shipment (an order may ship in multiple parts, but for V1 model 1:1 unless the deduction story needs splits).

| Column | Type | Notes |
|---|---|---|
| `shipment_id` | TEXT PK | `<order_id>-S1` |
| `order_id` | TEXT NOT NULL | FK → orders |
| `ship_date` | DATE NOT NULL | When it left Cinderhaven |
| `delivery_date` | DATE | When it arrived at the retailer DC; NULL if not yet delivered |
| `carrier` | TEXT | "CH Robinson", "FedEx Freight", etc. |
| `bol_number` | TEXT | Bill of lading number |
| `bol_signed` | BOOLEAN | TRUE if Cinderhaven retained a signed BOL |
| `bol_signed_short` | BOOLEAN | TRUE if BOL was signed marking a shortage at receipt |
| `bol_signed_damaged` | BOOLEAN | TRUE if BOL was signed marking damage |
| `pod_received` | BOOLEAN | TRUE if proof of delivery was received |
| `units_shipped` | INTEGER NOT NULL | Cases on the shipment |
| `pallets_shipped` | INTEGER | Pallet count |
| `asn_sent` | BOOLEAN | TRUE if EDI 856 was transmitted |
| `asn_sent_late` | BOOLEAN | TRUE if ASN was late vs. retailer requirement |

Indexes: `order_id`, `ship_date`.

### 7. `pack_records`

What was actually picked, packed, and labeled — the operational reality. This is where the "evidence quality" failure is modeled. Per CLAUDE.md, Cinderhaven uses handwritten paper notes for pack verification, so most rows reference paper artifacts.

| Column | Type | Notes |
|---|---|---|
| `pack_record_id` | INTEGER PK AUTOINCREMENT | |
| `order_id` | TEXT NOT NULL | FK → orders |
| `shipment_id` | TEXT | FK → shipments (NULL if not yet shipped) |
| `pack_date` | DATE NOT NULL | |
| `packer_initials` | TEXT | Free text — "JM", "RS", etc. — handwritten on the paper note |
| `units_picked` | INTEGER NOT NULL | What the picker counted |
| `units_packed` | INTEGER NOT NULL | What ended up in the cases |
| `units_pick_pack_match` | BOOLEAN | TRUE if picked == packed (most are TRUE) |
| `label_type_used` | TEXT NOT NULL | `generic`, `walmart_compliant`, `costco_compliant`, etc. |
| `label_scannable` | BOOLEAN | FALSE for generic-on-Walmart, generic-on-Costco — drives Code 22 hand-counts |
| `pack_verification` | TEXT | `none`, `paper_note`, `digital_log` |
| `evidence_format` | TEXT | `paper_note`, `digital`, `none` |
| `evidence_location` | TEXT | `office_filing_cabinet`, `warehouse_clipboard`, `system`, `lost` |
| `evidence_retrieval_minutes` | INTEGER | Synthetic time-cost to find this evidence — drives cost-to-dispute |

Index: `order_id`.

### 8. `deductions`

The central deduction record. **One row per deducted line item on a remittance.** A single PO can generate multiple deductions (short ship + label fine + late delivery), each its own row.

| Column | Type | Notes |
|---|---|---|
| `deduction_id` | TEXT PK | `DED-<seq>` |
| `retailer_id` | TEXT NOT NULL | FK → retailers |
| `order_id` | TEXT | FK → orders. **NULL allowed** — vague deductions may have no PO reference |
| `shipment_id` | TEXT | FK → shipments. NULL if pre-ship deduction (rare) |
| `deduction_type` | TEXT NOT NULL | `short_ship`, `label_fine`, `pallet_fine`, `damaged`, `late_delivery`, `promo_billback`, `vague` |
| `code_id` | TEXT | FK → deduction_codes. NULL for vague |
| `code_as_remitted` | TEXT | The literal code text on remittance ("22", "Code 99", "promo") |
| `remittance_description` | TEXT | Free text from remittance line — for vague deductions this is all we have |
| `amount` | REAL NOT NULL | Dollar value deducted |
| `deduction_date` | DATE NOT NULL | Date the deduction appeared on a remittance |
| `dispute_deadline` | DATE | Calculated: deduction_date + retailer_rules.dispute_window_days. NULL where unpublished |
| `is_vague` | BOOLEAN NOT NULL | TRUE for "Code 99 / promo -$4k" entries with no PO |
| `is_post_audit` | BOOLEAN NOT NULL | TRUE for retroactive clawbacks (Walmart APL audits, KeHE pass-throughs) |
| `remittance_id` | TEXT | FK → remittances |

Indexes: `(retailer_id, deduction_date)`, `order_id`, `dispute_deadline`.

### 9. `disputes`

Dispute attempts. **NULL row possible per deduction** — if Cinderhaven never filed, no row exists (the absence is itself part of the story). For deductions with a dispute attempt, exactly one row.

| Column | Type | Notes |
|---|---|---|
| `dispute_id` | TEXT PK | `DSP-<seq>` |
| `deduction_id` | TEXT NOT NULL UNIQUE | FK → deductions |
| `filed_date` | DATE | Date dispute was submitted. NULL if started but never filed |
| `filing_method` | TEXT | `portal`, `email_excel`, `email_buyer` |
| `evidence_quality` | TEXT NOT NULL | `digital_complete`, `digital_partial`, `handwritten_only`, `none` |
| `submitted_evidence_count` | INTEGER NOT NULL | How many artifacts were attached |
| `was_within_deadline` | BOOLEAN | NULL if no published deadline; TRUE/FALSE otherwise |
| `outcome` | TEXT NOT NULL | `pending`, `won_full`, `won_partial`, `lost_evidence`, `lost_deadline`, `lost_no_response`, `lost_other`, `abandoned` |
| `recovered_amount` | REAL | Dollar amount actually recovered. 0 if lost/abandoned |
| `closed_date` | DATE | Date outcome was finalized |
| `labor_hours` | REAL NOT NULL | Synthetic time spent gathering evidence + filing — drives cost-to-dispute |

Index: `deduction_id`.

### 10. `dispute_evidence`

What evidence was submitted (or known to be missing) per dispute. Many-to-one with disputes.

| Column | Type | Notes |
|---|---|---|
| `evidence_id` | INTEGER PK AUTOINCREMENT | |
| `dispute_id` | TEXT NOT NULL | FK → disputes |
| `evidence_type` | TEXT NOT NULL | `signed_bol`, `pod`, `pack_log`, `label_scan`, `promo_agreement`, `asn_confirmation`, `photo` |
| `was_submitted` | BOOLEAN NOT NULL | TRUE if attached to dispute |
| `was_required` | BOOLEAN NOT NULL | TRUE if retailer required this type |
| `format` | TEXT | `digital`, `paper_scan`, `handwritten_note`, `missing` |
| `notes` | TEXT | "BOL signed short — packer note shows 240 cases packed but BOL says 230" |

Index: `dispute_id`.

### 11. `remittances`

Payment events. The retailer's remittance advice arrives in some format (EDI, portal, paper check), with deductions itemized at varying clarity.

| Column | Type | Notes |
|---|---|---|
| `remittance_id` | TEXT PK | `REM-<retailer>-<seq>` |
| `retailer_id` | TEXT NOT NULL | FK → retailers |
| `received_date` | DATE NOT NULL | |
| `format` | TEXT NOT NULL | `edi_820`, `portal_download`, `paper_check`, `email_pdf` |
| `gross_amount` | REAL NOT NULL | What was owed |
| `net_amount` | REAL NOT NULL | What was actually paid |
| `total_deductions` | REAL NOT NULL | gross − net |
| `clarity` | TEXT NOT NULL | `clear` (PO and code per line), `partial` (some lines vague), `opaque` (lump-sum deductions) |

Index: `(retailer_id, received_date)`.

### 12. `edi_requirements`

Per-retailer compliance specs (label format, pallet spec, ASN timing, OTIF threshold). Used for both rendering retailer-rule cards in the UI and seeding pack_records.

| Column | Type | Notes |
|---|---|---|
| `requirement_id` | INTEGER PK AUTOINCREMENT | |
| `retailer_id` | TEXT NOT NULL | FK → retailers |
| `category` | TEXT NOT NULL | `label`, `pallet`, `asn`, `otif`, `appointment`, `carton` |
| `requirement` | TEXT NOT NULL | "GS1-128 with SSCC, 2 labels per pallet, top-third placement" |
| `penalty_if_violated` | TEXT | "$200 admin + $1/case (Walmart SQEP Phase 2)" |
| `is_verified` | BOOLEAN NOT NULL | TRUE for Walmart/KeHE/UNFI; FALSE for inferred Costco/WFM/regional |
| `source_url` | TEXT | Citation back to research/retailers/<slug>.md sources |

Index: `(retailer_id, category)`.

### 13. `post_audit_claims`

Retroactive clawback events. These are deductions but with distinct timing characteristics (1–3 years after the original transaction). Modeled as deductions with `is_post_audit=TRUE` plus an enrichment row here.

| Column | Type | Notes |
|---|---|---|
| `claim_id` | TEXT PK | `PA-<seq>` |
| `deduction_id` | TEXT NOT NULL | FK → deductions |
| `auditor_name` | TEXT | "Audit Partners Limited", "Cotiviti", or NULL when retailer self-audits |
| `audit_period_start` | DATE | Start of period audited |
| `audit_period_end` | DATE | End of period audited |
| `claim_type` | TEXT | `pricing`, `allowance`, `freight`, `compliance` |
| `lookback_months` | INTEGER | Months between audit_period_end and the clawback hitting |

Index: `deduction_id`.

---

## Relationships

```
retailers ──┬─< retailer_rules
            ├─< deduction_codes
            ├─< orders ──< order_lines ──> product_master
            │            │
            │            ├──< shipments ──< pack_records
            │            │
            │            └──< deductions ──< disputes ──< dispute_evidence
            │                       │
            │                       ├──> deduction_codes
            │                       ├──> remittances
            │                       └──< post_audit_claims
            ├─< edi_requirements
            └─< remittances ──< deductions
```

`product_master`, `stores`, `distribution_log`, `sku_costs`, `chargebacks` are unchanged from the base repo.

---

## Volume targets

For the 37-month window (Jan 2023 → Jan 2026, inclusive calendar months; annualization ×12/37), cross-channel pipeline output:

| Table | Target rows | Notes |
|---|---|---|
| orders (int_all) | 45,000–65,000 | Retailer + distributor channels combined |
| order_lines (retailer) | 150,000–220,000 | 3–4 lines per order avg |
| shipments (int_all) | 45,000–65,000 | 1:1 with orders |
| pack_records (retailer) | 38,000–55,000 | One per retailer shipment |
| deductions (int_all) | 14,000–20,000 | Retailer + distributor deductions combined |
| disputes (int_all) | 5,000–7,500 | ~35% dispute rate across channels |
| dispute_evidence (retailer) | 18,000–28,000 | 2–4 evidence items per dispute |
| remittances (int_all) | 250–500 | Weekly to biweekly per partner |
| edi_requirements (retailer) | 30–60 | 4–8 requirements per retailer |
| post_audit_claims (retailer) | 180–280 | Walmart APL + KeHE pass-throughs |
| retailer_rules | 40–70 | 9 partners × ~6 deduction types |
| deduction_codes (retailer) | 80–120 | Walmart 12, KeHE 8, plus distributor codes |
| partners (int_all) | 7–12 | Retailers + distributors |

Total deduction dollar volume target: **$750K–$1.2M annualized** (3–5% of $25M wholesale revenue, consistent with industry reports for specialty food brands). Materially larger than the base `chargebacks` table's $55–75K. This is intentional — the base captures defect-driven chargebacks only; this project models the full deduction picture (operational, compliance, OTIF, post-audit, vague). The base $55–75K should remain a recognizable subset of the new total.

---

## Generation order

Implementation will run in this order to satisfy FKs:

1. `retailers` — static seed
2. `retailer_rules` — static seed
3. `deduction_codes` — static seed
4. `edi_requirements` — static seed
5. `orders` + `order_lines` — driven by promotional calendar, distribution_log, retailer channel split
6. `pack_records` — derived from orders, with label-compliance flags
7. `shipments` — derived from orders + pack_records, with realistic OTIF noise
8. `deductions` — driven by shipments × pack_records × retailer_rules + a stochastic vague-deduction layer
9. `remittances` — bundles deductions into payment events
10. `disputes` — driven by deduction backlog + Cinderhaven's lean-team capacity model
11. `dispute_evidence` — derived from pack_records evidence quality + dispute filing
12. `post_audit_claims` — sampled from older deductions
