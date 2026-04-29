import {
  BoltRounded,
  BuildRounded,
  CloudSyncRounded,
  KeyRounded,
  LanRounded,
  LanguageRounded,
  PowerSettingsNewRounded,
  ShoppingCartRounded,
  SpeedRounded,
  TuneRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BasePage } from '@/components/base'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import {
  getProfiles,
  importProfile,
  installService,
  openWebUrl,
  patchClashMode,
  patchProfilesConfig,
  restartCore,
  startCore,
  stopCore,
  deleteProfile,
  updateProfile,
} from '@/services/cmds'
import delayManager from '@/services/delay'

const SUBSCRIPTION_BASE_URL = 'https://sub.jc116.com'
const CODE_STORAGE_KEY = 'shenxianyun.accessCode'
const CODE_NAME_STORAGE_KEY = 'shenxianyun.accessName'
const CODE_EXPIRES_STORAGE_KEY = 'shenxianyun.accessExpiresAt'
const CODE_UPDATE_VERSION_STORAGE_KEY = 'shenxianyun.updateVersion'
const CLIENT_ID_STORAGE_KEY = 'shenxianyun.clientId'
const DELAY_TIMEOUT = 5000
const CLIENT_UA = 'JC116-Shenxianyun-Windows/2.4.8'

const getClientId = () => {
  const saved = localStorage.getItem(CLIENT_ID_STORAGE_KEY)
  if (saved) return saved
  const generated = crypto.randomUUID()
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated)
  return generated
}

type VerifyResponse = {
  ok?: boolean
  name?: string
  expires_at?: string
  subscription_url?: string
  update_version?: number
  message?: string
}

type UpdateStateResponse = {
  ok?: boolean
  update_version?: number
  message?: string
}

class AccessCodeStateError extends Error {
  constructor(
    message: string,
    readonly serverRejected = false,
  ) {
    super(message)
  }
}

