import { app } from 'electron'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_WEIXIN_BRIDGE_RPC_URL } from '../shared/app-settings'
import { logError, logInfo, logWarn } from './logger'

const requireFromHere = createRequire(import.meta.url)
const WEIXIN_BRIDGE_PORT = 18790
const WEIXIN_BRIDGE_MAX_PORT_ATTEMPTS = 20
const WEIXIN_BRIDGE_STARTUP_TIMEOUT_MS = 20_000
const WEIXIN_BRIDGE_HEALTH_TIMEOUT_MS = 3_000
const WEIXIN_BRIDGE_STATE_DIR_NAME = 'weixin-bridge'
const WEIXIN_PLUGIN_ID = 'openclaw-weixin'
const ADMIN_RPC_PLUGIN_ID = 'admin-http-rpc'
const WEIXIN_BRIDGE_ADAPTER_PLUGIN_ID = 'deepseek-gui-weixin-bridge-adapter'
const WEIXIN_BRIDGE_ADAPTER_DIR_NAME = 'deepseek-gui-weixin-bridge-adapter'
const OPENCLAW_MIN_NODE_MAJOR = 22
const OPENCLAW_MIN_NODE_MINOR = 19
const OPENCLAW_MIN_NODE_PATCH = 0

type ResolvedOpenClawCli = {
  command: string
  args: string[]
  source: string
  nodeVersion?: string
}

type NodeVersion = {
  major: number
  minor: number
  patch: number
}

type ResolvedNodeRuntime = {
  command: string
  source: string
  version: string
}

type WeixinBridgeConfigOptions = {
  port: number
  adapterPluginPath: string | null
}

type WeixinBridgeRuntimeContext = {
  webhookUrl: string
  webhookSecret: string
  channelId: string
}

type ResolvedWeixinPluginModules = {
  root: string
  channelModulePath: string
  compatModulePath: string
}

type WeixinAccount = {
  accountId: string
  baseUrl: string
  token?: string
  configured: boolean
}

type WeixinAccountsModule = {
  resolveWeixinAccount: (cfg: Record<string, unknown>, accountId?: string | null) => WeixinAccount
}

type WeixinInboundModule = {
  restoreContextTokens: (accountId: string) => void
  getContextToken: (accountId: string, userId: string) => string | undefined
}

type WeixinSendModule = {
  sendMessageWeixin: (params: {
    to: string
    text: string
    opts: { baseUrl: string; token?: string; contextToken?: string; timeoutMs?: number }
  }) => Promise<{ messageId: string }>
}

export type WeixinBridgeSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }

let child: ChildProcess | null = null
let startPromise: Promise<string> | null = null
let recentBridgeOutput: string[] = []
let runtimeContextProvider: (() => Promise<WeixinBridgeRuntimeContext>) | null = null
let activeBridgePort = WEIXIN_BRIDGE_PORT

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isChildRunning(): boolean {
  return child !== null && child.exitCode === null
}

function resolveRpcUrl(port = activeBridgePort): string {
  const url = new URL(DEFAULT_WEIXIN_BRIDGE_RPC_URL)
  url.port = String(port)
  return url.toString()
}

export function configureWeixinBridgeRuntimeContextProvider(
  provider: (() => Promise<WeixinBridgeRuntimeContext>) | null
): void {
  runtimeContextProvider = provider
}

async function resolveRuntimeContext(): Promise<WeixinBridgeRuntimeContext> {
  return runtimeContextProvider
    ? runtimeContextProvider()
    : {
        webhookUrl: 'http://127.0.0.1:8787/claw/im',
        webhookSecret: '',
        channelId: ''
      }
}

function resolvePackagePath(packageName: string, subpath: string): string | null {
  try {
    return requireFromHere.resolve(`${packageName}/${subpath}`)
  } catch {
    return null
  }
}

function resolvePackageRoot(packageName: string): string | null {
  const packageJson = resolvePackagePath(packageName, 'package.json')
  return packageJson ? dirname(packageJson) : null
}

function parseNodeVersion(raw: string): NodeVersion | null {
  const match = raw.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  }
}

function isSupportedNodeVersion(version: NodeVersion | null): boolean {
  if (!version) return false
  if (version.major !== OPENCLAW_MIN_NODE_MAJOR) return version.major > OPENCLAW_MIN_NODE_MAJOR
  if (version.minor !== OPENCLAW_MIN_NODE_MINOR) return version.minor > OPENCLAW_MIN_NODE_MINOR
  return version.patch >= OPENCLAW_MIN_NODE_PATCH
}

