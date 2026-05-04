export interface TaskInsightLike {
  type: string;
  status: string;
  error?: string | null;
  result?: Record<string, unknown> | null;
}

export function taskFamily(taskType: string): string {
  if (taskType === "repair" || taskType === "fix_artist" || taskType === "health_check") return "repair";
  if (taskType.includes("tidal") || taskType.includes("download") || taskType.includes("acquisition")) return "acquisition";
  if (taskType.includes("stream") || taskType.includes("playback") || taskType.includes("variant")) return "playback";
  if (taskType.includes("analy") || taskType.includes("bliss") || taskType.includes("popularity")) return "analysis";
  if (taskType.includes("sync") || taskType.includes("pipeline") || taskType.includes("import")) return "sync";
  if (taskType.includes("enrich") || taskType.includes("mbid") || taskType.includes("release")) return "enrichment";
  return "other";
}

export function isRepairTaskType(taskType: string): boolean {
  return taskFamily(taskType) === "repair";
}

export function taskRevalidationIssueCount(result: Record<string, unknown> | null | undefined): number | null {
  const revalidation = result?.revalidation;
  if (!revalidation || typeof revalidation !== "object") return null;
  const remaining = Number((revalidation as Record<string, unknown>).issue_count ?? NaN);
  return Number.isFinite(remaining) ? remaining : null;
}

export function taskNeedsAttention(task: TaskInsightLike): boolean {
  if (task.status === "failed" || task.status === "cancelled") return true;
  if (task.error) return true;

  const result = task.result ?? {};
  const remaining = taskRevalidationIssueCount(result);
  if (remaining != null && remaining > 0 && isRepairTaskType(task.type)) return true;

  if (task.type === "repair") {
    const summary = (result.summary as Record<string, unknown> | undefined) ?? {};
    return Number(summary.failed ?? 0) > 0 || Number(summary.unsupported ?? 0) > 0;
  }

  if (task.type === "fix_artist") {
    return Number(result.albums_failed ?? 0) > 0 || Boolean(result.reason);
  }

  if (task.type === "health_check") {
    return Number(result.issue_count ?? 0) > 0;
  }

  if (typeof result.error === "string" && result.error.trim()) return true;
  return false;
}

export function repairOutcomeTone(task: TaskInsightLike): "success" | "warning" | "danger" | "neutral" {
  if (task.status === "failed") return "danger";
  if (taskNeedsAttention(task)) return "warning";
  if (task.status === "completed") return "success";
  if (task.status === "cancelled") return "neutral";
  return "neutral";
}

export function pickLatestRepairTask<
  T extends TaskInsightLike & { updated_at?: string | null; created_at?: string | null },
>(tasks: T[]): T | null {
  const candidates = tasks.filter((task) => isRepairTaskType(task.type));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  })[0] ?? null;
}
