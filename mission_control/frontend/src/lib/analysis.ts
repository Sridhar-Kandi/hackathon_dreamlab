import type { Analytics, ExperimentConfig, Intervention, Trial } from "./api"
import { humanize, modelLabel } from "./format"
import { MODULE_INFO } from "./harness-info"

// A save file as loaded on the Analyze page: from the server, or from a JSON file on disk.
export interface SaveFile {
  id: string
  name: string
  origin: "server" | "upload"
  source: string
  experiment: ExperimentConfig
  status: Record<string, unknown>
  request: Record<string, unknown> | null
  trials: Trial[]
  analytics?: Analytics
}

export const SLOT_LETTERS = ["A", "B", "C"]

// Harness interventions carry a row and a reason. Grip bookkeeping and the scripted expert's phase records do not count.
export function isIntervention(i: Intervention) {
  return typeof i.row === "number" && !!i.reason && i.reason !== "latch_release" && i.reason !== "after_place"
}

// Outcome code -> failure category and the phase in which the run stopped (mirrors lab.FAILURES).
export const FAILURES: Record<string, { category: string; phase: Phase | null; why: string }> = {
  never_touched: { category: "Approach", phase: "approach", why: "The arm never reached the object." },
  touched_no_lift: { category: "Grasp", phase: "grasp", why: "Contact without a lift: the grasp did not close on the object." },
  lifted_missed_goal: { category: "Placement", phase: "carry", why: "Lifted, but released away from the goal or dropped in transit." },
  wrong_object: { category: "Task logic", phase: "approach", why: "Grabbed an object that is not the target." },
  wrong_order: { category: "Task logic", phase: "carry", why: "Completed steps in the wrong order." },
  partial: { category: "Task logic", phase: "carry", why: "Finished the first step(s), not the whole task." },
  error: { category: "Infrastructure", phase: null, why: "Network, timeout or simulator error, not a policy failure." },
}
export const CATEGORIES = ["Approach", "Grasp", "Placement", "Task logic", "Infrastructure"]

export type Phase = "approach" | "grasp" | "carry" | "settle"
export const PHASES: { key: Phase; label: string; color: string }[] = [
  { key: "approach", label: "Approach", color: "var(--brand-peach-tint)" },
  { key: "grasp", label: "Grasp", color: "var(--brand-peach)" },
  { key: "carry", label: "Carry & place", color: "var(--brand-lavender)" },
  { key: "settle", label: "Settle", color: "var(--brand-grass-light)" },
]

export function failureOf(trial: Trial) {
  if (trial.success) return null
  return FAILURES[trial.outcome] ?? { category: "Other", phase: null, why: humanize(trial.outcome) }
}

// Phase spans in seconds, from the milestone rows the grader records (20 control rows per second).
export function phases(trial: Trial) {
  const end = (trial.rows ?? 0) / 20
  const contact = trial.first_contact_row != null ? trial.first_contact_row / 20 : null
  const lift = trial.lifted_row != null ? trial.lifted_row / 20 : null
  const goal = trial.goal_row != null ? trial.goal_row / 20 : null
  const spans: { phase: Phase; start: number; end: number }[] = []
  spans.push({ phase: "approach", start: 0, end: contact ?? end })
  if (contact != null) spans.push({ phase: "grasp", start: contact, end: lift ?? end })
  if (lift != null) spans.push({ phase: "carry", start: lift, end: goal ?? end })
  if (goal != null) spans.push({ phase: "settle", start: goal, end })
  return { spans, end, contact, lift, goal }
}

