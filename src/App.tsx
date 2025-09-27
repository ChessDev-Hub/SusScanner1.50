// web/src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { ScanResult } from "./types";
import BetaBanner from "./BetaBanner";
import { scan, health, API_BASE } from "./api";
import "./styles.css";

// CSV utilities (single source of truth in utils/)
import {
  toCsv,
  buildRawCsvRows,
  buildDownloadCsvRowsStrict,
  downloadTextFile,
} from "./utils/csv";

type RowStatus = "queued" | "running" | "done" | "error";

type Row = {
  username: string;
  status: RowStatus;
  result?: ScanResult;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  notFound?: boolean;
};

// 🎚️ Central config for suspicion thresholds + Tailwind colors
const SUSPICION_THRESHOLDS: { max: number; color: string; label: string }[] = [
  { max: 0.0, color: "bg-green-600", label: "normal (≤0.0)" },
  { max: 1.0, color: "bg-yellow-200", label: "low (≤1.0)" },
  { max: 1.5, color: "bg-yellow-400", label: "moderate (≤1.5)" },
  { max: 2.5, color: "bg-orange-500", label: "high (≤2.5)" },
  { max: 3.5, color: "bg-red-500", label: "higher (≤3.5)" },
  { max: 4.5, color: "bg-red-700", label: "very high (≤4.5)" },
  { max: Infinity, color: "bg-red-900", label: "Hmmm (>4.5)" },
];

// --- Build Version ---
const VERSION_BASE = "1.5";
const BUILD_TIME = (() => {
  const t = (import.meta as any)?.env?.VITE_BUILD_TIME;
  return t ? new Date(Number(t)) : new Date();
})();
function secondsSinceMidnight(d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}
function formatBuildVersion(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const secs = String(secondsSinceMidnight(d)).padStart(5, "0");
  return `${VERSION_BASE}.${y}.${m}.${day}.${secs}`;
}
const BUILD_VERSION = formatBuildVersion(BUILD_TIME);

// ---------- Utilities ----------
// percent as a number (0-100) with one decimal; accepts 0.42 or 42 or "42%"
function pctNumber(v: any): number | null {
  const n = toNumberOrNull(v);
  if (n == null) return null;
  const p = n <= 1 ? n * 100 : n;
  return Math.round(p * 10) / 10;
}
// ratio rounded to 3 decimals (e.g., Elo ratios)
function ratio3(v: any): number | null {
  const n = toNumberOrNull(v);
  if (n == null) return null;
  return Math.round(n * 1000) / 1000;
}

