import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEPARTMENT_OPTIONS } from "@/lib/constants";
import { scheduleGovernanceAnalysis, type GovSender } from "@/lib/governance.functions";

// Fire-and-forget governance analysis. Never awaited from a user-facing path.
function fireGovernance(rows: Array<{ id: string; ticket_id: string | null; role: string; message: string; created_at?: string }>, senderOverride?: GovSender) {
  for (const r of rows) {
    const sender: GovSender = senderOverride ?? (r.role === "user" ? "User" : "AI");
    void scheduleGovernanceAnalysis({
      conversationId: r.id,
      ticketId: r.ticket_id,
      sender,
      message: r.message,
      createdAt: r.created_at,
    });
  }
}

const CATEGORIES = ["HR", "IT", "Finance", "Operations"] as const;
const STATUSES = ["open", "in_progress", "escalated", "resolved"] as const;
const RESOLUTION_TYPES = ["self_service", "escalated", "pending"] as const;
const AGENT_STATUSES = ["available", "busy", "offline"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;

type Category = (typeof CATEGORIES)[number];

const TONE_PROMPTS: Record<Category, string> = {
  IT: "Friendly + technical. Acknowledge, give clear numbered steps, and state escalation path if steps fail.",
  HR: "Formal + empathetic. Acknowledge with empathy, give numbered steps where applicable, share timelines.",
  Finance: "Formal + precise. Confirm receipt, give clear numbered steps, include policy refs (REF-XXXXXX) where useful.",
  Operations: "Urgent + action-oriented. Confirm urgency, give clear numbered steps, state priority (P1/P2/P3).",
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

type TriageItem = {
  category: Category;
  resolution: "self_service" | "escalated";
  reason: string;
  title: string;
  excerpt: string;
};

async function triageMultiple(message: string): Promise<TriageItem[]> {
  const json = await callAI({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content:
          "You triage help-desk submissions. A single submission may contain MULTIPLE distinct issues belonging to DIFFERENT departments (HR, IT, Finance, Operations). Split it into one item per department. For each item: category (exactly one of HR/IT/Finance/Operations); resolution SELF_SERVICE or ESCALATED; one-sentence reason; concise 3-7 word title; and excerpt — the verbatim portion of the user's message describing THIS issue. Only split when issues clearly belong to different departments; otherwise return a single item. Call the tool.",
      },
      { role: "user", content: message },
    ],
    tools: [{
      type: "function",
      function: {
        name: "triage_tickets",
        description: "Split the submission into per-department tickets.",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  category: { type: "string", enum: CATEGORIES as unknown as string[] },
                  resolution: { type: "string", enum: ["SELF_SERVICE", "ESCALATED"] },
                  reason: { type: "string" },
                  title: { type: "string" },
                  excerpt: { type: "string" },
                },
                required: ["category", "resolution", "reason", "title", "excerpt"],
                additionalProperties: false,
              },
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "triage_tickets" } },
  });
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
  const raw: unknown[] = Array.isArray(args.items) ? args.items : [];
  const parsed: TriageItem[] = raw.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      category: CATEGORIES.includes(o.category as Category) ? (o.category as Category) : "Operations",
      resolution: o.resolution === "SELF_SERVICE" ? "self_service" : "escalated",
      reason: typeof o.reason === "string" ? o.reason : "Triage decision recorded.",
      title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 120) : (message.slice(0, 60) + (message.length > 60 ? "…" : "")),
      excerpt: typeof o.excerpt === "string" && o.excerpt.trim() ? o.excerpt.trim() : message,
    };
  });
  // Merge any duplicates by department
  const byCat = new Map<Category, TriageItem>();
  for (const it of parsed) {
    const ex = byCat.get(it.category);
    if (ex) ex.excerpt = `${ex.excerpt}\n${it.excerpt}`;
    else byCat.set(it.category, { ...it });
  }
  const result = Array.from(byCat.values());
  return result.length > 0 ? result : [{
    category: "Operations", resolution: "escalated", reason: "Default routing",
    title: message.slice(0, 60) + (message.length > 60 ? "…" : ""), excerpt: message,
  }];
}


async function generateSelfServiceSteps(message: string, category: Category): Promise<string> {
  const json = await callAI({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content: `You are a ${category} help-desk assistant. ${TONE_PROMPTS[category]} Respond with concise, numbered, step-by-step instructions the user can follow themselves. Keep it under 8 short steps. No preamble, no sign-off.`,
      },
      { role: "user", content: message },
    ],
  });
  return (json.choices?.[0]?.message?.content ?? "Please try the standard steps for this request.").trim();
}