// Where a run diverged from the reference run on the same seed.
export function divergence(trial: Trial, reference: Trial | undefined) {
  const run = phases(trial)
  if (!reference) return { text: "No reference run on this seed.", at: null as number | null }
  const ref = phases(reference)
  const milestones: [string, number | null, number | null][] = [
    ["contact", run.contact, ref.contact], ["lift", run.lift, ref.lift], ["goal", run.goal, ref.goal],
  ]
  for (const [name, mine, theirs] of milestones) {
    if (theirs != null && mine == null) {
      return { text: `Reference reached ${name} at ${theirs.toFixed(1)} s; this run never did.`, at: theirs }
    }
  }
  if (trial.success) return { text: "Matched the reference outcome.", at: null }
  const last = milestones.filter(([, mine]) => mine != null).pop()
  if (last) {
    const [name, mine, theirs] = last
    const delta = theirs != null && mine != null ? mine - theirs : null
    return { text: `Reached ${name} ${delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} s vs reference` : ""}, then failed.`, at: mine }
  }
  return { text: "Diverged before the first milestone.", at: 0 }
}

// A step-by-step log for one trial, built from its milestones and interventions.
export function eventLog(trial: Trial) {
  const p = phases(trial)
  const events: { t: number; text: string; kind: "milestone" | "intervention" | "end" }[] = [{ t: 0, text: "Trial started", kind: "milestone" }]
  if (p.contact != null) events.push({ t: p.contact, text: "First contact with the target", kind: "milestone" })
  if (p.lift != null) events.push({ t: p.lift, text: "Target lifted", kind: "milestone" })
  if (p.goal != null) events.push({ t: p.goal, text: "Goal reached", kind: "milestone" })
  for (const i of (trial.interventions ?? []).filter(isIntervention)) {
    events.push({ t: i.row / 20, text: `Harness: ${humanize(i.reason)}${i.arm ? ` (${i.arm} arm)` : ""}`, kind: "intervention" })
  }
  events.push({ t: p.end, text: trial.success ? "Verified success" : `Ended: ${humanize(trial.outcome)}${trial.error ? ` — ${trial.error}` : ""}`, kind: "end" })
  return events.sort((a, b) => a.t - b.t)
}

export function summarize(file: SaveFile) {
  const trials = file.trials
  const graded = trials.filter((t) => t.outcome !== "error")
  const wins = graded.filter((t) => t.success)
  const mean = (values: (number | null | undefined)[]) => {
    const v = values.filter((x): x is number => typeof x === "number" && !Number.isNaN(x))
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const categories: Record<string, number> = {}
  for (const t of trials) {
    const f = failureOf(t)
    if (f) categories[f.category] = (categories[f.category] ?? 0) + 1
  }
  const interventions = trials.reduce((n, t) => n + (t.interventions ?? []).filter(isIntervention).length, 0)
  return {
    trials: trials.length,
    graded: graded.length,
    successes: wins.length,
    errors: trials.length - graded.length,
    successRate: graded.length ? wins.length / graded.length : null,
    ci: wilson(wins.length, graded.length),
    timeToSuccess: mean(wins.map((t) => (t.goal_row ?? NaN) / 20)),
    simTime: mean(graded.map((t) => (t.rows ?? NaN) / 20)),
    calls: mean(graded.map((t) => t.calls)),
    wall: mean(trials.map((t) => t.wall_s)),
    cost: trials.reduce((n, t) => n + (t.est_cost_usd ?? 0), 0),
    interventionsPerTrial: trials.length ? interventions / trials.length : null,
    efficiency: trials.length ? wins.length / trials.length : null,
    categories,
    lifts: graded.map((t) => t.max_lift_cm).filter((x): x is number => typeof x === "number"),
  }
}

function wilson(successes: number, n: number, z = 1.96): [number, number] | null {
  if (!n) return null
  const p = successes / n
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

// Rows of the configuration comparison matrix.
export function configRows(files: SaveFile[]) {
  const value = (f: SaveFile, fn: (e: ExperimentConfig) => unknown) => {
    const v = fn(f.experiment)
    return v === undefined || v === null || v === "" ? "—" : String(v)
  }
  const rows: { group: string; label: string; values: string[] }[] = []
  const add = (group: string, label: string, fn: (e: ExperimentConfig) => unknown) =>
    rows.push({ group, label, values: files.map((f) => value(f, fn)) })

  add("Run", "Type", (e) => e.kind)
  add("Run", "Controller", (e) => (e.controller === "expert" ? "Scripted expert" : "Dream-1"))
  add("Run", "Model", (e) => modelLabel(e.model))
  add("Run", "Source", (e) => e.source)
  add("Task", "Scene", (e) => e.scene)
  add("Task", "Instruction", (e) => e.instruction)
  add("Task", "Steps", (e) => e.steps.map((s) => `${humanize(s.target)} → ${humanize(s.goal)}`).join("; "))
  add("Trials", "Seeds", (e) => (e.seeds.length > 1 ? `${e.seeds.length} (${Math.min(...e.seeds)}–${Math.max(...e.seeds)})` : e.seeds[0]))
  add("Trials", "Trials per seed", (e) => e.trials_per_seed)
  add("Trials", "Total trials", (e) => e.seeds.length * e.trials_per_seed)
  add("Hyperparameters", "Simulated seconds", (e) => e.sim_seconds)
  add("Hyperparameters", "Rows per reply", (e) => (e.controller === "expert" ? null : e.rows_per_reply))
  add("Hyperparameters", "Object jitter (cm)", (e) => e.jitter_cm)
  add("Hyperparameters", "API cost cap (USD)", (e) => e.max_usd)
  add("Harness", "Harness enabled", (e) => (e.harness?.enabled ? "Yes" : "No"))
  const modules = Object.keys(MODULE_INFO)
  for (const m of modules) {
    add("Harness", `Module · ${MODULE_INFO[m].label}`, (e) => (e.harness?.enabled ? ((e.harness.modules ?? []).includes(m) ? "On" : "Off") : null))
  }
  const keys = new Set<string>()
  files.forEach((f) => Object.keys(f.experiment.harness?.values ?? {}).forEach((k) => keys.add(k)))
  for (const key of [...keys].sort()) {
    add("Harness settings", key, (e) => (e.harness?.enabled ? e.harness.values?.[key] : null))
  }
  add("Output", "Saved request JSON", (e) => (e.save?.request_json ? "Yes" : "No"))
  add("Output", "Saved GIFs", (e) => (e.save?.gifs ? "Yes" : "No"))
  return rows.map((row) => ({ ...row, differs: new Set(row.values).size > 1 }))
}

// Parse a file saved with "Save to file": one save file or a list of them.
export function parseSaveFiles(text: string, fileName: string): SaveFile[] {
  const data = JSON.parse(text)
  const items = Array.isArray(data) ? data : [data]
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || !item.experiment || !Array.isArray(item.trials)) {
      throw new Error(`${fileName}: entry ${index + 1} is not an experiment save file.`)
    }
    const experiment = item.experiment as ExperimentConfig
    return {
      id: `upload:${fileName}:${experiment.id ?? index}`,
      name: experiment.name ?? fileName,
      origin: "upload" as const,
      source: "file",
      experiment,
      status: item.status ?? {},
      request: item.request ?? null,
      trials: item.trials as Trial[],
    }
  })
}
