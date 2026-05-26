import {
  Component,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { harden } from 'rehype-harden'
import type { PluggableList } from 'unified'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath
} from '@shared/write-markdown-resource'

export {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  writePathToFileUrl
} from '@shared/write-markdown-resource'

type Props = {
  content: string
  isMarkdown: boolean
  filePath?: string | null
  previewErrorMessage?: string
}

export const writeMarkdownHardenOptions = {
  defaultOrigin: 'https://deepseek-gui.local',
  allowedLinkPrefixes: ['*'],
  allowedImagePrefixes: ['*']
}

const rehypePlugins = [
  [
    harden,
    writeMarkdownHardenOptions
  ]
] as unknown as PluggableList

function plainTextFallback(content: string): ReactElement {
  return (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[13.5px] leading-6 text-ds-ink">
      {content}
    </pre>
  )
}

function isMissingImageIpc(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No handler registered for') ||
    message.includes('readWorkspaceImage is not a function')
}

type ResolvedMarkdownImageProps = {
  src?: string
  alt?: string | null
  filePath?: string | null
} & Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'alt'>

function ResolvedMarkdownImage({
  src,
  alt,
  filePath,
  ...props
}: ResolvedMarkdownImageProps): ReactElement {
  const [resolvedSrc, setResolvedSrc] = useState(() => resolveWriteMarkdownResource(src, filePath))
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)
    const localPath = resolveWriteMarkdownResourcePath(src, filePath)
    const fallback = resolveWriteMarkdownResource(src, filePath)
    setResolvedSrc(fallback)

    if (!localPath || typeof window.dsGui?.readWorkspaceImage !== 'function') return

    void window.dsGui.readWorkspaceImage({ path: localPath })
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setResolvedSrc(result.dataUrl)
        } else {
          setLoadFailed(true)
        }
      })
      .catch((error) => {
        if (!cancelled && !isMissingImageIpc(error)) setLoadFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [src, filePath])

  if (loadFailed) {
    return (
      <span className="inline-flex max-w-full items-center rounded-lg border border-red-200/70 bg-red-50/80 px-2 py-1 text-[12px] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
        {alt || src || 'Image could not be loaded'}
      </span>
    )
  }

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt ?? ''}
    />
  )
}

type PreviewBoundaryProps = {
  content: string
  filePath?: string | null
  previewErrorMessage: string
  children: ReactNode
}

type PreviewBoundaryState = {
  error: string | null
}

class PreviewErrorBoundary extends Component<PreviewBoundaryProps, PreviewBoundaryState> {
  state: PreviewBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): PreviewBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidUpdate(previousProps: PreviewBoundaryProps): void {
    if (
      this.state.error &&
      (previousProps.content !== this.props.content || previousProps.filePath !== this.props.filePath)
    ) {
      this.setState({ error: null })
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-full px-6 py-6">
        <div className="mb-4 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-[13px] leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/35 dark:text-amber-100">
          {this.props.previewErrorMessage}
        </div>
        {plainTextFallback(this.props.content)}
      </div>
    )
  }
}

function WriteMarkdownPreviewContent({ content, isMarkdown, filePath }: Props): ReactElement {
  if (!isMarkdown) return plainTextFallback(content)

  return (
    <div className="ds-markdown write-markdown-preview min-h-full text-ds-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ href, children, ...props }): ReactNode => (
            <a
              {...props}
              href={href}
              onClick={(event) => {
                if (!href) return
                event.preventDefault()
                void window.dsGui?.openExternal?.(href)
              }}
            >
              {children}
            </a>
          ),
          img: ({ src, alt, ...props }): ReactNode => (
            <ResolvedMarkdownImage
              {...props}
              src={src}
              alt={alt}
              filePath={filePath}
            />
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function WriteMarkdownPreview(props: Props): ReactElement {
  return (
    <PreviewErrorBoundary
      content={props.content}
      filePath={props.filePath}
      previewErrorMessage={props.previewErrorMessage ?? 'Markdown preview failed, showing source text instead.'}
    >
      <WriteMarkdownPreviewContent {...props} />
    </PreviewErrorBoundary>
  )
}