function severityColor(score?: number | null) {
  const s = score ?? 0;
  for (const t of SUSPICION_THRESHOLDS) {
    if (s <= t.max) return t.color;
  }
  return "bg-slate-400";
}
function textOnBgClass(bg: string) {
  if (/\b(bg-yellow-200|bg-yellow-400|bg-slate-200|bg-slate-300|bg-white)\b/.test(bg)) {
    return "text-slate-900";
  }
  return "text-white";
}
function shortReasons(reasons?: string[] | Record<string, any> | string, max = 2) {
  if (!reasons) return "";
  if (Array.isArray(reasons)) return reasons.slice(0, max).join(", ");
  if (typeof reasons === "string") return reasons;
  try {
    return Object.keys(reasons).slice(0, max).join(", ");
  } catch {
    return "";
  }
}
function msFmt(ms?: number) {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}
function uniqUsernames(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[\s,;]+/g)
        .map((s) => s.trim().replace(/^"+|"+$/g, "")) // remove leading/trailing quotes
        .filter(Boolean)
    )
  );
}
function fmtPctNum(v?: number | null) {
  if (v === undefined || v === null || Number.isNaN(v)) return null;
  return v <= 1 ? v * 100 : v;
}
function fmtPct(v?: number | null) {
  const p = fmtPctNum(v);
  if (p === null) return "0.0%";
  return `${p.toFixed(1)}%`;
}
function fmtNum(v?: number | null, digits = 6) {
  if (v === undefined || v === null || Number.isNaN(v)) return "0.000000";
  return Number(v).toFixed(digits);
}
function safe<T>(v: T | undefined | null, fallback: T): T {
  return v == null ? fallback : v;
}
// ⬇️ updated: supports string OR string[] paths
function pick(obj: any, paths: string | string[], dflt?: any) {
  const tryPath = (p: string) => {
    try {
      return p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    } catch {
      return undefined;
    }
  };
  if (Array.isArray(paths)) {
    for (const p of paths) {
      const v = tryPath(p);
      if (v != null) return v;
    }
    return dflt;
  }
  const v = tryPath(paths);
  return v ?? dflt;
}
function toNumberOrNull(v: any): number | null {
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
function parseWDL(s: any): [number, number, number] | null {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^\s*(\d+)\s*[-:\/]\s*(\d+)\s*[-:\/]\s*(\d+)\s*$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

// ---------- Modal (bounded + scrollable) ----------
function Modal({
  open,
  onClose,
  children,
  closeClassName,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  closeClassName?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close overlay" />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-2xl rounded-2xl bg-white text-slate-900 shadow-2xl">
        <button
          onClick={onClose}
          className={`absolute top-2 right-2 rounded-full px-2 py-1 transition focus:outline-none focus:ring-2 focus:ring-black/10 ${closeClassName ?? ""}`}
          aria-label="Close"
        >
          ✕
        </button>
        <div className="max-h-[85vh] md:max-h-[80vh] overflow-y-auto overscroll-contain p-5" style={{ scrollbarGutter: "stable" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------- Player Profile (uses CSV row if available) ----------
function PlayerProfile({ row, csvRow }: { row: Row; csvRow?: Record<string, any> }) {
  const r: any = row.result ?? {};

  const reasonsStr =
    Array.isArray(r?.reasons) ? r.reasons.join("; ")
    : typeof r?.reasons === "string" ? r.reasons
    : (csvRow?.Reasons ?? csvRow?.reasons ?? "");

  // parse some values out of the free-text reasons (fallbacks)
  const parseFromReasons = (s: string) => {
    const R = String(s ?? "");
    const games = (() => { const m = R.match(/\bover\s+(\d+)\s+(?:rated\s+)?games\b/i); return m ? Number(m[1]) : null; })();
    const elo = (() => { const m = R.match(/\belo\s*ratio[:\s]*([0-9.]+)/i) || R.match(/\bEloRatio\s*([0-9.]+)/i); return m ? Number(m[1]) : null; })();
    const tElo = (() => { const m = R.match(/\b(?:tourn(?:ament)?)\s+elo\s*ratio[:\s]*([0-9.]+)/i) || R.match(/\bTourn\s*EloRatio\s*([0-9.]+)/i); return m ? Number(m[1]) : null; })();
    const ntElo = (() => { const m = R.match(/\bnon[-\s]?tourn(?:ament)?\s+(?:elo\s*)?ratio[:\s]*([0-9.]+)/i); return m ? Number(m[1]) : null; })();
    const gap = (() => { const m = R.match(/\(gap\s*([0-9.]+)\s*\)/i); return m ? Number(m[1]) : null; })();
    return { games, elo, tElo, ntElo, gap };
  };
  const parsed = parseFromReasons(reasonsStr);

  // CSV getter
  function getCsv(names: string[]) {
    if (!csvRow) return undefined;
    for (const n of names) if (n in csvRow && (csvRow as any)[n] != null) return (csvRow as any)[n];
    return undefined;
  }

  // Lifetime totals (API first, CSV fallback, then reasons)
  const gTot_api = pick(r, ["totals.games", "lifetime_games"]);
  const wTot_api = pick(r, ["totals.wins", "wins"]);
  const dTot_api = pick(r, ["totals.draws", "draws"]);
  const lTot_api = pick(r, ["totals.losses", "losses"]);

  const games_csv = toNumberOrNull(getCsv(["Games", "games", "Lifetime Games", "Recent Games"]));
  const wdl_csv = parseWDL(getCsv(["W-D-L", "WDL"]));
  const w_csv = toNumberOrNull(getCsv(["Wins", "wins", "Recent Wins"]));
  const d_csv = toNumberOrNull(getCsv(["Draws", "draws", "Recent Draws"]));
  const l_csv = toNumberOrNull(getCsv(["Losses", "losses", "Recent Losses"]));

  const gTot = gTot_api ?? games_csv ?? (wdl_csv ? wdl_csv[0] + wdl_csv[1] + wdl_csv[2] : null) ?? parsed.games ?? null;
  const wTot = wTot_api ?? (wdl_csv ? wdl_csv[0] : w_csv ?? null);
  const dTot = dTot_api ?? (wdl_csv ? wdl_csv[1] : d_csv ?? null);
  const lTot = lTot_api ?? (wdl_csv ? wdl_csv[2] : l_csv ?? null);

  // Elo totals (API first, CSV fallback, then reasons)
  const eloGain = pick(r, ["totals.elo.gain", "elo_gain"]) ?? toNumberOrNull(getCsv(["Elo Gain", "EloGain"])) ?? null;
  const eloLoss = pick(r, ["totals.elo.loss", "elo_loss"]) ?? toNumberOrNull(getCsv(["Elo Loss", "EloLoss"])) ?? null;
  let eloRatio = pick(r, ["totals.elo.ratio", "elo_ratio"]) ?? toNumberOrNull(getCsv(["Elo Ratio", "EloRatio", "EloR"])) ?? parsed.elo ?? null;

  // Tournament split
  const tGames = pick(r, ["tournament.games"]) ?? toNumberOrNull(getCsv(["T Games", "TGames"])) ?? null;
  const tW = pick(r, ["tournament.wins"]) ?? toNumberOrNull(getCsv(["T Wins", "TW"])) ?? null;
  const tD = pick(r, ["tournament.draws"]) ?? toNumberOrNull(getCsv(["T Draws", "TD"])) ?? null;
  const tL = pick(r, ["tournament.losses"]) ?? toNumberOrNull(getCsv(["T Losses", "TL"])) ?? null;
  let tEloR = pick(r, ["tournament.elo.ratio"]) ?? toNumberOrNull(getCsv(["T Elo Ratio", "TEloR"])) ?? parsed.tElo ?? null;
  const tWR_api = pick(r, ["tournament.win_rate"]);
  const tWR_csv = toNumberOrNull(getCsv(["TWR", "TWR%", "T Win Rate", "Tournament Win Rate"]));
  const tWR = tWR_api ?? tWR_csv;

  // Non-tournament split
  const ntGames = pick(r, ["non_tournament.games"]) ?? toNumberOrNull(getCsv(["NT Games", "NTGames"])) ?? null;
  const ntW = pick(r, ["non_tournament.wins"]) ?? toNumberOrNull(getCsv(["NT Wins", "NTW"])) ?? null;
  const ntD = pick(r, ["non_tournament.draws"]) ?? toNumberOrNull(getCsv(["NT Draws", "NTD"])) ?? null;
  const ntL = pick(r, ["non_tournament.losses"]) ?? toNumberOrNull(getCsv(["NT Losses", "NTL"])) ?? null;
  let ntEloR = pick(r, ["non_tournament.elo.ratio"]) ?? toNumberOrNull(getCsv(["NT Elo Ratio", "NTEloR"])) ?? parsed.ntElo ?? null;
  const ntWR_api = pick(r, ["non_tournament.win_rate"]);
  const ntWR_csv = toNumberOrNull(getCsv(["NTWR", "NTWR%", "NT Win Rate", "Non-Tournament Win Rate"]));
  const ntWR = ntWR_api ?? ntWR_csv;

  // Derived gaps
  const wrGap =
    tWR != null && ntWR != null
      ? (fmtPctNum(tWR) ?? 0) - (fmtPctNum(ntWR) ?? 0)
      : null;
  const eloRatioGap =
    tEloR != null && ntEloR != null
      ? (Number(tEloR) - Number(ntEloR))
      : parsed.gap ?? null;

  const onlyT = (tGames ?? 0) > 0 && (ntGames ?? 0) === 0;

  const whyElo =
    eloRatio != null
      ? eloRatio < 1
        ? "An Elo ratio < 1.0 means the player is underperforming compared to rating expectations over this sample."
        : "An Elo ratio > 1.0 means the player is outperforming rating expectations over this sample."
      : "With missing Elo data, we can’t compare performance to rating expectations here.";

  // pretty render helpers
  const dash = (v: any) => (v == null ? "—" : v);
  const ratioStr = (v: any) => (v == null ? "n/a" : Number(v).toFixed(3));

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold mb-1">
        🔹 Player Profile: <span className="font-mono">{row.username}</span>
      </h3>

      <section>
        <div className="font-semibold">Lifetime Games: {dash(gTot)}</div>
        <div>Wins: {dash(wTot)} • Draws: {dash(dTot)} • Losses: {dash(lTot)}</div>
      </section>

      <section>
        <div className="font-semibold">🔹 Elo Accounting</div>
        <div>Elo Gain: {fmtNum(eloGain)}</div>
        <div>Elo Loss: {fmtNum(eloLoss)}</div>
        <div>Elo Ratio: {ratioStr(eloRatio)}</div>
        <p className="text-sm text-slate-600 mt-1">Why it matters: {whyElo}</p>
      </section>

      <section>
        <div className="font-semibold">🔹 Tournament</div>
        <div>Games: {dash(tGames)} • W/D/L: {dash(tW)} / {dash(tD)} / {dash(tL)}</div>
        <div>Elo Ratio: {ratioStr(tEloR)}</div>
        <div>Win Rate: {tWR != null ? fmtPct(tWR) : "n/a"}</div>
        <p className="text-sm text-slate-600 mt-1">
          Why it matters: {onlyT ? "All recorded games are tournament games, so this shows true competitive performance." : "Tournament performance can differ from casual play; comparing both helps context."}
        </p>
      </section>

      <section>
        <div className="font-semibold">🔹 Non-Tournament</div>
        <div>Games: {dash(ntGames)}</div>
        <div>Elo Ratio: {ratioStr(ntEloR)}</div>
        <div>Win Rate: {ntWR != null ? fmtPct(ntWR) : "n/a"}</div>
        <p className="text-sm text-slate-600 mt-1">
          Why it matters: {ntGames === 0 ? "With no casual games, no comparison can be made vs. tournament play." : "Casual play offers a baseline to compare with tournament performance."}
        </p>
      </section>

      <section>
        <div className="font-semibold">🔹 Comparative Ratios</div>
        <div>Elo Ratio Gap (T − NT): {eloRatioGap != null ? eloRatioGap.toFixed(3) : "n/a"}</div>
        <div>WR Gap (T − NT): {wrGap != null ? `${wrGap.toFixed(1)}%` : "n/a"}</div>
      </section>
    </div>
  );
} // end PlayerProfile

// ---------- Main App ----------
export default function App() {
  const [bulkInput, setBulkInput] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [apiOK, setApiOK] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Lazy modal: store username only; derive row on render.
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const selectedRow = useMemo(() => {
    if (!selectedUsername) return null;
    return rows.find((r) => r.username.toLowerCase() === selectedUsername.toLowerCase()) || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUsername, rows]);

  useEffect(() => {
    checkApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apiBadge = useMemo(() => {
    if (apiOK === null) return "checking…";
    return apiOK ? "online" : "offline";
  }, [apiOK]);

  async function checkApi() {
    try {
      const ok = await health();
      setApiOK(ok);
      setErr(null);
    } catch (e: any) {
      setApiOK(false);
      setErr(e?.message ?? String(e));
    }
  }

  function queue(usernames: string[]) {
    const now = Date.now();
    const initial: Row[] = usernames.map((u) => ({
      username: u,
      status: "queued",
      startedAt: now,
    }));
    setRows((prev) => {
      const without = prev.filter((r) => !usernames.includes(r.username));
      return [...without, ...initial];
    });
  }

  async function runScans() {
    const list = uniqUsernames(bulkInput);
    if (!list.length) {
      setErr("Enter at least one username (separate with spaces, commas, or newlines).");
      return;
    }
    setErr(null);
    setBusy(true);
    queue(list);

    for (const u of list) {
      if (!u) continue;
      const startedAt = Date.now();
      setRows((prev) =>
        prev.map((r) =>
          r.username.toLowerCase() === u.toLowerCase() ? { ...r, status: "running", startedAt } : r
        )
      );

      try {
        const result = await scan(u);
        const finishedAt = Date.now();
        setRows((prev) => {
          const without = prev.filter((r) => r.username.toLowerCase() !== u.toLowerCase());
          return [...without, { username: u, status: "done", result, startedAt, finishedAt }];
        });
      } catch (e: any) {
        const finishedAt = Date.now();
        const msg = e?.message ?? String(e);
        setRows((prev) => {
          const without = prev.filter((r) => r.username.toLowerCase() !== u.toLowerCase());
          return [
            ...without,
            {
              username: u,
              status: "error",
              error: msg,
              startedAt,
              finishedAt,
              notFound: /404|not.?found/i.test(msg),
            },
          ];
        });
      }
    }

    setBusy(false);
  }

  function clearResults() {
    setRows([]);
    setSelectedUsername(null);
  }

  const completedRows = useMemo(
    () => rows.filter((r) => r.status === "done" && r.result),
    [rows]
  );

  // Build CSV rows AS the table builds (whenever results change)
  const rawCsvRows = useMemo(() => {
    try {
      return (buildRawCsvRows as any)(completedRows) ?? [];
    } catch {
      return [];
    }
  }, [completedRows]);

  // Fast lookup by username (case-insensitive)
  const csvByUser = useMemo(() => {
    const map: Record<string, any> = {};
    if (Array.isArray(rawCsvRows)) {
      for (const row of rawCsvRows as any[]) {
        const uname = (row?.username ?? row?.User ?? row?.user ?? "")
          .toString()
          .toLowerCase();
        if (uname) map[uname] = row;
      }
    } else if (rawCsvRows && typeof rawCsvRows === "object") {
      for (const [k, v] of Object.entries(rawCsvRows as any)) {
        map[k.toLowerCase()] = v;
      }
    }
    return map;
  }, [rawCsvRows]);

  // ---- Close button color (based on SUSPICION_THRESHOLDS) ----
  const selScore = selectedRow?.result?.suspicion_score ?? null;
  const sevBg = selScore != null ? severityColor(selScore) : "bg-slate-300";
  const closeBtnClass =
    `${sevBg} ${textOnBgClass(sevBg)} hover:opacity-90 ` +
    "focus:outline-none focus:ring-2 focus:ring-black/10";

  // ---- Download strict CSV (only requested columns, ordered) ----
  function downloadResults() {
    if (!completedRows.length) return;
    try {
      const downloadRows = buildDownloadCsvRowsStrict(completedRows, csvByUser);
      const csv = toCsv(downloadRows);
      const filename = `sus-scanner-download-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadTextFile(csv, filename);
    } catch (e: any) {
      setErr(`CSV build failed: ${e?.message ?? String(e)}`);
    }
  }

  return (
    <div className="min-h-screen bg-[url('../public/bg.png')] bg-cover bg-center bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-slate-100 p-4 md:p-6">



      
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Top */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl sm:text-4xl font-bold text-lime-300 drop-shadow-xl">
            SusScanner 1.5 <span className="text-red-500">BETA</span>
          </h1>
          <div className="text-sm">
            <span className="px-2 py-1 rounded bg-slate-800/60 mr-2">
              API: <strong className={apiOK ? "text-green-400" : "text-red-400"}>{apiBadge}</strong>
            </span>
            <span className="px-2 py-1 rounded bg-slate-800/60">
              Base: <code>{API_BASE}</code>
            </span>
          </div>
        </div>

        {/* Beta banner */}
        <BetaBanner />

        {/* Input */}
        <div className="rounded-lg bg-white/10 border border-white/10 p-3 shadow">
          <label className="block text-sm mb-2">Usernames (comma, space, or newline separated)</label>
          <textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            placeholder="e.g. AlAlper, DR4GnDrop, SmyslovFan"
            rows={4}
            className="w-full rounded-md bg-slate-950/60 border border-slate-700 px-3 py-2 text-slate-100 placeholder:text-slate-400"
          />
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={runScans}
              disabled={busy}
              className="inline-flex items-center rounded-xl bg-lime-500/90 hover:bg-lime-500 px-4 py-2 font-medium disabled:opacity-50"
              title="Queue & run scans"
            >
              {busy ? "Scanning…" : "Scan"}
            </button>
            <button
              onClick={clearResults}
              disabled={!rows.length || busy}
              className="inline-flex items-center rounded-xl bg-yellow-500 hover:bg-yellow-400 px-3 py-2 font-medium disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Clear Results
            </button>
            <button
              onClick={downloadResults}
              disabled={!completedRows.length || busy}
              className="inline-flex items-center rounded-xl bg-yellow-600 hover:bg-yellow-500 px-3 py-2 font-medium disabled:opacity-30 disabled:cursor-not-allowed"
              title="Download CSV (strict columns)"
            >
              Download CSV
            </button>
            <button
              onClick={checkApi}
              className="inline-flex items-center rounded-lg px-2 py-1 border border-slate-600 hover:bg-slate-800 text-xs"
              title="Re-check API health"
              style={{ height: "28px" }}
            >
              Retry
            </button>
          </div>

          {err && (
            <div className="mt-3 rounded bg-red-700/80 text-white px-3 py-2 shadow">{err}</div>
          )}
        </div>

        {/* Results */}
        {rows.length > 0 && (
          <div className="rounded-lg bg-white/60 text-slate-900 shadow p-3">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/80">
                  <tr>
                    <th className="px-2 py-2 text-left">Severity</th>
                    <th className="px-2 py-2 text-left">User</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Suspicion</th>
                    <th className="px-2 py-2">Reasons</th>
                    <th className="px-2 py-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort((a, b) => {
                      const aScore = a.result?.suspicion_score ?? -Infinity;
                      const bScore = b.result?.suspicion_score ?? -Infinity;
                      if (aScore !== bScore) return bScore - aScore; // desc
                      return a.username.toLowerCase().localeCompare(b.username.toLowerCase()); // tie-breaker
                    })
                    .map((r) => {
                      const score = r.result?.suspicion_score ?? null;
                      const reasons = r.result?.reasons;
                      const finishedMs =
                        r.finishedAt && r.startedAt ? r.finishedAt - r.startedAt : undefined;
                      return (
                        <tr key={r.username} className="odd:bg-white even:bg-slate-50">
                          <td className="px-2 py-2">
                            <span
                              className={`inline-block w-3 h-3 rounded-full ${severityColor(score)}`}
                              title={score != null ? `Score: ${score.toFixed(2)}` : "Score: n/a"}
                            />
                          </td>
                          <td className="px-2 py-2 font-mono">
                            <button
                              onClick={() => setSelectedUsername(r.username)}
                              className="text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-200 rounded"
                              title="View player profile"
                            >
                              {r.username}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-center">
                            {r.status === "running" && <span className="text-amber-700">running…</span>}
                            {r.status === "queued" && <span className="text-slate-600">queued</span>}
                            {r.status === "done" && <span className="text-green-700">done</span>}
                            {r.status === "error" && (
                              <span className="text-red-700" title={r.error ?? ""}>
                                error
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {score != null ? score.toFixed(2) : "—"}
                          </td>
                          <td className="px-2 py-2">
                            {shortReasons(reasons) || <span className="text-slate-400">(none)</span>}
                          </td>
                          <td className="px-2 py-2 text-center">{msFmt(finishedMs)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-6">
              {SUSPICION_THRESHOLDS.map((t, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className={`w-3 h-3 rounded-full inline-block ${t.color}`} />
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Profile Modal — created/rendered ONLY when a username is clicked */}
      <Modal
        open={!!selectedRow}
        onClose={() => setSelectedUsername(null)}
        closeClassName={closeBtnClass}
      >
        {selectedRow ? (
          selectedRow.status === "done" && selectedRow.result ? (
            <PlayerProfile
              row={selectedRow}
              csvRow={csvByUser[selectedRow.username.toLowerCase()]}
            />
          ) : selectedRow.status === "error" ? (
            <div>
              <h3 className="text-lg font-semibold mb-2">
                Couldn’t load <span className="font-mono">{selectedRow.username}</span>
              </h3>
              <p className="text-sm text-slate-700">
                {selectedRow.notFound ? "User not found." : selectedRow.error ?? "Unknown error."}
              </p>
            </div>
          ) : (
            <div>
              <h3 className="text-lg font-semibold mb-2">
                <span className="font-mono">{selectedRow.username}</span>
              </h3>
              <p className="text-sm text-slate-700">Still scanning… open this again when the row is done.</p>
            </div>
          )
        ) : null}
      </Modal>

      <footer className="mt-8 text-center text-[11px] text-slate-400/80">v{BUILD_VERSION}</footer>
    </div>
  );
}
