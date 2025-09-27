// web/src/types.ts

export interface ScanResult {
  username: string;

  // Core score & explanations
  suspicion_score: number;
  reasons?: string[] | string;

  // Optional metrics the backend may include
  lifetime_games?: number;
  lifetime_wins?: number;
  lifetime_draws?: number;
  lifetime_losses?: number;

  recent_games?: number;
  recent_wins?: number;
  recent_draws?: number;
  recent_losses?: number;

  win_streak?: number;
  max_win_streak?: number;

  upset_wins?: number;
  short_win_rate?: number;
  timeout_win_ratio?: number;

  tourn_games?: number;
  tourn_wins?: number;
  tourn_draws?: number;
  tourn_losses?: number;

  non_tourn_games?: number;
  non_tourn_wins?: number;
  non_tourn_draws?: number;
  non_tourn_losses?: number;

  tourn_win_rate?: number;
  non_tourn_win_rate?: number;
  wr_gap?: number;

  elo_gain?: number;
  elo_loss?: number;
  elo_ratio?: number;

  tourn_elo_gain?: number;
  tourn_elo_loss?: number;
  tourn_elo_ratio?: number;

  non_tourn_elo_gain?: number;
  non_tourn_elo_loss?: number;
  non_tourn_elo_ratio?: number;

  elo_ratio_gap?: number;

  t_self_bail_loss_ratio?: number;
  nt_self_bail_loss_ratio?: number;

  // Allow unknown future fields without breaking the UI
  [key: string]: unknown;
}

export type HealthResponse = { ok: boolean };

/**
 * Normalize `reasons` to an array.
 * Accepts arrays or strings separated by | , or ;  (with optional spaces).
 */
export function reasonsAsArray(input?: string[] | string): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return String(input)
    .split(/[|,;]+/)       // support pipe, comma, semicolon
    .map(s => s.trim())
    .filter(Boolean);
}
