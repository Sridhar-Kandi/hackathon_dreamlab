import type { Kind } from "./api"

export function percent(value: number | null | undefined, digits = 0) {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(digits)}%`
}

export function number(value: number | null | undefined, digits = 1, unit = "") {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : `${value.toFixed(digits)}${unit}`
}

export function usd(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `$${value.toFixed(2)}`
}

export function dateTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  })
}

export function duration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${Math.round(seconds % 60)} s`
}

export function modelLabel(model: string | null | undefined) {
  if (!model) return "—"
  if (model === "oracle") return "Scripted expert"
  if (model === "dreamlabs/dream-1-beta") return "Dream-1"
  return model.split("/").pop() ?? model
}

export const KIND_LABEL: Record<Kind, string> = {
  vanilla: "Vanilla",
  harness: "Harness",
  scripted: "Scripted",
}

export function humanize(code: string | null | undefined) {
  if (!code) return "—"
  return code.replace(/^on:/, "on ").replace(/^in:/, "in ").replace(/_/g, " ")
}

// Parse "1000-1009, 1020, 1030-1031" into a list of distinct seeds.
export function parseSeeds(text: string): { seeds: number[]; error: string | null } {
  const seeds: number[] = []
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1]), end = Number(range[2])
      if (end < start) return { seeds: [], error: `Range ${part} runs backwards.` }
      if (end - start > 199) return { seeds: [], error: `Range ${part} has more than 200 seeds.` }
      for (let seed = start; seed <= end; seed++) seeds.push(seed)
    } else if (/^\d+$/.test(part)) {
      seeds.push(Number(part))
    } else {
      return { seeds: [], error: `"${part}" is not a seed or a range like 1000-1009.` }
    }
  }
  const distinct = [...new Set(seeds)]
  if (distinct.length !== seeds.length) return { seeds: [], error: "Each seed can appear only once." }
  if (!distinct.length) return { seeds: [], error: "Enter at least one seed." }
  if (distinct.length > 200) return { seeds: [], error: "Use at most 200 seeds." }
  return { seeds: distinct, error: null }
}

export function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/** Overall experiment progress: finished trials plus the simulated share of the running one. */
export function runProgress(done: number, total: number, current?: { fraction?: number } | null) {
  return ((done + (current?.fraction ?? 0)) / Math.max(1, total)) * 100
}

/** One line describing what the running trial is doing right now. */
export function liveLine(current?: { phase?: string; sim_s?: number; sim_total?: number; replies?: number; idle_s?: number | null } | null) {
  if (!current?.phase) return null
  let line = current.phase
  if (current.sim_total) line += ` · ${(current.sim_s ?? 0).toFixed(1)} / ${current.sim_total} s simulated`
  if (current.replies) line += ` · ${current.replies} model replies`
  if (current.idle_s && current.idle_s > 60) line += ` · no update for ${Math.round(current.idle_s)} s`
  return line
}
