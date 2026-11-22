// Types and calls for the console's /api/lab endpoints (mission_control/lab.py).

export type Kind = "vanilla" | "harness" | "scripted"
export type Controller = "dream1" | "expert"

export interface Step {
  instruction: string
  target: string
  goal: string
}

export interface HarnessSettingInfo {
  name: string
  default: number | string
  type: "int" | "float" | "str"
  min: number | null
  max: number | null
}

export interface ModelInfo {
  id: string
  label: string
  source: "base" | "ladder" | "console" | "account"
  runnable: boolean
  finetune_id?: string
}

export interface Meta {
  scenes: Record<string, { label: string; objects: string[]; goals: string[] }>
  controllers: Record<Controller, string>
  models: ModelInfo[]
  harness: { modules: string[]; steering: string[]; settings: HarnessSettingInfo[] }
  defaults: { sim_seconds: number; rows_per_reply: number; jitter_cm: number; max_usd: number; trials_per_seed: number }
  usd_per_call: number
}

export interface ExperimentSummary {
  id: string
  name: string
  description: string
  source: "console" | "ladder" | "sample"
  readonly: boolean | null
  controller: Controller
  model: string
  scene: string
  kind: Kind
  instruction: string
  trials_per_seed: number
  created_at: string | null
  rows_per_reply: number | null
  sim_seconds: number | null
  steps: number
  seeds: number
  harness: boolean
  harness_modules: string[]
  status: string
  message: string | null
  total: number
  done: number
  errors: number
  current: {
    seed: number; trial: number; started_at?: string
    // Live report from the running trial process.
    phase?: string; sim_s?: number; sim_total?: number; replies?: number; attempts?: number
    fraction?: number; idle_s?: number | null
  } | null
  successes: number
  graded: number
  success_rate: number | null
  cost_usd: number
}

export interface Intervention {
  row: number
  reason: string
  arm?: string | null
  info?: unknown
  obj?: string
}

export interface Trial {
  seed: number
  trial: number
  outcome: string
  success: boolean
  rows?: number
  first_contact_row?: number | null
  lifted_row?: number | null
  goal_row?: number | null
  max_lift_cm?: number
  progress?: number
  progress_of?: number
  step_outcomes?: string[]
  calls?: number
  median_rtt_s?: number | null
  wall_s?: number
  est_cost_usd?: number
  error?: string | null
  interventions?: Intervention[]
  steering?: string[]
  media?: string | null
  media_type?: "gif" | "video" | null
  request?: Record<string, unknown>
  episode?: { frames: number } | null
  [key: string]: unknown
}

export interface Analytics {
  trials: number
  graded: number
  successes: number
  errors: number
  success_rate: number | null
  success_ci: [number, number] | null
  outcomes: Record<string, number>
  failure_categories: Record<string, number>
  interventions: Record<string, number>
  per_seed: { seed: number; trials: number; successes: number; errors: number }[]
  mean_time_to_success_s: number | null
  mean_sim_s: number | null
  mean_calls: number | null
  mean_wall_s: number | null
  median_rtt_s: number | null
  cost_usd: number
  max_lift_cm: number[]
}

export interface ExperimentConfig {
  id: string
  name: string
  description: string
  controller: Controller
  model: string
  scene: string
  steps: Step[]
  instruction: string
  seeds: number[]
  trials_per_seed: number
  sim_seconds: number | null
  jitter_cm: number | null
  rows_per_reply: number | null
  max_usd: number | null
  harness: { enabled: boolean; modules?: string[]; values?: Record<string, number | string> }
  save: { request_json: boolean; gifs: boolean; episodes?: boolean }
  kind: Kind
  source: string
  created_at: string | null
  estimate?: { trials: number; max_calls: number; max_usd: number }
}

export interface ExperimentDetail {
  summary: ExperimentSummary
  experiment: ExperimentConfig
  status: Record<string, unknown>
  request: Record<string, unknown> | null
  trials: Trial[]
  analytics: Analytics
}

export interface FineTuneJob {
  id: string
  name: string
  base_model?: string
  steps: number
  step: number
  sources: { id: string; name: string; kind: Kind; trials: number; successes: number; episodes?: number }[]
  created_at: string
  progress: number
  stage: string
  status: "running" | "completed" | "failed"
  eta_s: number | null
  external?: boolean
  dataset_name?: string | null
  estimated_usd: number
  episodes?: number
  state?: string
  error?: string | null
  last_error?: string | null
  queue_position?: number | null
  loss?: number | null
  charge?: string | null
  price_usd?: number | null
  job_id?: string
  model_id?: string | null
  model_name?: string
}

export interface AccountInfo {
  balance_api: boolean
  note: string
  charged_usd: number
  held_usd: number
  budget_usd: number | null
  remaining_usd: number | null
  usd_per_step: number
  jobs: number
  active: number
  models: { id: string; suffix: string; finished_at: string | null }[]
  queue: { jobs_ahead_of_new: number; running: number; slots_free: number; slots_total: number } | null
  updated_at: string | null
  error: string | null
}

export interface CreateExperimentRequest {
  name: string
  description: string
  controller: Controller
  model?: string
  scene: string
  steps: Step[]
  seeds: number[]
  trials_per_seed: number
  sim_seconds: number
  jitter_cm: number
  rows_per_reply?: number
  max_usd?: number
  harness: { enabled: boolean; modules: string[]; values: Record<string, number | string> }
  save: { request_json: boolean; gifs: boolean; episodes: boolean }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return data as T
}

export const api = {
  meta: () => call<Meta>("/api/lab/meta"),
  experiments: () => call<{ experiments: ExperimentSummary[]; finetunes: FineTuneJob[] }>("/api/lab/experiments"),
  experiment: (id: string) => call<ExperimentDetail>(`/api/lab/experiments/${encodeURIComponent(id)}`),
  create: (request: CreateExperimentRequest) => call<ExperimentSummary>("/api/lab/experiments", request),
  remove: (id: string) => call<{ deleted: string }>(`/api/lab/experiments/${encodeURIComponent(id)}/delete`, {}),
  cancel: (id: string) => call<ExperimentSummary>(`/api/lab/experiments/${encodeURIComponent(id)}/cancel`, {}),
  finetunes: () => call<{ finetunes: FineTuneJob[] }>("/api/lab/finetunes"),
  account: () => call<AccountInfo>("/api/lab/account"),
  startFinetune: (body: {
    name: string; experiment_ids: string[]; steps: number; confirm_charge: boolean
    trials?: { experiment_id: string; seed: number; trial: number }[]
  }) =>
    call<FineTuneJob>("/api/lab/finetunes", body),
  saveModel: (id: string, name: string) => call<FineTuneJob>(`/api/lab/finetunes/${id}/save`, { name }),
  exportUrl: (ids: string[]) => `/api/lab/export?ids=${ids.map(encodeURIComponent).join(",")}`,
}
