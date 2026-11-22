import { Eye, FileJson, Loader2, Search, Upload, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { PageHeader, Section } from "@/components/app-shell"
import { KindBadge, SourceBadge } from "@/components/badges"
import { SERIES } from "@/components/charts"
import { JsonBlock } from "@/components/json-viewer"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { parseSaveFiles, SLOT_LETTERS, type SaveFile } from "@/lib/analysis"
import { api, type ExperimentSummary } from "@/lib/api"
import { modelLabel, percent } from "@/lib/format"
import { useExperiments } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import { ConfigDiff, PerformanceComparison, RunHeading } from "./comparison"
import { FailureAnalysis } from "./failures"

const MAX_RUNS = 3
const FINISHED = new Set(["completed", "completed_with_errors"])

export function AnalyzePage() {
  const { experiments } = useExperiments()
  const [chosen, setChosen] = useState<string[]>([])
  const [loaded, setLoaded] = useState<Record<string, SaveFile>>({})
  const [uploads, setUploads] = useState<SaveFile[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [rawId, setRawId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const finished = useMemo(() => experiments.filter((e) => FINISHED.has(e.status)), [experiments])

  // Fetch the full save file of every chosen server experiment, and of the one opened as a raw file.
  useEffect(() => {
    const wanted = rawId && !chosen.includes(rawId) ? [...chosen, rawId] : chosen
    const missing = wanted.filter((id) => !id.startsWith("upload:") && !loaded[id])
    if (!missing.length) return
    setLoading(true)
    Promise.all(missing.map((id) => api.experiment(id)))
      .then((details) => setLoaded((current) => {
        const next = { ...current }
        for (const d of details) {
          next[d.summary.id] = {
            id: d.summary.id, name: d.summary.name, origin: "server", source: d.summary.source, experiment: d.experiment,
            status: d.status, request: d.request, trials: d.trials, analytics: d.analytics,
          }
        }
        return next
      }))
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setLoading(false))
  }, [chosen, rawId, loaded])

  const files = chosen.map((id) => loaded[id] ?? uploads.find((u) => u.id === id)).filter(Boolean) as SaveFile[]
  const filesKey = files.map((f) => f.id).join("|")
  const rawFile = rawId ? loaded[rawId] ?? uploads.find((u) => u.id === rawId) : undefined

  function toggle(id: string, on: boolean) {
    setChosen((current) => {
      if (!on) return current.filter((x) => x !== id)
      if (current.length >= MAX_RUNS) {
        toast.message(`Compare up to ${MAX_RUNS} save files at a time. Deselect one first.`)
        return current
      }
      return [...current, id]
    })
  }

  async function onUpload(list: FileList | null) {
    for (const file of Array.from(list ?? [])) {
      try {
        const parsed = parseSaveFiles(await file.text(), file.name)
        setUploads((current) => [...current.filter((u) => !parsed.some((p) => p.id === u.id)), ...parsed])
        setChosen((current) => [...current, ...parsed.map((p) => p.id)].slice(-MAX_RUNS))
        toast.success(`Loaded ${parsed.length} save file${parsed.length > 1 ? "s" : ""} from ${file.name}`)
      } catch (err) {
        toast.error((err as Error).message)
      }
    }
    if (fileInput.current) fileInput.current.value = ""
  }

  const visible = finished.filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div>
      <PageHeader
        title="Analyze Jobs"
        description="Select three save files to compare them side by side (for example A vanilla, B harness-assisted, C scripted) and find where runs fail. Click a card to see its raw save file."
        actions={
          <>
            <input ref={fileInput} type="file" accept="application/json,.json" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
            <Button variant="outline" size="sm" className="gap-1" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" /> Load save file from disk
            </Button>
          </>
        }
      />
      <div className="grid gap-5 p-6">
        <Section title="Save files" description={`${files.length} of ${MAX_RUNS} selected. Colours and letters follow the selection order.`}
          actions={loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}>
          <div className="mb-3 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={f.id} className="inline-flex items-center gap-2 rounded-sm border bg-background py-1 pr-1 pl-2 text-[0.8125rem]"
                style={{ boxShadow: `inset 3px 0 0 ${SERIES[i]}` }}>
                <button type="button" className="cursor-pointer text-left" title="View raw save file" onClick={() => setRawId(f.id)}>
                  <RunHeading file={f} index={i} />
                </button>
                <Button variant="ghost" size="icon" className="size-5" aria-label={`Remove ${f.name}`} onClick={() => toggle(f.id, false)}>
                  <X className="size-3" />
                </Button>
              </span>
            ))}
            {!files.length && <span className="text-[0.8125rem] text-muted-foreground">Tick up to three save files below.</span>}
          </div>
          <div className="relative mb-2 w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter save files" className="h-8 pl-8 text-[0.875rem]" />
          </div>
          <div className="grid max-h-64 gap-1 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
            {[...uploads.map((u) => ({ upload: u })), ...visible.map((e) => ({ experiment: e }))].map((item) => {
              const id = "upload" in item ? item.upload!.id : item.experiment!.id
              const index = chosen.indexOf(id)
              return (
                <div key={id} role="button" tabIndex={0} title="View raw save file"
                  onClick={() => setRawId(id)} onKeyDown={(e) => { if (e.key === "Enter") setRawId(id) }}
                  className={cn("flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1.5 text-[0.8125rem] hover:bg-background", index >= 0 && "border-ring bg-accent")}>
                  <span onClick={(e) => e.stopPropagation()} className="flex">
                    <Checkbox checked={index >= 0} aria-label="Select for comparison" onCheckedChange={(v) => toggle(id, !!v)} />
                  </span>
                  {"upload" in item ? <UploadRow file={item.upload!} /> : <ExperimentRow e={item.experiment!} />}
                  {index >= 0 && <span className="ml-auto font-semibold" style={{ color: SERIES[index] }}>{SLOT_LETTERS[index]}</span>}
                  <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                </div>
              )
            })}
          </div>
        </Section>

        {files.length > 0 && files.length < MAX_RUNS && (
          <p className="rounded-sm border bg-card px-4 py-6 text-center text-[0.875rem] text-muted-foreground">
            Select {MAX_RUNS - files.length} more save file{MAX_RUNS - files.length > 1 ? "s" : ""} to see the comparison.
          </p>
        )}

        {files.length === MAX_RUNS && (
          <>
            <div className="flex items-center gap-3 pt-2">
              <h2 className="text-[1rem] font-semibold text-foreground">Analysis & comparison</h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Section title="Hyperparameters & configuration" description="Exact settings of each save file; differing rows are highlighted.">
              <ConfigDiff files={files} />
            </Section>
            <Section title="Performance breakdown" description="Completion, efficiency, outcome distributions and execution time.">
              <PerformanceComparison files={files} />
            </Section>
            <Section title="Failure mode diagnostics" description="Where and why runs failed, with a trace against the reference run on the same seed.">
              <FailureAnalysis key={filesKey} files={files} />
            </Section>

          </>
        )}
      </div>

      <Dialog open={!!rawId} onOpenChange={(open) => !open && setRawId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-sm sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Raw save file{rawFile ? ` · ${rawFile.name}` : ""}</DialogTitle>
            <DialogDescription>{rawFile ? `${rawFile.trials.length} trials` : "Loading…"}</DialogDescription>
          </DialogHeader>
          {rawFile
            ? <JsonBlock maxHeight={640}
                data={{ experiment: rawFile.experiment, status: rawFile.status, request: rawFile.request, trials: rawFile.trials }} />
            : <p className="flex items-center gap-2 text-[0.875rem] text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading the save file…</p>}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ExperimentRow({ e }: { e: ExperimentSummary }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <FileJson className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1"><span className="truncate font-medium">{e.name}</span><SourceBadge source={e.source} /></span>
        <span className="block truncate text-[0.75rem] text-muted-foreground">
          {modelLabel(e.model)} · {e.graded} graded · {percent(e.success_rate)} success
        </span>
      </span>
      <KindBadge kind={e.kind} />
    </span>
  )
}

function UploadRow({ file }: { file: SaveFile }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <Upload className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{file.name}</span>
        <span className="block text-[0.75rem] text-muted-foreground">From disk · {file.trials.length} trials</span>
      </span>
      <KindBadge kind={file.experiment.kind} />
    </span>
  )
}