function commandBasename(command: string): string {
  const parts = command.split(/[\\/]/)
  return parts.at(-1) ?? command
}

function toAsarUnpackedPath(filePath: string): string {
  return filePath.replace(/\.asar([\\/])/, '.asar.unpacked$1')
}

function executableIfExists(filePath: string): string | null {
  const unpackedPath = toAsarUnpackedPath(filePath)
  if (existsSync(unpackedPath)) return unpackedPath
  return existsSync(filePath) ? filePath : null
}

function splitPathEntries(value: string | undefined): string[] {
  return (value ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function listNodeRuntimeCandidates(): Array<{ command: string; source: string }> {
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node'
  const candidates: Array<{ command: string; source: string }> = []
  const push = (command: string | null | undefined, source: string) => {
    if (!command) return
    const resolved = executableIfExists(command)
    if (!resolved) return
    if (candidates.some((candidate) => candidate.command === resolved)) return
    candidates.push({ command: resolved, source })
  }

  push(process.env.DEEPSEEK_GUI_NODE_BINARY, 'env:DEEPSEEK_GUI_NODE_BINARY')
  push(process.env.OPENCLAW_NODE_BINARY, 'env:OPENCLAW_NODE_BINARY')

  const bundledNodeRoot = resolvePackageRoot('node')
  if (bundledNodeRoot) {
    push(join(bundledNodeRoot, 'bin', executableName), 'bundled-node')
  }
  for (const packageName of [
    'node-bin-darwin-arm64',
    'node-bin-linux-x64',
    'node-bin-win-x64'
  ]) {
    const packageRoot = resolvePackageRoot(packageName)
    if (packageRoot) {
      push(join(packageRoot, 'bin', executableName), packageName)
    }
  }

  if (!app.isPackaged) {
    for (const entry of splitPathEntries(process.env.PATH)) {
      push(join(entry, executableName), 'PATH')
    }
    push('/opt/homebrew/bin/node', 'dev-common')
    push('/opt/homebrew/opt/node/bin/node', 'dev-common')
    push('/usr/local/bin/node', 'dev-common')
    push('/Applications/Codex.app/Contents/Resources/node', 'dev-common')
  }

  if (commandBasename(process.execPath).toLowerCase().startsWith('node')) {
    push(process.execPath, 'process.execPath')
  }

  return candidates
}

function readNodeRuntimeVersion(command: string): string | null {
  try {
    const result = spawnSync(command, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (result.status !== 0) return null
    const version = result.stdout.trim()
    return isSupportedNodeVersion(parseNodeVersion(version)) ? version : null
  } catch {
    return null
  }
}

function resolveNodeRuntime(): ResolvedNodeRuntime | null {
  for (const candidate of listNodeRuntimeCandidates()) {
    const version = readNodeRuntimeVersion(candidate.command)
    if (!version) continue
    return {
      command: candidate.command,
      source: candidate.source,
      version
    }
  }
  return null
}

function resolveOpenClawCli(): ResolvedOpenClawCli | null {
  const nodeRuntime = resolveNodeRuntime()
  if (!nodeRuntime) return null

  const bundledCli = resolvePackagePath('openclaw', 'openclaw.mjs')
  if (bundledCli) {
    return {
      command: nodeRuntime.command,
      args: [bundledCli],
      source: `bundled via ${nodeRuntime.source}`,
      nodeVersion: nodeRuntime.version
    }
  }

  const devGlobalCli = '/Users/zxy/.local/lib/node_modules/openclaw/openclaw.mjs'
  if (!app.isPackaged && existsSync(devGlobalCli)) {
    return {
      command: nodeRuntime.command,
      args: [devGlobalCli],
      source: `dev-global via ${nodeRuntime.source}`,
      nodeVersion: nodeRuntime.version
    }
  }

  const devGlobalBin = '/opt/homebrew/bin/openclaw'
  if (!app.isPackaged && existsSync(devGlobalBin)) {
    return {
      command: devGlobalBin,
      args: [],
      source: 'dev-global-bin'
    }
  }

  return null
}

function resolveWeixinPluginRoot(): string | null {
  const bundled = resolvePackageRoot('@tencent-weixin/openclaw-weixin')
  if (bundled) return bundled

  const devGlobal = '/Users/zxy/.local/lib/node_modules/@tencent-weixin/openclaw-weixin'
  return !app.isPackaged && existsSync(devGlobal) ? devGlobal : null
}

function resolveWeixinPluginModules(): ResolvedWeixinPluginModules | null {
  const root = resolveWeixinPluginRoot()
  if (!root) return null
  const channelModulePath = join(root, 'dist', 'src', 'channel.js')
  const compatModulePath = join(root, 'dist', 'src', 'compat.js')
  if (!existsSync(channelModulePath) || !existsSync(compatModulePath)) return null
  return { root, channelModulePath, compatModulePath }
}

function stateRoot(): string {
  return join(app.getPath('userData'), WEIXIN_BRIDGE_STATE_DIR_NAME)
}

function configPath(): string {
  return join(stateRoot(), 'openclaw.json')
}

function adapterRoot(): string {
  return join(stateRoot(), WEIXIN_BRIDGE_ADAPTER_DIR_NAME)
}

function weixinAccountsPath(): string {
  return join(stateRoot(), WEIXIN_PLUGIN_ID, 'accounts.json')
}

async function withWeixinBridgeStateEnv<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENCLAW_STATE_DIR
  process.env.OPENCLAW_STATE_DIR = stateRoot()
  try {
    return await operation()
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCLAW_STATE_DIR
    } else {
      process.env.OPENCLAW_STATE_DIR = previous
    }
  }
}

async function readBridgeConfig(): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath(), 'utf8')
  const parsed = JSON.parse(raw) as unknown
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function buildWeixinBridgeAdapterPackageJson(): Record<string, unknown> {
  return {
    name: WEIXIN_BRIDGE_ADAPTER_PLUGIN_ID,
    version: '1.0.0',
    type: 'module',
    openclaw: {
      extensions: ['./index.mjs'],
      runtimeExtensions: ['./index.mjs']
    }
  }
}

