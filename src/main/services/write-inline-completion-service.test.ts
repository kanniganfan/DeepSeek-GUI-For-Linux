import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'
import { requestWriteInlineCompletion } from './write-inline-completion-service'

function createSettings(patch: Partial<AppSettingsV1['write']['inlineCompletion']> = {}): AppSettingsV1 {
  const write = defaultWriteSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    agentProvider: 'deepseek-runtime',
    deepseek: {
      binaryPath: '',
      port: 7878,
      autoStart: true,
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com/beta',
      runtimeToken: '',
      extraCorsOrigins: [],
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write'
    },
    workspaceRoot: '/tmp/workspace',
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    write: {
      ...write,
      inlineCompletion: {
        ...write.inlineCompletion,
        ...patch
      }
    },
    guiUpdate: {
      channel: 'stable'
    },
    claw: defaultClawSettings()
  }
}

function createRequest(): WriteInlineCompletionRequest {
  return {
    prefix: '# Draft\n\nThis is',
    suffix: ' a test.',
    currentFilePath: '/tmp/workspace/draft.md',
    cursor: {
      line: 3,
      column: 7
    },
    context: {
      language: 'markdown',
      currentLinePrefix: 'This is',
      currentLineSuffix: ' a test.',
      previousLine: '',
      previousNonEmptyLine: '# Draft',
      nextLine: '',
      indentation: '',
      signals: {
        list: false,
        quote: false,
        heading: false,
        table: false,
        atLineEnd: false,
        endsWithSentencePunctuation: false,
        previousLineEndsWithSentencePunctuation: false,
        prefersNewLineCompletion: false,
        paragraphBreakOpportunity: false
      }
    },
    policy: {
      name: 'precision-inline-v2',
      instruction: 'Return only inserted text.',
      acceptanceCriteria: ['Keep it short.'],
      rejectionCriteria: ['Do not ramble.']
    },
    preview: {
      local: 'This is',
      documentTail: '# Draft This is'
    },
    model: 'deepseek-v4-flash'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestWriteInlineCompletion', () => {
  it('calls DeepSeek FIM completions directly instead of chat completions', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' only a test' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ maxTokens: 64 }), createRequest())

    expect(result).toEqual({
      ok: true,
      completion: ' only a test',
      model: 'deepseek-v4-flash'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/beta/completions')
    expect(url).not.toContain('/chat/completions')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-test'
    })
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-flash',
      prompt: '# Draft\n\nThis is',
      suffix: ' a test.',
      max_tokens: 64
    })
  })

  it('does not request the API when inline completion is disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ enabled: false }), createRequest())

    expect(result).toEqual({ ok: false, message: 'Inline completion is disabled.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes the legacy completion default to the flash model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' flash text' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      model: 'deepseek-v4-pro'
    }
    const result = await requestWriteInlineCompletion(createSettings(), request)

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-v4-flash'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-flash'
    })
  })
})
