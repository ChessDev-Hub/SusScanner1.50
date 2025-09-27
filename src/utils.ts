// utils.ts
export function parseUserInput(raw: string): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];

  // 1) JSON array?  ["u1","u2"]
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      return uniq(
        parsed
          .map((v) => String(v ?? "").trim())
          .filter(Boolean)
      );
    }
  } catch {
    // not JSON; fall through
  }

  // 2) split by newline or comma; strip quotes; dedupe case-insensitively
  return uniq(
    s.split(/[\n,]+/)
      .map((u) => u.replace(/["']/g, "").trim())
      .filter(Boolean)
  );
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of arr) {
    const key = u.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(u);
    }
  }
  return out;
}
