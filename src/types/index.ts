// ============================================================
// types/index.ts — All shared types for the ShopWave Agent
// ============================================================

export type TicketCategory =
  | "refund_request"
  | "order_tracking"
  | "product_inquiry"
  | "account_issue"
  | "payment_problem"
  | "shipping_delay"
  | "damaged_item"
  | "wrong_item"
  | "cancellation"
  | "general_inquiry";

export type TicketUrgency = "critical" | "high" | "medium" | "low";
export type TicketStatus = "open" | "processing" | "resolved" | "escalated" | "failed";
export type CustomerTier = "vip" | "premium" | "standard" | "new";

export interface Ticket {
  id: string;
  customer_email: string;
  subject: string;
  body: string;
  created_at: string;
  order_id?: string;
  product_id?: string;
}

export interface Customer {
  email: string;
  name: string;
  tier: CustomerTier;
  total_orders: number;
  account_created: string;
  is_flagged: boolean;
  notes?: string;
}

export interface Order {
  order_id: string;
  customer_email: string;
  product_id: string;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "returned";
  amount: number;
  currency: string;
  created_at: string;
  estimated_delivery?: string;
  tracking_number?: string;
  return_deadline?: string;
  refund_status?: string;
  notes?: string;
}

export interface Product {
  product_id: string;
  name: string;
  category: string;
  price: number;
  warranty_months: number;
  in_stock: boolean;
  description: string;
}

export interface RefundEligibility {
  eligible: boolean;
  reason: string;
  max_refund_amount: number;
}

export interface KnowledgeBaseResult {
  results: Array<{
    title: string;
    content: string;
    relevance_score: number;
  }>;
}

export interface ToolCallLog {
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  status: "success" | "error" | "timeout" | "malformed";
  duration_ms: number;
  timestamp: string;
  error?: string;
}

export interface TicketResolution {
  ticket_id: string;
  category: TicketCategory;
  urgency: TicketUrgency;
  status: TicketStatus;
  confidence_score: number;
  reasoning: string;
  actions_taken: string[];
  tool_calls: ToolCallLog[];
  reply_sent?: string;
  escalation_summary?: string;
  processing_time_ms: number;
  resolved_at: string;
  agent_version: string;
}

export interface AuditLog {
  run_id: string;
  started_at: string;
  completed_at: string;
  total_tickets: number;
  resolved: number;
  escalated: number;
  failed: number;
  avg_confidence: number;
  total_tool_calls: number;
  tool_failures: number;
  tickets: TicketResolution[];
}

/**
 * Canonical error types for tool results.
 * - timeout      : tool took too long
 * - malformed    : tool returned unexpected shape
 * - not_found    : requested resource does not exist (no retry)
 * - server_error : unexpected internal failure
 * - rate_limit   : external API quota exceeded (back off + retry)
 */
export type ToolErrorType =
  | "timeout"
  | "malformed"
  | "not_found"
  | "server_error"
  | "rate_limit";

export type ToolResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      type: ToolErrorType;
      /** Milliseconds to wait before retrying (populated on rate_limit) */
      retryAfterMs?: number;
    };