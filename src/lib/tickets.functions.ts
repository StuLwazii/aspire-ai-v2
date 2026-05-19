import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEPARTMENT_OPTIONS } from "@/lib/constants";

const CATEGORIES = ["HR", "IT", "Finance", "Operations"] as const;
const STATUSES = ["open", "in_progress", "resolved"] as const;

type Category = (typeof CATEGORIES)[number];

const TONE_PROMPTS: Record<Category, string> = {
  IT: "Use a friendly, technical tone. Acknowledge the issue, provide ONE concrete troubleshooting step, and state the escalation path if the step fails.",
  HR: "Use a formal, empathetic tone. Acknowledge with empathy, state the next HR process step, and give a concrete timeline (e.g. 'within 2 business days').",
  Finance: "Use a formal, precise tone. Confirm receipt, state the policy or next approval step, and include a short reference number (format REF-XXXXXX).",
  Operations: "Use an urgent, action-oriented tone. Confirm urgency, state the immediate action being taken, and assign a priority level (P1/P2/P3).",
};

async function callAI(body: unknown) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("AI rate limit reached. Please try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted. Please top up in Workspace settings.");
  if (!res.ok) throw new Error(`AI gateway error: ${res.status}`);
  return res.json();
}

async function classify(message: string): Promise<Category> {
  const json = await callAI({
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: "Classify the help-desk ticket into exactly one of: HR, IT, Finance, Operations. Use the tool." },
      { role: "user", content: message },
    ],
    tools: [{
      type: "function",
      function: {
        name: "classify_ticket",
        description: "Assign a department category to the ticket",
        parameters: {
          type: "object",
          properties: { category: { type: "string", enum: CATEGORIES as unknown as string[] } },
          required: ["category"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "classify_ticket" } },
  });
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
  const cat = args?.category as Category | undefined;
  return cat && CATEGORIES.includes(cat) ? cat : "Operations";
}

async function generateReply(history: { role: string; message: string }[], category: Category): Promise<string> {
  const messages = [
    {
      role: "system",
      content: `You are a help-desk agent for the ${category} department. ${TONE_PROMPTS[category]} Write a concise 3-5 sentence reply. Acknowledge the user's request, reference specifics, and offer a concrete next step. No preamble.`,
    },
    ...history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.message })),
  ];
  const json = await callAI({ model: "google/gemini-2.5-flash", messages });
  return (json.choices?.[0]?.message?.content ?? "We received your message and will follow up shortly.").trim();
}

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

// ---------- PUBLIC (no auth) ----------

export const startConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(255),
      department: z.enum(DEPARTMENT_OPTIONS),
      message: z.string().trim().min(5).max(2000),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: user, error: ue } = await supabaseAdmin
      .from("app_users")
      .insert({ name: data.name, email: data.email, department: data.department })
      .select()
      .single();
    if (ue) throw new Error(ue.message);

    const category = await classify(data.message);
    const reply = await generateReply([{ role: "user", message: data.message }], category);

    const { data: ticket, error: te } = await supabaseAdmin
      .from("tickets")
      .insert({ user_id: user.id, message: data.message, category, ai_response: reply })
      .select()
      .single();
    if (te) throw new Error(te.message);

    const { data: msgs, error: me } = await supabaseAdmin
      .from("conversations")
      .insert([
        { ticket_id: ticket.id, role: "user", message: data.message },
        { ticket_id: ticket.id, role: "assistant", message: reply },
      ])
      .select();
    if (me) throw new Error(me.message);

    return { ticket, user, messages: msgs ?? [] };
  });

export const continueConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      ticketId: z.string().uuid(),
      message: z.string().trim().min(1).max(2000),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: ticket, error: te } = await supabaseAdmin
      .from("tickets")
      .select("id, category")
      .eq("id", data.ticketId)
      .single();
    if (te || !ticket) throw new Error(te?.message ?? "Ticket not found");

    const { data: history } = await supabaseAdmin
      .from("conversations")
      .select("role, message")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true });

    const fullHistory = [...(history ?? []), { role: "user", message: data.message }];
    const reply = await generateReply(fullHistory, ticket.category as Category);

    const { data: msgs, error: me } = await supabaseAdmin
      .from("conversations")
      .insert([
        { ticket_id: ticket.id, role: "user", message: data.message },
        { ticket_id: ticket.id, role: "assistant", message: reply },
      ])
      .select();
    if (me) throw new Error(me.message);

    return { messages: msgs ?? [] };
  });

export const rateTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      ticketId: z.string().uuid(),
      rating: z.enum(["up", "down"]),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("tickets")
      .update({ rating: data.rating })
      .eq("id", data.ticketId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- ADMIN ----------

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (data ?? []).map((r) => r.role);
    return { roles, isAdmin: roles.includes("admin") };
  });

export const adminListTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("tickets")
      .select("*, app_users(name, email, department)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminGetConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ticketId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("ticket_id", data.ticketId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminUpdateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(STATUSES).optional(),
      ai_response: z.string().trim().max(5000).optional(),
      admin_notes: z.string().trim().max(5000).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { id, ...patch } = data;
    const { data: row, error } = await supabaseAdmin
      .from("tickets")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminDeleteTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("tickets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