function buildWeixinBridgeAdapterManifest(): Record<string, unknown> {
  return {
    id: WEIXIN_BRIDGE_ADAPTER_PLUGIN_ID,
    version: '1.0.0',
    channels: [WEIXIN_PLUGIN_ID],
    channelConfigs: {
      [WEIXIN_PLUGIN_ID]: {
        schema: {
          type: 'object',
          additionalProperties: true
        },
        label: 'WeChat',
        description: 'DeepSeek GUI managed WeChat channel configuration.'
      }
    },
    configSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  }
}

function buildWeixinBridgeAdapterSource(modules: ResolvedWeixinPluginModules): string {
  const channelModuleUrl = pathToFileURL(modules.channelModulePath).href
  const compatModuleUrl = pathToFileURL(modules.compatModulePath).href
  const apiModuleUrl = pathToFileURL(join(modules.root, 'dist', 'src', 'api', 'api.js')).href
  const accountsModuleUrl = pathToFileURL(join(modules.root, 'dist', 'src', 'auth', 'accounts.js')).href
  const inboundModuleUrl = pathToFileURL(join(modules.root, 'dist', 'src', 'messaging', 'inbound.js')).href
  const sendModuleUrl = pathToFileURL(join(modules.root, 'dist', 'src', 'messaging', 'send.js')).href
  const syncBufModuleUrl = pathToFileURL(join(modules.root, 'dist', 'src', 'storage', 'sync-buf.js')).href
  const typesModuleUrl = pathToFileURL(join(modules.root, 'dist', 'src', 'api', 'types.js')).href
  return `import { weixinPlugin } from ${JSON.stringify(channelModuleUrl)}
import { assertHostCompatibility } from ${JSON.stringify(compatModuleUrl)}
import { getUpdates, notifyStart, notifyStop } from ${JSON.stringify(apiModuleUrl)}
import { DEFAULT_BASE_URL } from ${JSON.stringify(accountsModuleUrl)}
import { restoreContextTokens, setContextToken, weixinMessageToMsgContext } from ${JSON.stringify(inboundModuleUrl)}
import { sendMessageWeixin } from ${JSON.stringify(sendModuleUrl)}
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from ${JSON.stringify(syncBufModuleUrl)}
import { MessageItemType, MessageType } from ${JSON.stringify(typesModuleUrl)}

const WEB_LOGIN_METHODS = ['web.login.start', 'web.login.wait']
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
const RETRY_DELAY_MS = 2_000
const BACKOFF_DELAY_MS = 30_000

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }, { once: true })
  })
}

function textFromItemList(itemList) {
  if (!Array.isArray(itemList)) return ''
  for (const item of itemList) {
    if (item?.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text).trim()
    }
    if (item?.type === MessageItemType.VOICE && item.voice_item?.text != null) {
      return String(item.voice_item.text).trim()
    }
  }
  return ''
}

function readWebhookSettings() {
  return {
    url: process.env.DEEPSEEK_GUI_CLAW_IM_WEBHOOK_URL || 'http://127.0.0.1:8787/claw/im',
    secret: process.env.DEEPSEEK_GUI_CLAW_IM_WEBHOOK_SECRET || '',
    channelId: process.env.DEEPSEEK_GUI_CLAW_IM_CHANNEL_ID || ''
  }
}

function formatAdapterError(error) {
  return error instanceof Error ? error.message : String(error)
}

function logAdapterError(accountId, error) {
  const message = formatAdapterError(error)
  console.error(\`[deepseek-gui-weixin-bridge-adapter] [\${accountId}] \${message}\`)
  return message
}

async function postToDeepSeekGuiWebhook(message, accountId) {
  const settings = readWebhookSettings()
  const ctx = weixinMessageToMsgContext(message, accountId)
  const text = String(ctx.Body || textFromItemList(message.item_list)).trim()
  if (!text) {
    return { reply: 'Only text messages are supported right now.' }
  }
  const body = {
    provider: 'weixin',
    platform: 'weixin',
    channelId: settings.channelId || undefined,
    text,
    sender: message.from_user_id || 'WeChat',
    from: message.from_user_id || '',
    chatId: message.from_user_id || '',
    messageId: message.message_id || ctx.MessageSid || '',
    senderId: message.from_user_id || '',
    senderName: message.from_user_id || 'WeChat',
    threadId: '',
    message: {
      provider: 'weixin',
      text,
      sender: message.from_user_id || 'WeChat'
    }
  }
  const headers = { 'content-type': 'application/json' }
  if (settings.secret) {
    headers.authorization = \`Bearer \${settings.secret}\`
    headers['x-deepseek-gui-secret'] = settings.secret
  }
  const res = await fetch(settings.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(650_000)
  })
  const raw = await res.text()
  let json = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    json = null
  }
  if (!res.ok || json?.ok === false) {
    const message = json?.message || raw || \`DeepSeek GUI webhook HTTP \${res.status}\`
    throw new Error(message)
  }
  return json || {}
}

async function monitorDeepSeekGuiWeixinProvider(opts) {
  const account = opts.account || {}
  const accountId = opts.accountId || account.accountId || 'default'
  const {
    abortSignal,
    setStatus
  } = opts
  const baseUrl = account.baseUrl || DEFAULT_BASE_URL
  const token = account.token || ''
  if (!account.configured || !token.trim()) {
    throw new Error('weixin not configured: missing token')
  }
  restoreContextTokens(accountId)
  setStatus?.({
    accountId,
    running: true,
    lastStartAt: Date.now(),
    lastEventAt: Date.now()
  })
  try {
    await notifyStart({ baseUrl, token })
  } catch {
    // notifyStart is best-effort; long polling below is the source of truth.
  }

  const syncFilePath = getSyncBufFilePath(accountId)
  let getUpdatesBuf = loadGetUpdatesBuf(syncFilePath) || ''
  let nextTimeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS
  let consecutiveFailures = 0
  while (!abortSignal?.aborted) {
    try {
      const resp = await getUpdates({
        baseUrl,
        token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs
      })
      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms
      }
      const isApiError = (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0)
      if (isApiError) {
        consecutiveFailures += 1
        await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, abortSignal)
        if (consecutiveFailures >= 3) consecutiveFailures = 0
        continue
      }
      consecutiveFailures = 0
      setStatus?.({ accountId, lastEventAt: Date.now() })
      if (resp.get_updates_buf != null && resp.get_updates_buf !== '') {
        getUpdatesBuf = resp.get_updates_buf
        saveGetUpdatesBuf(syncFilePath, getUpdatesBuf)
      }
      for (const message of resp.msgs ?? []) {
        if (message.message_type === MessageType.BOT) continue
        const to = message.from_user_id || ''
        if (!to) continue
        const contextToken = message.context_token || undefined
        if (contextToken) setContextToken(accountId, to, contextToken)
        setStatus?.({
          accountId,
          lastEventAt: Date.now(),
          lastInboundAt: Date.now()
        })
        const result = await postToDeepSeekGuiWebhook(message, accountId)
        const reply = typeof result.reply === 'string'
          ? result.reply.trim()
          : typeof result.text === 'string'
            ? result.text.trim()
            : ''
        if (!reply) continue
        await sendMessageWeixin({
          to,
          text: reply,
          opts: { baseUrl, token, contextToken }
        })
        setStatus?.({
          accountId,
          lastEventAt: Date.now(),
          lastOutboundAt: Date.now()
        })
      }
    } catch (error) {
      if (abortSignal?.aborted) return
      const message = logAdapterError(accountId, error)
      setStatus?.({
        accountId,
        lastEventAt: Date.now(),
        lastError: message
      })
      consecutiveFailures += 1
      await sleep(consecutiveFailures >= 3 ? BACKOFF_DELAY_MS : RETRY_DELAY_MS, abortSignal)
      if (consecutiveFailures >= 3) consecutiveFailures = 0
    }
  }
}

export default {
  id: ${JSON.stringify(WEIXIN_BRIDGE_ADAPTER_PLUGIN_ID)},
  name: 'DeepSeek GUI WeChat Login',
  description: 'Expose the bundled WeChat channel to DeepSeek GUI QR login.',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  register(api) {
    assertHostCompatibility(api.runtime?.version)
    api.registerChannel({
      plugin: {
        ...weixinPlugin,
        gatewayMethods: Array.from(new Set([...(weixinPlugin.gatewayMethods ?? []), ...WEB_LOGIN_METHODS])),
        gateway: {
          ...weixinPlugin.gateway,
          startAccount: async (ctx) => monitorDeepSeekGuiWeixinProvider(ctx),
          stopAccount: async (ctx) => {
            const account = ctx.account || {}
            if (!account.configured || !account.token?.trim()) return
            try {
              await notifyStop({
                baseUrl: account.baseUrl || DEFAULT_BASE_URL,
                token: account.token
              })
            } catch {
              // Best-effort shutdown.
            }
          }
        }
      }
    })
  }
}
`
}

