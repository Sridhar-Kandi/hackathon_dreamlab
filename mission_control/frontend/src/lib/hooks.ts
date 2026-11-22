import { useCallback, useEffect, useState } from "react"
import { api, type ExperimentSummary, type FineTuneJob, type Meta } from "./api"

const ACTIVE = new Set(["queued", "running", "stopping"])

// The experiments list and fine-tune jobs, refreshed every few seconds while anything is still running.
export function useExperiments() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([])
  const [finetunes, setFinetunes] = useState<FineTuneJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api.experiments()
      setExperiments(data.experiments)
      setFinetunes(data.finetunes)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const busy = experiments.some((e) => ACTIVE.has(e.status)) || finetunes.some((f) => f.status === "running")
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(refresh, 2500)
    return () => clearInterval(timer)
  }, [busy, refresh])

  return { experiments, finetunes, loading, error, refresh }
}

export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => {
    api.meta().then(setMeta).catch((err) => setError((err as Error).message))
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { meta, error, refresh }
}

export function isActive(status: string) {
  return ACTIVE.has(status)
}
