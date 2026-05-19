import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CATEGORIES = ["HR", "IT", "Finance", "Operations"] as const;
const TONES = ["formal", "friendly", "urgent"] as const;
const STATUSES = ["open", "in_progress", "resolved"] as const;

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

async function classify(message: string): Promise<typeof CATEGORIES[number]> {
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
  const cat = args?.category;
  if (!CATEGORIES.includes(cat)) return "Operations";
  return cat;
}

async function generateResponse(message: string, category: string, tone: string): Promise<string> {
  const toneMap: Record<string, string> = {
    formal: "Use a professional, formal tone.",
    friendly: "Use a warm, friendly, conversational tone.",
    urgent: "Use a concise, urgent tone that acknowledges priority and outlines immediate next steps.",
  };
  const json = await callAI({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content: `You are a help-desk agent for the ${category} department. ${toneMap[tone] ?? toneMap.formal} Write a 3-5 sentence response that acknowledges the issue, references the specific request, and offers a concrete next step. No preamble.`,
      },
      { role: "user", content: message },
    ],
  });
  return json.choices?.[0]?.message?.content?.trim() ?? "We have received your ticket and will follow up shortly.";
}

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      message: z.string().trim().min(5).max(2000),
      tone: z.enum(TONES),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const category = await classify(data.message);
    const ai_response = await generateResponse(data.message, category, data.tone);
    const { data: row, error } = await context.supabase
      .from("tickets")
      .insert({
        user_id: context.userId,
        message: data.message,
        category,
        tone: data.tone,
        ai_response,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tickets")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(STATUSES).optional(),
      ai_response: z.string().trim().min(1).max(5000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("tickets")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const regenerateResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), tone: z.enum(TONES) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: t, error: e1 } = await context.supabase
      .from("tickets").select("*").eq("id", data.id).single();
    if (e1 || !t) throw new Error(e1?.message ?? "Not found");
    const ai_response = await generateResponse(t.message, t.category, data.tone);
    const { data: row, error } = await context.supabase
      .from("tickets")
      .update({ ai_response, tone: data.tone })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });