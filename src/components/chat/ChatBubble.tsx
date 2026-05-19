import { CategoryBadge } from "@/components/CategoryBadge";
import type { Database } from "@/integrations/supabase/types";

type Cat = Database["public"]["Enums"]["ticket_category"];

export function ChatBubble({
  role, message, timestamp, category, footer,
}: {
  role: "user" | "assistant";
  message: string;
  timestamp?: string;
  category?: Cat;
  footer?: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] sm:max-w-[75%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        {!isUser && category && <CategoryBadge category={category} />}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap shadow-sm ${
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-card border border-border rounded-bl-sm"
          }`}
        >
          {message}
        </div>
        {(timestamp || footer) && (
          <div className={`flex items-center gap-2 text-[10px] text-muted-foreground ${isUser ? "flex-row-reverse" : ""}`}>
            {timestamp && <span>{new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-2">Assistant is typing</span>
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
