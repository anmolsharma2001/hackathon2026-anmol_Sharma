# Failure Mode Analysis — ShopWave Support Agent

## Overview

This document describes at least 3 critical failure scenarios the agent is designed to handle gracefully, along with the system's response strategy for each.

---

## Failure Mode 1: Tool Timeout

**Scenario:** A tool (e.g., `get_order`, `check_refund_eligibility`) times out due to simulated network latency or a downstream service being unavailable.

**How it happens:**
- ~15% of all tool calls are configured to artificially delay past the 4-second threshold and return a timeout error.
- This simulates real-world microservice instability or rate-limiting.

**System Response:**
1. The `withRetry()` utility catches the timeout result.
2. Exponential backoff is applied: delays of 500ms, 1000ms, 2000ms between attempts (up to 3 retries).
3. If all 3 retries fail, the ticket is marked as "dead-lettered" and the error is logged in the audit trail.
4. The agent still attempts to resolve the ticket using information from successful tool calls.
5. If insufficient data is available, the ticket is escalated to a human with a detailed summary.

**Code Location:** `src/utils/retry.ts → withRetry()`

---

## Failure Mode 2: Malformed / Partial Tool Response

**Scenario:** A tool returns a response with a corrupted or incomplete payload (e.g., `null` fields, missing required keys).

**How it happens:**
- ~10% of tool calls return a malformed response simulating an API contract violation (e.g., a backend returning `{ null }` instead of proper order data).

**System Response:**
1. All tool results are wrapped in a typed `ToolResult<T>` discriminated union.
2. The agent checks `result.success` before accessing `result.data`.
3. Malformed responses are logged with `status: "malformed"` in the audit log.
4. The agent continues its reasoning chain using other available tool results.
5. Schema validation via Zod is applied to critical paths (e.g., before `issue_refund`).
6. If the critical data needed for resolution is malformed, the ticket escalates.

**Code Location:** `src/tools/mockTools.ts → withFailureSimulation()`, `src/types/index.ts → ToolResult<T>`

---

## Failure Mode 3: Irreversible Action Guard (Refund Without Eligibility Check)

**Scenario:** The agent attempts to call `issue_refund` without first confirming eligibility, or calls it on an ineligible order.

**How it happens:**
- Flagged customers, orders older than 30 days, or orders in `processing` status are not eligible for refunds.
- LLM hallucination could theoretically try to skip the eligibility check.

**System Response:**
1. The system prompt explicitly instructs the model: "ALWAYS call `check_refund_eligibility` BEFORE `issue_refund`. Never skip this."
2. The tool description for `issue_refund` is labeled `IRREVERSIBLE`.
3. If `check_refund_eligibility` returns `eligible: false`, the tool result includes the reason, and the model is expected to NOT proceed with `issue_refund`.
4. Flagged customer accounts are routed to escalation regardless of eligibility outcome.
5. All `issue_refund` calls are logged with full context in the audit trail for post-hoc review.

**Code Location:** `src/tools/mockTools.ts → check_refund_eligibility()`, `src/agent/reactAgent.ts → systemPrompt`

---

## Failure Mode 4: Unhandled Agent Exception

**Scenario:** An unexpected JavaScript exception is thrown during ticket processing (e.g., Gemini API error, JSON parse failure, network error).

**How it happens:**
- API rate limits, invalid API key, or a malformed Gemini response could throw at runtime.

**System Response:**
1. Each ticket's `processTicket()` call is wrapped in a `try/catch` in the main orchestrator.
2. Failed tickets are returned as `TicketResolution` with `status: "failed"` and the error in `reasoning`.
3. This ensures one bad ticket never blocks the concurrent processing of other tickets.
4. The failed ticket still appears in the audit log for investigation.
5. The final summary counts `failed` tickets separately so operators can see systemic issues.

**Code Location:** `src/index.ts → main() → Promise.all() catch block`

---

## Failure Mode 5: All Retries Exhausted — Dead Letter Queue

**Scenario:** A tool consistently fails across all retry attempts (e.g., a specific microservice is fully down).

**How it happens:**
- Persistent timeouts or malformed responses across 3 consecutive retry attempts.

**System Response:**
1. After exhausting retries, `withRetry()` logs: `"exhausted all 3 retries — dead-lettered"`.
2. The ticket's `tool_calls` array in the audit log records each failed attempt with timestamps and error types.
3. The agent escalates the ticket to a human with a summary: "Unable to retrieve [data] after 3 attempts."
4. Operations team can query the audit log for dead-lettered tickets using `tool_calls[*].status = "timeout"`.

**Code Location:** `src/utils/retry.ts → withRetry() → dead-letter log`
