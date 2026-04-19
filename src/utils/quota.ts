// ============================================================
// utils/quota.ts — Gemini 429 error parser
//
// Parses the structured JSON Gemini embeds inside error messages
// to distinguish per-minute limits (retryable) from per-day
// exhaustion (fatal for the current run).
// ============================================================

export type QuotaErrorKind =
  | "per_minute"  // RPM exhausted — retry after the server delay
  | "per_day"     // RPD exhausted — no point retrying until quota resets
  | "unknown";    // Non-quota 429 — treat conservatively as per_minute

export interface ParsedQuotaError {
  kind: QuotaErrorKind;
  /**
   * How long to wait before retrying (ms).
   * Sourced from the embedded RetryInfo.retryDelay if available,
   * otherwise falls back to a safe default.
   */
  retryAfterMs: number;
  /** Human-readable summary for logging */
  summary: string;
}

const PER_MINUTE_QUOTA_ID_PATTERNS = [
  /PerMinute/i,
  /per_minute/i,
  /RequestsPerMinute/i,
];

const PER_DAY_QUOTA_ID_PATTERNS = [
  /PerDay/i,
  /per_day/i,
  /RequestsPerDay/i,
  /DailyLimit/i,
];

/**
 * Parses the Gemini SDK error message for structured quota information.
 *
 * Gemini SDK attaches a JSON array to the error message like:
 *   [{"@type":"...RetryInfo","retryDelay":"54s"}, {"@type":"...QuotaFailure","violations":[...]}]
 *
 * This function extracts that JSON and classifies the error.
 */
export function parseGeminiQuotaError(errMsg: string): ParsedQuotaError | null {
  // Must be a 429
  if (!errMsg.includes("429") && !errMsg.toLowerCase().includes("quota")) {
    return null;
  }

  // Try to extract the embedded JSON array from the Gemini SDK error string.
  // The SDK appends it after the human-readable part, starting with '[{'.
  const jsonMatch = errMsg.match(/\[\s*\{[\s\S]*\}\s*\]/);

  let retryAfterMs = 60_000; // safe default: 60s
  let kind: QuotaErrorKind = "unknown";
  let violatedQuotaIds: string[] = [];

  if (jsonMatch) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details: any[] = JSON.parse(jsonMatch[0]);

      // Extract retryDelay from the RetryInfo object
      const retryInfo = details.find((d) =>
        typeof d["@type"] === "string" && d["@type"].includes("RetryInfo")
      );
      if (retryInfo?.retryDelay) {
        // retryDelay is a string like "54s" or "0s"
        const seconds = parseInt(String(retryInfo.retryDelay), 10);
        if (!isNaN(seconds) && seconds > 0) {
          retryAfterMs = (seconds + 5) * 1_000; // add 5s buffer
        }
        // "0s" means retry immediately — keep the 60s safe default
      }

      // Extract violated quota IDs from QuotaFailure
      const quotaFailure = details.find((d) =>
        typeof d["@type"] === "string" && d["@type"].includes("QuotaFailure")
      );
      if (quotaFailure?.violations && Array.isArray(quotaFailure.violations)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        violatedQuotaIds = quotaFailure.violations.map((v: any) =>
          String(v.quotaId ?? "")
        );
      }
    } catch {
      // JSON parse failed — fall through with defaults
    }
  }

  // Fallback: try the prose "retry in Xs" pattern if JSON had no useful retryDelay
  if (retryAfterMs === 60_000) {
    const proseMatch = errMsg.match(/retry[^\d]*(\d+(?:\.\d+)?)\s*s/i);
    if (proseMatch) {
      const secs = parseFloat(proseMatch[1]);
      if (!isNaN(secs) && secs > 0) {
        retryAfterMs = Math.ceil(secs + 5) * 1_000;
      }
    }
  }

  // Classify: check if ANY violated quota is per-day
  const isPerDay = violatedQuotaIds.some((id) =>
    PER_DAY_QUOTA_ID_PATTERNS.some((p) => p.test(id))
  );
  const isPerMinute = violatedQuotaIds.some((id) =>
    PER_MINUTE_QUOTA_ID_PATTERNS.some((p) => p.test(id))
  );

  // If per-day quota violated → fatal for this run, no retry helps
  if (isPerDay) {
    kind = "per_day";
  } else if (isPerMinute) {
    kind = "per_minute";
  } else {
    // Could not determine from quota IDs — check prose
    if (
      errMsg.toLowerCase().includes("per day") ||
      errMsg.toLowerCase().includes("daily") ||
      errMsg.includes("PerDay")
    ) {
      kind = "per_day";
    } else {
      kind = "per_minute";
    }
  }

  const summary =
    kind === "per_day"
      ? `Daily quota exhausted for this model. Quota resets at midnight Pacific. ` +
        `Switch to a different model via GEMINI_MODEL env var or wait until tomorrow.`
      : `Per-minute quota hit. Will retry after ${Math.round(retryAfterMs / 1000)}s.`;

  return { kind, retryAfterMs, summary };
}

/**
 * Returns true if the error message is a Gemini 429 of any kind.
 */
export function isGemini429(errMsg: string): boolean {
  return errMsg.includes("429") || errMsg.toLowerCase().includes("quota exceeded");
}
