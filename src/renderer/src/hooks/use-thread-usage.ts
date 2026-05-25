import { useEffect, useState } from 'react'

export type ThreadUsageSummary = {
  totalTokens: number
  costUsd: number
  turns: number
}

export type ThreadUsageState = {
  usage: ThreadUsageSummary | null
  loading: boolean
  loaded: boolean
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return new Intl.NumberFormat().format(value)
}

export function formatCost(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

export async function loadThreadUsage(threadId: string): Promise<ThreadUsageSummary | null> {
  if (typeof window.dsGui?.runtimeRequest !== 'function') return null
  const r = await window.dsGui.runtimeRequest('/v1/usage?group_by=thread', 'GET')
  if (!r.ok || !r.body.trim()) return null
  const parsed = JSON.parse(r.body) as {
    buckets?: Array<Record<string, unknown>>
  }
  const bucket = parsed.buckets?.find((item) => {
    const candidates = [item.thread_id, item.key, item.id, item.label]
    return candidates.some((candidate) => candidate === threadId)
  })
  if (!bucket) return null
  const totalTokens =
    usageNumber(bucket.input_tokens) +
    usageNumber(bucket.output_tokens) +
    usageNumber(bucket.cached_tokens) +
    usageNumber(bucket.reasoning_tokens)
  const costUsd = usageNumber(bucket.cost_usd)
  const turns = usageNumber(bucket.turns)
  if (totalTokens <= 0 && costUsd <= 0 && turns <= 0) return null
  return { totalTokens, costUsd, turns }
}

export function useThreadUsageState(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageState {
  const [state, setState] = useState<ThreadUsageState>({
    usage: null,
    loading: false,
    loaded: false
  })

  useEffect(() => {
    let cancelled = false
    if (!threadId || !enabled) {
      setState({ usage: null, loading: false, loaded: false })
      return
    }
    setState((current) => ({ ...current, loading: true }))
    void loadThreadUsage(threadId)
      .then((usage) => {
        if (!cancelled) setState({ usage, loading: false, loaded: true })
      })
      .catch(() => {
        if (!cancelled) setState({ usage: null, loading: false, loaded: true })
      })
    return () => {
      cancelled = true
    }
  }, [enabled, refreshKey, threadId])

  return state
}

export function useThreadUsage(
  threadId: string | null | undefined,
  enabled: boolean,
  refreshKey: unknown
): ThreadUsageSummary | null {
  return useThreadUsageState(threadId, enabled, refreshKey).usage
}