function buildGuiManagedOpenClawConfig(options: WeixinBridgeConfigOptions): Record<string, unknown> {
  return {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port: options.port,
      auth: {
        mode: 'none'
      }
    },
    plugins: {
      enabled: true,
      allow: [ADMIN_RPC_PLUGIN_ID, WEIXIN_BRIDGE_ADAPTER_PLUGIN_ID],
      bundledDiscovery: 'allowlist',
      load: {
        paths: options.adapterPluginPath ? [options.adapterPluginPath] : []
      },
      entries: {
        [ADMIN_RPC_PLUGIN_ID]: { enabled: true },
        [WEIXIN_BRIDGE_ADAPTER_PLUGIN_ID]: { enabled: true }
      }
    },
    channels: {
      [WEIXIN_PLUGIN_ID]: {
        enabled: true,
        accounts: {
          default: {
            enabled: true
          }
        }
      }
    },
    session: {
      dmScope: 'per-account-channel-peer'
    }
  }
}

async function writeJsonIfChanged(filePath: string, value: unknown): Promise<void> {
  const next = `${JSON.stringify(value, null, 2)}\n`
  try {
    const current = await readFile(filePath, 'utf8')
    if (current === next) return
  } catch {
    /* create the file below */
  }
  await writeFile(filePath, next, 'utf8')
}

