// web/src/utils/csv.ts
export type CsvRow = Record<string, string | number | boolean | null | undefined>;

function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: CsvRow[], headers?: string[]): string {
  if (!rows.length) return "";
  const cols =
    headers ??
    Array.from(
      rows.reduce((set, r) => {
        Object.keys(r).forEach((k) => set.add(k));
        return set;
      }, new Set<string>())
    );
  const headerLine = cols.map(escapeCsvCell).join(",");
  const lines = rows.map((r) => cols.map((c) => escapeCsvCell(r[c])).join(","));
  return "\uFEFF" + [headerLine, ...lines].join("\n"); // BOM for Excel
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Deep-flattens objects into key:value entries. Arrays -> JSON string. */
export function flattenForCsv(
  value: unknown,
  prefix = "",
  out: Record<string, string | number | boolean | null> = {}
) {
  if (value === null || value === undefined) {
    out[prefix.replace(/_$/, "")] = null;
    return out;
  }
  if (Array.isArray(value)) {
    // Preserve full raw detail for arrays
    out[prefix.replace(/_$/, "")] = JSON.stringify(value);
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenForCsv(v, `${prefix}${k}_`, out);
    }
    return out;
  }
  // primitive
  out[prefix.replace(/_$/, "")] =
    typeof value === "number" || typeof value === "boolean" ? value : String(value);
  return out;
}

/** Builds a “raw” row per username: username/status/timestamps + all ScanResult keys flattened */
export function buildRawCsvRows(
  rows: Array<{
    username: string;
    status: string;
    result?: any;
    error?: string;
    startedAt?: number;
    finishedAt?: number;
    notFound?: boolean;
  }>
) {
  return rows
    .filter((r) => r.result || r.error || r.notFound)
    .map((r) => {
      const base: Record<string, string | number | boolean | null> = {
        username: r.username,
        status: r.status,
        error: r.error ?? "",
        notFound: !!r.notFound,
        startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : "",
        finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : "",
      };
      if (r.result) {
        // Flatten all result fields (including nested tournament/non_tournament)
        flattenForCsv(r.result, "", base);
        // Also include a fully raw JSON column for audit/debug parity
        base.result_json = JSON.stringify(r.result);
      }
      return base;
    });
}
// --- Add below your existing exports in src/utils/csv.ts ---

/** Minimal input shape so App can pass rows without importing its types */
export type CsvInputRow = { username: string; result?: any };

/* Local helpers (namespaced to avoid collisions with existing utils) */
function _csvToNumberOrNull(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const m = v.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const num = parseFloat(m[0]);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}
function _csvPick(obj: any, path: string, dflt?: any) {
  try {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj) ?? dflt;
  } catch {
    return dflt;
  }
}
/** percent as a number (0–100) with one decimal; accepts 0.42 or 42 or "42%" */
function _pctNumber(v: any): number | null {
  const n = _csvToNumberOrNull(v);
  if (n == null) return null;
  const p = n <= 1 ? n * 100 : n;
  return Math.round(p * 10) / 10;
}
/** ratio rounded to 3 decimals (e.g., Elo ratios) */
function _ratio3(v: any): number | null {
  const n = _csvToNumberOrNull(v);
  if (n == null) return null;
  return Math.round(n * 1000) / 1000;
}