async function generateFollowUp(history: { role: string; message: string }[], category: Category): Promise<string> {
  const messages = [
    {
      role: "system",
      content: `You are a ${category} help-desk agent. ${TONE_PROMPTS[category]} Reply in 3-5 sentences. Reference specifics from the user's message and offer a concrete next step.`,
    },
    ...history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.message })),
  ];
  const json = await callAI({ model: "google/gemini-2.5-flash", messages });
  return (json.choices?.[0]?.message?.content ?? "We received your message and will follow up shortly.").trim();
}

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

const RESPONSE_TIME: Record<Category, string> = {
  IT: "within 2 hours",
  HR: "within 24 hours",
  Finance: "within 48 hours",
  Operations: "within 4 hours",
};

async function pickAgent(category: Category): Promise<{ id: string; full_name: string } | null> {
  // Prefer available agents in this department with lowest workload
  const { data: avail } = await supabaseAdmin
    .from("agents" as never)
    .select("id, full_name, status, current_ticket_count")
    .eq("department", category)
    .order("current_ticket_count", { ascending: true }) as unknown as { data: Array<{ id: string; full_name: string; status: string; current_ticket_count: number }> | null };
  if (!avail || avail.length === 0) return null;
  const available = avail.filter((a) => a.status === "available");
  const chosen = (available[0] ?? avail[0]);
  return { id: chosen.id, full_name: chosen.full_name };
}

async function bumpAgentWorkload(agentId: string, delta: number) {
  const { data } = await supabaseAdmin.from("agents" as never).select("current_ticket_count").eq("id", agentId).maybeSingle() as unknown as { data: { current_ticket_count: number } | null };
  if (!data) return;
  await supabaseAdmin.from("agents" as never).update({ current_ticket_count: Math.max(0, data.current_ticket_count + delta) } as never).eq("id", agentId);
}

// ---------- PUBLIC ----------

function verifyAccessCode(code: string) {
  const expected = process.env.COMPANY_ACCESS_CODE;
  if (!expected) throw new Error("Access control is not configured. Please contact your administrator.");
  if (code !== expected) throw new Error("Invalid access code. Please contact your administrator.");
}

