import { Bot, Cpu, Info, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { JsonViewer } from "@/components/json-viewer"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Controller, type CreateExperimentRequest, type Meta, type Step } from "@/lib/api"
import { humanize, parseSeeds, usd } from "@/lib/format"
import { MODULE_INFO, SETTING_GROUPS } from "@/lib/harness-info"
import { cn } from "@/lib/utils"

const DEFAULT_MODULES = ["reconnect", "clamp_gripper", "grasp_retry", "grasp_depth", "backtrack"]

function Field({ label, hint, error, children, className }: {
  label: string; hint?: string; error?: string | null; children: ReactNode; className?: string
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label className="text-[12px] font-semibold text-foreground">{label}</Label>
      {children}
      {error ? <p className="text-[12px] text-destructive">{error}</p>
        : hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function FormSection({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-b pb-5 last:border-0">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[11px] text-accent-foreground">{number}</span>
        {title}
      </h3>
      {children}
    </section>
  )
}

export function CreateExperimentDialog({ open, onOpenChange, meta, takenNames, initialModel, onCreated }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  meta: Meta | null
  takenNames: Set<string>
  initialModel?: string | null
  onCreated: () => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [controller, setController] = useState<Controller>("dream1")
  const [model, setModel] = useState("dreamlabs/dream-1-beta")
  const [scene, setScene] = useState("stock")
  const [taskMode, setTaskMode] = useState<"single" | "steps">("single")
  const [steps, setSteps] = useState<Step[]>([{ instruction: "Put the orange into the bowl", target: "orange", goal: "inside_bowl" }])
  const [seedText, setSeedText] = useState("1000-1004")
  const [trialsText, setTrialsText] = useState("2")
  const [simSecondsText, setSimSecondsText] = useState("60")
  const [jitterText, setJitterText] = useState("2")
  const [rowsText, setRowsText] = useState("24")
  const [maxUsdText, setMaxUsdText] = useState("5")
  const [harnessOn, setHarnessOn] = useState(false)
  const [modules, setModules] = useState<string[]>(DEFAULT_MODULES)
  const [values, setValues] = useState<Record<string, number | string>>({})
  const [saveRequest, setSaveRequest] = useState(true)
  const [saveGifs, setSaveGifs] = useState(true)
  const [saveEpisodes, setSaveEpisodes] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const defaults = useMemo(() => {
    const out: Record<string, number | string> = {}
    for (const setting of meta?.harness.settings ?? []) out[setting.name] = setting.default
    return out
  }, [meta])

  useEffect(() => {
    if (!open) return
    setServerError(null)
    if (initialModel) {
      setController("dream1")
      setModel(initialModel)
    }
  }, [open, initialModel])

  useEffect(() => { setValues(defaults) }, [defaults])

  const sceneInfo = meta?.scenes[scene]
  const seedParse = parseSeeds(seedText)
  const trimmedName = name.trim()
  const nameError = !trimmedName ? null
    : takenNames.has(trimmedName.toLowerCase()) ? "This name is already used. Experiment names must be unique." : null
  const trialsPerSeed = numericValue(trialsText)
  const simSeconds = numericValue(simSecondsText)
  const jitter = numericValue(jitterText)
  const rowsPerReply = numericValue(rowsText)
  const maxUsd = numericValue(maxUsdText)
  const numericErrors = {
    trials: numericError(trialsText, "Trials per seed", 1, 20, true),
    time: numericError(simSecondsText, "Simulated time", 5, 420),
    jitter: numericError(jitterText, "Object jitter", 0, 5),
    rows: numericError(rowsText, "Rows per reply", 1, 48, true),
    cost: numericError(maxUsdText, "API cost cap", 0, 500),
  }
  const harnessErrors: Record<string, string | null> = {}
  for (const setting of meta?.harness.settings ?? []) {
    if (setting.type !== "str") {
      harnessErrors[setting.name] = numericError(values[setting.name] ?? "", setting.name, setting.min, setting.max, setting.type === "int")
    }
  }
  const totalTrials = seedParse.seeds.length * trialsPerSeed
  const callsPerTrial = rowsPerReply > 0 ? Math.floor((simSeconds * 20) / rowsPerReply) + 1 : 0
  const estimatedUsd = controller === "dream1"
    ? Math.min(callsPerTrial * totalTrials * (meta?.usd_per_call ?? 3 / 2250), maxUsd) : 0
  const selectedModel = meta?.models.find((m) => m.id === model)

  function changeScene(next: string) {
    setScene(next)
    const info = meta?.scenes[next]
    if (!info) return
    setSteps((current) => current.map((step) => ({
      ...step,
      target: info.objects.includes(step.target) ? step.target : info.objects[0],
      goal: info.goals.includes(step.goal) ? step.goal : info.goals[0],
    })))
  }

  function changeController(next: Controller) {
    setController(next)
    if (next === "expert") setHarnessOn(false)
  }

  function updateStep(index: number, patch: Partial<Step>) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)))
  }

  function addStep() {
    const info = sceneInfo
    setSteps((current) => [...current, {
      instruction: "", target: info?.objects[Math.min(current.length, (info?.objects.length ?? 1) - 1)] ?? "orange",
      goal: info?.goals[0] ?? "inside_bowl",
    }])
  }

  const activeSteps = taskMode === "single" ? steps.slice(0, 1) : steps
  const request: CreateExperimentRequest = {
    name: trimmedName, description: description.trim(), controller, scene, steps: activeSteps,
    seeds: seedParse.seeds, trials_per_seed: trialsPerSeed, sim_seconds: simSeconds, jitter_cm: jitter,
    ...(controller === "dream1" ? { model, rows_per_reply: rowsPerReply, max_usd: maxUsd } : {}),
    harness: { enabled: harnessOn, modules: harnessOn ? modules : [], values: harnessOn ? changedValues(values, defaults) : {} },
    save: { request_json: saveRequest, gifs: saveGifs, episodes: saveEpisodes },
  }

  const blockers = [
    !trimmedName && "Enter an experiment name.",
    nameError,
    seedParse.error,
    numericErrors.trials,
    numericErrors.time,
    numericErrors.jitter,
    controller === "dream1" && numericErrors.rows,
    controller === "dream1" && numericErrors.cost,
    harnessOn && Object.values(harnessErrors).find(Boolean),
    activeSteps.some((s) => !s.instruction.trim()) && "Write a statement for every step.",
    totalTrials > 400 && "Keep seeds × trials at 400 or fewer.",
    controller === "dream1" && selectedModel && !selectedModel.runnable && "This model has no published checkpoint yet.",
  ].filter(Boolean) as string[]

  async function submit() {
    if (blockers.length || submitting) return
    setSubmitting(true)
    setServerError(null)
    try {
      const created = await api.create(request)
      toast.success(`Experiment "${created.name}" queued`, { description: `${totalTrials} trials will run in order.` })
      onCreated()
      onOpenChange(false)
      setName("")
      setDescription("")
    } catch (err) {
      setServerError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[92vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="text-[18px]">Create experiment</DialogTitle>
          <DialogDescription className="text-[13px]">
            Define the task, how many seeds and trials to run, and the controller. The experiment starts as soon as the simulator is free.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto" data-form-body>
          <div className="grid gap-5 px-6 py-5">
            <FormSection number={1} title="Basics">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Experiment name" error={nameError} hint="Unique across all experiments.">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. orange-bowl-harness-v2" maxLength={80} />
                </Field>
                <Field label="Description (optional)">
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={1} maxLength={400}
                    className="min-h-9" placeholder="What this run is testing" />
                </Field>
              </div>
            </FormSection>

            <FormSection number={2} title="Controller">
              <div className="grid gap-3 md:grid-cols-2">
                {([
                  ["dream1", Bot, "Dream-1 policy", "The model drives the arms from camera frames. The harness can wrap it."],
                  ["expert", Cpu, "Scripted expert (forward kinematics)", "Reads simulator state and solves each move with IK. Produces ideal demonstrations; no API cost."],
                ] as const).map(([value, Icon, title, text]) => (
                  <button key={value} type="button" onClick={() => changeController(value)}
                    className={cn("flex gap-3 rounded-sm border p-3 text-left hover:border-ring",
                      controller === value && "border-ring bg-accent shadow-[inset_0_0_0_1px_var(--ring)]")}>
                    <Icon className="mt-0.5 size-5 text-accent-foreground" />
                    <span>
                      <span className="block text-[13px] font-semibold">{title}</span>
                      <span className="block text-[12px] text-muted-foreground">{text}</span>
                    </span>
                  </button>
                ))}
              </div>
              {controller === "dream1" && (
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Model" hint={selectedModel && selectedModel.source !== "base" ? selectedModel.id : undefined}>
                    <Select value={model} onValueChange={setModel}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {meta?.models.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Rows per reply" hint="Action rows executed from each model reply (1–48)." error={numericErrors.rows}>
                    <Input type="text" inputMode="numeric" aria-label="Rows per reply" aria-invalid={!!numericErrors.rows} value={rowsText} onChange={(e) => setRowsText(e.target.value)} />
                  </Field>
                  <Field label="API cost cap (USD)" hint="The run stops when the estimate reaches this." error={numericErrors.cost}>
                    <Input type="text" inputMode="decimal" aria-label="API cost cap (USD)" aria-invalid={!!numericErrors.cost} value={maxUsdText} onChange={(e) => setMaxUsdText(e.target.value)} />
                  </Field>
                </div>
              )}
            </FormSection>

            <FormSection number={3} title="Task">
              <div className="flex flex-wrap items-end gap-4">
                <Field label="Scene" className="w-56">
                  <Select value={scene} onValueChange={changeScene}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(meta?.scenes ?? {}).map(([key, info]) => (
                        <SelectItem key={key} value={key}>{info.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Task type">
                  <ToggleGroup type="single" variant="outline" value={taskMode}
                    onValueChange={(v) => v && setTaskMode(v as "single" | "steps")}>
                    <ToggleGroupItem value="single" className="px-3 text-[13px]">Single statement</ToggleGroupItem>
                    <ToggleGroupItem value="steps" className="px-3 text-[13px]">Multiple steps</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </div>
              <div className="grid gap-2">
                {activeSteps.map((step, index) => (
                  <div key={index} className="grid items-end gap-3 rounded-sm border bg-background p-3 md:grid-cols-[1fr_160px_160px_auto]">
                    <Field label={taskMode === "single" ? "Statement" : `Step ${index + 1} statement`}>
                      <Input value={step.instruction} onChange={(e) => updateStep(index, { instruction: e.target.value })}
                        placeholder="Put the orange into the bowl" maxLength={300} className="bg-card" />
                    </Field>
                    <Field label="Object (graded)">
                      <Select value={step.target} onValueChange={(v) => updateStep(index, { target: v })}>
                        <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {sceneInfo?.objects.map((o) => <SelectItem key={o} value={o}>{humanize(o)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Goal (graded)">
                      <Select value={step.goal} onValueChange={(v) => updateStep(index, { goal: v })}>
                        <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {sceneInfo?.goals.map((g) => <SelectItem key={g} value={g}>{humanize(g)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Button variant="ghost" size="icon" aria-label="Remove step" disabled={activeSteps.length === 1}
                      onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {taskMode === "steps" && (
                  <Button variant="outline" size="sm" className="w-fit gap-1" onClick={addStep} disabled={steps.length >= 6}>
                    <Plus className="size-4" /> Add step
                  </Button>
                )}
                {taskMode === "steps" && activeSteps.length > 1 && (
                  <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    The robot receives the steps as one instruction for the whole trial; each step is graded separately, in order.
                  </p>
                )}
              </div>
            </FormSection>

            <FormSection number={4} title="Seeds and trials">
              <div className="grid gap-4 md:grid-cols-4">
                <Field label="Seeds" error={seedParse.error} className="md:col-span-2"
                  hint="Each seed fixes the starting scene (object jitter). Ranges and lists: 1000-1009, 1020">
                  <Input value={seedText} onChange={(e) => setSeedText(e.target.value)} className="font-mono" />
                </Field>
                <Field label="Trials per seed" hint="Repeats of the same starting scene (1–20)." error={numericErrors.trials}>
                  <Input type="text" inputMode="numeric" aria-label="Trials per seed" aria-invalid={!!numericErrors.trials} value={trialsText} onChange={(e) => setTrialsText(e.target.value)} />
                </Field>
                <Field label="Simulated time per trial (s)" hint="Between 5 and 420 seconds." error={numericErrors.time}>
                  <Input type="text" inputMode="decimal" aria-label="Simulated time per trial (s)" aria-invalid={!!numericErrors.time} value={simSecondsText} onChange={(e) => setSimSecondsText(e.target.value)} />
                </Field>
                <Field label="Object jitter (cm)" hint="Random start offset per seed (0–5 cm)." error={numericErrors.jitter}>
                  <Input type="text" inputMode="decimal" aria-label="Object jitter (cm)" aria-invalid={!!numericErrors.jitter} value={jitterText} onChange={(e) => setJitterText(e.target.value)} />
                </Field>
              </div>
              <div className="rounded-sm border border-accent-border bg-accent px-3 py-2 text-[13px] text-accent-foreground">
                {seedParse.seeds.length} seed{seedParse.seeds.length === 1 ? "" : "s"} × {trialsPerSeed} trial{trialsPerSeed === 1 ? "" : "s"} per seed
                = <b>{totalTrials} trials</b>. Every trial of a seed starts from the same scene, so repeats show how consistent the controller is.
                {controller === "expert" && " The scripted expert is deterministic, so repeats of a seed give the same result."}
              </div>
            </FormSection>

            <FormSection number={5} title="Harness">
              <p className="text-[12px] text-muted-foreground">DreamLoop ships dream-harness as a standalone Python module. Pick the capabilities you want to add to Dream-1 for pick-and-place tasks; the same module selection and settings can be used outside the console.</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <label className={cn("flex w-fit items-center gap-2 text-[13px]", controller === "expert" && "cursor-not-allowed opacity-50")}>
                    <Checkbox checked={harnessOn} disabled={controller === "expert"} onCheckedChange={(v) => setHarnessOn(!!v)} />
                    <span className="font-semibold">Run Dream-1 inside the harness</span>
                  </label>
                </TooltipTrigger>
                {controller === "expert" && <TooltipContent>The harness wraps Dream-1. Choose the Dream-1 controller to enable it.</TooltipContent>}
              </Tooltip>
              {harnessOn && (
                <div className="grid gap-4 rounded-sm border p-4">
                  <div>
                    <p className="mb-2 text-[12px] font-semibold text-foreground">Modules</p>
                    <div className="grid gap-2 md:grid-cols-3">
                      {(meta?.harness.modules ?? []).map((module) => (
                        <label key={module} className="flex gap-2 rounded-sm border p-2 hover:bg-background">
                          <Checkbox className="mt-0.5" checked={modules.includes(module)}
                            onCheckedChange={(v) => setModules((current) => v ? [...current, module] : current.filter((m) => m !== module))} />
                          <span>
                            <span className="block text-[13px] font-medium">
                              {MODULE_INFO[module]?.label ?? module}
                              {meta?.harness.steering.includes(module) && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· steers</span>}
                            </span>
                            <span className="block text-[12px] text-muted-foreground">{MODULE_INFO[module]?.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-semibold text-foreground">Settings</p>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-[12px]" onClick={() => setValues(defaults)}>
                      <RotateCcw className="size-3.5" /> Reset to library defaults
                    </Button>
                  </div>
                  {SETTING_GROUPS.map((group) => (
                    <div key={group.title}>
                      <p className="mb-2 text-[12px] text-muted-foreground">{group.title}</p>
                      <div className="grid gap-3 md:grid-cols-3">
                        {Object.entries(group.settings).map(([key, info]) => {
                          const spec = meta?.harness.settings.find((s) => s.name === key)
                          const changed = (spec?.type === "str" ? values[key] : numericValue(values[key] ?? "")) !== defaults[key]
                          return (
                            <Field key={key} label={`${info.label}${info.unit ? ` (${info.unit})` : ""}`} hint={info.help} error={harnessErrors[key]}
                              className={key === "RETRY_PROMPT" ? "md:col-span-3" : undefined}>
                              <Input
                                type="text"
                                inputMode={spec?.type === "str" ? "text" : spec?.type === "int" ? "numeric" : "decimal"}
                                aria-label={info.label}
                                aria-invalid={!!harnessErrors[key]}
                                value={values[key] ?? ""}
                                className={cn(changed && "border-ring bg-accent")}
                                onChange={(e) => setValues((current) => ({
                                  ...current, [key]: e.target.value,
                                }))}
                              />
                            </Field>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </FormSection>

            <FormSection number={6} title="Output">
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={saveRequest} onCheckedChange={(v) => setSaveRequest(!!v)} />
                  Save request JSON
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={saveGifs} onCheckedChange={(v) => setSaveGifs(!!v)} />
                  Save GIFs of every trial (three camera views)
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={saveEpisodes} onCheckedChange={(v) => setSaveEpisodes(!!v)} />
                  Record training episodes (needed to fine-tune on this experiment's successful trials)
                </label>
              </div>
              <JsonViewer title="Preview request JSON" data={request} />
            </FormSection>
          </div>
        </div>
        <DialogFooter className="flex-col items-stretch gap-2 border-t bg-background px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[12px] text-muted-foreground">
            {serverError ? <span className="text-destructive">{serverError}</span>
              : blockers.length ? <span className="text-warning">{blockers[0]}</span>
              : <>{totalTrials} trials · {controller === "dream1" ? `up to ${(callsPerTrial * totalTrials).toLocaleString()} model calls · est. ≤ ${usd(estimatedUsd)}` : "no API cost"}</>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || blockers.length > 0}>
              {submitting && <Loader2 className="size-4 animate-spin" />} Start experiment
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function changedValues(values: Record<string, number | string>, defaults: Record<string, number | string>) {
  const out: Record<string, number | string> = {}
  for (const [key, value] of Object.entries(values)) {
    const parsed = typeof defaults[key] === "number" ? numericValue(value) : value
    if (parsed !== defaults[key]) out[key] = parsed
  }
  return out
}

function numericValue(value: string | number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function numericError(value: string | number, label: string, min: number | null, max: number | null, integer = false) {
  if (!String(value).trim()) return `${label} is required.`
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return `Enter a valid number for ${label.toLowerCase()}.`
  if (integer && !Number.isInteger(parsed)) return `${label} must be a whole number.`
  if (min !== null && parsed < min) return `${label} must be at least ${min}.`
  if (max !== null && parsed > max) return `${label} must be ${max} or less.`
  return null
}
