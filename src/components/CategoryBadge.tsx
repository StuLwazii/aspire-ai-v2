import type { Database } from "@/integrations/supabase/types";

type Cat = Database["public"]["Enums"]["ticket_category"];

const STYLE: Record<Cat, { bg: string; fg: string; label: string }> = {
  IT:         { bg: "color-mix(in oklab, var(--cat-it) 15%, transparent)",      fg: "var(--cat-it)",      label: "IT" },
  Finance:    { bg: "color-mix(in oklab, var(--cat-finance) 15%, transparent)", fg: "var(--cat-finance)", label: "Finance" },
  HR:         { bg: "color-mix(in oklab, var(--cat-hr) 18%, transparent)",      fg: "var(--cat-hr)",      label: "HR" },
  Operations: { bg: "color-mix(in oklab, var(--cat-ops) 15%, transparent)",     fg: "var(--cat-ops)",     label: "Operations" },
};

export function CategoryBadge({ category }: { category: Cat }) {
  const s = STYLE[category];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}