/** Safe text download helper for CSV files */
export function downloadTextFile(
  content: string,
  filename: string,
  mime = "text/csv;charset=utf-8"
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** -------------------- STRICT DOWNLOAD CSV BUILDER --------------------
 * Only these columns, in this exact order. No redundant fields.
 */
// In src/utils/csv.ts — replace the whole buildDownloadCsvRowsStrict with this version
export function buildDownloadCsvRowsStrict(
  finishedRows: { username: string; result?: any }[],
  csvByUser: Record<string, any>
): Array<Record<string, any>> {
  // helpers
  const norm = (s: any) =>
    (s == null ? "" : String(s)).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const num = (v: any): number | null => {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const m = v.match(/-?\d+(\.\d+)?/);
      if (!m) return null;
      const n = parseFloat(m[0]);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const pick = (obj: any, paths: string[]): any => {
    for (const p of paths) {
      try {
        const v = p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
        if (v != null) return v;
      } catch {}
    }
    return undefined;
  };
  const pct = (v: any): number | null => {
    const n = num(v);
    if (n == null) return null;
    const p = n <= 1 ? n * 100 : n;
    return Math.round(p * 10) / 10;
  };
  const rat = (v: any): number | null => {
    const n = num(v);
    if (n == null) return null;
    return Math.round(n * 1000) / 1000;
  };
  const sumNN = (a: number | null, b: number | null): number | null =>
    a == null || b == null ? null : a + b;

  // CSV getter (case/space/underscore/punct tolerant)
  const getCSV = (csv: any, aliases: string[]): any => {
    if (!csv || typeof csv !== "object") return undefined;
    if (!csv.__normIndex) {
      const idx: Record<string, any> = {};
      for (const [k, v] of Object.entries(csv)) idx[norm(k)] = v;
      Object.defineProperty(csv, "__normIndex", { value: idx, enumerable: false });
    }
    const idx = csv.__normIndex as Record<string, any>;
    for (const a of aliases) {
      const v = idx[norm(a)];
      if (v != null) return v;
    }
    return undefined;
  };

  // parse numbers out of a free-text reasons string (very tolerant)
  function parseFromReasons(reasons: string | undefined | null) {
    const R = String(reasons ?? "");
    const g = (() => {
      const m = R.match(/\bover\s+(\d+)\s+(?:rated\s+)?games\b/i);
      return m ? num(m[1]) : null;
    })();
    const elo = (() => {
      const m = R.match(/\belo\s*ratio[:\s]*([0-9.]+)/i) || R.match(/\belo\s*ratio\W+([0-9.]+)/i) || R.match(/\bEloRatio\s*([0-9.]+)/i);
      return m ? rat(m[1]) : null;
    })();
    const tElo = (() => {
      const m = R.match(/\b(?:tourn(?:ament)?)\s+elo\s*ratio[:\s]*([0-9.]+)/i) || R.match(/\bTourn\s*EloRatio\s*([0-9.]+)/i);
      return m ? rat(m[1]) : null;
    })();
    const ntElo = (() => {
      const m = R.match(/\bnon[-\s]?tourn(?:ament)?\s+(?:elo\s*)?ratio[:\s]*([0-9.]+)/i);
      return m ? rat(m[1]) : null;
    })();
    const gap = (() => {
      const m = R.match(/\(gap\s*([0-9.]+)\s*\)/i);
      return m ? rat(m[1]) : null;
    })();
    const ntSelfBail = (() => {
      const m = R.match(/\bnon[-\s]?tournament\s+self-bail\s+losses\s+([0-9.]+)%/i)
        || R.match(/\bNT\s+self-bail\s+loss(?:es)?\s+([0-9.]+)%/i);
      return m ? pct(m[1]) : null;
    })();
    const upsets = (() => {
      const m = R.match(/\b(\d+)\s+upset\s+wins?\b/i);
      return m ? num(m[1]) : null;
    })();
    return { games: g, elo, tElo, ntElo, gap, ntSelfBail, upsets };
  }

  // alias bundles
  const A = {
    suspicion: ["suspicion_score", "suspicion", "score"],

    recentGames: ["recent_games", "recent games", "games", "lifetime_games", "lifetime games"],
    recentWins: ["recent_wins", "recent wins", "wins"],
    recentDraws: ["recent_draws", "recent draws", "draws"],
    recentLosses: ["recent_losses", "recent losses", "losses"],

    streak: ["win_streak", "streak", "stk"],
    maxStreak: ["max_win_streak", "max streak", "maxstk", "max win streak"],
    upsetWins: ["upset_wins", "upsets", "upset"],

    shortWinRate: ["short_win_rate", "short win rate", "shortw%", "short_win%", "shortwin%"],
    timeoutWinRatio: ["timeout_win_ratio", "timeout win ratio", "to/res%", "timeout%"],

    tGames: ["t_games", "t games", "tournament_games", "tournament games"],
    tWins: ["t_wins", "t wins", "tournament_wins", "tournament wins", "tw"],
    tDraws: ["t_draws", "t draws", "tournament_draws", "tournament draws", "td"],
    tLosses: ["t_losses", "t losses", "tournament_losses", "tournament losses", "tl"],
    tWR: ["tourn_win_rate", "tournament win rate", "twr", "twr%"],

    ntGames: ["nt_games", "nt games", "non_tourn_games", "non tournament games", "non_tournament_games"],
    ntWins: ["nt_wins", "nt wins", "non_tourn_wins", "non tournament wins", "non_tournament_wins"],
    ntDraws: ["nt_draws", "nt draws", "non_tourn_draws", "non tournament draws", "non_tournament_draws"],
    ntLosses: ["nt_losses", "nt losses", "non_tourn_losses", "non tournament losses", "non_tournament_losses"],
    ntWR: ["non_tourn_win_rate", "non tournament win rate", "ntwr", "ntwr%"],

    eloGain: ["elo_gain", "elo gain"],
    eloLoss: ["elo_loss", "elo loss"],
    eloRatio: ["elo_ratio", "elo ratio", "elor"],

    tEloGain: ["tourn_elo_gain", "t elo gain", "t_elo_gain"],
    tEloLoss: ["tourn_elo_loss", "t elo loss", "t_elo_loss"],
    tEloRatio: ["tourn_elo_ratio", "t elo ratio", "t_elo_ratio", "telor", "t elor", "t eloratio"],

    ntEloGain: ["non_tourn_elo_gain", "nt elo gain", "nt_elo_gain"],
    ntEloLoss: ["non_tourn_elo_loss", "nt elo loss", "nt_elo_loss"],
    ntEloRatio: ["non_tourn_elo_ratio", "nt elo ratio", "nt_elo_ratio", "ntelor"],

    wrGap: ["wr_gap", "wr gap", "Δwr", "wr gap (t − nt)", "wr gap (t-nt)"],
    eloRatioGap: ["elo_ratio_gap", "elo ratio gap", "Δelor"],

    tSelfBail: ["t_self_bail_loss_ratio", "t-selfto%"],
    ntSelfBail: ["nt_self_bail_loss_ratio", "nt-selfto%"],

    reasons: ["reasons"],
  };

  const out = finishedRows.map((row) => {
    const r = row.result ?? {};
    const csv = csvByUser[row.username.toLowerCase()];
    const reasonsStr =
      Array.isArray(r?.reasons) ? r.reasons.join("; ")
      : typeof r?.reasons === "string" ? r.reasons
      : (getCSV(csv, A.reasons) ?? "");
    const parsed = parseFromReasons(reasonsStr);

    // suspicion
    const suspicion_score =
      pick(r, ["suspicion_score", "suspicion.score"]) ??
      num(getCSV(csv, A.suspicion)) ?? null;

    // T / NT splits
    const t_games = num(pick(r, ["tournament.games", "t.games", "tourn.games"])) ?? num(getCSV(csv, A.tGames)) ?? null;
    const t_wins  = num(pick(r, ["tournament.wins",  "t.wins",  "tourn.wins"]))  ?? num(getCSV(csv, A.tWins))  ?? null;
    const t_draws = num(pick(r, ["tournament.draws", "t.draws", "tourn.draws"])) ?? num(getCSV(csv, A.tDraws)) ?? null;
    const t_losses= num(pick(r, ["tournament.losses","t.losses","tourn.losses"]))?? num(getCSV(csv, A.tLosses))?? null;
    let  tWR      = pct(pick(r, ["tournament.win_rate", "t.win_rate"])) ?? pct(getCSV(csv, A.tWR));

    const nt_games = num(pick(r, ["non_tournament.games", "nt.games"])) ?? num(getCSV(csv, A.ntGames)) ?? null;
    const nt_wins  = num(pick(r, ["non_tournament.wins",  "nt.wins"]))  ?? num(getCSV(csv, A.ntWins))  ?? null;
    const nt_draws = num(pick(r, ["non_tournament.draws", "nt.draws"])) ?? num(getCSV(csv, A.ntDraws)) ?? null;
    const nt_losses= num(pick(r, ["non_tournament.losses","nt.losses"]))?? num(getCSV(csv, A.ntLosses))?? null;
    let  ntWR      = pct(pick(r, ["non_tournament.win_rate", "nt.win_rate"])) ?? pct(getCSV(csv, A.ntWR));

    // lifetime / recent totals (fallback from T+NT or reasons)
    let recent_games  = num(pick(r, ["totals.games", "lifetime_games", "recent.games", "games"])) ?? num(getCSV(csv, A.recentGames)) ?? parsed.games;
    let recent_wins   = num(pick(r, ["totals.wins", "wins"]))   ?? num(getCSV(csv, A.recentWins));
    let recent_draws  = num(pick(r, ["totals.draws", "draws"])) ?? num(getCSV(csv, A.recentDraws));
    let recent_losses = num(pick(r, ["totals.losses", "losses"])) ?? num(getCSV(csv, A.recentLosses));

    recent_games  ??= sumNN(t_games, nt_games);
    recent_wins   ??= sumNN(t_wins, nt_wins);
    recent_draws  ??= sumNN(t_draws, nt_draws);
    recent_losses ??= sumNN(t_losses, nt_losses);

    // if WR missing but wins/games exist, compute
    if (tWR == null && t_wins != null && t_games && t_games > 0) tWR = Math.round(((t_wins / t_games) * 100) * 10) / 10;
    if (ntWR == null && nt_wins != null && nt_games && nt_games > 0) ntWR = Math.round(((nt_wins / nt_games) * 100) * 10) / 10;

    // streak/upsets
    const win_streak     = getCSV(csv, A.streak) ?? pick(r, ["streak"]) ?? null;
    const max_win_streak = getCSV(csv, A.maxStreak) ?? pick(r, ["max_streak"]) ?? null;
    let upset_wins       = getCSV(csv, A.upsetWins) ?? pick(r, ["upset_wins"]);
    if (upset_wins == null && parsed.upsets != null) upset_wins = parsed.upsets;

    // ratios
    const short_win_rate    = pct(pick(r, ["ratios.short_win_rate", "short_win_rate"])) ?? pct(getCSV(csv, A.shortWinRate));
    const timeout_win_ratio = pct(pick(r, ["ratios.timeout_win_ratio", "timeout_win_ratio"])) ?? pct(getCSV(csv, A.timeoutWinRatio));

    // elo totals
    const elo_gain  = num(pick(r, ["totals.elo.gain", "elo.gain"])) ?? num(getCSV(csv, A.eloGain)) ?? null;
    const elo_loss  = num(pick(r, ["totals.elo.loss", "elo.loss"])) ?? num(getCSV(csv, A.eloLoss)) ?? null;
    let   elo_ratio = rat(pick(r, ["totals.elo.ratio", "elo.ratio"])) ?? rat(getCSV(csv, A.eloRatio)) ?? parsed.elo ?? null;

    const t_elo_gain  = num(pick(r, ["tournament.elo.gain", "t.elo.gain"])) ?? num(getCSV(csv, A.tEloGain)) ?? null;
    const t_elo_loss  = num(pick(r, ["tournament.elo.loss", "t.elo.loss"])) ?? num(getCSV(csv, A.tEloLoss)) ?? null;
    let   t_elo_ratio = rat(pick(r, ["tournament.elo.ratio", "t.elo.ratio"])) ?? rat(getCSV(csv, A.tEloRatio)) ?? parsed.tElo ?? null;

    const nt_elo_gain  = num(pick(r, ["non_tournament.elo.gain", "nt.elo.gain"])) ?? num(getCSV(csv, A.ntEloGain)) ?? null;
    const nt_elo_loss  = num(pick(r, ["non_tournament.elo.loss", "nt.elo.loss"])) ?? num(getCSV(csv, A.ntEloLoss)) ?? null;
    let   nt_elo_ratio = rat(pick(r, ["non_tournament.elo.ratio", "nt.elo.ratio"])) ?? rat(getCSV(csv, A.ntEloRatio)) ?? parsed.ntElo ?? null;

    // gaps
    let wr_gap: number | null = null;
    if (tWR != null && ntWR != null) wr_gap = Math.round((tWR - ntWR) * 10) / 10;
    else wr_gap = pct(getCSV(csv, A.wrGap));

    let elo_ratio_gap: number | null = null;
    if (t_elo_ratio != null && nt_elo_ratio != null) elo_ratio_gap = rat(t_elo_ratio - nt_elo_ratio);
    else elo_ratio_gap = rat(getCSV(csv, A.eloRatioGap)) ?? parsed.gap ?? null;

    const t_self_bail_loss_ratio  = pct(pick(r, ["ratios.self_bail_loss_ratio_t"])) ?? pct(getCSV(csv, A.tSelfBail));
    const nt_self_bail_loss_ratio = pct(pick(r, ["ratios.self_bail_loss_ratio_nt"])) ?? pct(getCSV(csv, A.ntSelfBail)) ?? parsed.ntSelfBail ?? null;

    // reasons (pass through as-is)
    const reasons = reasonsStr;

    return {
      username: row.username,
      suspicion_score,
      recent_games,
      recent_wins,
      recent_draws,
      recent_losses,
      win_streak,
      max_win_streak,
      upset_wins,
      short_win_rate,
      timeout_win_ratio,
      tourn_games: t_games,
      tourn_wins: t_wins,
      tourn_draws: t_draws,
      tourn_losses: t_losses,
      non_tourn_games: nt_games,
      non_tourn_wins: nt_wins,
      non_tourn_draws: nt_draws,
      non_tourn_losses: nt_losses,
      tourn_win_rate: tWR,
      non_tourn_win_rate: ntWR,
      wr_gap,
      elo_gain,
      elo_loss,
      elo_ratio,
      tourn_elo_gain: t_elo_gain,
      tourn_elo_loss: t_elo_loss,
      tourn_elo_ratio: t_elo_ratio,
      non_tourn_elo_gain: nt_elo_gain,
      non_tourn_elo_loss: nt_elo_loss,
      non_tourn_elo_ratio: nt_elo_ratio,
      elo_ratio_gap,
      t_self_bail_loss_ratio,
      nt_self_bail_loss_ratio,
      reasons,
    };
  });

  // sort: suspicion desc, username asc
  out.sort((a, b) => {
    const as = num((a as any).suspicion_score) ?? -Infinity;
    const bs = num((b as any).suspicion_score) ?? -Infinity;
    if (as !== bs) return bs - as;
    return String((a as any).username).toLowerCase().localeCompare(String((b as any).username).toLowerCase());
  });

  return out;
}

