# INPUT-SPEC — retailer-deduction-recovery (client mode)

What to hand the deduction-recovery engine in a client engagement. Written so a
client's finance/IT person can produce the file without a call. Derived from the
fields the analytics actually consume (`computeKpis`, `scripts/20_export_json.py`,
`frontend/src/types.ts`), not from a wish list.

## The file

- **One deduction ledger**, CSV or XLSX. One row per deduction line as it appears
  on a retailer/distributor remittance. Read via `lailara_engagement`'s tolerant
  reader: UTF-8 / UTF-8-BOM / latin-1; comma / semicolon / tab; leading blank rows
  and trailing junk dropped; header whitespace trimmed; Excel dates rendered as ISO
  text; identifier columns kept as text (leading zeros preserved).
- Extra columns are ignored. Column names map to the canonical fields below via
  `engagement.yml` (`columns:`), never by editing code.

## Required columns

These four drive the money analysis; without them the run produces a **Data
Readiness Report** instead of results.

| Canonical | Type | Required | Used for |
|---|---|---|---|
| `deduction_id` | identifier (text) | yes | Row key; must be unique. §1 |
| `deduction_type` | string | yes | Buckets the backlog by type (short_ship, label_fine, pallet_fine, damaged, late_delivery, promo_billback, pricing_error, spoilage, slotting). Unrecognized values are kept and grouped under their own label. §2 |
| `amount` | number ≥ 0 | yes | The deduction dollar amount. Drives every dollar total, the annualized figure, and the by-type / by-retailer splits. §3 |
| `deduction_date` | date | yes | Places each deduction in the analysis window; drives annualization (×12 / window_months). §4 |

## Optional columns

Each one unlocks part of the analysis. When absent, its analysis is **disclosed as a
data limitation** in the deliverable — never silently zeroed.

| Canonical | Type | Unlocks |
|---|---|---|
| `retailer` | string | Per-retailer scorecard (volume, recovered, recovery rate). Absent → by-retailer omitted. |
| `dispute_filed` | date **or** yes/no | Whether the deduction was disputed. A non-blank value ⇒ disputed; blank ⇒ counted in the "never filed" cohort (the core "~two-thirds are never fought" story). Absent column → recovery analysis unavailable. |
| `recovered_amount` | number ≥ 0 | Recovered dollars. Drives both recovery bases (recovered / total, and recovered / disputed). Absent → treated as 0 with a disclosure. |
| `dispute_outcome` | string | won / partial / lost / pending — the outcome mix. Absent → by-outcome omitted. |
| `dispute_deadline` | date | Timeline-pressure exposure (dollars past deadline). Absent → timeline view omitted. |
| `labor_hours` | number ≥ 0 | Dispute labor → FTE-equivalent (whole-window and annualized). Absent → labor/FTE omitted. |

> The interactive per-deduction views (causation trace, dispute builder, evidence
> quality, origin clustering, post-audit risk) require the client's **operational
> extracts** — order / pack / shipment / evidence records — which a remittance
> ledger does not carry. Those views are out of scope for a ledger-only intake and
> are listed as data limitations when their inputs are absent. The headline recovery
> economics (this spec) come entirely from the ledger.

## Basis & window (engagement.yml)

Every headline dollar figure is printed next to its basis and window. These come from
config, never from the wall clock:

```yaml
basis:
  window_months: 37                       # analysis window length
  window_label: "Jan 2023 – Jan 2026"     # printed beside every annualized number
as_of_date: "2026-01-02"                  # analysis anchor; NEVER today's date
```

- **Annualization** is `total × 12 / window_months` — labeled on the output.
- **Recovery rate** is reported two ways, each labeled: recovered / **all** deduction
  dollars (the portfolio recovery rate) and recovered / **disputed** dollars (how well
  the disputes that *are* filed do). The 2026-07-31 audit's P1 was these two being
  conflated; they are always shown with their basis.

## Column mapping (engagement.yml)

If the client's header isn't literally the canonical name, map it. A single header or
a list of candidates is accepted; a case/whitespace-insensitive exact match is
auto-detected and disclosed.

```yaml
columns:
  deduction_id: "Deduction #"
  deduction_type: "Reason Code"
  amount: ["Deduction Amt", "Amount"]
  deduction_date: "Remit Date"
  retailer: "Customer"
  dispute_filed: "Disputed On"
  recovered_amount: "Recovered $"
  dispute_outcome: "Dispute Result"
```

## Run

```bash
# with lailara_engagement installed: pip install -e ../engagement-template/lib
python client_mode.py --config engagement.yml --input client-data/deductions.csv \
    --out client-output [--final]
```

Outputs to `client-output/` (gitignored):
- `deduction-recovery-summary.html` — branded, provenance-footed (input SHA-256, row
  counts, `as_of_date`, config hash, validation status), DRAFT-watermarked until `--final`.
- `json/summary.json` — the headline analytics in the same schema the interactive app
  consumes, so a local build can render the client's data (never deployed).
- or `data-readiness-report.html` if a required column is missing or the data isn't ready.
