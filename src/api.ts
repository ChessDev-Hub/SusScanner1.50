// web/src/api.ts
import type { ScanResult } from "./types";

export const API_BASE = (() => {
  // 1) .env override (Vite): VITE_API_BASE="http://127.0.0.1:8000"
  const fromEnv = (import.meta as any)?.env?.VITE_API_BASE as string | undefined;
  if (fromEnv) return fromEnv;

  // 2) Auto-detect localhost in dev
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return "http://127.0.0.1:8000";
  }

  // 3) Default to Render in prod
  return "https://susscanner-1-5-api.onrender.com";
})();

export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function scan(username: string): Promise<ScanResult> {
  const res = await fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}${txt ? `: ${txt}` : ""}`);
  }
  return (await res.json()) as ScanResult;
}

/**
 * Run many scans client-side with limited concurrency.
 * Calls onPartial(result) as each username finishes.
 */
export async function scanEach(
  usernames: string[],
  onPartial: (r: ScanResult) => void,
  concurrency = 6
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < usernames.length) {
      const u = usernames[i++];
      try {
        const r = await scan(u);
        onPartial(r);
      } catch (e: any) {
        onPartial({
          username: u,
          suspicion_score: 0,
          reasons: [`Failed: ${e?.message ?? String(e)}`],
        });
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, usernames.length)) },
    worker
  );
  await Promise.all(workers);
}
