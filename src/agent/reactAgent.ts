// ============================================================
// agent/reactAgent.ts — ReAct-style agent loop for ShopWave
// ============================================================

import {
  GoogleGenerativeAI,
  FunctionCallingMode,
  SchemaType,
  Tool,
  Part,
  Content,
} from "@google/generative-ai";
import {
  Ticket,
  TicketResolution,
  ToolCallLog,
  ToolResult,
  TicketStatus,
  TicketCategory,
  TicketUrgency,
} from "../types";
import * as tools from "../tools/mockTools";
import { timedToolCall } from "../utils/retry";
import { logger } from "../utils/logger";
import { parseGeminiQuotaError, isGemini429 } from "../utils/quota";

// ── Gemini Tool Declarations ────────────────────────────────

const TOOL_DECLARATIONS: Tool = {
  functionDeclarations: [
    {
      name: "get_order",
      description: "Get order details, status, and timestamps by order ID",
      parameters: {
        type: SchemaType.OBJECT,
        properties: { order_id: { type: SchemaType.STRING, description: "The order ID" } },
        required: ["order_id"],
      },
    },
    {
      name: "get_customer",
      description: "Get customer profile, tier, and history by email",
      parameters: {
        type: SchemaType.OBJECT,
        properties: { email: { type: SchemaType.STRING, description: "Customer email address" } },
        required: ["email"],
      },
    },
    {
      name: "get_product",
      description: "Get product metadata, category, and warranty information",
      parameters: {
        type: SchemaType.OBJECT,
        properties: { product_id: { type: SchemaType.STRING, description: "The product ID" } },
        required: ["product_id"],
      },
    },
    {
      name: "check_refund_eligibility",
      description: "Check if an order is eligible for refund. MUST be called before issue_refund.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: { order_id: { type: SchemaType.STRING, description: "The order ID to check" } },
        required: ["order_id"],
      },
    },
    {
      name: "issue_refund",
      description:
        "IRREVERSIBLE: Issue a refund for an order. Only call after check_refund_eligibility confirms eligible=true.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          order_id: { type: SchemaType.STRING, description: "The order ID" },
          amount: { type: SchemaType.NUMBER, description: "Refund amount in USD" },
        },
        required: ["order_id", "amount"],
      },
    },
    {
      name: "send_reply",
      description: "Send a reply to the customer for this ticket",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ticket_id: { type: SchemaType.STRING, description: "The ticket ID" },
          message: { type: SchemaType.STRING, description: "The reply message to send" },
        },
        required: ["ticket_id", "message"],
      },
    },
    {
      name: "escalate",
      description: "Escalate ticket to a human agent when uncertain or complex",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          ticket_id: { type: SchemaType.STRING, description: "The ticket ID" },
          summary: {
            type: SchemaType.STRING,
            description: "Structured summary of the issue and actions taken",
          },
          priority: {
            type: SchemaType.STRING,
            enum: ["urgent", "high", "medium"],
            description: "Escalation priority level",
          },
        },
        required: ["ticket_id", "summary", "priority"],
      },
    },
    {
      name: "search_knowledge_base",
      description: "Semantic search over ShopWave policy and FAQ documents",
      parameters: {
        type: SchemaType.OBJECT,
        properties: { query: { type: SchemaType.STRING, description: "Search query" } },
        required: ["query"],
      },
    },
  ],
};

// ── Helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 0–500 ms random jitter to spread concurrent API calls */
function jitter(): number {
  return Math.floor(Math.random() * 500);
}

// ── Typed Tool Dispatch ────────────────────────────────────
//
// Each entry is typed to its exact return so we avoid unsafe casts.
// The union on ToolResult<…> is widened to ToolResult<unknown> at the
// call site, which is safe because executeTool only inspects the
// success/error shape — never the concrete data type.

type ToolFn = (args: Record<string, unknown>) => Promise<ToolResult<unknown>>;

function buildToolDispatch(): Record<string, ToolFn> {
  return {
    get_order: (a) =>
      tools.get_order(a.order_id as string) as Promise<ToolResult<unknown>>,

    get_customer: (a) =>
      tools.get_customer(a.email as string) as Promise<ToolResult<unknown>>,

    get_product: (a) =>
      tools.get_product(a.product_id as string) as Promise<ToolResult<unknown>>,

    check_refund_eligibility: (a) =>
      tools.check_refund_eligibility(a.order_id as string) as Promise<ToolResult<unknown>>,

    issue_refund: (a) =>
      tools.issue_refund(
        a.order_id as string,
        a.amount as number
      ) as Promise<ToolResult<unknown>>,

    send_reply: (a) =>
      tools.send_reply(
        a.ticket_id as string,
        a.message as string
      ) as Promise<ToolResult<unknown>>,

    escalate: (a) =>
      tools.escalate(
        a.ticket_id as string,
        a.summary as string,
        a.priority as "urgent" | "high" | "medium"
      ) as Promise<ToolResult<unknown>>,

    search_knowledge_base: (a) =>
      tools.search_knowledge_base(a.query as string) as Promise<ToolResult<unknown>>,
  };
}