async function prepareBridgeAdapter(modules: ResolvedWeixinPluginModules): Promise<string> {
  const root = adapterRoot()
  await mkdir(root, { recursive: true })
  await writeJsonIfChanged(join(root, 'package.json'), buildWeixinBridgeAdapterPackageJson())
  await writeJsonIfChanged(join(root, 'openclaw.plugin.json'), buildWeixinBridgeAdapterManifest())

  const sourcePath = join(root, 'index.mjs')
  const source = buildWeixinBridgeAdapterSource(modules)
  try {
    const current = await readFile(sourcePath, 'utf8')
    if (current === source) return root
  } catch {
    /* create the file below */
  }
  await writeFile(sourcePath, source, 'utf8')
  return root
}

async function prepareBridgeState(port: number): Promise<void> {
  const root = stateRoot()
  await mkdir(root, { recursive: true })
  const weixinPluginModules = resolveWeixinPluginModules()
  if (!weixinPluginModules) {
    throw new Error(
      'Built-in WeChat login component is missing. Reinstall DeepSeek GUI or rebuild with @tencent-weixin/openclaw-weixin bundled.'
    )
  }
  const adapterPluginPath = await prepareBridgeAdapter(weixinPluginModules)
  await writeJsonIfChanged(configPath(), buildGuiManagedOpenClawConfig({
    port,
    adapterPluginPath
  }))
}

