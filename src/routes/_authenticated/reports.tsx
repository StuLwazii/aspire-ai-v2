import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Sparkles, Download, FileText, Trash2, Clock, Calendar, Plus, Eye, Loader2 } from "lucide-react";
import {
  adminGenerateReport, adminListReports, adminGetReport, adminDeleteReport,
  adminListSchedules, adminCreateSchedule, adminUpdateSchedule, adminDeleteSchedule,
} from "@/lib/reports.functions";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Business Reports — Aspire AI" }] }),
});

const DEPARTMENTS = ["All", "Sales", "Marketing", "Operations", "Finance", "HR", "IT"] as const;

type ReportRow = {
  id: string; title: string; department: string;
  period_start: string; period_end: string;
  executive_summary: string; recommendations: string;
  kpis: Record<string, unknown>; created_at: string;
  html?: string; performance_analysis?: string;
};

type Schedule = {
  id: string; name: string; department: string; cadence: string;
  recipients: string[]; active: boolean;
  last_run_at: string | null; next_run_at: string | null; created_at: string;
};

function ReportsPage() {
  const session = useSupabaseSessionStatus();
  const enabled = session === "authenticated";
  const qc = useQueryClient();

  const listReports = useServerFn(adminListReports);
  const getReport = useServerFn(adminGetReport);
  const generate = useServerFn(adminGenerateReport);
  const delReport = useServerFn(adminDeleteReport);
  const listSchedules = useServerFn(adminListSchedules);
  const createSched = useServerFn(adminCreateSchedule);
  const updateSched = useServerFn(adminUpdateSchedule);
  const deleteSched = useServerFn(adminDeleteSchedule);

  const reportsQ = useQuery({ queryKey: ["reports"], queryFn: () => listReports() as Promise<ReportRow[]>, enabled });
  const schedulesQ = useQuery({ queryKey: ["report-schedules"], queryFn: () => listSchedules() as Promise<Schedule[]>, enabled });

  // Generate
  const [dept, setDept] = useState<string>("All");
  const [days, setDays] = useState<number>(7);
  const [filterDept, setFilterDept] = useState<string>("All");
  const [filterFrom, setFilterFrom] = useState<string>("");

  const genMut = useMutation({
    mutationFn: (vars: { department: string; periodDays: number }) =>
      generate({ data: { department: vars.department as never, periodDays: vars.periodDays, save: true } }),
    onSuccess: () => {
      toast.success("Report generated");
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delReport({ data: { id } }),
    onSuccess: () => { toast.success("Report deleted"); qc.invalidateQueries({ queryKey: ["reports"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Viewer
  const [viewing, setViewing] = useState<ReportRow | null>(null);
  const openReport = async (id: string) => {
    try {
      const r = await getReport({ data: { id } }) as ReportRow;
      setViewing(r);
    } catch (e) { toast.error((e as Error).message); }
  };

  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportHtml = (r: ReportRow) => r.html && download(`${r.title.replace(/\s+/g, "_")}.html`, r.html, "text/html");
  const exportDocx = (r: ReportRow) => r.html && download(`${r.title.replace(/\s+/g, "_")}.doc`, r.html, "application/msword");
  const exportPdf = (r: ReportRow) => {
    if (!r.html) return;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Pop-up blocked"); return; }
    w.document.write(r.html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  // Filter history
  const filteredReports = (reportsQ.data ?? []).filter((r) => {
    if (filterDept !== "All" && r.department !== filterDept) return false;
    if (filterFrom && new Date(r.created_at) < new Date(filterFrom)) return false;
    return true;
  });

  // Schedules
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedName, setSchedName] = useState("");
  const [schedDept, setSchedDept] = useState<string>("All");
  const [schedCadence, setSchedCadence] = useState<string>("weekly");
  const [schedRecipients, setSchedRecipients] = useState("");

  const createSchedMut = useMutation({
    mutationFn: () => createSched({
      data: {
        name: schedName, department: schedDept as never, cadence: schedCadence as never,
        recipients: schedRecipients.split(",").map((s) => s.trim()).filter(Boolean),
        active: true,
      },
    }),
    onSuccess: () => {
      toast.success("Schedule created");
      setSchedOpen(false); setSchedName(""); setSchedRecipients("");
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleSched = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) => updateSched({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-schedules"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSchedMut = useMutation({
    mutationFn: (id: string) => deleteSched({ data: { id } }),
    onSuccess: () => { toast.success("Schedule removed"); qc.invalidateQueries({ queryKey: ["report-schedules"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-accent" />
          <h1 className="text-3xl font-bold tracking-tight">Business Reporting Automation</h1>
        </div>
        <p className="text-muted-foreground mt-1">AI-generated executive summaries, department breakdowns, and scheduled delivery.</p>
      </header>

      <Tabs defaultValue="generate" className="space-y-4">
        <TabsList>
          <TabsTrigger value="generate"><Sparkles className="h-4 w-4 mr-1.5" /> Generate</TabsTrigger>
          <TabsTrigger value="history"><FileText className="h-4 w-4 mr-1.5" /> History</TabsTrigger>
          <TabsTrigger value="schedules"><Clock className="h-4 w-4 mr-1.5" /> Schedules</TabsTrigger>
        </TabsList>

        {/* GENERATE */}
        <TabsContent value="generate">
          <Card className="p-5 space-y-4">
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Department</label>
                <Select value={dept} onValueChange={setDept}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Period</label>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days (Weekly)</SelectItem>
                    <SelectItem value="14">Last 14 days</SelectItem>
                    <SelectItem value="30">Last 30 days (Monthly)</SelectItem>
                    <SelectItem value="90">Last 90 days (Quarterly)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={() => genMut.mutate({ department: dept, periodDays: days })}
                  disabled={genMut.isPending}
                >
                  {genMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generate report</>}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The AI reads live dashboard data, computes KPIs (volume, resolution rate, response times, trend vs previous period), and writes an executive-level summary, performance analysis, and recommendations. The report is archived in History.
            </p>
          </Card>
        </TabsContent>

        {/* HISTORY */}
        <TabsContent value="history" className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[140px]">
                <label className="text-xs text-muted-foreground mb-1 block">Department</label>
                <Select value={filterDept} onValueChange={setFilterDept}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-[140px]">
                <label className="text-xs text-muted-foreground mb-1 block">Created from</label>
                <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
              </div>
              <div className="ml-auto text-sm text-muted-foreground">{filteredReports.length} report{filteredReports.length === 1 ? "" : "s"}</div>
            </div>
          </Card>

          <div className="space-y-2">
            {reportsQ.isLoading && <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>}
            {!reportsQ.isLoading && filteredReports.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">No reports yet. Generate your first one above.</Card>
            )}
            {filteredReports.map((r) => (
              <Card key={r.id} className="p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-accent" />
                    <div className="font-semibold">{r.title}</div>
                    <Badge variant="secondary">{r.department}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(r.period_start).toLocaleDateString()} → {new Date(r.period_end).toLocaleDateString()} · generated {new Date(r.created_at).toLocaleString()}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{r.executive_summary}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => openReport(r.id)}><Eye className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* SCHEDULES */}
        <TabsContent value="schedules" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Configure automated report generation and recipient lists.</p>
            <Button onClick={() => setSchedOpen(true)} size="sm"><Plus className="h-4 w-4 mr-1" /> New schedule</Button>
          </div>

          <div className="space-y-2">
            {schedulesQ.isLoading && <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>}
            {!schedulesQ.isLoading && (schedulesQ.data ?? []).length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">No schedules yet.</Card>
            )}
            {(schedulesQ.data ?? []).map((s) => (
              <Card key={s.id} className="p-4 flex flex-wrap items-center gap-3">
                <Calendar className="h-4 w-4 text-accent" />
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold">{s.name}</div>
                    <Badge variant="secondary">{s.department}</Badge>
                    <Badge variant="outline">{s.cadence}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {s.recipients.length} recipient{s.recipients.length === 1 ? "" : "s"}
                    {s.next_run_at && ` · next run ${new Date(s.next_run_at).toLocaleDateString()}`}
                    {s.last_run_at && ` · last ${new Date(s.last_run_at).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={s.active} onCheckedChange={(v) => toggleSched.mutate({ id: s.id, active: v })} />
                  <Button size="sm" variant="ghost" onClick={() => deleteSchedMut.mutate(s.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Schedule modal */}
      <Dialog open={schedOpen} onOpenChange={setSchedOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New report schedule</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name</label>
              <Input value={schedName} onChange={(e) => setSchedName(e.target.value)} placeholder="Weekly exec summary" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Department</label>
                <Select value={schedDept} onValueChange={setSchedDept}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Cadence</label>
                <Select value={schedCadence} onValueChange={setSchedCadence}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Recipients (comma-separated emails)</label>
              <Input value={schedRecipients} onChange={(e) => setSchedRecipients(e.target.value)} placeholder="ceo@company.com, cfo@company.com" />
            </div>
            <Button
              className="w-full"
              disabled={!schedName.trim() || createSchedMut.isPending}
              onClick={() => createSchedMut.mutate()}
            >
              {createSchedMut.isPending ? "Saving…" : "Create schedule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Viewer */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              {viewing?.title}
              {viewing && <Badge variant="secondary">{viewing.department}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => exportPdf(viewing)}><Download className="h-4 w-4 mr-1" /> PDF (print)</Button>
                <Button size="sm" variant="outline" onClick={() => exportDocx(viewing)}><Download className="h-4 w-4 mr-1" /> DOCX</Button>
                <Button size="sm" variant="outline" onClick={() => exportHtml(viewing)}><Download className="h-4 w-4 mr-1" /> HTML</Button>
              </div>
              <div className="flex-1 overflow-auto border rounded-md bg-white">
                <iframe title="report" srcDoc={viewing.html} className="w-full h-[70vh]" />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