const parseExpireTime = (value: string) => {
  if (!value) return Number.POSITIVE_INFINITY
  const time = Date.parse(value.replace(' ', 'T'))
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

const pickPrimaryGroup = (groups: IProxyGroupItem[] = []) => {
  const selectable = groups.filter((group) => {
    const type = String(group.type || '').toLowerCase()
    return type === 'selector' || type === 'urltest' || type === 'fallback'
  })

  return (
    selectable.find((group) =>
      ['节点', '选择', 'select', 'proxy'].some((keyword) =>
        group.name.toLowerCase().includes(keyword.toLowerCase()),
      ),
    ) ||
    selectable.find((group) =>
      group.all?.some((proxy) => !['DIRECT', 'REJECT'].includes(proxy.name)),
    ) ||
    groups[0]
  )
}

const getNodeDelay = (proxy: IProxyItem, groupName = '') => {
  const testedDelay = groupName
    ? delayManager.getDelayFix(proxy, groupName)
    : -1
  if (testedDelay >= 0) return testedDelay
  return proxy.history?.at(-1)?.delay ?? -1
}

const formatNodeLabel = (proxy: IProxyItem, groupName = '') => {
  const delay = getNodeDelay(proxy, groupName)
  if (delay === -2) return `${proxy.name} · 测试中`
  if (delay === 0 || delay >= DELAY_TIMEOUT) return `${proxy.name} · 超时`
  if (delay > 0 && delay < 100000) return `${proxy.name} · ${delay}ms`
  return proxy.name
}

const delayRank = (proxy: IProxyItem, groupName = '') => {
  const delay = getNodeDelay(proxy, groupName)
  if (delay > 0 && delay < DELAY_TIMEOUT) return delay
  if (delay === 0 || delay >= DELAY_TIMEOUT) return DELAY_TIMEOUT + 1
  return Number.MAX_SAFE_INTEGER
}

const HomePage = () => {
  const { verge, patchVerge } = useVerge()
  const { profiles, current, mutateProfiles } = useProfiles()
  const { proxies, clashConfig, refreshAll, refreshClashConfig, refreshProxy } =
    useAppData()
  const {
    indicator: systemProxyOn,
    configState: systemProxyConfigOn,
    toggleSystemProxy,
    invalidateProxyState,
  } = useSystemProxyState()
  const {
    isTunModeAvailable,
    runningMode,
    isAdminMode,
    isServiceOk,
    mutateSystemState,
  } = useSystemState()
  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      setStatus('节点已切换')
      refreshProxy().catch(() => {})
    },
    onError: () => setStatus('节点切换失败'),
  })

  const [code, setCode] = useState(
    () => localStorage.getItem(CODE_STORAGE_KEY) || '',
  )
  const [savedCode, setSavedCode] = useState(
    () => localStorage.getItem(CODE_STORAGE_KEY) || '',
  )
  const [expiresAt, setExpiresAt] = useState(
    () => localStorage.getItem(CODE_EXPIRES_STORAGE_KEY) || '',
  )
  const [accessName, setAccessName] = useState(
    () => localStorage.getItem(CODE_NAME_STORAGE_KEY) || '',
  )
  const [status, setStatus] = useState(
    savedCode ? '提取码已保存，会自动检查订阅更新。' : '输入提取码后自动订阅。',
  )
  const [busy, setBusy] = useState(false)
  const [delayTesting, setDelayTesting] = useState(false)
  const [delaySortTick, setDelaySortTick] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const autoImportCodeRef = useRef('')

  const primaryGroup = useMemo(
    () => pickPrimaryGroup((proxies?.groups || []) as IProxyGroupItem[]),
    [proxies?.groups],
  )
  const nodes = useMemo(() => {
    void delaySortTick
    return (primaryGroup?.all || [])
      .filter((proxy) => !['DIRECT', 'REJECT'].includes(proxy.name))
      .toSorted(
        (a, b) =>
          delayRank(a, primaryGroup?.name) - delayRank(b, primaryGroup?.name),
      )
  }, [primaryGroup, delaySortTick])

  const selectedNode = primaryGroup?.now || ''
  const mode = (clashConfig?.mode || 'rule').toLowerCase()
  const tunOn = verge?.enable_tun_mode || false
  const actualRunning = tunOn || systemProxyOn || systemProxyConfigOn
  const running = actualRunning
  const activeProfileName = current?.name || profiles?.current || '未导入订阅'
  const currentCode = savedCode || code.trim()
  const isSwitchingCode = Boolean(
    savedCode && code.trim() && code.trim() !== savedCode,
  )
  const codeExpired = Boolean(expiresAt && nowMs > parseExpireTime(expiresAt))
  const tunLabel = tunOn
    ? 'TUN 虚拟网卡已开启'
    : isTunModeAvailable
      ? 'TUN 虚拟网卡可用'
      : 'TUN 需管理员/服务'

  const verifyCode = async (input: string): Promise<VerifyResponse> => {
    const response = await tauriFetch(
      `${SUBSCRIPTION_BASE_URL}/api/verify/${encodeURIComponent(input)}`,
      {
        method: 'GET',
        connectTimeout: 8000,
        headers: {
          'User-Agent': CLIENT_UA,
          'X-Client-Type': 'shenxianyun-windows',
        },
      },
    )
    const data = (await response.json()) as VerifyResponse
    if (!response.ok || !data.ok || !data.subscription_url) {
      throw new Error(data.message || '提取码验证失败')
    }
    return data
  }

  const updateState = async (input: string): Promise<UpdateStateResponse> => {
    const response = await tauriFetch(
      `${SUBSCRIPTION_BASE_URL}/api/update-state/${encodeURIComponent(input)}`,
      {
        method: 'GET',
        connectTimeout: 8000,
        headers: {
          'User-Agent': CLIENT_UA,
          'X-Client-Type': 'shenxianyun-windows',
        },
      },
    )
    const data = (await response.json()) as UpdateStateResponse
    if (!response.ok || !data.ok) {
      throw new AccessCodeStateError(data.message || '提取码已失效或过期', true)
    }
    return data
  }

  const sendClientPresence = useCallback(
    async (online: boolean) => {
      const value = savedCode || code.trim()
      if (!value) return
      const endpoint = online ? 'heartbeat' : 'offline'
      const params = new URLSearchParams({
        client_id: getClientId(),
        platform: 'Windows电脑',
        app_name: '神仙云桌面端',
        app_version: '2.4.8',
        device_name: navigator.userAgent,
      })
      await tauriFetch(
        `${SUBSCRIPTION_BASE_URL}/api/client/${endpoint}/${encodeURIComponent(value)}?${params.toString()}`,
        {
          method: 'GET',
          connectTimeout: 5000,
          headers: {
            'User-Agent': CLIENT_UA,
            'X-Client-Type': 'shenxianyun-windows',
          },
        },
      ).catch(() => undefined)
    },
    [code, savedCode],
  )

  const activateCode = async (value: string, retryCount = 3) => {
    let lastError: unknown
    for (let attempt = 1; attempt <= retryCount; attempt += 1) {
      try {
        const data = await verifyCode(value)

        if (savedCode && savedCode !== value && current?.uid) {
          await stopCore().catch(() => {})
          if (tunOn) await patchVerge({ enable_tun_mode: false })
          if (systemProxyOn || systemProxyConfigOn) {
            await toggleSystemProxy(false)
          }
          await deleteProfile(current.uid).catch(() => {})
        }

        await importProfile(data.subscription_url!, {
          with_proxy: true,
          allow_auto_update: true,
          update_interval: 60,
        })

        const latestProfiles = await getProfiles()
        const newestProfile = latestProfiles.items?.at(-1)
        if (newestProfile?.uid) {
          const oldProfiles =
            latestProfiles.items?.filter(
              (item) => item.uid !== newestProfile.uid,
            ) || []
          await Promise.all(
            oldProfiles.map((item) =>
              item.uid
                ? deleteProfile(item.uid).catch(() => {})
                : Promise.resolve(),
            ),
          )

          const singleProfileConfig = await getProfiles()
          await patchProfilesConfig({
            ...singleProfileConfig,
            current: newestProfile.uid,
          })
        }

        localStorage.setItem(CODE_STORAGE_KEY, value)
        localStorage.setItem(CODE_NAME_STORAGE_KEY, data.name || value)
        localStorage.setItem(CODE_EXPIRES_STORAGE_KEY, data.expires_at || '')
        localStorage.setItem(
          CODE_UPDATE_VERSION_STORAGE_KEY,
          String(data.update_version || 0),
        )
        setSavedCode(value)
        setAccessName(data.name || value)
        setExpiresAt(data.expires_at || '')
        await mutateProfiles()
        await refreshAll()
        return data
      } catch (error) {
        lastError = error
        if (attempt < retryCount) {
          setStatus(`订阅失败，正在重试 ${attempt}/${retryCount - 1}...`)
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  const importByCode = useLockFn(async () => {
    const value = code.trim()
    if (!value) {
      setStatus('请输入提取码')
      return
    }

    setBusy(true)
    setStatus(isSwitchingCode ? '正在切换提取码...' : '正在验证提取码...')
    try {
      const data = await activateCode(value)
      setStatus(
        `${isSwitchingCode ? '提取码已切换' : '订阅已导入'}：${data.name || value}${
          data.expires_at ? `，到期 ${data.expires_at}` : ''
        }`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!running || !savedCode) return
    sendClientPresence(true).catch(() => undefined)
    const timer = window.setInterval(() => {
      sendClientPresence(true).catch(() => undefined)
    }, 30_000)
    return () => {
      window.clearInterval(timer)
      sendClientPresence(false).catch(() => undefined)
    }
  }, [running, savedCode, sendClientPresence])

  useEffect(() => {
    const value = code.trim()
    if (!value || value === savedCode || busy || running) return
    if (value.length < 2 || autoImportCodeRef.current === value) return

    const timer = window.setTimeout(() => {
      autoImportCodeRef.current = value
      importByCode().catch(() => {
        autoImportCodeRef.current = ''
      })
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [busy, code, importByCode, running, savedCode])

  useEffect(() => {
    if (!savedCode) return

    const checkUpdate = async () => {
      try {
        const state = await updateState(savedCode)
        const remoteVersion = Number(state.update_version || 0)
        const localVersion = Number(
          localStorage.getItem(CODE_UPDATE_VERSION_STORAGE_KEY) || 0,
        )
        if (remoteVersion > localVersion && current?.uid) {
          setStatus('检测到后台推送，正在更新订阅...')
          await updateProfile(current.uid, { with_proxy: true })
          localStorage.setItem(
            CODE_UPDATE_VERSION_STORAGE_KEY,
            String(remoteVersion),
          )
          await mutateProfiles()
          await refreshAll()
          setStatus('后台推送订阅已更新')
        }
      } catch (error) {
        const blockedByServer =
          error instanceof AccessCodeStateError && error.serverRejected
        const blockedByLocalExpire = Boolean(
          expiresAt && Date.now() > parseExpireTime(expiresAt),
        )

        if (running && (blockedByServer || blockedByLocalExpire)) {
          if (tunOn) await patchVerge({ enable_tun_mode: false })
          if (systemProxyOn || systemProxyConfigOn) {
            await toggleSystemProxy(false)
          }
          await stopCore().catch(() => {})
          await invalidateProxyState()
        }

        if (blockedByServer || blockedByLocalExpire) {
          setStatus(error instanceof Error ? error.message : String(error))
        } else {
          setStatus('后台暂时连接失败，已按本地提取码有效期继续使用')
        }
      }
    }

    checkUpdate().catch(() => {})
    const timer = window.setInterval(() => {
      checkUpdate().catch(() => {})
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [
    current?.uid,
    expiresAt,
    invalidateProxyState,
    mutateProfiles,
    patchVerge,
    refreshAll,
    running,
    savedCode,
    systemProxyConfigOn,
    systemProxyOn,
    toggleSystemProxy,
    tunOn,
  ])

  const updateCurrentSubscription = useLockFn(async () => {
    if (!current?.uid) {
      setStatus('还没有可更新的订阅')
      return
    }
    setBusy(true)
    setStatus('正在更新订阅...')
    try {
      await updateProfile(current.uid, { with_proxy: true })
      await mutateProfiles()
      await refreshAll()
      setStatus('订阅已更新')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const togglePower = useLockFn(async () => {
    setBusy(true)
    try {
      if (running) {
        if (tunOn) await patchVerge({ enable_tun_mode: false })
        if (systemProxyOn || systemProxyConfigOn) {
          await toggleSystemProxy(false)
        } else {
          await patchVerge({ enable_system_proxy: false })
        }
        await stopCore().catch(() => {})
        await invalidateProxyState()
        await refreshAll()
        await sendClientPresence(false)
        setStatus('已停止代理')
        return
      }

      if (!current?.uid) {
        const value = code.trim()
        if (!value) {
          setStatus('请先输入提取码并导入订阅')
          return
        }
        setStatus('正在导入订阅...')
        await activateCode(value)
      }

      if (!currentCode) {
        setStatus('请先输入提取码')
        return
      }

      setStatus('正在检查提取码有效期...')
      if (expiresAt && Date.now() > parseExpireTime(expiresAt)) {
        setStatus('提取码已过期，不能开启代理')
        return
      }

      try {
        const state = await updateState(currentCode)
        if (state.update_version) {
          localStorage.setItem(
            CODE_UPDATE_VERSION_STORAGE_KEY,
            String(state.update_version),
          )
        }
      } catch (error) {
        if (error instanceof AccessCodeStateError && error.serverRejected) {
          setStatus(error.message)
          return
        }
        setStatus('后台暂时连接失败，按本地提取码有效期继续启动...')
      }

      setStatus('正在启动内核...')
      await startCore().catch(() => restartCore())
      await mutateSystemState()

      if (isTunModeAvailable) {
        await patchVerge({ enable_tun_mode: true })
        if (systemProxyOn || systemProxyConfigOn) await toggleSystemProxy(false)
        setStatus('已启动 TUN 模式，按钮可点击停止')
      } else {
        await toggleSystemProxy(true)
        setStatus('已启动系统代理，按钮可点击停止')
      }
      await invalidateProxyState()
      await refreshAll()
      await sendClientPresence(true)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const changeMode = useLockFn(async (_: unknown, value: string | null) => {
    if (!value || value === mode) return
    setBusy(true)
    try {
      await patchClashMode(value)
      await refreshClashConfig()
      setStatus(value === 'global' ? '已切换全局模式' : '已切换规则模式')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const changeNode = (value: string) => {
    if (!primaryGroup || !value) return
    changeProxy(primaryGroup.name, value, primaryGroup.now)
  }

  const testNodeDelay = useLockFn(async () => {
    if (!primaryGroup || nodes.length === 0) {
      setStatus('没有可测试的节点')
      return
    }

    setDelayTesting(true)
    setStatus('正在测试节点延迟...')
    try {
      await delayManager.checkListDelay(
        nodes.map((node) => node.name),
        primaryGroup.name,
        DELAY_TIMEOUT,
        8,
      )
      setDelaySortTick((tick) => tick + 1)
      await refreshProxy()
      setStatus('延迟测试完成，低延迟节点已排在前面')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setDelayTesting(false)
    }
  })

  return (
    <BasePage title="神仙云">
      <Box
        sx={{
          minHeight: '100%',
          display: 'grid',
          placeItems: 'center',
          px: 3,
          py: 4,
          background:
            'radial-gradient(circle at 50% 18%, rgba(255,80,145,.16), transparent 34%), linear-gradient(180deg, rgba(16,18,28,.04), transparent)',
        }}
      >
        <Stack spacing={3} sx={{ width: 'min(720px, 100%)' }}>
          <Stack spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h3" sx={{ fontWeight: 800 }}>
              神仙云
            </Typography>
            <Typography color="text.secondary">
              输入提取码，选择节点，一键开启。
            </Typography>
          </Stack>

          <Paper
            elevation={0}
            sx={{
              borderRadius: 4,
              p: { xs: 3, md: 4 },
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Stack spacing={3} sx={{ alignItems: 'center' }}>
              <Button
                disabled={busy}
                onClick={togglePower}
                sx={{
                  width: 220,
                  height: 220,
                  borderRadius: '50%',
                  fontSize: 32,
                  fontWeight: 800,
                  color: 'white',
                  bgcolor: running ? '#2ac77f' : '#f25b96',
                  boxShadow: running
                    ? '0 18px 42px rgba(42,199,127,.35)'
                    : '0 18px 42px rgba(242,91,150,.35)',
                  '&:hover': {
                    bgcolor: running ? '#24b472' : '#e94f8b',
                  },
                }}
              >
                <Stack spacing={1} sx={{ alignItems: 'center' }}>
                  <PowerSettingsNewRounded sx={{ fontSize: 56 }} />
                  <span>{running ? '停止' : '启动'}</span>
                </Stack>
              </Button>

              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                <Chip
                  icon={<BoltRounded />}
                  color={running ? 'success' : 'default'}
                  label={running ? '代理已开启' : '代理未开启'}
                />
                <Chip
                  icon={<TuneRounded />}
                  label={accessName || activeProfileName}
                />
                {expiresAt && (
                  <Chip
                    color={codeExpired ? 'error' : 'default'}
                    variant="outlined"
                    label={codeExpired ? '提取码已过期' : `到期 ${expiresAt}`}
                  />
                )}
                <Chip
                  icon={<LanguageRounded />}
                  label={mode === 'global' ? '全局模式' : '规则模式'}
                />
                <Chip
                  icon={<LanRounded />}
                  color={
                    tunOn
                      ? 'success'
                      : isTunModeAvailable
                        ? 'primary'
                        : 'warning'
                  }
                  variant={tunOn ? 'filled' : 'outlined'}
                  label={tunLabel}
                />
                <Chip
                  icon={<BoltRounded />}
                  color={
                    systemProxyOn || systemProxyConfigOn ? 'success' : 'default'
                  }
                  variant={
                    systemProxyOn || systemProxyConfigOn ? 'filled' : 'outlined'
                  }
                  label={
                    systemProxyOn || systemProxyConfigOn
                      ? '系统代理已开启'
                      : '系统代理未开启'
                  }
                />
              </Stack>

              <Alert
                severity={isTunModeAvailable ? 'success' : 'warning'}
                sx={{ width: '100%' }}
              >
                {isTunModeAvailable
                  ? `TUN 虚拟网卡可用：${runningMode} 模式，启动时会优先使用 TUN。`
                  : `TUN 虚拟网卡暂不可用：管理员=${isAdminMode ? '是' : '否'}，服务=${isServiceOk ? '正常' : '未安装/未启动'}。会自动改用系统代理。`}
              </Alert>

              {!isTunModeAvailable && (
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<BuildRounded />}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setStatus('正在安装 TUN 服务，会弹出管理员授权...')
                    try {
                      await installService()
                      await restartCore()
                      await mutateSystemState()
                      setStatus('TUN 服务已安装，可以重新启动代理')
                    } catch (error) {
                      setStatus(
                        error instanceof Error ? error.message : String(error),
                      )
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  安装 TUN 虚拟网卡服务
                </Button>
              )}

              {tunOn && (
                <Button
                  fullWidth
                  variant="outlined"
                  color="warning"
                  startIcon={<LanRounded />}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setStatus('Closing TUN...')
                    try {
                      await patchVerge({ enable_tun_mode: false })
                      await mutateSystemState()
                      await refreshAll()
                      setStatus('TUN virtual adapter is off')
                    } catch (error) {
                      setStatus(
                        error instanceof Error ? error.message : String(error),
                      )
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  关闭 TUN 虚拟网卡
                </Button>
              )}

              <ToggleButtonGroup
                exclusive
                value={mode}
                onChange={changeMode}
                disabled={busy}
                fullWidth
                sx={{ maxWidth: 420 }}
              >
                <ToggleButton value="rule">规则模式</ToggleButton>
                <ToggleButton value="global">全局模式</ToggleButton>
              </ToggleButtonGroup>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ width: '100%' }}
              >
                <FormControl fullWidth>
                  <InputLabel>选择节点</InputLabel>
                  <Select
                    label="选择节点"
                    value={selectedNode}
                    onChange={(event) => changeNode(event.target.value)}
                    disabled={!primaryGroup || nodes.length === 0}
                  >
                    {nodes.map((node) => (
                      <MenuItem key={node.name} value={node.name}>
                        {formatNodeLabel(node, primaryGroup?.name)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="outlined"
                  startIcon={<SpeedRounded />}
                  disabled={busy || delayTesting || nodes.length === 0}
                  onClick={testNodeDelay}
                  sx={{ minWidth: 132 }}
                >
                  {delayTesting ? '测试中' : '测延迟'}
                </Button>
              </Stack>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ width: '100%' }}
              >
                <TextField
                  fullWidth
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  label="提取码"
                  placeholder="输入网页后台生成的提取码"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <KeyRounded sx={{ mr: 1, color: 'text.secondary' }} />
                      ),
                    },
                  }}
                />
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={importByCode}
                  sx={{ minWidth: 140 }}
                >
                  {isSwitchingCode
                    ? '切换提取码'
                    : savedCode
                      ? '重新订阅'
                      : '导入订阅'}
                </Button>
              </Stack>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ width: '100%' }}
              >
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<CloudSyncRounded />}
                  disabled={busy}
                  onClick={updateCurrentSubscription}
                >
                  更新订阅
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<ShoppingCartRounded />}
                  onClick={() => openWebUrl(`${SUBSCRIPTION_BASE_URL}/pay`)}
                >
                  新购 / 续费
                </Button>
              </Stack>

              <Alert
                severity={
                  status.includes('失败') || status.includes('错误')
                    ? 'error'
                    : 'info'
                }
                sx={{ width: '100%' }}
              >
                {status}
              </Alert>
            </Stack>
          </Paper>
        </Stack>
      </Box>
    </BasePage>
  )
}

export default HomePage
