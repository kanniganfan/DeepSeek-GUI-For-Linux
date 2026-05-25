import { INLINE_COMPLETION_MIN_CONTEXT_CHARS } from './constants'
import type { InlineCompletionRequestContext } from './types'

function compactText(text = ''): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

export function shouldRequestInlineCompletion(
  context: InlineCompletionRequestContext | null,
  isEnabled?: () => boolean
): boolean {
  if (typeof isEnabled === 'function' && !isEnabled()) return false
  if (!context) return false
  if (context.nextCharIsWord) return false
  if (!context.docLength || !compactText(context.prefixWindow)) return false
  if (context.looksLikeUrlTail) return false

  const localSignalLength = compactText(context.currentLinePrefix).length
  const hasEnoughLocalSignal = localSignalLength >= 3
  const hasEnoughDocumentSignal =
    compactText(context.docPreview).length >= INLINE_COMPLETION_MIN_CONTEXT_CHARS

  if (context.isBlankLine && !context.hasStructuralContext && !context.isParagraphBreakOpportunity) {
    return false
  }
  if (
    !hasEnoughLocalSignal &&
    !hasEnoughDocumentSignal &&
    !context.hasStructuralContext &&
    !context.isParagraphBreakOpportunity
  ) {
    return false
  }

  return true
}