// ── Tool Executor ──────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ticketId: string
): Promise<{ result: unknown; log: ToolCallLog }> {
  const timestamp = new Date().toISOString();
  const dispatch = buildToolDispatch();
  const fn = dispatch[name];

  if (!fn) {
    const log: ToolCallLog = {
      tool: name,
      input: args,
      output: null,
      status: "error",
      duration_ms: 0,
      timestamp,
      error: `Unknown tool: ${name}`,
    };
    logger.toolCall(ticketId, name, "error", 0);
    return { result: { error: log.error }, log };
  }

  const { result, duration_ms } = await timedToolCall(
    () => fn(args),
    name,
    ticketId
  );

  // result is ToolResult<unknown> — we inspect the discriminant only
  const status: ToolCallLog["status"] = result.success
    ? "success"
    : result.type === "timeout"
    ? "timeout"
    : result.type === "malformed"
    ? "malformed"
    : "error";

  const log: ToolCallLog = {
    tool: name,
    input: args,
    output: result.success ? result.data : null,
    status,
    duration_ms,
    timestamp,
    error: result.success ? undefined : result.error,
  };

  // Single logger.toolCall call — timedToolCall does NOT log it separately
  logger.toolCall(ticketId, name, status, duration_ms);

  return {
    result: result.success ? result.data : { error: result.error },
    log,
  };
}

// ── System Prompt ──────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an autonomous support resolution agent for ShopWave, an e-commerce platform.
Your goal is to resolve customer support tickets efficiently and accurately in as few steps as possible.

RULES:
1. Use tools ONLY when necessary — do NOT call tools speculatively or make redundant calls.
2. For refunds: ALWAYS call check_refund_eligibility BEFORE issue_refund. Never skip this.
3. issue_refund is IRREVERSIBLE — be certain before calling it.
4. Escalate if: account is flagged, refund amount > $300, complex billing disputes, or you are unsure.
5. If any tool fails, gracefully continue using available information.
6. ALWAYS end by calling send_reply (resolved) OR escalate (uncertain). Never leave a ticket open.
7. Keep reasoning concise — do NOT over-explain.

EFFICIENCY:
- Prefer the minimum number of tool calls needed to resolve the ticket.
- If the ticket contains an order ID, use it directly — don't look it up from the customer first.
- Do NOT call search_knowledge_base unless you genuinely need policy guidance.

CONFIDENCE SCORING:
After calling send_reply or escalate, output a single JSON block on its own line:
{"category": "refund_request", "urgency": "high", "confidence": 0.92, "status": "resolved", "reasoning": "..."}

