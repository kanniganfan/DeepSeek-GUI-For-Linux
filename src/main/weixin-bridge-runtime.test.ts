import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { weixinBridgeRuntimeInternals } from './weixin-bridge-runtime'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/deepseek-gui-test-user-data'
  }
}))

const requireFromTest = createRequire(import.meta.url)

describe('weixin bridge runtime', () => {
  it('builds a GUI-managed OpenClaw config that activates the WeChat adapter channel', () => {
    const config = weixinBridgeRuntimeInternals.buildGuiManagedOpenClawConfig({
      port: 18790,
      adapterPluginPath: '/tmp/deepseek-gui-weixin-adapter'
    })

    expect(config).toMatchObject({
      gateway: {
        bind: 'loopback',
        port: 18790,
        auth: { mode: 'none' }
      },
      plugins: {
        allow: ['admin-http-rpc', 'deepseek-gui-weixin-bridge-adapter'],
        load: { paths: ['/tmp/deepseek-gui-weixin-adapter'] },
        entries: {
          'admin-http-rpc': { enabled: true },
          'deepseek-gui-weixin-bridge-adapter': { enabled: true }
        }
      },
      channels: {
        'openclaw-weixin': {
          enabled: true,
          accounts: {
            default: { enabled: true }
          }
        }
      }
    })
  })

  it('generates an adapter plugin that exposes WeChat QR login over web login RPC', () => {
    const source = weixinBridgeRuntimeInternals.buildWeixinBridgeAdapterSource({
      root: '/tmp/weixin-plugin',
      channelModulePath: '/tmp/weixin-plugin/dist/src/channel.js',
      compatModulePath: '/tmp/weixin-plugin/dist/src/compat.js'
    })

    expect(source).toContain('weixinPlugin')
    expect(source).toContain('gatewayMethods')
    expect(source).toContain('web.login.start')
    expect(source).toContain('web.login.wait')
    expect(source).toContain('DEEPSEEK_GUI_CLAW_IM_WEBHOOK_URL')
    expect(source).toContain('postToDeepSeekGuiWebhook')
    expect(source).toContain('sendMessageWeixin')
    expect(source).toContain("opts.accountId || account.accountId || 'default'")
    expect(source).toContain('deepseek-gui-weixin-bridge-adapter')
    expect(source).toContain('lastError: message')
  })

  it('generates adapter source that imports against the bundled WeChat plugin modules', async () => {
    const root = dirname(requireFromTest.resolve('@tencent-weixin/openclaw-weixin/package.json'))
    const source = weixinBridgeRuntimeInternals.buildWeixinBridgeAdapterSource({
      root,
      channelModulePath: join(root, 'dist', 'src', 'channel.js'),
      compatModulePath: join(root, 'dist', 'src', 'compat.js')
    })

    const imported = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

    expect(imported.default).toMatchObject({
      id: 'deepseek-gui-weixin-bridge-adapter'
    })
    expect(typeof imported.default.register).toBe('function')
  })

  it('accepts only Node versions supported by the bundled WeChat bridge runtime', () => {
    const { parseNodeVersion, isSupportedNodeVersion } = weixinBridgeRuntimeInternals

    expect(isSupportedNodeVersion(parseNodeVersion('20.19.1'))).toBe(false)
    expect(isSupportedNodeVersion(parseNodeVersion('22.18.0'))).toBe(false)
    expect(isSupportedNodeVersion(parseNodeVersion('22.19.0'))).toBe(true)
    expect(isSupportedNodeVersion(parseNodeVersion('24.14.0'))).toBe(true)
  })
})
