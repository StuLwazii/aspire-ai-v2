// Server-only helper for calling the Lovable AI Gateway with:
// - Exponential backoff retries on 429 rate-limit responses (up to 3 attempts)
// - Structured error responses so the UI never receives an opaque crash
// - Persistent error logs written to `ai_error_logs`
// - Basic threshold-based alerting (>10 rate-limit errors within 60 seconds)
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const RATE_LIMIT_USER_MESSAGE = "System is busy. Please try again in a moment.";

export type AIErrorType = "RATE_LIMIT" | "CREDITS_EXHAUSTED" | "AI_GATEWAY" | "AI_UNAVAILABLE";

export type AIErrorResponse = {
  status: "error";
  type: AIErrorType;
  message: string;
  timestamp: number;
};

export class AIGatewayError extends Error {
  status: "error" = "error";
  type: AIErrorType;
  timestamp: number;
  attempts: number;
  constructor(type: AIErrorType, message: string, attempts = 1) {
    super(message);
    this.name = "AIGatewayError";
    this.type = type;
    this.attempts = attempts;
    // Always use current epoch time in milliseconds — never a hardcoded value.
    this.timestamp = Date.now();
  }
  toResponse(): AIErrorResponse {
    return { status: this.status, type: this.type, message: this.message, timestamp: this.timestamp };
  }
}

type LogContext = {
  fnName: string;
  ticketId?: string | null;
  conversationId?: string | null;
};

const ALERT_WINDOW_MS = 60_000;
const ALERT_THRESHOLD = 10;

async function logAIError(
  errorType: AIErrorType,
  message: string,
  attempts: number,
  ctx: LogContext,
): Promise<void> {
  try {
    const nowMs = Date.now();
    // Sanity: guard against absurd future timestamps that would indicate a bug
    // in a caller. Fall back to the current epoch millisecond.
    const safeNow = nowMs > 0 && nowMs < 4_102_444_800_000 ? nowMs : Date.now();
    const occurredAt = new Date(safeNow).toISOString();

    let alertTriggered = false;
    if (errorType === "RATE_LIMIT") {
      const windowStart = new Date(safeNow - ALERT_WINDOW_MS).toISOString();
      const { count } = await supabaseAdmin
        .from("ai_error_logs" as never)
        .select("id", { count: "exact", head: true })
        .eq("error_type", "RATE_LIMIT")
        .gte("occurred_at", windowStart);
      // Include this occurrence in the threshold check.
      if ((count ?? 0) + 1 > ALERT_THRESHOLD) {
        alertTriggered = true;
        console.error(
          `[ai-retry] ALERT: >${ALERT_THRESHOLD} AI rate-limit errors within ${ALERT_WINDOW_MS}ms — review quota usage.`,
        );
      }
    }

    await supabaseAdmin.from("ai_error_logs" as never).insert({
      error_type: errorType,
      message,
      function_name: ctx.fnName,
      ticket_id: ctx.ticketId ?? null,
      conversation_id: ctx.conversationId ?? null,
      attempts,
      alert_triggered: alertTriggered,
      occurred_at: occurredAt,
    } as never);
  } catch (err) {
    console.error("[ai-retry] failed to persist AI error log", err instanceof Error ? err.message : err);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff schedule for 3 total attempts: try, wait 500ms, try,
// wait 1500ms, try. Adjustable if the gateway starts returning Retry-After.
const RETRY_DELAYS_MS = [500, 1500];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * Call the Lovable AI Gateway with exponential-backoff retries on 429.
 * Throws AIGatewayError on non-retryable failures or after retries are
 * exhausted so callers can decide whether to bubble a structured response
 * or surface a friendly message.
 */
export async function callAIWithRetry(body: unknown, ctx: LogContext): Promise<unknown> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    const err = new AIGatewayError("AI_UNAVAILABLE", "LOVABLE_API_KEY not configured", 1);
    await logAIError(err.type, err.message, err.attempts, ctx);
    throw err;
  }

  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      // Treat network failures like a transient gateway error and back off.
      lastStatus = 0;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
        continue;
      }
      const msg = networkErr instanceof Error ? networkErr.message : "AI gateway unreachable";
      const err = new AIGatewayError("AI_UNAVAILABLE", msg, attempt);
      await logAIError(err.type, err.message, err.attempts, ctx);
      throw err;
    }

    if (res.ok) return res.json();

    lastStatus = res.status;

    if (res.status === 429) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
        continue;
      }
      const err = new AIGatewayError("RATE_LIMIT", RATE_LIMIT_USER_MESSAGE, attempt);
      await logAIError(err.type, err.message, err.attempts, ctx);
      throw err;
    }

    if (res.status === 402) {
      const err = new AIGatewayError(
        "CREDITS_EXHAUSTED",
        "AI credits exhausted. Please top up in Workspace settings.",
        attempt,
      );
      await logAIError(err.type, err.message, err.attempts, ctx);
      throw err;
    }

    // Non-retryable gateway error.
    const err = new AIGatewayError("AI_GATEWAY", `AI gateway error: ${res.status}`, attempt);
    await logAIError(err.type, err.message, err.attempts, ctx);
    throw err;
  }

  // Should be unreachable — safeguard.
  const err = new AIGatewayError("AI_GATEWAY", `AI gateway error: ${lastStatus || "unknown"}`, MAX_ATTEMPTS);
  await logAIError(err.type, err.message, err.attempts, ctx);
  throw err;
}
