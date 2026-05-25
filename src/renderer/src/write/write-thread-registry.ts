import type { NormalizedThread } from '../agent/types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

export type WriteThreadWorkspaceRecord = {
  activeThreadId: string
  threadIds: string[]
}

export type WriteThreadRegistry = {
  version: 1
  workspaces: Record<string, WriteThreadWorkspaceRecord>
}

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const WRITE_THREAD_REGISTRY_KEY = 'deepseekgui.write.threadRegistry.v1'

export function emptyWriteThreadRegistry(): WriteThreadRegistry {
  return { version: 1, workspaces: {} }
}

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function writeWorkspaceKey(workspaceRoot: string | undefined | null): string {
  return normalizeWorkspaceRoot(workspaceRoot ?? '')
}

function normalizeThreadIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const ordered = new Set<string>()
  for (const id of ids) {
    if (typeof id === 'string' && id.trim()) ordered.add(id.trim())
  }
  return [...ordered]
}

export function normalizeWriteThreadRegistry(raw: unknown): WriteThreadRegistry {
  if (!raw || typeof raw !== 'object') return emptyWriteThreadRegistry()
  const source = raw as { workspaces?: unknown }
  if (!source.workspaces || typeof source.workspaces !== 'object') return emptyWriteThreadRegistry()

  const workspaces: WriteThreadRegistry['workspaces'] = {}
  for (const [workspaceRoot, value] of Object.entries(source.workspaces as Record<string, unknown>)) {
    const key = writeWorkspaceKey(workspaceRoot)
    if (!key || !value || typeof value !== 'object') continue
    const record = value as { activeThreadId?: unknown; threadIds?: unknown }
    const threadIds = normalizeThreadIds(record.threadIds)
    const activeThreadId =
      typeof record.activeThreadId === 'string' && record.activeThreadId.trim()
        ? record.activeThreadId.trim()
        : threadIds[0] ?? ''
    const nextIds = activeThreadId
      ? [activeThreadId, ...threadIds.filter((id) => id !== activeThreadId)]
      : threadIds
    if (nextIds.length > 0) {
      workspaces[key] = {
        activeThreadId: nextIds[0],
        threadIds: nextIds
      }
    }
  }
  return { version: 1, workspaces }
}

export function readWriteThreadRegistry(storage: StorageLike | null = browserStorage()): WriteThreadRegistry {
  if (!storage) return emptyWriteThreadRegistry()
  try {
    const raw = storage.getItem(WRITE_THREAD_REGISTRY_KEY)
    return normalizeWriteThreadRegistry(raw ? JSON.parse(raw) : null)
  } catch {
    return emptyWriteThreadRegistry()
  }
}

export function saveWriteThreadRegistry(
  registry: WriteThreadRegistry,
  storage: StorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(WRITE_THREAD_REGISTRY_KEY, JSON.stringify(normalizeWriteThreadRegistry(registry)))
  } catch {
    /* ignore storage failures */
  }
}

export function writeThreadIds(registry: WriteThreadRegistry = readWriteThreadRegistry()): Set<string> {
  const ids = new Set<string>()
  for (const record of Object.values(registry.workspaces)) {
    for (const id of record.threadIds) ids.add(id)
  }
  return ids
}

export function isWriteThreadId(
  threadId: string | null | undefined,
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): boolean {
  return Boolean(threadId && writeThreadIds(registry).has(threadId))
}

export function writeThreadBelongsToWorkspace(
  thread: Pick<NormalizedThread, 'id' | 'workspace'>,
  workspaceRoot: string,
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): boolean {
  return isWriteThreadId(thread.id, registry) && writeWorkspaceKey(thread.workspace) === writeWorkspaceKey(workspaceRoot)
}

export function markWriteThread(
  workspaceRoot: string,
  threadId: string,
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): WriteThreadRegistry {
  const key = writeWorkspaceKey(workspaceRoot)
  const id = threadId.trim()
  if (!key || !id) return registry
  const record = registry.workspaces[key] ?? { activeThreadId: '', threadIds: [] }
  const threadIds = [id, ...record.threadIds.filter((item) => item !== id)]
  return normalizeWriteThreadRegistry({
    ...registry,
    workspaces: {
      ...registry.workspaces,
      [key]: { activeThreadId: id, threadIds }
    }
  })
}

export function forgetWriteThread(
  threadId: string,
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): WriteThreadRegistry {
  const id = threadId.trim()
  if (!id) return registry
  const workspaces: WriteThreadRegistry['workspaces'] = {}
  for (const [workspaceRoot, record] of Object.entries(registry.workspaces)) {
    const threadIds = record.threadIds.filter((item) => item !== id)
    if (threadIds.length === 0) continue
    workspaces[workspaceRoot] = {
      activeThreadId: record.activeThreadId === id ? threadIds[0] : record.activeThreadId,
      threadIds
    }
  }
  return { version: 1, workspaces }
}

export function pruneWriteThreadRegistry(
  threads: Pick<NormalizedThread, 'id' | 'workspace'>[],
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): WriteThreadRegistry {
  const known = new Set(threads.map((thread) => thread.id))
  const workspaces: WriteThreadRegistry['workspaces'] = {}
  for (const [workspaceRoot, record] of Object.entries(registry.workspaces)) {
    const threadIds = record.threadIds.filter((id) => known.has(id))
    if (threadIds.length === 0) continue
    const activeThreadId = threadIds.includes(record.activeThreadId)
      ? record.activeThreadId
      : threadIds[0]
    workspaces[workspaceRoot] = { activeThreadId, threadIds }
  }
  return { version: 1, workspaces }
}

export function activeWriteThreadForWorkspace(
  workspaceRoot: string,
  threads: NormalizedThread[],
  registry: WriteThreadRegistry = readWriteThreadRegistry()
): NormalizedThread | null {
  const key = writeWorkspaceKey(workspaceRoot)
  if (!key) return null
  const record = registry.workspaces[key]
  if (!record) return null
  const candidates = record.threadIds
    .map((id) => threads.find((thread) => thread.id === id) ?? null)
    .filter((thread): thread is NormalizedThread => Boolean(thread))
    .filter((thread) => writeWorkspaceKey(thread.workspace) === key)
  return candidates.find((thread) => thread.id === record.activeThreadId) ?? candidates[0] ?? null
}
