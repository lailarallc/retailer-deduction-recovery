import { useMemo, useState } from "react";
import type { Deduction, RetailersById } from "../types";
import { formatCount, formatDollars, formatPercent } from "../data";
import { partnerLabel } from "../partnerLabels";
import "./RetailerScorecardView.css";

interface Props {
  cohort: Deduction[];
  retailers: RetailersById | null;
  activeRetailerId: string | null;
  onSelectRetailer: (id: string | null) => void;
}

interface Scorecard {
  id: string;
  name: string;
  channelType: string;
  count: number;
  dollars: number;
  recovered: number;
  netLoss: number;
  recoveryRate: number;
  filed: number;
  won: number;
  filingRate: number;
  winRate: number;
  topType: { type: string; share: number } | null;
  avgWindow: number | null;
  evidenceItems: number;
  expiredCount: number;
  expiredDollars: number;
  profile: string;
}

// Research-grounded retailer-specific narrative (sourced from
// research/retailers/). Hardcoded because the JSON schema doesn't
// carry a "behavioral profile" field. Keyed by retailer.id as it
// appears in the data (RET-*/DIST-*); retailers without a profile
// render no note.
const RETAILER_PROFILE: Record<string, string> = {
  "RET-WALMART":
    "APDP portal accepts most disputes; OTIF (3% of COGS) is the bigger lever; third-party email-based post-audit team months later.",
  "RET-COSTCO":
    "Cross-dock receiving leaves no room for fixes; ASN/label compliance dominates the chargeback mix; refused deliveries on missed appointment windows.",
  "RET-WHOLEFOODS":
    "Manual Excel + Smartsheet dispute process; strict quality program; double layer of deductions when paired with distributor A.",
  "DIST-UNFI":
    "Two parallel systems (Natural / Conventional); Excel-only dispute forms by email; deductions can pull directly from future invoices.",
  "DIST-KEHE":
    "Distributor — pass-through audits from underlying retailers add complexity; granular per-incident compliance fines.",
};

type Sort = "net_loss" | "dollars" | "worst_recovery";

const SORT_LABEL: Record<Sort, string> = {
  net_loss: "Net loss",
  dollars: "Volume",
  worst_recovery: "Worst recovery",
};

function compute(
  cohort: Deduction[],
  retailers: RetailersById | null
): Scorecard[] {
  const acc = new Map<string, Scorecard>();
  const typeCounts = new Map<string, Map<string, number>>();

  for (const d of cohort) {
    let s = acc.get(d.retailer.id);
    if (!s) {
      s = {
        id: d.retailer.id,
        name: partnerLabel(d.retailer, true),
        channelType: d.retailer.channel_type,
        count: 0,
        dollars: 0,
        recovered: 0,
        netLoss: 0,
        recoveryRate: 0,
        filed: 0,
        won: 0,
        filingRate: 0,
        winRate: 0,
        topType: null,
        avgWindow: null,
        evidenceItems: 0,
        expiredCount: 0,
        expiredDollars: 0,
        profile: RETAILER_PROFILE[d.retailer.id] ?? "",
      };
      acc.set(d.retailer.id, s);
    }
    s.count++;
    s.dollars += d.amount;
    if (d.dispute) {
      if (d.dispute.filed_date) {
        s.filed++;
        if (
          d.dispute.outcome === "won" ||
          d.dispute.outcome === "partial"
        ) {
          s.won++;
        }
      }
      s.recovered += d.dispute.recovered_amount ?? 0;
    }
    if (d.dispute?.filed_date && d.dispute_deadline &&
        new Date(d.dispute.filed_date) > new Date(d.dispute_deadline)) {
      s.expiredCount++;
      s.expiredDollars += d.amount;
    }

    let m = typeCounts.get(d.retailer.id);
    if (!m) {
      m = new Map();
      typeCounts.set(d.retailer.id, m);
    }
    m.set(d.deduction_type, (m.get(d.deduction_type) ?? 0) + 1);
  }

  for (const s of acc.values()) {
    s.netLoss = s.dollars - s.recovered;
    s.recoveryRate = s.dollars ? s.recovered / s.dollars : 0;
    s.filingRate = s.count ? s.filed / s.count : 0;
    s.winRate = s.filed ? s.won / s.filed : 0;

    const m = typeCounts.get(s.id);
    if (m) {
      let topType = "";
      let topCount = 0;
      let total = 0;
      for (const [t, c] of m) {
        total += c;
        if (c > topCount) {
          topCount = c;
          topType = t;
        }
      }
      s.topType = { type: topType, share: total ? topCount / total : 0 };
    }

    const r = retailers?.[s.id];
    if (r) {
      const windows = Object.values(r.rules)
        .map((rule) => rule.dispute_window_days)
        .filter((w): w is number => typeof w === "number");
      if (windows.length > 0) {
        s.avgWindow = Math.round(
          windows.reduce((a, b) => a + b, 0) / windows.length
        );
      }
      const evCounts = Object.values(r.rules).map(
        (rule) => rule.evidence_required.length
      );
      if (evCounts.length > 0) {
        s.evidenceItems =
          Math.round(
            (evCounts.reduce((a, b) => a + b, 0) / evCounts.length) * 10
          ) / 10;
      }
    }
  }

  return [...acc.values()];
}

