import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircleMore,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CLAW_COMPOSER_MODEL_IDS, useChatStore } from '../../store/chat-store'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'
import { FloatingComposer } from './FloatingComposer'
import type { ChatBlock } from '../../agent/types'

const STORAGE_KEY = 'deepseekgui.layout.sidePanelCollapsed'
const PANEL_DEFAULT_WIDTH = 380
const PANEL_MIN_WIDTH = 300
const PANEL_MAX_WIDTH = 560

type Props = {
  className?: string
  onCollapse?: () => void
}

function readStoredCollapsed(): boolean {
  const raw = readBrowserStorageItem(STORAGE_KEY)
  if (raw === '1') return true
  if (raw === '0') return false
  return false
}

function persistCollapsed(value: boolean): void {
  writeBrowserStorageItem(STORAGE_KEY, value ? '1' : '0')
}

function formatInheritedTime(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(date)
}

function clampWidth(value: number, containerWidth: number | null): number {
  const maxAllowed = containerWidth
    ? Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, Math.floor(containerWidth * 0.6)))
    : PANEL_MAX_WIDTH
  return Math.min(maxAllowed, Math.max(PANEL_MIN_WIDTH, value))
}

function SideMessageBubble({ block }: { block: ChatBlock }): ReactElement | null {
  if (block.kind === 'user') {
    return (
      <div className="ds-card-soft rounded-[18px] bg-ds-card/82 px-4 py-3 text-[14px] leading-6 text-ds-ink shadow-[0_8px_22px_rgba(15,23,42,0.05)]">
        <div className="ds-markdown whitespace-pre-wrap break-words">{block.text}</div>
      </div>
    )
  }
  if (block.kind === 'assistant') {
    const streaming = block.id === 'live-assistant'
    return (
      <div className="ds-markdown ds-chat-answer min-w-0 max-w-full text-[14px] leading-6 text-ds-ink">
        {streaming ? (
          <span>{block.text}</span>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        )}
      </div>
    )
  }
  if (block.kind === 'reasoning') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3.5 py-2.5 text-[12.5px] leading-6 text-ds-muted">
        <div className="ds-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (block.kind === 'tool') {
    return (
      <div className="flex items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card/70 px-3 py-1.5 text-[12px] text-ds-muted">
        <Wrench className="h-3 w-3 shrink-0" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate">
          {block.summary || block.toolKind || 'tool'}
        </span>
        {block.status === 'running' ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" strokeWidth={1.9} />
        ) : null}
      </div>
    )
  }
  if (block.kind === 'approval' || block.kind === 'compaction') {
    return (
      <div className="rounded-full border border-ds-border-muted bg-ds-card/60 px-3 py-1.5 text-[12px] text-ds-muted">
        {block.summary}
      </div>
    )
  }
  if (block.kind === 'user_input') {
    return (
      <div className="rounded-full border border-ds-border-muted bg-ds-card/60 px-3 py-1.5 text-[12px] text-ds-muted">
        {block.questions.map((q) => q.question).join(' · ') || 'user input'}
      </div>
    )
  }
  if (block.kind === 'system') {
    return (
      <div className="rounded-[14px] border border-ds-border-muted bg-ds-card/55 px-3 py-2 text-[12.5px] text-ds-muted">
        {block.text}
      </div>
    )
  }
  return null
}

