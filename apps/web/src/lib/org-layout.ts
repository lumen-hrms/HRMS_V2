/**
 * Org-chart card positions the user dragged around. Per-session only: kept in
 * `sessionStorage` (survives a reload) and wiped on logout, never sent to the
 * server. Offsets are relative to a card's automatic slot in the layout.
 */
export type Offsets = Record<string, { x: number; y: number }>;

/**
 * What was saved: the offsets plus a signature of the chart structure they were
 * made against (who reports to whom, how each team is laid out). Offsets are
 * relative to a card's automatic slot, so they only make sense while that
 * structure is unchanged — see `layoutSignature` in pages/org-chart/model.ts.
 */
export interface SavedLayout {
  sig: string | null;
  offsets: Offsets;
}

const PREFIX = 'lumen.orgchart.layout.';
const KEY = (key: string) => `${PREFIX}v2.${key}`;

export function loadOrgLayout(key: string | null): SavedLayout {
  const empty: SavedLayout = { sig: null, offsets: {} };
  if (!key) return empty;
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY(key)) ?? 'null');
    return saved && typeof saved.sig === 'string' && saved.offsets ? saved : empty;
  } catch {
    return empty;
  }
}

export function saveOrgLayout(key: string | null, layout: SavedLayout) {
  if (!key) return;
  try {
    if (Object.keys(layout.offsets).length === 0) sessionStorage.removeItem(KEY(key));
    else sessionStorage.setItem(KEY(key), JSON.stringify(layout));
  } catch {
    // storage unavailable — positions just won't survive a reload
  }
}

/** Forget every saved layout, including older formats (called on logout). */
export function clearOrgLayouts() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // nothing to clear
  }
}
