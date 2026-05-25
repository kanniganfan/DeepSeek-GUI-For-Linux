import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  normalizeWriteInlineCompletionModel,
  type AppSettingsV1
} from '../../shared/app-settings'
import { upstreamDeepSeekFimCompletionsUrl } from '../../shared/openai-compat-url'
import type {
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from '../../shared/write-inline-completion'

const INLINE_COMPLETION_TIMEOUT_MS = 12_000

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
    text?: string
  }>
}

function resolveModel(request: WriteInlineCompletionRequest, settings: AppSettingsV1): string {
  const trimmed = request.model?.trim() || settings.write.inlineCompletion.model.trim()
  return normalizeWriteInlineCompletionModel(trimmed || DEFAULT_WRITE_INLINE_COMPLETION_MODEL)
}

function flattenMessageContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part?.type === 'text' || part?.text ? part?.text ?? '' : ''))
    .join('')
}

function cleanCompletionText(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  const trimmed = normalized.trim()
  if (!trimmed) return ''

  const fenced = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/)
  if (fenced) return fenced[1]
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return normalized
}

function extractCompletion(responseText: string): string {
  let parsed: ChatCompletionResponse
  try {
    parsed = JSON.parse(responseText) as ChatCompletionResponse
  } catch {
    throw new Error('Inline completion provider returned non-JSON data.')
  }
  const firstChoice = parsed.choices?.[0]
  if (typeof firstChoice?.text === 'string') return cleanCompletionText(firstChoice.text)
  const first = firstChoice?.message?.content
  return cleanCompletionText(flattenMessageContent(first))
}

export async function requestWriteInlineCompletion(
  settings: AppSettingsV1,
  request: WriteInlineCompletionRequest
): Promise<WriteInlineCompletionResult> {
  if (settings.write.inlineCompletion.enabled === false) {
    return { ok: false, message: 'Inline completion is disabled.' }
  }

  const apiKey = settings.deepseek.apiKey.trim()
  if (!apiKey) {
    return { ok: false, message: 'Missing API key for inline completion.' }
  }

  const model = resolveModel(request, settings)
  const url = upstreamDeepSeekFimCompletionsUrl(
    settings.write.inlineCompletion.baseUrl.trim() || DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL
  )
  const maxTokens = settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt: request.prefix,
        suffix: request.suffix,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(INLINE_COMPLETION_TIMEOUT_MS)
    })
    const text = await response.text()
    if (!response.ok) {
      return {
        ok: false,
        message: `Inline completion request failed (${response.status}): ${text.slice(0, 300)}`
      }
    }

    return {
      ok: true,
      completion: extractCompletion(text),
      model
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
