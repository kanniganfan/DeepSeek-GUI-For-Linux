import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import {
  activeWriteThreadForWorkspace,
  emptyWriteThreadRegistry,
  forgetWriteThread,
  isWriteThreadId,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry
} from './write-thread-registry'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function thread(id: string, workspace: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-05-24T00:00:00.000Z',
    model: 'auto',
    mode: 'agent',
    workspace
  }
}

describe('write-thread-registry', () => {
  it('saves and restores write thread records by workspace', () => {
    const storage = new MemoryStorage()
    const registry = markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry())
    saveWriteThreadRegistry(registry, storage)

    const restored = readWriteThreadRegistry(storage)
    expect(isWriteThreadId('thread-1', restored)).toBe(true)
    expect(activeWriteThreadForWorkspace('/Users/zxy/workspace', [thread('thread-1', '/Users/zxy/workspace')], restored)?.id).toBe('thread-1')
  })

  it('keeps the newest marked write thread active', () => {
    const first = markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry())
    const second = markWriteThread('/Users/zxy/workspace', 'thread-2', first)

    expect(second.workspaces['/Users/zxy/workspace'].activeThreadId).toBe('thread-2')
    expect(second.workspaces['/Users/zxy/workspace'].threadIds).toEqual(['thread-2', 'thread-1'])
  })

  it('prunes missing runtime threads and forgets deleted threads', () => {
    const registry = markWriteThread('/Users/zxy/workspace', 'thread-2',
      markWriteThread('/Users/zxy/workspace', 'thread-1', emptyWriteThreadRegistry()))
    const pruned = pruneWriteThreadRegistry([thread('thread-1', '/Users/zxy/workspace')], registry)

    expect(isWriteThreadId('thread-2', pruned)).toBe(false)
    expect(pruned.workspaces['/Users/zxy/workspace'].activeThreadId).toBe('thread-1')
    expect(forgetWriteThread('thread-1', pruned).workspaces['/Users/zxy/workspace']).toBeUndefined()
  })
})