export const startConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(255),
      department: z.enum(DEPARTMENT_OPTIONS),
      message: z.string().trim().min(5).max(2000),
      accessCode: z.string().min(1).max(200),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    verifyAccessCode(data.accessCode);
    const { data: user, error: ue } = await supabaseAdmin
      .from("app_users").insert({ name: data.name, email: data.email, department: data.department })
      .select().single();
    if (ue) throw new Error(ue.message);

    const items = await triageMultiple(data.message);
    const multi = items.length > 1;

    type TicketRow = {
      id: string; user_id: string; message: string; title: string | null; category: string;
      ai_response: string | null; status: string; resolution_type: string;
      escalation_reason: string | null; priority: string; assigned_agent_id: string | null;
      created_at: string; updated_at: string; admin_notes: string | null;
      rating: string | null; classification_method: string; resolved_by_user: boolean;
    };
    type Created = {
      ticket: TicketRow;
      item: TriageItem;
      assistantText: string;
      assignedAgent: { id: string; full_name: string } | null;
    };
    const created: Created[] = [];

    for (const item of items) {
      let assistantText = "";
      let assignedAgent: { id: string; full_name: string } | null = null;
      let status: typeof STATUSES[number] = "open";
      const sourceText = multi ? item.excerpt : data.message;

      if (item.resolution === "self_service") {
        const steps = await generateSelfServiceSteps(sourceText, item.category);
        assistantText = `**${item.category} — ${item.title}**\n\n${steps}\n\nDoes this resolve your issue?`;
      } else {
        assignedAgent = await pickAgent(item.category);
        status = "escalated";
        const eta = RESPONSE_TIME[item.category];
        assistantText = assignedAgent
          ? `**${item.category} — ${item.title}**\n\nYour request requires hands-on assistance from our ${item.category} team. Assigned to **${assignedAgent.full_name}**.\n\n🏢 Department: ${item.category}\n👤 Assigned to: ${assignedAgent.full_name}\n⏱️ Expected response: ${eta}`
          : `**${item.category} — ${item.title}**\n\nYour request needs hands-on assistance from our ${item.category} team. Our team is at capacity — you are in the queue. Expected response: ${eta}.`;
      }

      const { data: ticket, error: te } = await supabaseAdmin
        .from("tickets").insert({
          user_id: user.id,
          message: sourceText,
          title: item.title,
          category: item.category,
          ai_response: assistantText,
          status,
          resolution_type: item.resolution,
          escalation_reason: item.reason,
          assigned_agent_id: assignedAgent?.id ?? null,
        } as never).select().single();
      if (te) throw new Error(te.message);
      if (assignedAgent) await bumpAgentWorkload(assignedAgent.id, +1);
      created.push({ ticket: ticket as Created["ticket"], item, assistantText, assignedAgent });
    }

    // Primary ticket = first one; conversation thread anchors here.
    const primary = created[0];
    const combinedAssistant = multi
      ? `I detected **${created.length} separate issues** in your message and split them into individual tickets so each department can handle their part:\n\n` +
        created.map((c, i) => `**${i + 1}. ${c.item.category} — ${c.item.title}**\n${c.assistantText.split("\n").slice(2).join("\n")}`).join("\n\n---\n\n")
      : primary.assistantText;

    // Seed conversations: original user message on primary, then combined assistant reply.
    const { data: msgs, error: me } = await supabaseAdmin
      .from("conversations").insert([
        { ticket_id: primary.ticket.id, role: "user", message: data.message },
        { ticket_id: primary.ticket.id, role: "assistant", message: combinedAssistant },
      ]).select();
    if (me) throw new Error(me.message);

    // Analyze primary conversation messages
    fireGovernance((msgs ?? []).map((m) => ({ id: m.id, ticket_id: m.ticket_id, role: m.role, message: m.message, created_at: m.created_at })));

    // For sibling tickets, seed their own conversation with the excerpt + their assistant reply
    for (const c of created.slice(1)) {
      const { data: siblingMsgs } = await supabaseAdmin.from("conversations").insert([
        { ticket_id: c.ticket.id, role: "user", message: c.item.excerpt },
        { ticket_id: c.ticket.id, role: "assistant", message: c.assistantText },
      ]).select();
      fireGovernance((siblingMsgs ?? []).map((m) => ({ id: m.id, ticket_id: m.ticket_id, role: m.role, message: m.message, created_at: m.created_at })));
    }

    return {
      ticket: primary.ticket,
      user,
      messages: msgs ?? [],
      assignedAgentName: primary.assignedAgent?.full_name ?? null,
      expectedResponse: primary.item.resolution === "escalated" ? RESPONSE_TIME[primary.item.category] : null,
      relatedTickets: created.map((c) => ({
        id: c.ticket.id,
        category: c.item.category,
        title: c.item.title,
        resolution: c.item.resolution,
        assignedAgentName: c.assignedAgent?.full_name ?? null,
      })),
    };
  });

export const continueConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ ticketId: z.string().uuid(), message: z.string().trim().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: ticket, error: te } = await supabaseAdmin
      .from("tickets").select("id, category, status").eq("id", data.ticketId).single();
    if (te || !ticket) throw new Error(te?.message ?? "Ticket not found");

    const { data: history } = await supabaseAdmin
      .from("conversations").select("role, message").eq("ticket_id", ticket.id).order("created_at", { ascending: true });

    const fullHistory = [...(history ?? []), { role: "user", message: data.message }];
    const reply = await generateFollowUp(fullHistory, ticket.category as Category);

    const { data: msgs, error: me } = await supabaseAdmin
      .from("conversations").insert([
        { ticket_id: ticket.id, role: "user", message: data.message },
        { ticket_id: ticket.id, role: "assistant", message: reply },
      ]).select();
    if (me) throw new Error(me.message);
    fireGovernance((msgs ?? []).map((m) => ({ id: m.id, ticket_id: m.ticket_id, role: m.role, message: m.message, created_at: m.created_at })));
    return { messages: msgs ?? [] };
  });