Categories: refund_request, order_tracking, product_inquiry, account_issue, payment_problem, shipping_delay, damaged_item, wrong_item, cancellation, general_inquiry
Urgency: critical, high, medium, low
Status: resolved, escalated`;
}

// ── Parse confidence JSON from model text ─────────────────

function parseFinalDecision(text: string): {
  category: TicketCategory;
  urgency: TicketUrgency;
  confidence: number;
  status: TicketStatus;
  reasoning: string;
} {
  try {
    const match = text.match(/\{[^{}]*"category"[^{}]*\}/s);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        category: (parsed.category as TicketCategory) ?? "general_inquiry",
        urgency: (parsed.urgency as TicketUrgency) ?? "medium",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
        status: (parsed.status as TicketStatus) ?? "resolved",
        reasoning: (parsed.reasoning as string) ?? text.substring(0, 200),
      };
    }
  } catch {
    // fall through to safe defaults
  }
  return {
    category: "general_inquiry",
    urgency: "medium",
    confidence: 0.5,
    status: "resolved",
    reasoning: text.substring(0, 300),
  };
}

// ── Main ReAct Loop ────────────────────────────────────────

/**
 * processTicket — runs the ReAct reasoning loop for a single ticket.
 *
 * Logging of "Starting → Subject" is the caller's (index.ts) responsibility.
 * This function only logs mid-loop events and the final Done line.
 */
export async function processTicket(
  ticket: Ticket,
  genAI: GoogleGenerativeAI
): Promise<TicketResolution> {
  const startTime = Date.now();
  const toolCallLogs: ToolCallLog[] = [];
  const actionsTaken: string[] = [];

  // Model is configurable via GEMINI_MODEL env var.
  // Switch to gemini-1.5-flash if gemini-2.0-flash daily quota is exhausted.
  const modelName = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: buildSystemPrompt(),
    tools: [TOOL_DECLARATIONS],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
  });
  logger.debug(`[Ticket ${ticket.id}] Using model: ${modelName}`);

  const userMessage = [
    `Ticket ID: ${ticket.id}`,
    `Customer Email: ${ticket.customer_email}`,
    `Subject: ${ticket.subject}`,
    `Body: ${ticket.body}`,
    ticket.order_id ? `Order ID: ${ticket.order_id}` : "",
    ticket.product_id ? `Product ID: ${ticket.product_id}` : "",
    `Created At: ${ticket.created_at}`,
    "",
    "Resolve this ticket. Use tools only as needed. End with send_reply or escalate.",
  ]
    .filter(Boolean)
    .join("\n");

  const history: Content[] = [{ role: "user", parts: [{ text: userMessage }] }];

  let finalText = "";
  const MAX_TURNS = 5;
  let turnCount = 0;
  let earlyExit = false;

  // ── Agent Loop ───────────────────────────────────────────
  while (turnCount < MAX_TURNS && !earlyExit) {
    turnCount++;

    // Throttle: 1–1.5s between Gemini calls (skip before the very first)
    if (turnCount > 1) {
      await sleep(1_000 + jitter());
    }

    let response;
    try {
      response = await model.generateContent({ contents: history });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      if (isGemini429(errMsg)) {
        const parsed = parseGeminiQuotaError(errMsg);
        const kind = parsed?.kind ?? "unknown";
        const summary = parsed?.summary ?? errMsg.substring(0, 200);

        logger.warn(
          `[Ticket ${ticket.id}] 🚨 Gemini 429 (${kind}) on turn ${turnCount}: ${summary}`
        );

        // Annotate the error so index.ts can tell per-day from per-minute
        // without re-parsing the message a second time.
        if (err instanceof Error) {
          (err as Error & { quotaKind: string; retryAfterMs: number })[
            "quotaKind"
          ] = kind;
          (err as Error & { quotaKind: string; retryAfterMs: number })[
            "retryAfterMs"
          ] = parsed?.retryAfterMs ?? 60_000;
        }
        throw err;
      }

      logger.error(`[Ticket ${ticket.id}] Gemini error on turn ${turnCount}: ${errMsg}`);
      break;
    }

    const candidate = response.response.candidates?.[0];
    if (!candidate) {
      logger.warn(`[Ticket ${ticket.id}] No candidate on turn ${turnCount} — breaking`);
      break;
    }

    const parts = candidate.content.parts;
    history.push({ role: "model", parts });

    // Collect text parts
    const textParts = parts.filter((p: Part) => "text" in p && p.text);
    for (const tp of textParts) {
      if ("text" in tp && tp.text) {
        finalText += tp.text + "\n";
      }
    }

    // Find tool call parts
    const toolCallParts = parts.filter((p: Part) => "functionCall" in p && p.functionCall);

    if (toolCallParts.length === 0) {
      // Model has finished reasoning with no further tool calls
      break;
    }

    // Execute ONLY the first tool call per turn (prevents burst API usage)
    const firstPart = toolCallParts[0];
    if (!("functionCall" in firstPart) || !firstPart.functionCall) break;

    const { name, args } = firstPart.functionCall;
    const safeArgs = (args as Record<string, unknown>) ?? {};

    logger.ticket(ticket.id, `→ Tool: ${name}(${JSON.stringify(safeArgs)})`);

    const { result, log } = await executeTool(name, safeArgs, ticket.id);
    toolCallLogs.push(log);
    actionsTaken.push(`${name}(${JSON.stringify(safeArgs)})`);

    // Feed result back WITHOUT JSON.stringify — Gemini expects the raw object
    const toolResultPart: Part = {
      functionResponse: {
        name,
        response: { result },
      },
    };
    history.push({ role: "user", parts: [toolResultPart] });

    // Early exit on terminal actions
    if ((name === "send_reply" || name === "escalate") && log.status === "success") {
      earlyExit = true;
    }
  }

  // ── Final summary call ───────────────────────────────────
  // After a terminal tool, give the model one turn to emit its JSON block.
  if (earlyExit) {
    await sleep(1_000 + jitter());
    try {
      const summaryResponse = await model.generateContent({ contents: history });
      const summaryCandidate = summaryResponse.response.candidates?.[0];
      if (summaryCandidate) {
        for (const tp of summaryCandidate.content.parts) {
          if ("text" in tp && tp.text) {
            finalText += tp.text + "\n";
          }
        }
      }
    } catch {
      // Non-critical: we still have whatever text was collected
    }
  }

  const decision = parseFinalDecision(finalText);
  const processingTime = Date.now() - startTime;

  logger.ticket(
    ticket.id,
    `✔ Done → status=${decision.status} confidence=${decision.confidence} ` +
      `tools=${toolCallLogs.length} turns=${turnCount} time=${processingTime}ms`
  );

  return {
    ticket_id: ticket.id,
    category: decision.category,
    urgency: decision.urgency,
    status: decision.status,
    confidence_score: decision.confidence,
    reasoning: decision.reasoning,
    actions_taken: actionsTaken,
    tool_calls: toolCallLogs,
    processing_time_ms: processingTime,
    resolved_at: new Date().toISOString(),
    agent_version: "1.0.0",
  };
}