export function SideConversationPanel({ className, onCollapse }: Props): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const [collapsed, setCollapsed] = useState<boolean>(() => readStoredCollapsed())
  const [width, setWidth] = useState<number>(PANEL_DEFAULT_WIDTH)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const widthRef = useRef(width)
  widthRef.current = width

  useEffect(() => {
    persistCollapsed(collapsed)
  }, [collapsed])

  useEffect(() => {
    if (!shellRef.current) return
    const node = shellRef.current.parentElement
    if (!node) return
    const update = (): void => {
      const next = clampWidth(widthRef.current, node.clientWidth)
      if (Math.abs(next - widthRef.current) > 0.5) {
        widthRef.current = next
        setWidth(next)
      }
    }
    update()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (ro) ro.observe(node)
    window.addEventListener('resize', update)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const sideData = useChatStore(
    useShallow((s) => ({
      sides: s.sideConversations,
      panel: s.sidePanel,
      parentThreadId: s.activeThreadId,
      threads: s.threads,
      runtimeConnection: s.runtimeConnection,
      probeRuntime: s.probeRuntime,
      openSettings: s.openSettings,
      sendSideMessage: s.sendSideMessage,
      interruptSide: s.interruptSide,
      setSideInput: s.setSideInput,
      setSideModel: s.setSideModel,
      setSideReasoningEffort: s.setSideReasoningEffort,
      selectSideConversation: s.selectSideConversation,
      setSidePanelOpen: s.setSidePanelOpen,
      closeSideConversation: s.closeSideConversation,
      discardSideConversation: s.discardSideConversation,
      promoteSideConversation: s.promoteSideConversation
    }))
  )

  const sideIds = useMemo(() => Object.keys(sideData.sides), [sideData.sides])
  const hasSides = sideIds.length > 0
  const shouldRender = hasSides || sideData.panel.open
  const activeId = hasSides
    ? sideData.panel.activeSideId && sideData.sides[sideData.panel.activeSideId]
      ? sideData.panel.activeSideId
      : sideIds[0]
    : null
  const activeSide = activeId ? sideData.sides[activeId] : null
  const parentThread = sideData.parentThreadId
    ? sideData.threads.find((thread) => thread.id === sideData.parentThreadId) ?? null
    : null

  if (!shouldRender) return null

  const runningCount = sideIds.reduce((count, id) => {
    const side = sideData.sides[id]
    return side?.busy ? count + 1 : count
  }, 0)

  const handleSend = (sideId: string, text: string): void => {
    void sideData.sendSideMessage(sideId, text)
  }

  const handleSetInput = (sideId: string, text: string): void => {
    sideData.setSideInput(sideId, text)
  }

  const handleSetModel = (sideId: string, model: string): void => {
    sideData.setSideModel(sideId, model)
  }

  const handleSetReasoningEffort = (sideId: string, effort: string): void => {
    sideData.setSideReasoningEffort(sideId, effort)
  }

  const handleInterrupt = (sideId: string): void => {
    void sideData.interruptSide(sideId)
  }

  const handleSelect = (sideId: string): void => {
    sideData.selectSideConversation(sideId)
  }

  const handleClose = (sideId: string): void => {
    void sideData.closeSideConversation(sideId)
  }

  const handleDiscard = (sideId: string): void => {
    void sideData.discardSideConversation(sideId)
  }

  const handlePromote = (sideId: string): void => {
    void sideData.promoteSideConversation(sideId)
  }

  const handleCollapse = (): void => {
    if (collapsed) {
      setCollapsed(false)
      sideData.setSidePanelOpen(true)
      return
    }
    setCollapsed(true)
    onCollapse?.()
  }

  const handleHiddenClose = (): void => {
    sideData.setSidePanelOpen(false)
    onCollapse?.()
  }

  if (collapsed) {
    return (
      <div
        className={`ds-side-rail ds-no-drag flex w-12 shrink-0 flex-col items-center gap-2 border-l border-ds-border-muted bg-ds-sidebar/82 py-3 ${className ?? ''}`}
        aria-label={t('sidePanelRailLabel')}
        title={t('sidePanelExpand')}
      >
        <button
          type="button"
          onClick={handleCollapse}
          className="ds-side-rail-toggle flex h-9 w-9 items-center justify-center rounded-full border border-transparent bg-white/40 text-ds-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition hover:border-ds-border-muted hover:bg-white/70 hover:text-ds-ink dark:bg-white/[0.04] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] dark:hover:bg-white/[0.08]"
          aria-label={t('sidePanelExpand')}
          title={t('sidePanelExpand')}
        >
          <MessageCircleMore className="h-4 w-4" strokeWidth={1.85} />
        </button>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold ${
            runningCount > 0
              ? 'bg-amber-500/14 text-amber-900 dark:text-amber-200'
              : 'bg-ds-card text-ds-muted'
          }`}
          title={
            runningCount > 0
              ? t('sidePanelRunningCount', { running: runningCount, total: sideIds.length })
              : t('sidePanelIdleCount', { total: sideIds.length })
          }
        >
          {sideIds.length}
        </div>
        {runningCount > 0 ? (
          <span
            className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
            aria-label={t('sidePanelRunningDot')}
            title={t('sidePanelRunningDot')}
          />
        ) : null}
        <div className="mt-auto flex flex-col items-center gap-1">
          {sideIds.slice(-3).map((id) => {
            const side = sideData.sides[id]
            if (!side) return null
            const initial = side.title.trim().charAt(0).toUpperCase() || '·'
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setCollapsed(false)
                  handleSelect(id)
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-ds-card text-[11px] font-semibold text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                title={side.title}
              >
                {initial}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <aside
      ref={shellRef}
      className={`ds-side-panel ds-no-drag flex h-full min-h-0 shrink-0 flex-col border-l border-ds-border-muted bg-ds-sidebar/90 backdrop-blur-xl ${className ?? ''}`}
      style={{ width }}
      aria-label={t('sidePanelTitle')}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted px-3 py-2.5">
        <MessageCircleMore className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ds-ink">
            {t('sidePanelTitle')}
          </div>
          <div className="truncate text-[11.5px] text-ds-faint">
            {parentThread
              ? t('sidePanelParentLabel', { title: parentThread.title })
              : t('sidePanelParentMissing')}
          </div>
        </div>
        <button
          type="button"
          onClick={handleHiddenClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('sidePanelHide')}
          title={t('sidePanelHide')}
        >
          <PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.85} />
        </button>
        <button
          type="button"
          onClick={handleCollapse}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('sidePanelCollapse')}
          title={t('sidePanelCollapse')}
        >
          <PanelRightOpen className="h-3.5 w-3.5 -scale-x-100" strokeWidth={1.85} />
        </button>
      </header>

      {sideIds.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-ds-border-muted px-2 py-1.5">
          {sideIds.map((id) => {
            const side = sideData.sides[id]
            if (!side) return null
            const active = id === activeId
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleSelect(id)}
                className={`ds-side-tab flex min-w-0 max-w-[180px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition ${
                  active
                    ? 'bg-ds-card text-ds-ink shadow-sm'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
                title={side.title}
              >
                <span className="min-w-0 flex-1 truncate">{side.title}</span>
                {side.busy ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
                    aria-label={t('sidePanelRunningDot')}
                  />
                ) : null}
                {active ? (
                  <Check className="h-3 w-3 shrink-0 text-accent" strokeWidth={2.2} />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {activeSide ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted px-3 py-1.5 text-[11.5px] text-ds-faint">
            <ChevronRight className="h-3 w-3" strokeWidth={1.9} />
            <span
              className="min-w-0 flex-1 truncate"
              title={t('sidePanelInheritedAt', {
                time: formatInheritedTime(activeSide.inheritedAt, i18n.language)
              })}
            >
              {t('sidePanelInheritedAt', {
                time: formatInheritedTime(activeSide.inheritedAt, i18n.language)
              })}
            </span>
            <button
              type="button"
              onClick={() => handleClose(activeSide.threadId)}
              className="ds-side-action flex items-center gap-1 rounded-full px-2 py-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              title={t('sidePanelCloseTitle')}
            >
              <X className="h-3 w-3" strokeWidth={2} />
              <span>{t('sidePanelClose')}</span>
            </button>
            <button
              type="button"
              onClick={() => handlePromote(activeSide.threadId)}
              className="ds-side-action flex items-center gap-1 rounded-full px-2 py-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              title={t('sidePanelPromoteTitle')}
            >
              <ArrowDownToLine className="h-3 w-3" strokeWidth={1.9} />
              <span>{t('sidePanelPromote')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleDiscard(activeSide.threadId)}
              className="ds-side-action flex items-center gap-1 rounded-full px-2 py-1 text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
              title={t('sidePanelDiscardTitle')}
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.9} />
              <span>{t('sidePanelDiscard')}</span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
              {activeSide.blocks.length === 0 && !activeSide.liveAssistant && !activeSide.liveReasoning ? (
                <div className="ds-no-drag flex flex-1 flex-col items-center justify-center gap-2 text-center text-[12.5px] text-ds-faint">
                  <MessageCircleMore className="h-5 w-5 opacity-60" strokeWidth={1.7} />
                  <p>{t('sidePanelEmpty')}</p>
                </div>
              ) : null}
              {activeSide.blocks.map((block) => (
                <SideMessageBubble key={block.id} block={block} />
              ))}
              {activeSide.liveReasoning ? (
                <SideMessageBubble
                  block={{
                    kind: 'reasoning',
                    id: `live-reasoning-${activeSide.lastSeq || Date.now()}`,
                    text: activeSide.liveReasoning
                  }}
                />
              ) : null}
              {activeSide.liveAssistant ? (
                <SideMessageBubble
                  block={{
                    kind: 'assistant',
                    id: 'live-assistant',
                    text: activeSide.liveAssistant
                  }}
                />
              ) : null}
              {activeSide.error ? (
                <div className="rounded-[12px] border border-red-300/70 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200">
                  {activeSide.error}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 justify-center px-2 pb-2 pt-1">
              <FloatingComposer
                variant="compact"
                input={activeSide.input}
                setInput={(value) => handleSetInput(activeSide.threadId, value)}
                mode="agent"
                setMode={() => {
                  /* side conversations are agent-mode only */
                }}
                busy={activeSide.busy}
                runtimeReady={sideData.runtimeConnection === 'ready'}
                hasActiveThread
                composerModel={activeSide.model}
                composerPickList={CLAW_COMPOSER_MODEL_IDS}
                composerReasoningEffort={activeSide.reasoningEffort}
                onComposerModelChange={(modelId) => handleSetModel(activeSide.threadId, modelId)}
                onComposerReasoningEffortChange={(effort) => {
                  handleSetReasoningEffort(activeSide.threadId, effort)
                }}
                hideBtwCommand
                queuedMessages={[]}
                onRemoveQueuedMessage={() => {
                  /* no queued messages inside a side conversation */
                }}
                onSend={() => handleSend(activeSide.threadId, activeSide.input)}
                onInterrupt={() => handleInterrupt(activeSide.threadId)}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[12.5px] text-ds-faint">
          <ChevronLeft className="h-4 w-4" strokeWidth={1.85} />
          <p>{t('sidePanelEmpty')}</p>
        </div>
      )}
    </aside>
  )
}