// User marks a self-service answer as resolved or not
export const markUserResolution = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ ticketId: z.string().uuid(), resolved: z.boolean() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { data: ticket } = await supabaseAdmin
      .from("tickets").select("*").eq("id", data.ticketId).single();
    if (!ticket) throw new Error("Ticket not found");

    if (data.resolved) {
      await supabaseAdmin.from("tickets").update({
        status: "resolved",
        resolved_by_user: true,
      } as never).eq("id", data.ticketId);
      const { data: ack } = await supabaseAdmin.from("conversations").insert({
        ticket_id: data.ticketId, role: "assistant",
        message: "Glad we could help! Marking this ticket as resolved. 🎉",
      }).select();
      fireGovernance((ack ?? []).map((m) => ({ id: m.id, ticket_id: m.ticket_id, role: m.role, message: m.message, created_at: m.created_at })));
      return { escalated: false, assignedAgentName: null, expectedResponse: null };
    }

    // Escalate
    const cat = ticket.category as Category;
    const agent = await pickAgent(cat);
    const eta = RESPONSE_TIME[cat];
    const text = agent
      ? `Got it — escalating this to our ${cat} team. Your ticket has been assigned to **${agent.full_name}** and they will contact you shortly.\n\n🏢 Department: ${cat}\n👤 Assigned to: ${agent.full_name}\n⏱️ Expected response: ${eta}`
      : `Got it — escalating to our ${cat} team. They are currently at capacity, so you have been placed in the queue. Expected response: ${eta}.`;

    await supabaseAdmin.from("tickets").update({
      status: "escalated",
      resolution_type: "escalated",
      assigned_agent_id: agent?.id ?? null,
      escalation_reason: "User indicated self-service answer did not resolve their issue.",
    } as never).eq("id", data.ticketId);

    if (agent) await bumpAgentWorkload(agent.id, +1);

    const { data: escMsgs } = await supabaseAdmin.from("conversations").insert({
      ticket_id: data.ticketId, role: "assistant", message: text,
    }).select();
    fireGovernance((escMsgs ?? []).map((m) => ({ id: m.id, ticket_id: m.ticket_id, role: m.role, message: m.message, created_at: m.created_at })));

    return { escalated: true, assignedAgentName: agent?.full_name ?? null, expectedResponse: eta };
  });

export const rateTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ ticketId: z.string().uuid(), rating: z.enum(["up", "down"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("tickets").update({ rating: data.rating }).eq("id", data.ticketId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- USER PORTAL (public, lookup by email) ----------

export const userListTicketsByEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().email().max(255), accessCode: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    verifyAccessCode(data.accessCode);
    const email = data.email.toLowerCase();
    const { data: users } = await supabaseAdmin
      .from("app_users").select("id, name, email").ilike("email", email);
    const ids = (users ?? []).map((u) => u.id);
    if (ids.length === 0) return { tickets: [] as Array<{ id: string; title: string | null; message: string; status: string; category: string; priority: string; resolution_type: string; created_at: string; updated_at: string; assigned_agent_id: string | null; assigned_agent_name: string | null }> };
    const { data: tickets, error } = await supabaseAdmin
      .from("tickets")
      .select("id, title, message, status, category, priority, resolution_type, created_at, updated_at, assigned_agent_id")
      .in("user_id", ids)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const agentIds = Array.from(new Set((tickets ?? []).map((t) => t.assigned_agent_id).filter(Boolean) as string[]));
    let agentMap: Record<string, string> = {};
    if (agentIds.length) {
      const { data: agents } = await supabaseAdmin
        .from("agents" as never).select("id, full_name").in("id", agentIds) as unknown as { data: { id: string; full_name: string }[] | null };
      agentMap = Object.fromEntries((agents ?? []).map((a) => [a.id, a.full_name]));
    }
    return {
      tickets: (tickets ?? []).map((t) => ({ ...t, assigned_agent_name: t.assigned_agent_id ? agentMap[t.assigned_agent_id] ?? null : null })),
    };
  });

export const userGetTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().email().max(255), ticketId: z.string().uuid(), accessCode: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }) => {
    verifyAccessCode(data.accessCode);
    const email = data.email.toLowerCase();
    const { data: ticket, error } = await supabaseAdmin
      .from("tickets").select("*").eq("id", data.ticketId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!ticket) throw new Error("Ticket not found");
    const { data: owner } = await supabaseAdmin
      .from("app_users").select("email").eq("id", ticket.user_id).maybeSingle();
    if (!owner || owner.email.toLowerCase() !== email) throw new Error("Ticket not found");

    const { data: messages } = await supabaseAdmin
      .from("conversations").select("*").eq("ticket_id", ticket.id).order("created_at", { ascending: true });

    let agentName: string | null = null;
    if (ticket.assigned_agent_id) {
      const { data: agent } = await supabaseAdmin
        .from("agents" as never).select("full_name").eq("id", ticket.assigned_agent_id).maybeSingle() as unknown as { data: { full_name: string } | null };
      agentName = agent?.full_name ?? null;
    }
    return { ticket, messages: messages ?? [], assignedAgentName: agentName };
  });

