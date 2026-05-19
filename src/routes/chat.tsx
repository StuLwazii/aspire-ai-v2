import { createFileRoute } from "@tanstack/react-router";
import { ChatPortal } from "@/components/chat/ChatPortal";

export const Route = createFileRoute("/chat")({
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "Help Desk Chat — Helix" },
      { name: "description", content: "Get instant AI-powered help across HR, IT, Finance, and Operations." },
    ],
  }),
});

function ChatPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary flex items-center justify-center p-4">
      <ChatPortal />
    </div>
  );
}