export default function RetailerScorecardView({
  cohort,
  retailers,
  activeRetailerId,
  onSelectRetailer,
}: Props) {
  const [sort, setSort] = useState<Sort>("net_loss");

  const scorecards = useMemo(() => {
    const cards = compute(cohort, retailers);
    return [...cards].sort((a, b) => {
      if (sort === "net_loss") return b.netLoss - a.netLoss;
      if (sort === "dollars") return b.dollars - a.dollars;
      // worst_recovery: lowest recovery rate first — the most painful
      // retailers (Cinderhaven gets least back from them) at the top.
      return a.recoveryRate - b.recoveryRate;
    });
  }, [cohort, retailers, sort]);

  // Portfolio win rate, shown both ways so the headline isn't inflated by
  // partial recoveries: "won or partially recovered" counts partials as
  // wins (the optimistic read); "won outright" counts only full wins.
  const winStats = useMemo(() => {
    let filed = 0;
    let wonOrPartial = 0;
    let wonOutright = 0;
    for (const d of cohort) {
      if (!d.dispute?.filed_date) continue;
      filed++;
      if (d.dispute.outcome === "won" || d.dispute.outcome === "partial")
        wonOrPartial++;
      if (d.dispute.outcome === "won") wonOutright++;
    }
    return { filed, wonOrPartial, wonOutright };
  }, [cohort]);

  const totalNetLoss = scorecards.reduce((s, c) => s + c.netLoss, 0);

  if (cohort.length === 0) {
    return (
      <section className="scorecard section">
        <h2>Retailer scorecard</h2>
        <p className="section-description">
          Each retailer gets a profile showing: total deduction dollars,
          most common deduction types, dispute acceptance rate, average
          days to decide a dispute, deadline strictness, and how their
          behavior compares to the group. Use this to answer questions
          like "is the national mass retailer actually our worst retailer or does it just
          feel that way because they're our biggest?" and "which retailer
          is most likely to accept a dispute if we file one?"
        </p>
        <p className="scorecard-empty section-empty">No deductions in the current cohort.</p>
      </section>
    );
  }

  return (
    <section className="scorecard section">
      <header className="scorecard-header section-header">
        <div>
          <h2>Retailer scorecard</h2>
          <p className="section-description">
            Each retailer gets a profile showing: total deduction dollars,
            most common deduction types, dispute acceptance rate, average
            days to decide a dispute, deadline strictness, and how their
            behavior compares to the group. Use this to answer questions
            like "is the national mass retailer actually our worst retailer or does it just
            feel that way because they're our biggest?" and "which
            retailer is most likely to accept a dispute if we file one?"
          </p>
          <p className="scorecard-context section-context">
            Comparative view across {formatCount(scorecards.length)} retailers
            in the current cohort. Each card pairs the dollar story (volume,
            recovery, net loss) with the behavioral one (top deduction type,
            filing → win rate, dispute window, evidence demand). Click{" "}
            <strong>Filter →</strong> on any retailer to scope the rest of
            the app to that relationship.
          </p>
          {winStats.filed > 0 && (
            <p className="scorecard-winrate section-context">
              Across {formatCount(winStats.filed)} filed disputes,{" "}
              <strong>
                {formatPercent(winStats.wonOrPartial / winStats.filed)}
              </strong>{" "}
              were won or partially recovered — but only{" "}
              <strong>
                {formatPercent(winStats.wonOutright / winStats.filed)}
              </strong>{" "}
              were won outright. The per-card "Filed → won" rate counts
              partial recoveries as wins; the gap between the two is the
              partial-recovery tail.
            </p>
          )}
        </div>
        <div className="scorecard-sort">
          <span className="scorecard-sort-label">Sort by</span>
          {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
            <button
              key={s}
              className={
                sort === s ? "scorecard-sort-btn active" : "scorecard-sort-btn"
              }
              onClick={() => setSort(s)}
            >
              {SORT_LABEL[s]}
            </button>
          ))}
        </div>
      </header>

      <div className="scorecard-grid">
        {scorecards.map((s) => (
          <ScorecardCard
            key={s.id}
            scorecard={s}
            isActive={activeRetailerId === s.id}
            shareOfNetLoss={totalNetLoss > 0 ? s.netLoss / totalNetLoss : 0}
            onFilter={() =>
              onSelectRetailer(activeRetailerId === s.id ? null : s.id)
            }
          />
        ))}
      </div>
    </section>
  );
}

