// Public display labels for trade partners. Rule (2026-11-05): a Cinderhaven
// dollar figure never shares a sentence, row, card or label with a real
// retailer/distributor name. The data keeps the real names and IDs; every
// rendered partner name goes through partnerLabel(). The map is vendored
// from cinderhaven-data-platform by scripts/refresh_canonical.py.
import labels from "../../reference/retailer_display_labels.json";

const BY_KEY = new Map<string, string>();
for (const [id, e] of Object.entries({ ...labels.retailers, ...labels.distributors })) {
  BY_KEY.set(id, e.label);
  BY_KEY.set(e.name, e.label);
}

// Accepts a partner ({id, name}) or a bare id/name. Pass capitalize=true at
// the start of a sentence or as a table cell, card title, or legend entry.
export function partnerLabel(
  p: { id: string; name: string } | string,
  capitalize = false
): string {
  const label =
    typeof p === "string"
      ? BY_KEY.get(p) ?? p
      : BY_KEY.get(p.id) ?? BY_KEY.get(p.name) ?? p.name;
  return capitalize ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

// Distributor PO numbers embed the partner name (DPO-UNFI-, DPO-KEHE-,
// DPO--DPI-). Display only: swap that segment for the label's short form
// ("distributor A" -> DPO-A-007969). The underlying order IDs are unchanged.
export function displayPoNumber(
  po: string,
  p: { id: string; name: string }
): string {
  const short = /^distributor (\w+)$/.exec(partnerLabel(p))?.[1];
  return short ? po.replace(/^DPO-+[^-]+-/, `DPO-${short}-`) : po;
}
