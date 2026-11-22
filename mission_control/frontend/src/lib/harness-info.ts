// Labels and grouping for the dream_harness settings (harness/src/dream_harness/settings.py).

export const MODULE_INFO: Record<string, { label: string; description: string }> = {
  reconnect: { label: "Reconnect", description: "Retry expired sessions, a full model pool and dropped connections." },
  clamp_gripper: { label: "Clamp gripper", description: "Clip small gripper overshoots instead of failing the reply." },
  wrong_object: { label: "Wrong-object watch", description: "Home and re-prompt after the arm grabs a non-target object." },
  grasp_retry: { label: "Grasp retry", description: "Home and re-prompt after a stalled grasp or a dropped object." },
  grasp_depth: { label: "Grasp depth", description: "Regrasp lower when the gripper closes above the object." },
  edge_pinch: { label: "Edge pinch", description: "Regrasp when the fingers pinch an edge instead of the faces." },
  backtrack: { label: "Backtrack", description: "Replay the replay buffer in reverse after a stalled grasp." },
  place: { label: "Place assist", description: "Centre the carried object over its goal before release." },
  adaptive_chunking: { label: "Adaptive chunking", description: "Run only the forecast rows of each reply near the object." },
}

export const SETTING_GROUPS: { title: string; settings: Record<string, { label: string; unit?: string; help: string }> }[] = [
  {
    title: "Replay & forecast buffers",
    settings: {
      REPLAY_BUFFER_S: { label: "Replay buffer", unit: "s", help: "Commanded motion kept for the backtrack replay." },
      REPLAY_BUFFER_MAX_ROWS: { label: "Replay buffer cap", unit: "rows", help: "Hard upper bound on the replay buffer size." },
      NEAR_ROWS: { label: "Forecast rows near object", unit: "rows", help: "Rows of each reply executed while near the object (adaptive chunking)." },
      NEAR_RADIUS_M: { label: "Near radius", unit: "m", help: "Gripper-to-object distance that counts as near." },
      CONTROL_HZ: { label: "Control rate", unit: "Hz", help: "Simulator control rows per second." },
    },
  },
  {
    title: "Grasp & placement",
    settings: {
      STALL_S: { label: "Stall time", unit: "s", help: "Touching without lifting this long is a stalled grasp." },
      DROP_S: { label: "Drop time", unit: "s", help: "A lifted object resting untouched this long counts as dropped." },
      HIGH_M: { label: "Grasp height tolerance", unit: "m", help: "Closing this far above the top face triggers a regrasp." },
      MAX_REGRASPS: { label: "Max regrasps per object", help: "Regrasp interventions allowed per object." },
      HOVER_S: { label: "Hover time", unit: "s", help: "Carrying still over the goal this long triggers a placement." },
      GRIPPER_SLACK: { label: "Gripper slack", help: "How far outside 0..1 a gripper value may be clipped." },
    },
  },
  {
    title: "Supervisor",
    settings: {
      MAX_SUPERVISOR_RETRIES: { label: "Max retries per trial", help: "Home-and-retry interventions allowed per trial." },
      HOME_SECONDS: { label: "Home duration", unit: "s", help: "Time to drive the arms home before a retry." },
      WRONG_OBJECT_LIFT_M: { label: "Wrong-object lift", unit: "m", help: "A non-target object lifted this much counts as grabbed." },
      WRONG_OBJECT_SLIDE_M: { label: "Wrong-object slide", unit: "m", help: "A non-target object slid this far while touched counts as grabbed." },
      RETRY_PROMPT: { label: "Retry instruction", help: "Instruction used after a retry. Leave empty to keep the original." },
    },
  },
  {
    title: "Connection",
    settings: {
      SESSION_RESTARTS: { label: "Session restarts", help: "Expired sessions reopened in a row." },
      CAPACITY_WAITS: { label: "Capacity waits", help: "Waits for a full model pool before giving up." },
      NETWORK_RETRIES: { label: "Network retries", help: "Dropped connections retried per trial." },
    },
  },
]

export const INTERVENTION_LABEL: Record<string, string> = {
  depth_too_high: "Grasp too high → regrasp",
  edge_pinch: "Edge pinch → regrasp",
  grasp_stalled: "Stalled grasp → backtrack",
  place_align: "Placement aligned",
  place_hover: "Hover → placed",
  wrong_object: "Wrong object → home",
  dropped: "Dropped → home",
  next_move: "Next move",
}
