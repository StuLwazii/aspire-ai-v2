## Overview

Expand the existing help desk app into a two-portal product:
1. **Public User Chat Portal** — no-login, chat-style ticket submission with auto-classification, auto-response, multi-turn chat, and 👍/👎 ratings.
2. **Admin Dashboard** — role-gated, full ticket management with filters, search, realtime updates, internal notes, status workflow, response override, and richer analytics (bar + line + pie).

Keep the navy/white + coral theme already in `src/styles.css`. Reuse existing AI server functions where possible; restructure data model to match the new spec.

---

## Database changes (one migration)

Replace the current single-table model with the spec'd schema:

- `app_users` (public chat submitters): `id, name, email, department, created_at`
- `tickets`: drop/recreate with `id, user_id (→app_users), message, category, ai_response, status, rating ('up'|'down'|null), admin_notes, created_at, updated_at`
- `conversations`: `id, ticket_id, role ('user'|'assistant'), message, created_at`
- `app_role` enum + `user_roles` table (`user_id, role`) + `has_role()` SECURITY DEFINER function — standard Lovable role pattern (never store role on profile).
- RLS:
  - `app_users`, `tickets`, `conversations`: public INSERT + public SELECT (chat is unauthenticated). UPDATE/DELETE restricted to admins via `has_role(auth.uid(), 'admin')`.
  - `user_roles`: admins manage; users read own.
- Enable Realtime on `tickets` and `conversations`.
- Keep existing `ticket_category` / `ticket_status` enums; add a `rating` text check or enum.

The user will need to grant themselves the `admin` role once (via SQL or seed) — I'll surface that in the final message.

---

## Server functions (`src/lib/tickets.functions.ts`)

- `startConversation({name,email,department,message})` — upserts `app_users` row, creates ticket, classifies, generates first AI response (tone auto-picked by category), inserts both messages into `conversations`. Returns ticket + messages. **No auth.**
- `continueConversation({ticketId, message})` — appends user message, generates assistant reply using full conversation history + category tone, persists both. **No auth.**
- `rateTicket({ticketId, rating})` — sets 👍/👎. **No auth** (rate-limited by ticket existence).
- Admin-only (use `requireSupabaseAuth` + `has_role` check inside handler):
  - `adminListTickets()` — returns tickets joined with `app_users` + latest rating.
  - `adminUpdateTicket({id, status?, ai_response?, admin_notes?})`
  - `adminDeleteTicket({id})`
  - `adminGetConversation({ticketId})`

Tone map updated to spec:
- IT → friendly + technical, include troubleshooting step + escalation path
- HR → formal + empathetic, next step + timeline
- Finance → formal + precise, policy/approval + reference number (generate short ref)
- Operations → urgent + action-oriented, immediate action + priority level

---

## Routes & UI

### Public
- `/` → redirect to `/chat`
- `/chat` — User Chat Portal:
  - Pre-chat form (Name, Email, Department dropdown)
  - Chat view: bubbles (user right / assistant left), typing indicator, category badge after first reply, ticket ID + timestamp footer, 👍/👎 buttons on assistant messages, input box for follow-ups.
- `/login` — existing admin login (keep; relabel "Admin Sign in").

### Authenticated admin (under `_authenticated`, with admin role check in `beforeLoad`)
- `/dashboard` — Analytics overview: 4 summary cards (Total, Open, Resolved, Avg Rating), bar chart (by category), line chart (tickets over time with daily/weekly toggle), pie chart (status breakdown).
- `/tickets` — Full table with filters (category, status, date range, department), search (keyword/name/id), sortable columns, row click → drawer/modal showing full conversation, AI response editor, status dropdown, internal notes textarea, delete button.
- Realtime subscription on `tickets` + `conversations` to auto-refresh both pages.

---

## Components

New / updated:
- `ChatPortal.tsx` (pre-chat form + chat view, manages local state, calls server fns)
- `ChatBubble.tsx`, `TypingIndicator.tsx`, `RatingButtons.tsx`
- `AdminTicketTable.tsx` (replaces current `TicketList.tsx`) — TanStack-ish filtering with native state, sortable headers.
- `AdminTicketDrawer.tsx` — conversation view + edit controls + notes + delete.
- `AnalyticsOverview.tsx` — 4 cards + 3 charts (Recharts), all wrapped in `<ClientOnly>` to avoid SSR crash.
- `useRealtimeTickets.ts` hook.

Keep `CategoryBadge.tsx`; extend colors per spec (🔵 IT / 🟠 HR / 🟢 Finance / 🟣 Operations).

---

## Technical details

```text
src/
  routes/
    index.tsx                 → redirect to /chat
    chat.tsx                  (public)
    login.tsx                 (existing)
    _authenticated.tsx        (adds admin role guard)
    _authenticated/
      dashboard.tsx           (analytics)
      tickets.tsx             (admin table)
  lib/
    tickets.functions.ts      (rewritten per above)
  components/
    chat/ChatPortal.tsx, ChatBubble.tsx, TypingIndicator.tsx, PreChatForm.tsx, RatingButtons.tsx
    admin/AnalyticsOverview.tsx, AdminTicketTable.tsx, AdminTicketDrawer.tsx, Filters.tsx
    CategoryBadge.tsx (extended)
  hooks/useRealtimeTickets.ts
```

- Recharts components always wrapped in `<ClientOnly fallback={…}>` to keep SSR safe (matches the earlier fix).
- All public mutations validated with Zod (length limits, email format, enum departments).
- Admin guard: `beforeLoad` in `_authenticated.tsx` checks session AND calls a `getMyRole` server fn; if not admin → redirect to `/login`.
- Realtime via `supabase.channel('tickets').on('postgres_changes', …)` triggers React Query `refetch`.

---

## Out of scope / assumptions

- No multi-tenant orgs.
- "Admins" table from spec is implemented as `user_roles` (standard Lovable security pattern — storing roles on a separate table prevents privilege escalation).
- Email notifications not requested → skipped.
- After migration, you'll need to assign yourself admin: I'll show the exact SQL in the final message.
