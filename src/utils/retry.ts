// ============================================================
// utils/retry.ts — Tool retry logic with adaptive backoff +
//                  global circuit breaker for rate limits
// ============================================================

import { logger } from "./logger";
import { ToolResult, ToolErrorType } from "../types";

// ── Types ──────────────────────────────────────────────────

interface RetryOptions {
  /** Maximum number of attempts (first attempt + retries). Default: 2 */
  maxAttempts: number;
  /** Base delay in ms for exponential backoff. Default: 500 */
  baseDelayMs: number;
  /** Hard ceiling on backoff delay. Default: 8000 */
  maxDelayMs: number;
  /** Ticket context for logging. */
  ticketId: string;
  /** Tool name for logging. */
  toolName: string;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  ticketId: "unknown",
  toolName: "unknown",
};

// ── Helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full-jitter backoff: random value in [0, cap] avoids thundering-herd. */
function fullJitterBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const cap = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  return Math.floor(Math.random() * cap);
}

/**
 * Compute the retry delay in ms.
 * - rate_limit: honour the server-supplied retry-after, falling back to 60s.
 * - timeout:    aggressive doubling since the service may be under load.
 * - others:     full-jitter exponential backoff.
 */
function getRetryDelay(
  attempt: number,
  opts: RetryOptions,
  errorType?: ToolErrorType,
  retryAfterMs?: number
): number {
  if (errorType === "rate_limit") {
    return retryAfterMs ?? 60_000;
  }
  if (errorType === "timeout") {
    return Math.min(1_000 * Math.pow(2, attempt), opts.maxDelayMs);
  }
  return fullJitterBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
}

// ── Circuit Breaker (module-scoped, shared across all calls) ──

let circuitOpenUntil = 0;

function isCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function openCircuit(durationMs: number): void {
  const until = Date.now() + durationMs;
  if (until > circuitOpenUntil) {
    circuitOpenUntil = until;
    logger.warn(`🚨 Circuit breaker OPEN for ${Math.round(durationMs / 1000)}s`);
  }
}

// ── Main Retry Wrapper ─────────────────────────────────────

/**
 * withRetry — executes `fn` up to `maxAttempts` times.
 *
 * Non-retryable immediately: not_found, malformed.
 * Triggers circuit breaker:  rate_limit.
 * Retryable with backoff:    timeout, server_error.
 */
export async function withRetry<T>(
  fn: () => Promise<ToolResult<T>>,
  options: Partial<RetryOptions> = {}
): Promise<ToolResult<T>> {
  const opts: RetryOptions = { ...DEFAULT_OPTIONS, ...options };
  let lastResult: ToolResult<T> | null = null;

  // Fast-fail if circuit is open
  if (isCircuitOpen()) {
    const waitMs = circuitOpenUntil - Date.now();
    logger.warn(
      `[Ticket ${opts.ticketId}] ⚡ Circuit open — skipping ${opts.toolName} (resets in ${Math.round(waitMs / 1000)}s)`
    );
    return { success: false, error: "Circuit breaker active", type: "server_error" };
  }

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const attemptStart = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - attemptStart;

      if (result.success) {
        if (attempt > 1) {
          logger.info(
            `[Ticket ${opts.ticketId}] ✅ ${opts.toolName} recovered on attempt ${attempt} (${duration}ms)`
          );
        }
        return result;
      }

      lastResult = result;

      // ── Non-retryable failures ───────────────────────────
      if (result.type === "not_found" || result.type === "malformed") {
        logger.warn(
          `[Ticket ${opts.ticketId}] ${opts.toolName} → ${result.type} (no retry): ${result.error}`
        );
        return result;
      }

      // ── Rate-limit handling ──────────────────────────────
      if (result.type === "rate_limit") {
        const retryAfter = result.retryAfterMs ?? 60_000;
        openCircuit(retryAfter);
        logger.warn(
          `[Ticket ${opts.ticketId}] ${opts.toolName} → rate_limit. ` +
            `Waiting ${Math.round(retryAfter / 1000)}s before attempt ${attempt + 1}/${opts.maxAttempts}`
        );
        await sleep(retryAfter);
        continue; // don't count as a failed attempt for backoff purposes
      }

      // ── Retryable failures ───────────────────────────────
      logger.warn(
        `[Ticket ${opts.ticketId}] ${opts.toolName} → ${result.type} ` +
          `(attempt ${attempt}/${opts.maxAttempts}, ${duration}ms): ${result.error}`
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - attemptStart;

      // Detect 429 thrown as an exception by the Gemini SDK
      if (errMsg.includes("429") || errMsg.toLowerCase().includes("quota")) {
        const retryAfterMatch = errMsg.match(/retry[^\d]*(\d+)\s*s/i);
        const retryAfterMs = retryAfterMatch
          ? (parseInt(retryAfterMatch[1], 10) + 2) * 1_000
          : 60_000;

        openCircuit(retryAfterMs);
        logger.warn(
          `[Ticket ${opts.ticketId}] ${opts.toolName} → 429 thrown (attempt ${attempt}/${opts.maxAttempts}, ${duration}ms). ` +
            `Waiting ${Math.round(retryAfterMs / 1000)}s`
        );
        lastResult = { success: false, error: errMsg, type: "rate_limit", retryAfterMs };
        await sleep(retryAfterMs);
        continue;
      }

      logger.error(
        `[Ticket ${opts.ticketId}] ${opts.toolName} threw exception ` +
          `(attempt ${attempt}/${opts.maxAttempts}, ${duration}ms): ${errMsg}`
      );
      lastResult = { success: false, error: errMsg, type: "server_error" };
    }

    // Backoff before next attempt (not after the last)
    if (attempt < opts.maxAttempts) {
      const failedType = lastResult?.success === false ? lastResult.type : undefined;
      const retryAfterMs =
        lastResult?.success === false ? lastResult.retryAfterMs : undefined;
      const delay = getRetryDelay(attempt, opts, failedType, retryAfterMs);

      logger.debug(
        `[Ticket ${opts.ticketId}] ⏳ Backoff ${delay}ms before attempt ${attempt + 1}/${opts.maxAttempts}`
      );
      await sleep(delay);
    }
  }

  // Dead-letter after all attempts exhausted
  logger.error(
    `[Ticket ${opts.ticketId}] 💀 ${opts.toolName} exhausted all ${opts.maxAttempts} attempts`,
    { last_error: lastResult?.success === false ? lastResult.error : "unknown" }
  );

  return (
    lastResult ?? {
      success: false,
      error: "Unknown failure after all retries",
      type: "server_error",
    }
  );
}

// ── Timed Tool Call ────────────────────────────────────────

/**
 * timedToolCall — wraps a tool fn with retry and wall-clock timing.
 * NOTE: does NOT emit its own logger.toolCall here; executeTool in
 * reactAgent.ts handles that to avoid double-logging.
 */
export async function timedToolCall<T>(
  fn: () => Promise<ToolResult<T>>,
  toolName: string,
  ticketId: string
): Promise<{ result: ToolResult<T>; duration_ms: number }> {
  const start = Date.now();
  const result = await withRetry(fn, { toolName, ticketId });
  return { result, duration_ms: Date.now() - start };
}