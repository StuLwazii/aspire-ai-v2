import { createFileRoute } from "@tanstack/react-router";
import GovernancePage from "@/components/admin/GovernancePage";

export const Route = createFileRoute("/_authenticated/governance")({
  component: GovernancePage,
});
