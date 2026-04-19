// ============================================================
// index.ts — Entry point: loads tickets, processes sequentially,
//            saves audit log
// ============================================================

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Ticket, AuditLog, TicketResolution } from "./types";
import { processTicket } from "./agent/reactAgent";
import { logger } from "./utils/logger";
import { parseGeminiQuotaError, isGemini429 } from "./utils/quota";

// ── Environment validation ─────────────────────────────────

function validateEnv(): void {
  if (!process.env.GEMINI_API_KEY) {
    console.error("\x1b[31m[ERROR] GEMINI_API_KEY is not set.\x1b[0m");
    console.error("Copy .env.example to .env and add your Gemini API key.");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  logger.info(`Model: ${model} (override via GEMINI_MODEL env var)`);
}

// ── Ticket loading ─────────────────────────────────────────

function loadTickets(): Ticket[] {
  const ticketPath = path.join(__dirname, "../data/tickets.json");
  if (!fs.existsSync(ticketPath)) {
    logger.error(`Tickets file not found: ${ticketPath}`);
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = JSON.parse(fs.readFileSync(ticketPath, "utf-8"));

  return raw.map((t, i): Ticket => ({
    id: (t.ticket_id as string | undefined) ?? `TKT-${String(i + 1).padStart(3, "0")}`,
    customer_email: t.customer_email as string,
    subject: t.subject as string,
    body: t.body as string,
    created_at: t.created_at as string,
    order_id: t.order_id as string | undefined,
    product_id: t.product_id as string | undefined,
  }));
}

// ── Audit log ─────────────────────────────────────────────

function saveAuditLog(log: AuditLog): void {
  const logDir = path.join(__dirname, "../logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const logPath = path.join(logDir, "audit_log.json");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  logger.info(`✅ Audit log saved → ${logPath}`);
}

// ── Summary banner ─────────────────────────────────────────

function printSummary(log: AuditLog): void {
  const durationMs =
    new Date(log.completed_at).getTime() - new Date(log.started_at).getTime();

  console.log("\n" + "═".repeat(60));
  console.log("  🤖 ShopWave Agent — Run Complete");
  console.log("═".repeat(60));
  console.log(`  Run ID         : ${log.run_id}`);
  console.log(`  Total Tickets  : ${log.total_tickets}`);
  console.log(`  ✅ Resolved    : ${log.resolved}`);
  console.log(`  🚨 Escalated   : ${log.escalated}`);
  console.log(`  ❌ Failed      : ${log.failed}`);
  console.log(`  Tool Calls     : ${log.total_tool_calls}`);
  console.log(`  Tool Failures  : ${log.tool_failures}`);
  console.log(`  Avg Confidence : ${(log.avg_confidence * 100).toFixed(1)}%`);
  console.log(`  Duration       : ${durationMs}ms`);
  console.log("═".repeat(60) + "\n");
}

// ── Quota error sentinel ───────────────────────────────────

/**
 * Thrown when a per-day (daily) Gemini quota is exhausted.
 * Signals the main loop to abort processing — retrying other
 * tickets would also fail, so we save the partial audit log
 * and exit cleanly.
 */
class DailyQuotaExhaustedError extends Error {
  constructor(model: string) {
    super(
      `Daily free-tier quota exhausted for model "${model}".\n` +
        `The quota resets at midnight Pacific time (Google).
` +
        `To continue immediately, set GEMINI_MODEL=gemini-1.5-flash in .env\n` +
        `(gemini-1.5-flash has a separate daily quota of 1,500 RPD).`
    );
    this.name = "DailyQuotaExhaustedError";
  }
}

// ── Rate-limit-aware ticket processor ─────────────────────

const MAX_TICKET_ATTEMPTS = 3;

/**
 * processWithRetry — processes a single ticket with 429-aware retry.
 *
 * per_minute quota: waits the server-supplied delay, retries up to MAX_TICKET_ATTEMPTS.
 * per_day quota:    throws DailyQuotaExhaustedError immediately — no point retrying.
 * Other errors:     logged and returned as a "failed" resolution.
 */
async function processWithRetry(
  ticket: Ticket,
  genAI: GoogleGenerativeAI,
  attempt = 1
): Promise<TicketResolution> {
  if (attempt === 1) {
    logger.info(`[Ticket ${ticket.id}] ▶ Starting → Subject: "${ticket.subject}"`);
  } else {
    logger.info(
      `[Ticket ${ticket.id}] ↩ Retry attempt ${attempt}/${MAX_TICKET_ATTEMPTS} → Subject: "${ticket.subject}"`
    );
  }

  try {
    return await processTicket(ticket, genAI);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (isGemini429(errMsg)) {
      // Read the .quotaKind annotation set by reactAgent.ts
      // so we don't re-parse the long error string.
      const annotated = err as Error & { quotaKind?: string; retryAfterMs?: number };
      const kind = annotated.quotaKind ?? parseGeminiQuotaError(errMsg)?.kind ?? "unknown";
      const retryAfterMs = annotated.retryAfterMs ?? parseGeminiQuotaError(errMsg)?.retryAfterMs ?? 60_000;
      const modelName = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

      // ── PER-DAY exhaustion → abort the run ──────────────────
      if (kind === "per_day") {
        logger.error(
          `[Ticket ${ticket.id}] 🚨 DAILY QUOTA EXHAUSTED for model "${modelName}".\n` +
            `  Quota resets at midnight Pacific.\n` +
            `  FIX: Add GEMINI_MODEL=gemini-1.5-flash to .env and restart.`
        );
        throw new DailyQuotaExhaustedError(modelName);
      }

      // ── PER-MINUTE → wait + retry ───────────────────────────
      if (attempt < MAX_TICKET_ATTEMPTS) {
        const waitSec = Math.round(retryAfterMs / 1_000);
        logger.warn(
          `[Ticket ${ticket.id}] 🟡 Per-minute limit (attempt ${attempt}/${MAX_TICKET_ATTEMPTS}). ` +
            `Waiting ${waitSec}s…`
        );
        await new Promise<void>((r) => setTimeout(r, retryAfterMs));
        return processWithRetry(ticket, genAI, attempt + 1);
      }

      // Retries exhausted for this ticket
      const reason = `Per-minute rate-limited after ${MAX_TICKET_ATTEMPTS} attempts`;
      logger.error(`[Ticket ${ticket.id}] ❌ ${reason}`);
      return makeFailedResolution(ticket.id, reason);
    }

    // Non-429 error
    const reason = `Unhandled error: ${errMsg}`;
    logger.error(`[Ticket ${ticket.id}] ❌ ${reason}`);
    return makeFailedResolution(ticket.id, reason);
  }
}

function makeFailedResolution(ticketId: string, reason: string): TicketResolution {
  return {
    ticket_id: ticketId,
    category: "general_inquiry",
    urgency: "medium",
    status: "failed",
    confidence_score: 0,
    reasoning: reason,
    actions_taken: [],
    tool_calls: [],
    processing_time_ms: 0,
    resolved_at: new Date().toISOString(),
    agent_version: "1.0.0",
  };
}

// ── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnv();

  console.log("\n" + "═".repeat(60));
  console.log("  🚀 ShopWave Autonomous Support Agent — Starting");
  console.log("═".repeat(60) + "\n");

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const tickets = loadTickets();

  logger.info(`Loaded ${tickets.length} ticket(s). Processing sequentially (concurrency=1).`);

  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const resolutions: TicketResolution[] = [];

  // Sequential processing — each ticket fully completes before the next starts.
  // On DailyQuotaExhaustedError we break early and save the partial audit log
  // so completed tickets are not lost.
  let dailyQuotaHit = false;

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];

    logger.info(`\n[${i + 1}/${tickets.length}] Processing ticket ${ticket.id}`);

    try {
      const resolution = await processWithRetry(ticket, genAI);
      resolutions.push(resolution);
    } catch (err) {
      if (err instanceof DailyQuotaExhaustedError) {
        console.error(`\n\x1b[31m${err.message}\x1b[0m\n`);
        dailyQuotaHit = true;
        // Mark remaining tickets as failed in the audit log
        for (let j = i; j < tickets.length; j++) {
          resolutions.push(makeFailedResolution(tickets[j].id, "Run aborted: daily quota exhausted"));
        }
        break;
      }
      // Unexpected non-quota fatal error
      throw err;
    }

    // Inter-ticket delay (skip after the last ticket processed)
    if (!dailyQuotaHit && i < tickets.length - 1) {
      const delayMs = 3_000 + Math.floor(Math.random() * 1_000); // 3–4s + jitter
      logger.debug(`Inter-ticket delay: ${delayMs}ms`);
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }

  if (dailyQuotaHit) {
    logger.warn(
      `⚠️  Run terminated early due to daily quota exhaustion. ` +
        `Partial results saved. Set GEMINI_MODEL=gemini-1.5-flash in .env to retry.`
    );
  }

  const completedAt = new Date().toISOString();
  const totalToolCalls = resolutions.reduce((s, r) => s + r.tool_calls.length, 0);
  const toolFailures = resolutions.reduce(
    (s, r) => s + r.tool_calls.filter((t) => t.status !== "success").length,
    0
  );

  const auditLog: AuditLog = {
    run_id: runId,
    started_at: startedAt,
    completed_at: completedAt,
    total_tickets: tickets.length,
    resolved: resolutions.filter((r) => r.status === "resolved").length,
    escalated: resolutions.filter((r) => r.status === "escalated").length,
    failed: resolutions.filter((r) => r.status === "failed").length,
    avg_confidence:
      resolutions.length > 0
        ? resolutions.reduce((s, r) => s + r.confidence_score, 0) / resolutions.length
        : 0,
    total_tool_calls: totalToolCalls,
    tool_failures: toolFailures,
    tickets: resolutions,
  };

  saveAuditLog(auditLog);
  printSummary(auditLog);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