// ---------- ADMIN ----------

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId);
    const roles = (data ?? []).map((r) => r.role);
    let agentRecord: { id: string; full_name: string; department: string } | null = null;
    if (roles.includes("agent")) {
      const { data: a } = await supabaseAdmin
        .from("agents" as never)
        .select("id, full_name, department")
        .eq("user_id", context.userId)
        .maybeSingle() as unknown as { data: { id: string; full_name: string; department: string } | null };
      agentRecord = a;
    }
    return {
      roles,
      isAdmin: roles.includes("admin"),
      isAgent: roles.includes("agent"),
      agentRecord,
    };
  });


export const adminListTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("tickets")
      .select("*, app_users(name, email, department), agents:assigned_agent_id(id, full_name, department, status)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminListAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin.from("agents" as never).select("*").order("department");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminCreateAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      full_name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(255),
      department: z.enum(CATEGORIES),
      status: z.enum(AGENT_STATUSES).default("available"),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin.from("agents" as never).insert(data as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminUpdateAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      full_name: z.string().trim().min(1).max(120).optional(),
      email: z.string().trim().email().max(255).optional(),
      department: z.enum(CATEGORIES).optional(),
      status: z.enum(AGENT_STATUSES).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { id, ...patch } = data;
    const { data: row, error } = await supabaseAdmin.from("agents" as never).update(patch as never).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminDeleteAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("agents" as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- ADMIN: USER MANAGEMENT ----------

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const roleMap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role as string);
      roleMap.set(r.user_id, arr);
    }
    return list.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      roles: roleMap.get(u.id) ?? [],
      isAdmin: (roleMap.get(u.id) ?? []).includes("admin"),
      isAgent: (roleMap.get(u.id) ?? []).includes("agent"),
      isSelf: u.id === context.userId,
    }));
  });

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "agent"]),
      grant: z.boolean(),
      agentId: z.string().uuid().optional(), // when granting 'agent', link to an existing agent record
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId && data.role === "admin" && !data.grant) {
      throw new Error("You cannot remove your own admin role.");
    }
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
      if (data.role === "agent" && data.agentId) {
        const { error: linkErr } = await supabaseAdmin
          .from("agents" as never)
          .update({ user_id: data.userId } as never)
          .eq("id", data.agentId);
        if (linkErr) throw new Error(linkErr.message);
      }
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
      if (data.role === "agent") {
        await supabaseAdmin
          .from("agents" as never)
          .update({ user_id: null } as never)
          .eq("user_id", data.userId);
      }
    }
    return { ok: true };
  });

export const adminPromoteToAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      userId: z.string().uuid(),
      department: z.enum(CATEGORIES),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    // Get the auth user's email + name
    const { data: u, error: ue } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (ue || !u.user) throw new Error(ue?.message ?? "User not found");
    const email = u.user.email ?? "";
    const full_name = (u.user.user_metadata?.full_name as string | undefined) ?? email.split("@")[0] ?? "Agent";

    // Find an existing agent record linked to this user OR matching email
    const { data: existingByUser } = await supabaseAdmin
      .from("agents" as never).select("id").eq("user_id", data.userId).maybeSingle() as unknown as { data: { id: string } | null };

    let agentId = existingByUser?.id ?? null;

    if (!agentId) {
      const { data: existingByEmail } = await supabaseAdmin
        .from("agents" as never).select("id").eq("email", email).is("user_id", null).maybeSingle() as unknown as { data: { id: string } | null };
      if (existingByEmail) {
        agentId = existingByEmail.id;
        await supabaseAdmin.from("agents" as never)
          .update({ user_id: data.userId, department: data.department } as never)
          .eq("id", agentId);
      } else {
        const { data: created, error: ce } = await supabaseAdmin
          .from("agents" as never)
          .insert({ full_name, email, department: data.department, status: "available", user_id: data.userId } as never)
          .select().single() as unknown as { data: { id: string } | null; error: { message: string } | null };
        if (ce) throw new Error(ce.message);
        agentId = created!.id;
      }
    } else {
      await supabaseAdmin.from("agents" as never)
        .update({ department: data.department } as never)
        .eq("id", agentId);
    }

    const { error: re } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: data.userId, role: "agent" }, { onConflict: "user_id,role" });
    if (re) throw new Error(re.message);

    return { ok: true, agentId };
  });



// ---------- AGENT ENDPOINTS ----------

