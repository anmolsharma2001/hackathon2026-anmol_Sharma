// ============================================================
// tools/mockTools.ts
// Realistic mock tools with real failure modes:
//   - Random timeouts (~15% of calls)
//   - Malformed/partial responses (~10% of calls)
//   - Not-found errors for unknown IDs
//   - issue_refund is IRREVERSIBLE — guarded by eligibility check
// ============================================================

import { v4 as uuidv4 } from "uuid";
import {
  Customer,
  Order,
  Product,
  RefundEligibility,
  KnowledgeBaseResult,
  ToolResult,
} from "../types";
import {
  MOCK_CUSTOMERS,
  MOCK_ORDERS,
  MOCK_PRODUCTS,
} from "../mocks/mockData";

// ── Failure simulation ───────────────────────────────────────
const TIMEOUT_RATE = 0.15;   // 15% chance of timeout
const MALFORMED_RATE = 0.10; // 10% chance of malformed data
const TIMEOUT_MS = 4000;

function shouldTimeout(): boolean {
  return Math.random() < TIMEOUT_RATE;
}
function shouldMalform(): boolean {
  return Math.random() < MALFORMED_RATE;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps any tool with timeout + malformed injection
async function withFailureSimulation<T>(
  fn: () => Promise<ToolResult<T>>,
  toolName: string
): Promise<ToolResult<T>> {
  if (shouldTimeout()) {
    await sleep(TIMEOUT_MS);
    return { success: false, error: `${toolName} timed out after ${TIMEOUT_MS}ms`, type: "timeout" };
  }

  if (shouldMalform()) {
    return {
      success: false,
      error: `${toolName} returned malformed response: unexpected null in payload`,
      type: "malformed",
    };
  }

  return fn();
}

// ── Tool Implementations ─────────────────────────────────────

export async function get_order(order_id: string): Promise<ToolResult<Order>> {
  return withFailureSimulation(async () => {
    const order = MOCK_ORDERS[order_id];
    if (!order) {
      return { success: false, error: `Order ${order_id} not found`, type: "not_found" };
    }
    return { success: true, data: order };
  }, "get_order");
}

export async function get_customer(email: string): Promise<ToolResult<Customer>> {
  return withFailureSimulation(async () => {
    const customer = MOCK_CUSTOMERS[email];
    if (!customer) {
      return { success: false, error: `Customer ${email} not found`, type: "not_found" };
    }
    return { success: true, data: customer };
  }, "get_customer");
}

export async function get_product(product_id: string): Promise<ToolResult<Product>> {
  return withFailureSimulation(async () => {
    const product = MOCK_PRODUCTS[product_id];
    if (!product) {
      return { success: false, error: `Product ${product_id} not found`, type: "not_found" };
    }
    return { success: true, data: product };
  }, "get_product");
}

export async function check_refund_eligibility(
  order_id: string
): Promise<ToolResult<RefundEligibility>> {
  return withFailureSimulation(async (): Promise<ToolResult<RefundEligibility>> => {
    const order = MOCK_ORDERS[order_id];
    if (!order) {
      return { success: false, error: `Order ${order_id} not found`, type: "not_found" };
    }

    // Already refunded
    if (order.refund_status === "refunded") {
      return {
        success: true,
        data: { eligible: false, reason: "Refund already processed for this order. Allow 5-7 business days for bank processing.", max_refund_amount: 0 },
      };
    }

    // Cannot cancel/refund if still in processing — suggest cancellation instead
    if (order.status === "processing" || order.status === "pending") {
      return {
        success: true,
        data: { eligible: false, reason: "Order not yet shipped — can be cancelled free of charge instead of refunded", max_refund_amount: 0 },
      };
    }

    const customer = MOCK_CUSTOMERS[order.customer_email];

    // Check VIP extended return exception (like emma.collins)
    if (customer?.tier === "vip" && customer.notes?.includes("standing exception")) {
      return {
        success: true,
        data: { eligible: true, reason: "VIP customer with pre-approved extended return window exception", max_refund_amount: order.amount },
      };
    }

    // Check return_deadline from order data
    if (order.return_deadline) {
      const deadline = new Date(order.return_deadline);
      const now = new Date("2024-03-15"); // ticket processing date from sample data
      if (now > deadline) {
        // Special: check if notes mention non-returnable (registered device)
        if (order.notes?.includes("Non-returnable") || order.notes?.includes("registered online")) {
          return {
            success: true,
            data: { eligible: false, reason: "Return window expired AND device registered online — non-returnable per policy", max_refund_amount: 0 },
          };
        }
        // Warranty active check
        if (order.notes?.includes("Warranty still active")) {
          return {
            success: true,
            data: { eligible: false, reason: "Return window expired but warranty is still active — escalate as warranty claim", max_refund_amount: 0 },
          };
        }
        return {
          success: true,
          data: { eligible: false, reason: `Return window expired on ${order.return_deadline}`, max_refund_amount: 0 },
        };
      }
    }

    if (customer?.is_flagged) {
      return {
        success: true,
        data: { eligible: false, reason: "Account flagged — manual review required before processing refund", max_refund_amount: 0 },
      };
    }

    return {
      success: true,
      data: { eligible: true, reason: "Within return window — eligible for full refund", max_refund_amount: order.amount },
    };
  }, "check_refund_eligibility");
}

// IRREVERSIBLE — must only be called after eligibility check passes
export async function issue_refund(
  order_id: string,
  amount: number
): Promise<ToolResult<{ refund_id: string; status: string; amount: number }>> {
  return withFailureSimulation(async () => {
    const order = MOCK_ORDERS[order_id];
    if (!order) {
      return { success: false, error: `Order ${order_id} not found`, type: "not_found" };
    }
    if (amount > order.amount) {
      return {
        success: false,
        error: `Refund amount $${amount} exceeds order total $${order.amount}`,
        type: "server_error",
      };
    }
    const refundId = `REF-${uuidv4().split("-")[0].toUpperCase()}`;
    return {
      success: true,
      data: { refund_id: refundId, status: "processed", amount },
    };
  }, "issue_refund");
}

export async function send_reply(
  ticket_id: string,
  message: string
): Promise<ToolResult<{ sent: boolean; message_id: string }>> {
  return withFailureSimulation(async () => {
    const messageId = `MSG-${uuidv4().split("-")[0].toUpperCase()}`;
    console.log(`\n  📧 [Reply to ${ticket_id}]: ${message.substring(0, 80)}...`);
    return { success: true, data: { sent: true, message_id: messageId } };
  }, "send_reply");
}

export async function escalate(
  ticket_id: string,
  summary: string,
  priority: "urgent" | "high" | "medium"
): Promise<ToolResult<{ escalation_id: string; assigned_to: string }>> {
  return withFailureSimulation(async () => {
    const escalationId = `ESC-${uuidv4().split("-")[0].toUpperCase()}`;
    const teams: Record<string, string> = {
      urgent: "Tier-3 Senior Support",
      high: "Tier-2 Support",
      medium: "Tier-1 Support",
    };
    console.log(`\n  🚨 [Escalate ${ticket_id}] Priority: ${priority} → ${teams[priority]}`);
    return {
      success: true,
      data: { escalation_id: escalationId, assigned_to: teams[priority] },
    };
  }, "escalate");
}

export async function search_knowledge_base(
  query: string
): Promise<ToolResult<KnowledgeBaseResult>> {
  return withFailureSimulation(async () => {
    const kb: Array<{ keywords: string[]; title: string; content: string }> = [
      {
        keywords: ["refund", "return", "money back"],
        title: "Return & Refund Policy",
        content:
          "ShopWave offers a 30-day return window for all items. Refunds are processed within 3–5 business days to the original payment method. Items must be unused and in original packaging.",
      },
      {
        keywords: ["shipping", "delivery", "tracking", "delay"],
        title: "Shipping & Delivery Information",
        content:
          "Standard shipping takes 5–7 business days. Express shipping 2–3 days. Free shipping on orders over $50. Track your order using the tracking number in your confirmation email.",
      },
      {
        keywords: ["warranty", "defective", "broken", "damaged"],
        title: "Warranty & Damaged Items Policy",
        content:
          "All products include a manufacturer warranty. For damaged or defective items, contact support within 30 days. We offer free replacement or full refund for damaged goods.",
      },
      {
        keywords: ["cancel", "cancellation"],
        title: "Order Cancellation Policy",
        content:
          "Orders can be cancelled within 24 hours of placing if not yet shipped. Once shipped, you must wait for delivery and then initiate a return.",
      },
      {
        keywords: ["account", "password", "login", "access"],
        title: "Account & Security",
        content:
          "If you cannot access your account, use the 'Forgot Password' link. For security issues, contact support immediately. Two-factor authentication is available in account settings.",
      },
      {
        keywords: ["payment", "charge", "billing", "invoice"],
        title: "Payment & Billing",
        content:
          "We accept Visa, Mastercard, Amex, and PayPal. For payment disputes, contact your bank or reach out to our billing team with your order ID.",
      },
    ];

    const lowerQuery = query.toLowerCase();
    const results = kb
      .map((item) => {
        const matchCount = item.keywords.filter((k) => lowerQuery.includes(k)).length;
        const relevance = matchCount / item.keywords.length;
        return { title: item.title, content: item.content, relevance_score: relevance };
      })
      .filter((r) => r.relevance_score > 0)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 2);

    if (results.length === 0) {
      results.push({
        title: "General Support",
        content: "For issues not covered in our FAQ, please contact our support team directly.",
        relevance_score: 0.1,
      });
    }

    return { success: true, data: { results } };
  }, "search_knowledge_base");
}
