import type { ColumnDef } from "@tanstack/react-table"
import { Download, ImageOff, Loader2, Maximize2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { FineTunedBadge, KindBadge, OutcomeBadge, StatusBadge } from "@/components/badges"
import { HorizontalBars, StatTile } from "@/components/charts"
import { DataTable, SortHeader } from "@/components/data-table"
import { JsonViewer } from "@/components/json-viewer"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isIntervention, trialReason } from "@/lib/analysis"
import { api, type ExperimentDetail, type Trial } from "@/lib/api"
import { dateTime, humanize, liveLine, modelLabel, number, percent, runProgress, usd } from "@/lib/format"
import { INTERVENTION_LABEL, MODULE_INFO } from "@/lib/harness-info"
import { isActive } from "@/lib/hooks"
import { cn } from "@/lib/utils"

const trialKey = (t: Trial) => `${t.seed}-${t.trial}`

export function ExperimentDetailDialog({ experimentId, onOpenChange, refreshKey }: {
  experimentId: string | null
  onOpenChange: (open: boolean) => void
  refreshKey: number
}) {
  const [detail, setDetail] = useState<ExperimentDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedTrial, setSelectedTrial] = useState<string | null>(null)
  const [tab, setTab] = useState("summary")

  useEffect(() => {
    if (!experimentId) {
      setDetail(null)
      setSelectedTrial(null)
      setTab("summary")
      return
    }
    let cancelled = false
    api.experiment(experimentId)
      .then((data) => { if (!cancelled) { setDetail(data); setError(null) } })
      .catch((err) => { if (!cancelled) setError((err as Error).message) })
    return () => { cancelled = true }
  }, [experimentId, refreshKey])

  const trial = detail?.trials.find((t) => trialKey(t) === selectedTrial) ?? null

  return (
    <Dialog open={!!experimentId} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[90dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-sm p-0 sm:max-w-6xl">
        <DialogHeader className="min-w-0 border-b px-4 py-4 pr-12 [overflow-wrap:anywhere] sm:px-6 sm:pr-12">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[1.125rem]">
            {detail?.summary.name ?? "Loading…"}
            {detail && <StatusBadge status={detail.summary.status} />}
            {detail && <KindBadge kind={detail.summary.kind} />}
            {detail?.summary.finetuned && <FineTunedBadge />}
          </DialogTitle>
          <DialogDescription className="text-[0.875rem]">
            {detail ? `${modelLabel(detail.summary.model)} · ${detail.summary.instruction}` : error ?? " "}
            {detail?.summary.source_experiment && ` · replays the failed seeds of “${detail.summary.source_experiment.name}”`}
          </DialogDescription>
        </DialogHeader>
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {error ?? <Loader2 className="size-5 animate-spin" />}
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
            <div className="flex flex-wrap items-center justify-between border-b px-2 sm:px-6">
              <TabsList variant="line" className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto [&_button]:whitespace-normal">
                <TabsTrigger value="summary">Summary & analytics</TabsTrigger>
                <TabsTrigger value="trials">Trials ({detail.trials.length})</TabsTrigger>
                <TabsTrigger value="request">Request JSON</TabsTrigger>
              </TabsList>
              <Button variant="ghost" size="sm" className="gap-1 text-[0.8125rem]" asChild>
                <a href={api.exportUrl([detail.summary.id])}><Download className="size-3.5" /> Save to file</a>
              </Button>
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background p-3 sm:p-6">
              <TabsContent value="summary" className="mt-0">
                <SummaryTab detail={detail} onPickTrial={(key) => { setSelectedTrial(key); setTab("trials") }} />
              </TabsContent>
              <TabsContent value="trials" className="mt-0">
                <TrialsTab detail={detail} selected={selectedTrial} onSelect={setSelectedTrial} trial={trial} />
              </TabsContent>
              <TabsContent value="request" className="mt-0 grid gap-3">
                {detail.request ? <JsonViewer title="Request sent by the console" data={detail.request} defaultOpen />
                  : <p className="rounded-sm border bg-card p-3 text-[0.875rem] text-muted-foreground">
                    {detail.summary.source === "console" ? "This experiment was created with “Save request JSON” turned off."
                      : "Imported experiments have no console request. The resolved configuration is below."}
                  </p>}
                <JsonViewer title="Resolved experiment configuration" data={detail.experiment} defaultOpen={!detail.request} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SummaryTab({ detail, onPickTrial }: { detail: ExperimentDetail; onPickTrial: (key: string) => void }) {
  const { summary: s, analytics: a, experiment: e } = detail
  const outcomeData = Object.entries(a.outcomes).sort((x, y) => y[1] - x[1]).map(([label, value]) => ({ label: humanize(label), value }))
  const interventionData = Object.entries(a.interventions).map(([k, v]) => ({ label: INTERVENTION_LABEL[k] ?? humanize(k), value: v }))
  const trialsBySeed = useMemo(() => {
    const map = new Map<number, Trial[]>()
    for (const t of detail.trials) map.set(t.seed, [...(map.get(t.seed) ?? []), t])
    return map
  }, [detail.trials])

  return (
    <div className="grid gap-4">
      {isActive(s.status) && (
        <div className="rounded-sm border bg-card p-3">
          <div className="mb-1.5 flex justify-between text-[0.8125rem]">
            <span>{s.current ? `Running seed ${s.current.seed}, trial ${s.current.trial}` : s.message}</span>
            <span className="tabular-nums">{s.done} / {s.total} trials done</span>
          </div>
          <Progress value={runProgress(s.done, s.total, s.current)} className="h-1.5" />
          {liveLine(s.current) && <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{liveLine(s.current)}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Success rate" value={percent(a.success_rate)}
          sub={a.success_ci ? `95% CI ${percent(a.success_ci[0])}–${percent(a.success_ci[1])}` : undefined} />
        <StatTile label="Trials graded" value={`${a.successes} / ${a.graded}`} sub={`${a.errors} errors`} />
        <StatTile label="Time to success" value={number(a.mean_time_to_success_s, 1, " s")} sub="mean, simulated" />
        <StatTile label="Model calls / trial" value={number(a.mean_calls, 0)} sub={`median RTT ${number(a.median_rtt_s, 2, " s")}`} />
        <StatTile label="API cost" value={usd(a.cost_usd)} sub={`wall ${number(a.mean_wall_s, 0, " s")} / trial`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm border bg-card p-4">
          <h3 className="mb-2 text-[0.875rem] font-semibold">Outcomes</h3>
          <HorizontalBars data={outcomeData} valueLabel="Trials" />
        </div>
        <div className="rounded-sm border bg-card p-4">
          <h3 className="mb-1 text-[0.875rem] font-semibold">Seed × trial results</h3>
          <p className="mb-2 text-[0.8125rem] text-muted-foreground">Each square is one trial. Select one to open it.</p>
          <div className="grid max-h-64 gap-1 overflow-y-auto">
            {[...trialsBySeed.entries()].map(([seed, trials]) => (
              <div key={seed} className="flex flex-wrap items-center gap-2">
                <span className="w-12 font-mono text-[0.75rem] text-muted-foreground">{seed}</span>
                {trials.sort((x, y) => x.trial - y.trial).map((t) => (
                  <Tooltip key={trialKey(t)}>
                    <TooltipTrigger asChild>
                      <button type="button" onClick={() => onPickTrial(trialKey(t))}
                        aria-label={`Seed ${t.seed} trial ${t.trial}: ${t.outcome}`}
                        className={cn("flex size-6 items-center justify-center rounded-[2px] border text-[0.6875rem] font-semibold",
                          t.success ? "border-success-border bg-success-bg text-success"
                            : t.outcome === "error" ? "border-border bg-muted text-muted-foreground"
                            : "border-danger-border bg-danger-bg text-destructive")}>
                        {t.success ? "✓" : t.outcome === "error" ? "!" : "✕"}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Seed {t.seed}, trial {t.trial}: {humanize(t.outcome)}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            ))}
            {!detail.trials.length && <p className="text-[0.8125rem] text-muted-foreground">No trials have finished yet.</p>}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm border bg-card p-4">
          <h3 className="mb-2 text-[0.875rem] font-semibold">Configuration</h3>
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-[0.875rem] [overflow-wrap:anywhere]">
            <dt className="text-muted-foreground">Controller</dt><dd>{e.controller === "expert" ? "Scripted expert (FK/IK)" : e.controller === "recovery" ? "Scripted expert on the failed seeds of a harness run" : "Dream-1 policy"}</dd>
            <dt className="text-muted-foreground">Model</dt><dd className="min-w-0 font-mono text-[0.8125rem] break-all">{e.model}</dd>
            <dt className="text-muted-foreground">Scene</dt><dd>{e.scene}</dd>
            <dt className="text-muted-foreground">Steps</dt>
            <dd>{e.steps.map((st, i) => <div key={i}>{i + 1}. {humanize(st.target)} → {humanize(st.goal)}</div>)}</dd>
            <dt className="text-muted-foreground">Seeds × trials</dt><dd>{e.seeds.length} × {e.trials_per_seed}</dd>
            <dt className="text-muted-foreground">Sim time · jitter</dt><dd>{e.sim_seconds} s · {e.jitter_cm} cm</dd>
            {e.controller === "dream1" && <><dt className="text-muted-foreground">Rows per reply</dt><dd>{e.rows_per_reply}</dd></>}
            <dt className="text-muted-foreground">Harness</dt>
            <dd>{e.harness.enabled ? (e.harness.modules ?? []).map((m) => MODULE_INFO[m]?.label ?? m).join(", ") || "on, no modules" : "Off"}</dd>
            <dt className="text-muted-foreground">Created</dt><dd>{dateTime(e.created_at)}</dd>
          </dl>
        </div>
        <div className="rounded-sm border bg-card p-4">
          <h3 className="mb-2 text-[0.875rem] font-semibold">Harness interventions</h3>
          {interventionData.length ? <HorizontalBars data={interventionData} valueLabel="Interventions" />
            : <p className="text-[0.8125rem] text-muted-foreground">No interventions recorded.</p>}
        </div>
      </div>
    </div>
  )
}

function TrialsTab({ detail, selected, onSelect, trial }: {
  detail: ExperimentDetail; selected: string | null; onSelect: (key: string | null) => void; trial: Trial | null
}) {
  const columns = useMemo<ColumnDef<Trial, unknown>[]>(() => [
    { accessorKey: "seed", header: ({ column }) => <SortHeader label="Seed · trial" column={column} />,
      cell: ({ row }) => <span className="font-mono whitespace-nowrap">{row.original.seed} · t{row.original.trial}</span> },
    { accessorKey: "outcome", header: ({ column }) => <SortHeader label="Outcome" column={column} />, cell: ({ row }) => <OutcomeBadge outcome={row.original.outcome} success={row.original.success} /> },
    { id: "reason", header: "What went wrong", cell: ({ row }) => {
      const reason = trialReason(row.original)
      return reason
        ? <span className={cn("line-clamp-2 text-[0.8125rem] whitespace-normal [overflow-wrap:anywhere]", row.original.outcome === "error" ? "text-muted-foreground" : "text-destructive")} title={reason}>{reason}</span>
        : <span className="text-muted-foreground">—</span>
    } },
    { id: "steps", header: "Steps", cell: ({ row }) => row.original.progress_of ? `${row.original.progress ?? 0} / ${row.original.progress_of}` : "—" },
    { id: "time", header: "Sim time", cell: ({ row }) => <span className="whitespace-nowrap">{number((row.original.rows ?? NaN) / 20, 1, " s")}</span> },
    { accessorKey: "calls", header: "Calls", cell: ({ row }) => row.original.calls ?? "—" },
    { id: "interventions", header: "Interv.", cell: ({ row }) => (row.original.interventions ?? []).filter(isIntervention).length },
  ], [])
  const panel = useRef<HTMLDivElement>(null)
  // Bring the clicked trial's details into view below the table.
  useEffect(() => { if (selected) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }) }, [selected])
  const reason = trial ? trialReason(trial) : null

  return (
    <div className="grid min-w-0 gap-4">
      <DataTable columns={columns} data={detail.trials} getRowId={trialKey} pageSize={12}
        className="[&_table]:table-fixed [&_th]:whitespace-normal [&_td]:whitespace-normal [&_th:nth-child(3)]:w-[46%] [&_td]:[overflow-wrap:anywhere] [&_td_span]:whitespace-normal max-lg:[&_th:nth-child(n+4)]:hidden max-lg:[&_td:nth-child(n+4)]:hidden max-sm:[&_th]:px-1.5 max-sm:[&_td]:px-1.5"
        onRowClick={(t) => onSelect(trialKey(t))} empty="No trials have finished yet." />
      <div ref={panel} className="min-w-0 scroll-mt-4 rounded-sm border bg-card p-4">
        {!trial ? (
          <p className="py-10 text-center text-[0.875rem] text-muted-foreground">Click a trial in the table to see why it failed, its replay, request and response.</p>
        ) : (
          <div className="grid min-w-0 gap-3" key={selected}>
            <div className="flex items-center justify-between">
              <h3 className="text-[0.9375rem] font-semibold">Seed {trial.seed} · trial {trial.trial}</h3>
              <OutcomeBadge outcome={trial.outcome} success={trial.success} />
            </div>
            {reason && (
              <div className="rounded-sm border border-danger-border bg-danger-bg p-3 text-[0.875rem] text-destructive">
                <p className="mb-1 font-semibold">{trial.outcome === "error" ? "Error" : "Why it failed"}</p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{trial.error || reason}</p>
              </div>
            )}
            <p className="text-[0.8125rem] text-muted-foreground lg:hidden">
              {trial.progress_of ? `${trial.progress ?? 0} / ${trial.progress_of} steps · ` : ""}
              {number((trial.rows ?? NaN) / 20, 1, " s")} sim time · {trial.calls ?? "—"} calls · {(trial.interventions ?? []).filter(isIntervention).length} interventions
            </p>
            {trial.media ? (
              <div className="min-w-0 max-w-3xl"><Replay trial={trial} /></div>
            ) : (
              <div className="flex items-center gap-2 rounded-sm border border-dashed p-4 text-[0.8125rem] text-muted-foreground">
                <ImageOff className="size-4" /> No replay saved for this trial.
              </div>
            )}
            {(trial.interventions ?? []).some(isIntervention) && (
              <div className="text-[0.8125rem]">
                <p className="mb-1 font-semibold">Interventions</p>
                {(trial.interventions ?? []).filter(isIntervention).map((i, idx) => (
                  <p key={idx} className="text-muted-foreground">t = {(i.row / 20).toFixed(1)} s · {INTERVENTION_LABEL[i.reason] ?? humanize(i.reason)}</p>
                ))}
              </div>
            )}
            <JsonViewer title="Request (this trial)" data={trial.request ?? { note: "Not recorded for imported runs." }} defaultOpen />
            <JsonViewer title="Response (trial result)" data={withoutRequest(trial)} />
          </div>
        )}
      </div>
    </div>
  )
}

function withoutRequest(trial: Trial) {
  const copy: Record<string, unknown> = { ...trial }
  delete copy.request
  return copy
}


/** A trial's camera replay, with a button that opens it nearly full screen. */
function Replay({ trial }: { trial: Trial }) {
  const [maximized, setMaximized] = useState(false)
  const label = `Camera replay of seed ${trial.seed} trial ${trial.trial}`
  const media = (big: boolean) => trial.media_type === "video"
    ? <video src={trial.media!} controls autoPlay={big} className={cn("w-full rounded-sm border bg-black", big && "max-h-[82vh] object-contain")} />
    : <img src={trial.media!} alt={label} className={cn("w-full rounded-sm border", big && "max-h-[82vh] object-contain")} />
  return (
    <>
      <div className="relative">
        {media(false)}
        <Button variant="secondary" size="sm" className="absolute top-2 right-2 h-7 gap-1 text-xs opacity-90" onClick={() => setMaximized(true)}>
          <Maximize2 className="size-3.5" /> Maximize
        </Button>
      </div>
      <Dialog open={maximized} onOpenChange={setMaximized}>
        <DialogContent className="rounded-sm sm:max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>Seed {trial.seed} · trial {trial.trial}</DialogTitle>
            <DialogDescription>Overhead camera with both wrist cameras, as the model saw them.</DialogDescription>
          </DialogHeader>
          {media(true)}
        </DialogContent>
      </Dialog>
    </>
  )
}