async function getMyAgent(userId: string): Promise<{ id: string; department: string; full_name: string } | null> {
  const { data } = await supabaseAdmin
    .from("agents" as never)
    .select("id, department, full_name")
    .eq("user_id", userId)
    .maybeSingle() as unknown as { data: { id: string; department: string; full_name: string } | null };
  return data;
}

export const agentListMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const me = await getMyAgent(context.userId);
    if (!me) throw new Error("You are not linked to an agent profile.");
    const { data, error } = await supabaseAdmin
      .from("tickets")
      .select("*, app_users(name, email, department), agents:assigned_agent_id(id, full_name, department, status)")
      .eq("assigned_agent_id", me.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { agent: me, tickets: data ?? [] };
  });

export const agentGetConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const me = await getMyAgent(context.userId);
    if (!me) throw new Error("Forbidden");
    // ensure ticket is assigned to this agent
    const { data: t } = await supabaseAdmin
      .from("tickets").select("assigned_agent_id").eq("id", data.ticketId).maybeSingle();
    if (!t || (t as { assigned_agent_id: string | null }).assigned_agent_id !== me.id) {
      throw new Error("Forbidden");
    }
    const { data: rows, error } = await supabaseAdmin
      .from("conversations").select("*").eq("ticket_id", data.ticketId).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const agentRespondToTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      ticketId: z.string().uuid(),
      response: z.string().trim().min(1).max(5000).optional(),
      status: z.enum(["open", "in_progress", "escalated", "resolved"]).optional(),
      admin_notes: z.string().trim().max(5000).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const me = await getMyAgent(context.userId);
    if (!me) throw new Error("Forbidden");
    const { data: prev } = await supabaseAdmin
      .from("tickets").select("assigned_agent_id, status").eq("id", data.ticketId).maybeSingle();
    const p = prev as { assigned_agent_id: string | null; status: string } | null;
    if (!p || p.assigned_agent_id !== me.id) throw new Error("Forbidden");

    const patch: Record<string, unknown> = {};
    if (data.status) patch.status = data.status;
    if (data.admin_notes !== undefined) patch.admin_notes = data.admin_notes;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("tickets").update(patch as never).eq("id", data.ticketId);
      if (error) throw new Error(error.message);
    }
    if (data.response) {
      const { error } = await supabaseAdmin.from("conversations").insert({
        ticket_id: data.ticketId, role: "assistant", message: data.response,
      });
      if (error) throw new Error(error.message);
    }
    if (data.status === "resolved" && p.status !== "resolved") {
      await bumpAgentWorkload(me.id, -1);
    }
    return { ok: true };
  });



export const adminGetConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: rows, error } = await supabaseAdmin
      .from("conversations").select("*").eq("ticket_id", data.ticketId).order("created_at", { ascending: true });
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
      assigned_agent_id: z.string().uuid().nullable().optional(),
      resolution_type: z.enum(RESOLUTION_TYPES).optional(),
      priority: z.enum(PRIORITIES).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { id, ...patch } = data;
    // If reassigning, adjust workload counts
    if ("assigned_agent_id" in patch) {
      const { data: prev } = await supabaseAdmin.from("tickets").select("assigned_agent_id, status").eq("id", id).maybeSingle();
      const oldAgent = (prev as { assigned_agent_id: string | null } | null)?.assigned_agent_id ?? null;
      const newAgent = patch.assigned_agent_id ?? null;
      if (oldAgent && oldAgent !== newAgent) await bumpAgentWorkload(oldAgent, -1);
      if (newAgent && newAgent !== oldAgent) await bumpAgentWorkload(newAgent, +1);
    }
    // If marking resolved, decrement workload from current agent
    if (patch.status === "resolved") {
      const { data: prev } = await supabaseAdmin.from("tickets").select("assigned_agent_id, status").eq("id", id).maybeSingle();
      const p = prev as { assigned_agent_id: string | null; status: string } | null;
      if (p?.assigned_agent_id && p.status !== "resolved") await bumpAgentWorkload(p.assigned_agent_id, -1);
    }
    const { data: row, error } = await supabaseAdmin.from("tickets").update(patch as never).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminDeleteTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: t } = await supabaseAdmin.from("tickets").select("assigned_agent_id, status").eq("id", data.id).maybeSingle();
    const tt = t as { assigned_agent_id: string | null; status: string } | null;
    if (tt?.assigned_agent_id && tt.status !== "resolved") await bumpAgentWorkload(tt.assigned_agent_id, -1);
    const { error } = await supabaseAdmin.from("tickets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