async function fetchBridgeHealth(port = activeBridgePort): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(WEIXIN_BRIDGE_HEALTH_TIMEOUT_MS)
    })
    if (!res.ok) return false
    const data = await res.json().catch(() => null) as { ok?: unknown; status?: unknown } | null
    return data?.ok === true || data?.status === 'live' || data?.status === 'ok'
  } catch {
    return false
  }
}

async function hasPersistedWeixinAccount(): Promise<boolean> {
  try {
    const raw = await readFile(weixinAccountsPath(), 'utf8')
    const accounts = JSON.parse(raw) as unknown
    return Array.isArray(accounts) && accounts.some((account) =>
      typeof account === 'string' && account.trim()
    )
  } catch {
    return false
  }
}

async function requestBridgeRpc(
  port: number,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000
): Promise<Record<string, unknown>> {
  const res = await fetch(resolveRpcUrl(port), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${method}-${Date.now()}`,
      method,
      params
    }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) as Record<string, unknown> : {}
  if (!res.ok || data.ok === false) {
    const error = typeof data.error === 'object' && data.error !== null
      ? data.error as Record<string, unknown>
      : {}
    const message = typeof error.message === 'string'
      ? error.message
      : typeof data.message === 'string'
        ? data.message
        : `HTTP ${res.status}`
    throw new Error(message)
  }
  return data
}

async function startPersistedWeixinChannel(port: number): Promise<void> {
  if (!await hasPersistedWeixinAccount()) return
  try {
    await requestBridgeRpc(port, 'channels.start', { channel: WEIXIN_PLUGIN_ID }, 30_000)
  } catch (error) {
    logWarn('weixin-bridge', 'Failed to start persisted WeChat channel.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function resolveAvailableBridgePort(): Promise<number> {
  if (isChildRunning() && await fetchBridgeHealth(activeBridgePort)) return activeBridgePort
  for (let offset = 0; offset < WEIXIN_BRIDGE_MAX_PORT_ATTEMPTS; offset += 1) {
    const port = WEIXIN_BRIDGE_PORT + offset
    if (await isPortAvailable(port)) return port
  }
  throw new Error('Built-in WeChat login component could not find an available local port.')
}

async function waitForBridgeHealth(startedChild: ChildProcess): Promise<void> {
  const deadline = Date.now() + WEIXIN_BRIDGE_STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await fetchBridgeHealth()) return
    if (startedChild.exitCode !== null) {
      const detail = recentBridgeOutput.length > 0 ? ` ${recentBridgeOutput.slice(-6).join(' ')}` : ''
      throw new Error(`Built-in WeChat login component exited with code ${startedChild.exitCode}.${detail}`)
    }
    await sleep(300)
  }
  throw new Error('Built-in WeChat login component did not become ready in time.')
}

function bridgeEnv(context: WeixinBridgeRuntimeContext): NodeJS.ProcessEnv {
  const root = stateRoot()
  return {
    ...process.env,
    OPENCLAW_STATE_DIR: root,
    OPENCLAW_CONFIG_PATH: configPath(),
    DEEPSEEK_GUI_CLAW_IM_WEBHOOK_URL: context.webhookUrl,
    DEEPSEEK_GUI_CLAW_IM_WEBHOOK_SECRET: context.webhookSecret,
    DEEPSEEK_GUI_CLAW_IM_CHANNEL_ID: context.channelId
  }
}

function captureBridgeOutput(stream: 'stdout' | 'stderr', chunk: Buffer | string): void {
  const text = String(chunk).trim()
  if (!text) return
  const lines = text.split(/\r?\n/).slice(-10)
  recentBridgeOutput.push(...lines)
  recentBridgeOutput = recentBridgeOutput.slice(-20)
  for (const line of lines) {
    logInfo('weixin-bridge', `[${stream}] ${line}`)
  }
}

async function startBridgeProcess(): Promise<string> {
  if (isChildRunning() && await fetchBridgeHealth(activeBridgePort)) return resolveRpcUrl()

  const port = await resolveAvailableBridgePort()
  activeBridgePort = port
  await prepareBridgeState(port)
  const runtimeContext = await resolveRuntimeContext()
  const cli = resolveOpenClawCli()
  if (!cli) {
    throw new Error('Built-in WeChat login runtime is missing. Reinstall DeepSeek GUI.')
  }

  const args = [
    ...cli.args,
    'gateway',
    'run',
    '--allow-unconfigured',
    '--bind',
    'loopback',
    '--auth',
    'none',
    '--port',
    String(port)
  ]
  child = spawn(cli.command, args, {
    env: bridgeEnv(runtimeContext),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  const startedChild = child
  recentBridgeOutput = []
  logInfo(
    'weixin-bridge',
    `spawned ${cli.source} bridge on port ${port}` +
    (cli.nodeVersion ? ` (node ${cli.nodeVersion})` : '')
  )
  startedChild.stdout?.on('data', (chunk) => captureBridgeOutput('stdout', chunk))
  startedChild.stderr?.on('data', (chunk) => captureBridgeOutput('stderr', chunk))
  startedChild.on('error', (error) => {
    logError('weixin-bridge', 'process error', error)
  })
  startedChild.on('exit', (code, signal) => {
    logWarn('weixin-bridge', signal ? `exited with signal ${signal}` : `exited with code ${code ?? 'unknown'}`)
    if (child === startedChild) {
      child = null
      startPromise = null
    }
  })
  await waitForBridgeHealth(startedChild)
  await startPersistedWeixinChannel(port)
  return resolveRpcUrl()
}

export async function ensureWeixinBridgeRpcUrl(): Promise<string> {
  if (!startPromise) {
    startPromise = startBridgeProcess().catch((error) => {
      startPromise = null
      throw error
    })
  }
  return startPromise
}

export async function sendWeixinBridgeMessage(options: {
  accountId: string
  to: string
  text: string
}): Promise<WeixinBridgeSendResult> {
  const accountId = options.accountId.trim()
  const to = options.to.trim()
  const text = options.text.trim()
  if (!accountId) return { ok: false, message: 'WeChat account id is missing.' }
  if (!to) return { ok: false, message: 'WeChat recipient is missing.' }
  if (!text) return { ok: false, message: 'Message is empty.' }

  try {
    await ensureWeixinBridgeRpcUrl()
    return await withWeixinBridgeStateEnv(async () => {
      const modules = resolveWeixinPluginModules()
      if (!modules) {
        return {
          ok: false as const,
          message: 'Built-in WeChat login component is missing. Reinstall DeepSeek GUI.'
        }
      }
      const [accountsModule, inboundModule, sendModule] = await Promise.all([
        import(pathToFileURL(join(modules.root, 'dist', 'src', 'auth', 'accounts.js')).href) as Promise<WeixinAccountsModule>,
        import(pathToFileURL(join(modules.root, 'dist', 'src', 'messaging', 'inbound.js')).href) as Promise<WeixinInboundModule>,
        import(pathToFileURL(join(modules.root, 'dist', 'src', 'messaging', 'send.js')).href) as Promise<WeixinSendModule>
      ])
      const cfg = await readBridgeConfig()
      const account = accountsModule.resolveWeixinAccount(cfg, accountId)
      if (!account.configured || !account.token?.trim()) {
        return { ok: false as const, message: 'WeChat account is not configured.' }
      }
      inboundModule.restoreContextTokens(account.accountId)
      const contextToken = inboundModule.getContextToken(account.accountId, to)
      const result = await sendModule.sendMessageWeixin({
        to,
        text,
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          contextToken
        }
      })
      return { ok: true as const, messageId: result.messageId }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logError('weixin-bridge', 'Failed to send WeChat message from GUI.', {
      message,
      accountId,
      to
    })
    return { ok: false, message }
  }
}

export function stopWeixinBridgeRuntime(): void {
  startPromise = null
  if (!child) return
  const runningChild = child
  child = null
  runningChild.kill()
}

export const weixinBridgeRuntimeInternals = {
  buildGuiManagedOpenClawConfig,
  buildWeixinBridgeAdapterSource,
  isSupportedNodeVersion,
  parseNodeVersion
}