function ScorecardCard({
  scorecard: s,
  isActive,
  shareOfNetLoss,
  onFilter,
}: {
  scorecard: Scorecard;
  isActive: boolean;
  shareOfNetLoss: number;
  onFilter: () => void;
}) {
  return (
    <div
      className={`scorecard-card ${isActive ? "active" : ""} channel-${s.channelType}`}
    >
      <header className="scorecard-card-head">
        <div>
          <div className="scorecard-card-name">{s.name}</div>
          <div className="scorecard-card-channel">{s.channelType}</div>
        </div>
        <button className="scorecard-filter-btn" onClick={onFilter}>
          {isActive ? "× Clear" : "Filter →"}
        </button>
      </header>

      <div className="scorecard-card-loss">
        <div className="scorecard-loss-label">Net loss</div>
        <div className="scorecard-loss-value">{formatDollars(s.netLoss)}</div>
        <div className="scorecard-loss-share">
          {formatPercent(shareOfNetLoss)} of cohort net loss
        </div>
        <div className="scorecard-loss-bar">
          <div
            className="scorecard-loss-bar-fill"
            style={{ width: `${Math.min(shareOfNetLoss * 100, 100)}%` }}
          />
        </div>
      </div>

      <div className="scorecard-metrics">
        <Metric
          label="Volume"
          value={formatDollars(s.dollars)}
          sub={`${formatCount(s.count)} deductions`}
        />
        <Metric
          label="Top type"
          value={s.topType ? s.topType.type.replace(/_/g, " ") : "—"}
          sub={s.topType ? formatPercent(s.topType.share) : ""}
        />
        <Metric
          label="Filed → won"
          value={`${formatPercent(s.filingRate)} → ${formatPercent(s.winRate)}`}
          sub={`${formatCount(s.filed)} filed · ${formatCount(s.won)} won`}
        />
        <Metric
          label="Recovered"
          value={formatDollars(s.recovered)}
          sub={formatPercent(s.recoveryRate)}
        />
        <Metric
          label="Window"
          value={s.avgWindow !== null ? `${s.avgWindow}d` : "varies"}
          sub={`${s.evidenceItems} avg evidence items`}
        />
        <Metric
          label="Past deadline"
          value={formatCount(s.expiredCount)}
          sub={`${formatDollars(s.expiredDollars)} lost`}
        />
      </div>

      {s.profile && <p className="scorecard-profile">{s.profile}</p>}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="scorecard-metric">
      <div className="scorecard-metric-label">{label}</div>
      <div className="scorecard-metric-value">{value}</div>
      <div className="scorecard-metric-sub">{sub}</div>
    </div>
  );
}
