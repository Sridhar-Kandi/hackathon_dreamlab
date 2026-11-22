import type { ColumnDef, RowSelectionState } from "@tanstack/react-table"
import { Download, Eye, MoreHorizontal, Plus, RefreshCw, Search, Sparkles, Square, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { PageHeader } from "@/components/app-shell"
import { KindBadge, SourceBadge, StatusBadge } from "@/components/badges"
import { DataTable, SortHeader } from "@/components/data-table"
import { FINISHED, FineTuneDialog, FineTuneJobCard } from "@/components/finetune"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type ExperimentSummary } from "@/lib/api"
import { dateTime, liveLine, modelLabel, percent, runProgress } from "@/lib/format"
import { isActive, useExperiments, useMeta } from "@/lib/hooks"
import { CreateExperimentDialog } from "./create-experiment-dialog"
import { ExperimentDetailDialog } from "./experiment-detail-dialog"

export function ExperimentsPage() {
  const { experiments, finetunes, loading, error, refresh } = useExperiments()
  const { meta, refresh: refreshMeta } = useMeta()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState("")
  const [modelFilter, setModelFilter] = useState("all")
  const [kindFilter, setKindFilter] = useState("all")
  const [selection, setSelection] = useState<RowSelectionState>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [fineTuneOpen, setFineTuneOpen] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ExperimentSummary | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // "Test model" on a finished fine-tune links here with ?create=1&model=<id>.
  const presetModel = params.get("model")
  useEffect(() => {
    if (params.get("create") === "1") {
      refreshMeta()
      setCreateOpen(true)
    }
  }, [params, refreshMeta])

  // Keep an open details modal in step with the polled list.
  useEffect(() => { setRefreshKey((k) => k + 1) }, [experiments])

  const models = useMemo(() => [...new Set(experiments.map((e) => e.model).filter(Boolean))], [experiments])
  const filtered = useMemo(() => experiments.filter((e) =>
    e.name.toLowerCase().includes(search.trim().toLowerCase())
    && (modelFilter === "all" || e.model === modelFilter)
    && (kindFilter === "all" || e.kind === kindFilter),
  ), [experiments, search, modelFilter, kindFilter])
  const selected = experiments.filter((e) => selection[e.id])
  const takenNames = useMemo(() => new Set(experiments.map((e) => e.name.toLowerCase())), [experiments])

  async function confirmDelete() {
    if (!deleting) return
    try {
      await api.remove(deleting.id)
      toast.success(`Deleted "${deleting.name}"`)
      setSelection((current) => { const next = { ...current }; delete next[deleting.id]; return next })
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  async function cancel(experiment: ExperimentSummary) {
    try {
      await api.cancel(experiment.id)
      toast.message(`Stopping "${experiment.name}"`)
      refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const columns = useMemo<ColumnDef<ExperimentSummary, unknown>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader label="Name" column={column} />,
      cell: ({ row }) => (
        <div className="min-w-0 max-w-72">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-accent-foreground hover:underline">{row.original.name}</span>
            <SourceBadge source={row.original.source} />
          </div>
          <p className="truncate text-[12px] text-muted-foreground" title={row.original.instruction}>{row.original.instruction}</p>
        </div>
      ),
    },
    {
      accessorKey: "model",
      header: ({ column }) => <SortHeader label="Model" column={column} />,
      cell: ({ row }) => <span title={row.original.model}>{modelLabel(row.original.model)}</span>,
    },
    {
      accessorKey: "kind",
      header: "Type",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <KindBadge kind={row.original.kind} />
          {row.original.harness && (
            <Tooltip>
              <TooltipTrigger asChild><span className="text-[11px] text-muted-foreground">{row.original.harness_modules.length} mod.</span></TooltipTrigger>
              <TooltipContent>{row.original.harness_modules.join(", ")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      id: "runs",
      header: "Seeds × trials",
      cell: ({ row }) => <span className="tabular-nums">{row.original.seeds} × {row.original.trials_per_seed}</span>,
    },
    {
      id: "progress",
      header: "Progress",
      cell: ({ row }) => {
        const e = row.original
        return (
          <div className="w-32">
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{e.done}/{e.total}</span>
              {e.current && <span>seed {e.current.seed}·t{e.current.trial}</span>}
            </div>
            <Progress value={runProgress(e.done, e.total, e.current)} className="h-1" />
            {e.current?.phase && (
              <div className="mt-1 truncate text-[11px] text-muted-foreground" title={liveLine(e.current) ?? ""}>
                {e.current.phase === "Running" ? `${(e.current.sim_s ?? 0).toFixed(0)}/${e.current.sim_total} s sim` : e.current.phase}
              </div>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "success_rate",
      header: ({ column }) => <SortHeader label="Success" column={column} />,
      sortUndefined: "last",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {percent(row.original.success_rate)}
          <span className="ml-1 text-[11px] text-muted-foreground">{row.original.successes}/{row.original.graded}</span>
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => <SortHeader label="Status" column={column} />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => <SortHeader label="Created" column={column} />,
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{dateTime(row.original.created_at)}</span>,
    },
    {
      id: "actions",
      header: "",
      size: 40,
      cell: ({ row }) => {
        const e = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${e.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={() => setViewing(e.id)}><Eye className="size-4" /> View details & results</DropdownMenuItem>
              <DropdownMenuItem asChild><a href={api.exportUrl([e.id])}><Download className="size-4" /> Save to file</a></DropdownMenuItem>
              {isActive(e.status) && e.status !== "stopping" && (
                <DropdownMenuItem onSelect={() => cancel(e)}><Square className="size-4" /> Stop run</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={!!e.readonly} onSelect={() => setDeleting(e)}>
                <Trash2 className="size-4" /> {e.readonly ? "Delete (read-only source)" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [])

  const blockedSelection = selected.filter((e) => !FINISHED.has(e.status))
  const exportIds = selected.length ? selected.map((e) => e.id) : filtered.map((e) => e.id)

  return (
    <div>
      <PageHeader
        title="Experiments"
        description="Every experiment, including the ones you create here. Open one to see its trials, request JSON, replays and analytics."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1" asChild disabled={!exportIds.length}>
              <a href={api.exportUrl(exportIds)}><Download className="size-4" /> Save {selected.length ? `${selected.length} selected` : "all shown"} to file</a>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="outline" size="sm" className="gap-1" disabled={!selected.length || blockedSelection.length > 0}
                    onClick={() => setFineTuneOpen(true)}>
                    <Sparkles className="size-4" /> Fine-tune{selected.length ? ` (${selected.length})` : ""}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {!selected.length ? "Select one or more finished experiments to fine-tune on."
                  : blockedSelection.length ? `"${blockedSelection[0].name}" has not finished running yet.` : "Fine-tune Dream-1 on the selected experiments."}
              </TooltipContent>
            </Tooltip>
            <Button size="sm" className="gap-1" onClick={() => { refreshMeta(); setCreateOpen(true) }}>
              <Plus className="size-4" /> Add experiment
            </Button>
          </>
        }
      />
      <div className="grid gap-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name"
              className="h-8 w-64 bg-card pl-8 text-[13px]" />
          </div>
          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger size="sm" className="w-52 bg-card text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {models.map((m) => <SelectItem key={m} value={m}>{modelLabel(m)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger size="sm" className="w-40 bg-card text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="vanilla">Vanilla</SelectItem>
              <SelectItem value="harness">Harness</SelectItem>
              <SelectItem value="scripted">Scripted</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="gap-1 text-[13px]" onClick={refresh}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          {error && <span className="text-[12px] text-destructive">{error}</span>}
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(e) => e.id}
          selectable
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          onRowClick={(e) => setViewing(e.id)}
          empty={loading ? "Loading experiments…" : "No experiments match these filters."}
          initialSorting={[{ id: "created_at", desc: true }]}
        />
        {finetunes.length > 0 && (
          <section className="grid gap-2">
            <h2 className="text-[14px] font-semibold">Fine-tuning jobs</h2>
            {finetunes.map((job) => <FineTuneJobCard key={job.id} job={job} onChanged={refresh} />)}
          </section>
        )}
      </div>

      <CreateExperimentDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open && params.get("create")) setParams({}, { replace: true })
        }}
        meta={meta}
        takenNames={takenNames}
        initialModel={presetModel}
        onCreated={refresh}
      />
      <ExperimentDetailDialog experimentId={viewing} onOpenChange={(open) => !open && setViewing(null)} refreshKey={refreshKey} />
      <FineTuneDialog open={fineTuneOpen} onOpenChange={setFineTuneOpen} selected={selected}
        onStarted={() => { setSelection({}); refresh() }} />
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="rounded-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the experiment's save file, results and replays from disk.
              {deleting && isActive(deleting.status) ? " The run is still active and will be stopped first." : ""} This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
