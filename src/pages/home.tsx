import {
  AddRounded,
  BoltRounded,
  BuildRounded,
  CloudSyncRounded,
  DeleteRounded,
  DnsRounded,
  KeyRounded,
  LanRounded,
  LanguageRounded,
  PowerSettingsNewRounded,
  RuleRounded,
  SettingsRounded,
  ShoppingCartRounded,
  SpeedRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useLockFn } from 'ahooks'
import yaml from 'js-yaml'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BasePage } from '@/components/base'
import { useClash } from '@/hooks/use-clash'
import { useConnectionData } from '@/hooks/use-connection-data'
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
  readProfileFile,
  restartCore,
  saveProfileFile,
  startCore,
  stopCore,
  deleteProfile,
  updateProfile,
} from '@/services/cmds'
import delayManager from '@/services/delay'
import getSystem from '@/utils/get-system'

const SUBSCRIPTION_BASE_URL = 'https://sub.jc116.com'
const CODE_STORAGE_KEY = 'shenxianyun.accessCode'
const CODE_EXPIRES_STORAGE_KEY = 'shenxianyun.accessExpiresAt'
const CODE_UPDATE_VERSION_STORAGE_KEY = 'shenxianyun.updateVersion'
const CLIENT_ID_STORAGE_KEY = 'shenxianyun.clientId'
const DELAY_TIMEOUT = 5000
const TRAFFIC_REPORT_INTERVAL_MS = 30_000
const MAX_TRAFFIC_REPORT_DELTA = 5 * 1024 * 1024 * 1024
const DESKTOP_VERSION = '2.4.9'
const CLIENT_UA = 'JC116-Shenxianyun-Windows/2.4.9'
const DESKTOP_PLATFORM = getSystem()
const fieldSx = {
  '& .MuiInputLabel-root': {
    color: 'rgba(36,46,66,.66)',
  },
  '& .MuiInputLabel-root.Mui-focused': {
    color: '#1c8dff',
  },
  '& .MuiInputBase-root': {
    color: '#182033',
    bgcolor: 'rgba(255,255,255,.82)',
  },
  '& .MuiInputBase-input': {
    color: '#182033',
  },
  '& .MuiInputBase-input.Mui-disabled': {
    WebkitTextFillColor: 'rgba(24,32,51,.72)',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgba(45,65,105,.18)',
  },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgba(28,141,255,.52)',
  },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: '#1c8dff',
  },
  '& .MuiSelect-icon': {
    color: 'rgba(24,32,51,.72)',
  },
  '& .MuiSvgIcon-root': {
    color: 'rgba(28,141,255,.86)',
  },
}

const outlineButtonSx = {
  color: '#176fd6',
  borderColor: 'rgba(28,141,255,.44)',
  bgcolor: 'rgba(28,141,255,.06)',
  '&:hover': {
    borderColor: '#1c8dff',
    bgcolor: 'rgba(28,141,255,.12)',
  },
  '&.Mui-disabled': {
    color: 'rgba(36,46,66,.38)',
    borderColor: 'rgba(36,46,66,.16)',
  },
}

const getClientId = () => {
  const saved = localStorage.getItem(CLIENT_ID_STORAGE_KEY)
  if (saved) return saved
  const generated =
    crypto.randomUUID?.() ||
    `sx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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

type ValidVerifyResponse = VerifyResponse & {
  subscription_url: string
}

type UpdateStateResponse = {
  ok?: boolean
  update_version?: number
  message?: string
}

type DesktopVersionResponse = {
  ok?: boolean
  latest_version?: string
  download_url?: string
  windows_url?: string
  macos_url?: string
  linux_deb_url?: string
  linux_rpm_url?: string
  notes?: string
  platform?: string
}

type RuleSnapshot = {
  rules?: unknown
  ruleProviders?: unknown
  subRules?: unknown
}

type TrafficRuleItem = {
  raw: string
  domain: string
  policy: string
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

const compareVersion = (remote: string, current: string) => {
  const parse = (value: string) =>
    value
      .replace(/^v/i, '')
      .split(/[.+-]/)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)

  const left = parse(remote)
  const right = parse(current)
  const max = Math.max(left.length, right.length, 3)

  for (let index = 0; index < max; index += 1) {
    const a = left[index] || 0
    const b = right[index] || 0
    if (a > b) return 1
    if (a < b) return -1
  }
  return 0
}

const readRuleSnapshot = async (
  profileUid?: string,
): Promise<RuleSnapshot | null> => {
  if (!profileUid) return null

  try {
    const content = await readProfileFile(profileUid)
    const data = yaml.load(content) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') return null

    const snapshot: RuleSnapshot = {}
    if (Array.isArray(data.rules)) snapshot.rules = data.rules
    if (data['rule-providers'] && typeof data['rule-providers'] === 'object') {
      snapshot.ruleProviders = data['rule-providers']
    }
    if (data['sub-rules'] && typeof data['sub-rules'] === 'object') {
      snapshot.subRules = data['sub-rules']
    }

    return Object.keys(snapshot).length > 0 ? snapshot : null
  } catch {
    return null
  }
}

const restoreRuleSnapshot = async (
  profileUid: string | undefined,
  snapshot: RuleSnapshot | null,
) => {
  if (!profileUid || !snapshot) return

  const content = await readProfileFile(profileUid)
  const data = yaml.load(content) as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return

  if (snapshot.rules !== undefined) data.rules = snapshot.rules
  if (snapshot.ruleProviders !== undefined) {
    data['rule-providers'] = snapshot.ruleProviders
  }
  if (snapshot.subRules !== undefined) data['sub-rules'] = snapshot.subRules

  await saveProfileFile(profileUid, yaml.dump(data, { lineWidth: -1 }))
}

const normalizeRuleDomain = (input: string) => {
  const value = input.trim()
  if (!value) return ''

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return url.hostname.replace(/^\*\./, '').toLowerCase()
  } catch {
    return value
      .replace(/^\w+:\/\//, '')
      .split('/')[0]
      .split(':')[0]
      .replace(/^\*\./, '')
      .toLowerCase()
  }
}

const parseTrafficRule = (rule: unknown): TrafficRuleItem | null => {
  if (typeof rule !== 'string') return null
  const parts = rule.split(',').map((part) => part.trim())
  if (parts.length < 3) return null
  if (!['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD'].includes(parts[0])) {
    return null
  }
  return {
    raw: rule,
    domain: parts[1],
    policy: parts[2],
  }
}

const pickPrimaryGroup = (groups: IProxyGroupItem[] = []) => {
  const manualGroups = groups.filter((group) => {
    const type = String(group.type || '').toLowerCase()
    return type === 'selector' || type === 'select'
  })
  const fallbackGroups = groups.filter((group) => {
    const type = String(group.type || '').toLowerCase()
    return type === 'urltest' || type === 'url-test' || type === 'fallback'
  })
  const selectable = manualGroups.length ? manualGroups : fallbackGroups

  return (
    selectable.find((group) =>
      ['节点', '选择', 'select', 'proxy'].some((keyword) =>
        group.name.toLowerCase().includes(keyword.toLowerCase()),
      ),
    ) ||
    selectable.find((group) =>
      group.all?.some((proxy) => !['DIRECT', 'REJECT'].includes(proxy.name)),
    ) ||
    manualGroups[0] ||
    fallbackGroups[0] ||
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
  const { response: connectionResponse } = useConnectionData()
  const { patchClash } = useClash()
  const { profiles, current, mutateProfiles } = useProfiles()
  const { proxies, clashConfig, refreshAll, refreshClashConfig, refreshProxy } =
    useAppData()
  const {
    indicator: systemProxyOn,
    configState: systemProxyConfigOn,
    toggleSystemProxy,
    invalidateProxyState,
  } = useSystemProxyState()
  const { isTunModeAvailable, mutateSystemState } = useSystemState()
  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      setStatus('节点已切换')
      refreshProxy().catch(() => {})
    },
    onError: () => setStatus('节点切换失败'),
  })

  const [code, setCode] = useState('')
  const [savedCode, setSavedCode] = useState(
    () => localStorage.getItem(CODE_STORAGE_KEY) || '',
  )
  const [expiresAt, setExpiresAt] = useState(
    () => localStorage.getItem(CODE_EXPIRES_STORAGE_KEY) || '',
  )
  const [status, setStatus] = useState(
    savedCode ? '提取码已保存，会自动检查订阅更新。' : '',
  )
  const [codeDialogOpen, setCodeDialogOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [trafficRuleOpen, setTrafficRuleOpen] = useState(false)
  const [trafficRuleInput, setTrafficRuleInput] = useState('')
  const [trafficRulePolicy, setTrafficRulePolicy] = useState('')
  const [trafficRules, setTrafficRules] = useState<TrafficRuleItem[]>([])
  const [desktopUpdate, setDesktopUpdate] =
    useState<DesktopVersionResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [delayTesting, setDelayTesting] = useState(false)
  const [delaySortTick, setDelaySortTick] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const trafficTotalsRef = useRef({ upload: 0, download: 0 })
  const lastReportedTrafficRef = useRef({ upload: 0, download: 0 })

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

  const selectedNode = useMemo(() => {
    if (!primaryGroup) return ''
    const current = primaryGroup.now || ''
    if (current && nodes.some((node) => node.name === current)) return current
    return nodes[0]?.name || ''
  }, [nodes, primaryGroup])
  const mode = (clashConfig?.mode || 'rule').toLowerCase()
  const tunOn = verge?.enable_tun_mode || false
  const proxyStateMismatch = systemProxyConfigOn && !systemProxyOn
  const running = tunOn || systemProxyOn
  const systemProxyChip: {
    label: string
    color: 'success' | 'warning' | 'default'
    variant: 'filled' | 'outlined'
  } = tunOn
    ? { label: 'TUN 已开', color: 'success', variant: 'filled' }
    : systemProxyOn
      ? { label: '系统代理已开', color: 'success', variant: 'filled' }
      : proxyStateMismatch
        ? { label: '系统代理异常', color: 'warning', variant: 'filled' }
        : { label: '系统代理关闭', color: 'default', variant: 'outlined' }
  const activeProfileName = current?.name || profiles?.current || '未导入订阅'
  const currentCode = savedCode
  const isSwitchingCode = Boolean(
    savedCode && code.trim() && code.trim() !== savedCode,
  )
  const codeExpired = Boolean(expiresAt && nowMs > parseExpireTime(expiresAt))
  const allowLanOn = clashConfig?.allowLan ?? false
  const dnsOverwriteOn = verge?.enable_dns_settings ?? false
  const proxyGuardOn = verge?.enable_proxy_guard ?? true
  const powerHint = running ? '已启动，点击停止' : '还没有启动，点击启动'
  const rulesProfileUid = current?.option?.rules || ''
  const rulePolicies = useMemo(() => {
    const values = [
      primaryGroup?.name,
      selectedNode,
      ...nodes.map((node) => node.name),
      'DIRECT',
      'REJECT',
    ].filter((value): value is string => Boolean(value))
    return Array.from(new Set(values))
  }, [nodes, primaryGroup?.name, selectedNode])
  const verifyCode = async (input: string): Promise<ValidVerifyResponse> => {
    const params = new URLSearchParams({
      import: '1',
      client_id: getClientId(),
    })
    const response = await tauriFetch(
      `${SUBSCRIPTION_BASE_URL}/api/verify/${encodeURIComponent(input)}?${params.toString()}`,
      {
        method: 'GET',
        connectTimeout: 8000,
        headers: {
          'User-Agent': CLIENT_UA,
          'X-Client-Id': getClientId(),
          'X-Client-Type': 'shenxianyun-windows',
        },
      },
    )
    const data = (await response.json()) as VerifyResponse
    if (!response.ok || !data.ok || !data.subscription_url) {
      throw new Error(data.message || '提取码验证失败')
    }
    return { ...data, subscription_url: data.subscription_url }
  }

  const updateState = useCallback(
    async (input: string): Promise<UpdateStateResponse> => {
      const params = new URLSearchParams({
        client_id: getClientId(),
      })
      const response = await tauriFetch(
        `${SUBSCRIPTION_BASE_URL}/api/update-state/${encodeURIComponent(input)}?${params.toString()}`,
        {
          method: 'GET',
          connectTimeout: 8000,
          headers: {
            'User-Agent': CLIENT_UA,
            'X-Client-Id': getClientId(),
            'X-Client-Type': 'shenxianyun-windows',
          },
        },
      )
      const data = (await response.json()) as UpdateStateResponse
      if (!response.ok || !data.ok) {
        throw new AccessCodeStateError(
          data.message || '提取码已失效或过期',
          true,
        )
      }
      return data
    },
    [],
  )

  const checkDesktopUpdate = useCallback(async () => {
    const response = await tauriFetch(
      `${SUBSCRIPTION_BASE_URL}/api/desktop-version?platform=${encodeURIComponent(DESKTOP_PLATFORM)}`,
      {
        method: 'GET',
        connectTimeout: 8000,
        headers: {
          'User-Agent': CLIENT_UA,
          'X-Client-Id': getClientId(),
          'X-Client-Type': 'shenxianyun-windows',
        },
      },
    )
    const data = (await response.json()) as DesktopVersionResponse
    const latestVersion = data.latest_version?.trim() || ''
    const downloadUrl = data.download_url?.trim() || ''
    const hasDownload =
      Boolean(downloadUrl) ||
      (DESKTOP_PLATFORM === 'linux' &&
        Boolean(data.linux_deb_url?.trim() || data.linux_rpm_url?.trim()))
    if (
      response.ok &&
      data.ok &&
      latestVersion &&
      hasDownload &&
      compareVersion(latestVersion, DESKTOP_VERSION) > 0
    ) {
      setDesktopUpdate({
        ...data,
        latest_version: latestVersion,
        download_url: downloadUrl,
        linux_deb_url: data.linux_deb_url?.trim() || '',
        linux_rpm_url: data.linux_rpm_url?.trim() || '',
      })
    }
  }, [])

  const updateCurrentProfileKeepingRules = useCallback(async () => {
    const profileUid = current?.uid
    if (!profileUid) return

    const ruleSnapshot = await readRuleSnapshot(profileUid)
    await updateProfile(profileUid, { with_proxy: true })
    await restoreRuleSnapshot(profileUid, ruleSnapshot)
  }, [current?.uid])

  const sendClientPresence = useCallback(
    async (online: boolean) => {
      const value = savedCode
      if (!value) return
      const endpoint = online ? 'heartbeat' : 'offline'
      const params = new URLSearchParams({
        client_id: getClientId(),
        platform: 'Windows电脑',
        app_name: '神仙云桌面端',
        app_version: '2.4.9',
        device_name: navigator.userAgent,
      })
      await tauriFetch(
        `${SUBSCRIPTION_BASE_URL}/api/client/${endpoint}/${encodeURIComponent(value)}?${params.toString()}`,
        {
          method: 'GET',
          connectTimeout: 5000,
          headers: {
            'User-Agent': CLIENT_UA,
            'X-Client-Id': getClientId(),
            'X-Client-Type': 'shenxianyun-windows',
          },
        },
      ).catch(() => undefined)
    },
    [savedCode],
  )

  const reportClientTraffic = useCallback(async () => {
    const value = savedCode
    if (!value || !running) return

    const current = trafficTotalsRef.current
    const previous = lastReportedTrafficRef.current
    if (
      current.upload < previous.upload ||
      current.download < previous.download
    ) {
      lastReportedTrafficRef.current = current
      return
    }

    const uploadDelta = current.upload - previous.upload
    const downloadDelta = current.download - previous.download
    if (uploadDelta <= 0 && downloadDelta <= 0) return
    if (
      uploadDelta > MAX_TRAFFIC_REPORT_DELTA ||
      downloadDelta > MAX_TRAFFIC_REPORT_DELTA
    ) {
      lastReportedTrafficRef.current = current
      return
    }

    await tauriFetch(
      `${SUBSCRIPTION_BASE_URL}/api/client/traffic/${encodeURIComponent(value)}`,
      {
        method: 'POST',
        connectTimeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': CLIENT_UA,
          'X-Client-Id': getClientId(),
          'X-Client-Type': 'shenxianyun-windows',
        },
        body: JSON.stringify({
          client_id: getClientId(),
          platform: 'Windows电脑',
          app_name: '神仙云桌面端',
          app_version: '2.4.9',
          device_name: navigator.userAgent,
          upload_bytes: uploadDelta,
          download_bytes: downloadDelta,
        }),
      },
    )
      .then(() => {
        lastReportedTrafficRef.current = current
      })
      .catch(() => undefined)
  }, [running, savedCode])

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

        await importProfile(data.subscription_url, {
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
        localStorage.setItem(CODE_EXPIRES_STORAGE_KEY, data.expires_at || '')
        localStorage.setItem(
          CODE_UPDATE_VERSION_STORAGE_KEY,
          String(data.update_version || 0),
        )
        setSavedCode(value)
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
      setCode('')
      setCodeDialogOpen(false)
      setStatus(
        `${isSwitchingCode ? '提取码已切换' : '订阅已导入'}${
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
    checkDesktopUpdate().catch(() => undefined)
  }, [checkDesktopUpdate])

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
    trafficTotalsRef.current = {
      upload: connectionResponse.data?.uploadTotal ?? 0,
      download: connectionResponse.data?.downloadTotal ?? 0,
    }
  }, [
    connectionResponse.data?.downloadTotal,
    connectionResponse.data?.uploadTotal,
  ])

  useEffect(() => {
    if (!running || !savedCode) {
      lastReportedTrafficRef.current = trafficTotalsRef.current
      return
    }

    const timer = window.setInterval(() => {
      reportClientTraffic().catch(() => undefined)
    }, TRAFFIC_REPORT_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      reportClientTraffic().catch(() => undefined)
    }
  }, [reportClientTraffic, running, savedCode])

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
          await updateCurrentProfileKeepingRules()
          localStorage.setItem(
            CODE_UPDATE_VERSION_STORAGE_KEY,
            String(remoteVersion),
          )
          await mutateProfiles()
          await refreshAll()
          setStatus('订阅已更新')
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
          setStatus('')
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
    updateCurrentProfileKeepingRules,
    updateState,
  ])

  const updateCurrentSubscription = useLockFn(async () => {
    if (!current?.uid) {
      setStatus('还没有可更新的订阅')
      return
    }
    setBusy(true)
    setStatus('正在更新订阅...')
    try {
      await updateCurrentProfileKeepingRules()
      await mutateProfiles()
      await refreshAll()
      setStatus('订阅已更新，同提取码规则已保留')
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
        setStatus('请先导入订阅')
        setCodeDialogOpen(true)
        return
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
        setStatus('')
      }

      setStatus('正在启动...')
      if (proxyStateMismatch) {
        await toggleSystemProxy(false).catch(() => {})
      }
      await startCore().catch(() => restartCore())
      await mutateSystemState()

      if (tunOn) await patchVerge({ enable_tun_mode: false })
      const useTunForPowerStart =
        localStorage.getItem('SHENXIANYUN_POWER_START_TUN') === '1'
      if (useTunForPowerStart && isTunModeAvailable) {
        await patchVerge({ enable_tun_mode: true })
        if (systemProxyOn || systemProxyConfigOn) await toggleSystemProxy(false)
        setStatus('已启动 TUN 模式')
      } else {
        await toggleSystemProxy(true)
        await invalidateProxyState()
        setStatus('已启动系统代理')
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

  const loadTrafficRules = useCallback(async () => {
    if (!rulesProfileUid) {
      setTrafficRules([])
      return
    }

    try {
      const content = await readProfileFile(rulesProfileUid)
      const data = yaml.load(content) as {
        prepend?: unknown
        append?: unknown
      } | null
      const prepend = Array.isArray(data?.prepend) ? data.prepend : []
      const append = Array.isArray(data?.append) ? data.append : []
      setTrafficRules(
        [...prepend, ...append]
          .map(parseTrafficRule)
          .filter((item): item is TrafficRuleItem => Boolean(item)),
      )
    } catch {
      setTrafficRules([])
    }
  }, [rulesProfileUid])

  const saveTrafficRuleAppend = async (nextAppendRule: string) => {
    if (!rulesProfileUid) throw new Error('当前订阅没有可编辑的规则文件')

    const content = await readProfileFile(rulesProfileUid)
    const data = (yaml.load(content) as Record<string, unknown> | null) || {}
    const next = parseTrafficRule(nextAppendRule)
    const removeSameDomain = (rules: unknown[]) =>
      rules.filter((rule) => {
        const parsed = parseTrafficRule(rule)
        return !parsed || !next || parsed.domain !== next.domain
      })

    if (Array.isArray(data.prepend)) {
      data.prepend = removeSameDomain(data.prepend)
    }

    const append = Array.isArray(data.append) ? data.append : []
    const withoutSameDomain = removeSameDomain(append)

    data.append = [...withoutSameDomain, nextAppendRule]
    await saveProfileFile(rulesProfileUid, yaml.dump(data, { lineWidth: -1 }))
  }

  const addTrafficRule = useLockFn(async () => {
    const domain = normalizeRuleDomain(trafficRuleInput)
    const policy = trafficRulePolicy || selectedNode || primaryGroup?.name || ''

    if (!domain) {
      setStatus('请输入要分流的网址或域名')
      return
    }
    if (!policy) {
      setStatus('请选择这个网址要走的节点')
      return
    }

    setBusy(true)
    try {
      await saveTrafficRuleAppend(`DOMAIN-SUFFIX,${domain},${policy}`)
      setTrafficRuleInput('')
      setTrafficRulePolicy(policy)
      await loadTrafficRules()
      await refreshAll()
      setStatus(`已添加规则：${domain} 走 ${policy}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const deleteTrafficRule = useLockFn(async (target: TrafficRuleItem) => {
    if (!rulesProfileUid) return

    setBusy(true)
    try {
      const content = await readProfileFile(rulesProfileUid)
      const data = (yaml.load(content) as Record<string, unknown> | null) || {}
      for (const key of ['prepend', 'append']) {
        if (Array.isArray(data[key])) {
          data[key] = data[key].filter((rule) => rule !== target.raw)
        }
      }
      await saveProfileFile(rulesProfileUid, yaml.dump(data, { lineWidth: -1 }))
      await loadTrafficRules()
      await refreshAll()
      setStatus(`已删除规则：${target.domain}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  useEffect(() => {
    if (!trafficRuleOpen) return
    loadTrafficRules()
  }, [loadTrafficRules, trafficRuleOpen])

  const toggleAllowLan = useLockFn(async (checked: boolean) => {
    setBusy(true)
    try {
      await patchClash({ 'allow-lan': checked })
      await refreshClashConfig()
      setStatus(checked ? '局域网连接已开启' : '局域网连接已关闭')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const toggleDnsOverwrite = useLockFn(async (checked: boolean) => {
    setBusy(true)
    try {
      await patchVerge({ enable_dns_settings: checked })
      await invoke('apply_dns_config', { apply: checked })
      await refreshClashConfig()
      setStatus(checked ? 'DNS 覆写已开启' : 'DNS 覆写已关闭')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const toggleProxyGuard = useLockFn(async (checked: boolean) => {
    setBusy(true)
    try {
      await patchVerge({ enable_proxy_guard: checked })
      setStatus(checked ? '系统代理守护已开启' : '系统代理守护已关闭')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  return (
    <BasePage
      full
      contentStyle={{
        height: '100%',
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 1,
          py: 0.75,
          position: 'relative',
          background:
            'radial-gradient(circle at 16% 10%, rgba(96,190,255,.24), transparent 34%), radial-gradient(circle at 86% 16%, rgba(255,128,170,.18), transparent 32%), linear-gradient(135deg, #eef6ff 0%, #f7f8fb 52%, #fff3f7 100%)',
        }}
      >
        <Box
          data-tauri-drag-region="true"
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 88,
            height: 34,
            zIndex: 12,
          }}
        />
        <Stack
          spacing={1}
          sx={{
            width: 'min(735px, 100%)',
            maxHeight: '100%',
            minHeight: 0,
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{
              alignItems: { xs: 'center', sm: 'flex-end' },
              justifyContent: 'space-between',
            }}
          >
            <Box>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 900,
                  letterSpacing: 0,
                  color: '#172033',
                  textShadow: '0 10px 30px rgba(28,141,255,.12)',
                }}
              >
                神仙云
              </Typography>
              <Typography sx={{ color: 'rgba(36,46,66,.68)', fontSize: 12 }}>
                提取码订阅 · 节点选择 · 一键连接
              </Typography>
            </Box>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <Chip
                size="small"
                icon={<BoltRounded />}
                color={running ? 'success' : 'default'}
                label={running ? '在线' : '离线'}
              />
              <Chip
                size="small"
                icon={<LanguageRounded />}
                label={mode === 'global' ? '全局' : '规则'}
              />
              <Chip
                size="small"
                icon={<LanRounded />}
                color={systemProxyChip.color}
                variant={systemProxyChip.variant}
                label={systemProxyChip.label}
              />
            </Stack>
          </Stack>

          <Paper
            elevation={0}
            sx={{
              borderRadius: '22px',
              p: 1.15,
              border: '1px solid rgba(70,100,145,.16)',
              bgcolor: 'rgba(255,255,255,.76)',
              boxShadow:
                '0 22px 58px rgba(42,65,105,.16), 0 0 0 1px rgba(255,255,255,.55), inset 0 1px 0 rgba(255,255,255,.9)',
              backdropFilter: 'blur(20px)',
              overflow: 'hidden',
              position: 'relative',
              '&:before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                background:
                  'linear-gradient(120deg, rgba(28,141,255,.09), transparent 44%, rgba(255,128,170,.08))',
                opacity: 1,
              },
            }}
          >
            <Stack
              direction="row"
              spacing={1.15}
              sx={{ position: 'relative', alignItems: 'stretch' }}
            >
              <Stack
                spacing={1.25}
                sx={{
                  width: 180,
                  alignItems: 'center',
                  justifyContent: 'center',
                  py: 0,
                }}
              >
                <Box
                  sx={{
                    width: 146,
                    height: 146,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: running
                      ? 'radial-gradient(circle, rgba(41,190,160,.22), rgba(41,190,160,.08) 62%, transparent 63%)'
                      : 'radial-gradient(circle, rgba(255,116,138,.22), rgba(255,116,138,.08) 62%, transparent 63%)',
                    boxShadow: running
                      ? '0 0 38px rgba(41,190,160,.16)'
                      : '0 0 38px rgba(255,116,138,.16)',
                  }}
                >
                  <Button
                    disabled={busy}
                    onClick={togglePower}
                    sx={{
                      width: 116,
                      height: 116,
                      borderRadius: '50%',
                      fontSize: 20,
                      fontWeight: 900,
                      color: 'white',
                      background: running
                        ? 'linear-gradient(135deg, #28c99c, #2aa7ff)'
                        : 'linear-gradient(135deg, #ff6f8f, #ff9b66)',
                      boxShadow: running
                        ? '0 18px 34px rgba(42,167,255,.24)'
                        : '0 18px 34px rgba(255,111,143,.24)',
                      '&:hover': {
                        background: running
                          ? 'linear-gradient(135deg, #24b88f, #2198ed)'
                          : 'linear-gradient(135deg, #f26182, #f18e5c)',
                      },
                    }}
                  >
                    <Stack spacing={0.6} sx={{ alignItems: 'center' }}>
                      <PowerSettingsNewRounded sx={{ fontSize: 34 }} />
                      <span>{running ? '停止' : '启动'}</span>
                    </Stack>
                  </Button>
                </Box>

                <Stack
                  spacing={0.7}
                  sx={{ alignItems: 'center', width: '100%' }}
                >
                  <Chip
                    size="small"
                    color={running ? 'success' : 'default'}
                    variant={running ? 'filled' : 'outlined'}
                    label={powerHint}
                    sx={{
                      fontWeight: 800,
                      bgcolor: running ? undefined : 'rgba(24,32,51,.04)',
                    }}
                  />
                  <Typography
                    sx={{ fontSize: 13, color: 'rgba(36,46,66,.66)' }}
                  >
                    {savedCode ? '提取码已绑定' : activeProfileName}
                  </Typography>
                  {expiresAt && (
                    <Chip
                      size="small"
                      color={codeExpired ? 'error' : 'default'}
                      variant="outlined"
                      label={codeExpired ? '提取码已过期' : `到期 ${expiresAt}`}
                    />
                  )}
                </Stack>
              </Stack>

              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  borderRadius: '16px',
                  p: 1,
                  border: '1px solid rgba(70,100,145,.14)',
                  bgcolor: 'rgba(255,255,255,.58)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.72)',
                }}
              >
                <Stack
                  spacing={1}
                  sx={{
                    '& .MuiButton-outlined': outlineButtonSx,
                    '& .MuiButton-contained.Mui-disabled': {
                      color: 'rgba(255,255,255,.56)',
                    },
                  }}
                >
                  <ToggleButtonGroup
                    exclusive
                    value={mode}
                    onChange={changeMode}
                    disabled={busy}
                    fullWidth
                    size="small"
                    sx={{
                      '& .MuiToggleButton-root': {
                        py: 0.75,
                        minHeight: 34,
                        borderColor: 'rgba(45,65,105,.16)',
                        fontWeight: 700,
                        color: 'rgba(36,46,66,.72)',
                        '&.Mui-selected': {
                          color: '#fff',
                          bgcolor: '#1c8dff',
                        },
                        '&.Mui-selected:hover': {
                          bgcolor: '#167ce3',
                        },
                      },
                    }}
                  >
                    <ToggleButton value="rule">规则模式</ToggleButton>
                    <ToggleButton value="global">全局模式</ToggleButton>
                  </ToggleButtonGroup>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <FormControl fullWidth size="small">
                      <InputLabel>选择节点</InputLabel>
                      <Select
                        sx={fieldSx}
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
                      sx={{ minWidth: 104 }}
                    >
                      {delayTesting ? '测试中' : '测延迟'}
                    </Button>
                  </Stack>

                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ flexWrap: 'wrap' }}
                  >
                    <Button
                      variant="contained"
                      startIcon={<KeyRounded />}
                      disabled={busy}
                      onClick={() => {
                        setCode('')
                        setCodeDialogOpen(true)
                      }}
                      sx={{
                        flex: '1 1 132px',
                        bgcolor: '#1c8dff',
                        color: '#fff',
                        fontWeight: 800,
                        '&:hover': { bgcolor: '#167ce3' },
                      }}
                    >
                      {savedCode ? '切换提取码' : '导入订阅'}
                    </Button>
                    {!isTunModeAvailable && (
                      <Button
                        variant="outlined"
                        startIcon={<BuildRounded />}
                        disabled={busy}
                        sx={{ flex: '1 1 110px' }}
                        onClick={async () => {
                          setBusy(true)
                          setStatus('正在安装 TUN 服务...')
                          try {
                            await installService()
                            await restartCore()
                            await mutateSystemState()
                            setStatus('TUN 服务已安装')
                          } catch (error) {
                            setStatus(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            )
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        安装 TUN
                      </Button>
                    )}
                    {tunOn && (
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={<LanRounded />}
                        disabled={busy}
                        sx={{ flex: '1 1 110px' }}
                        onClick={async () => {
                          setBusy(true)
                          setStatus('正在关闭 TUN...')
                          try {
                            await patchVerge({ enable_tun_mode: false })
                            await mutateSystemState()
                            await refreshAll()
                            setStatus('TUN 已关闭')
                          } catch (error) {
                            setStatus(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            )
                          } finally {
                            setBusy(false)
                          }
                        }}
                      >
                        关闭 TUN
                      </Button>
                    )}
                    <Button
                      variant="outlined"
                      startIcon={<CloudSyncRounded />}
                      disabled={busy}
                      onClick={updateCurrentSubscription}
                      sx={{ flex: '1 1 116px' }}
                    >
                      更新订阅
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<SettingsRounded />}
                      disabled={busy}
                      onClick={() => setAdvancedOpen(true)}
                      sx={{ flex: '1 1 132px' }}
                    >
                      高级用户设置
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<ShoppingCartRounded />}
                      sx={{ flex: '1 1 96px' }}
                      onClick={() => {
                        const url = savedCode
                          ? `${SUBSCRIPTION_BASE_URL}/pay?action=renew&code=${encodeURIComponent(savedCode)}`
                          : `${SUBSCRIPTION_BASE_URL}/pay?action=new`
                        openWebUrl(url)
                      }}
                    >
                      {savedCode ? '续费' : '新购'}
                    </Button>
                  </Stack>

                  {status && (
                    <Alert
                      severity={
                        status.includes('失败') ||
                        status.includes('错误') ||
                        status.includes('过期')
                          ? 'error'
                          : 'info'
                      }
                      sx={{ py: 0.35 }}
                    >
                      {status}
                    </Alert>
                  )}
                </Stack>
              </Box>
            </Stack>
          </Paper>
          <Dialog
            open={advancedOpen}
            onClose={() => setAdvancedOpen(false)}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: {
                  borderRadius: '20px',
                  border: '1px solid rgba(70,100,145,.16)',
                  background:
                    'linear-gradient(145deg, rgba(255,255,255,.98), rgba(244,249,255,.96))',
                },
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              高级用户设置
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1.25}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.25,
                    borderRadius: '14px',
                    border: '1px solid rgba(45,65,105,.12)',
                    bgcolor: 'rgba(255,255,255,.72)',
                  }}
                >
                  <Stack spacing={1}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center' }}
                    >
                      <RuleRounded sx={{ color: '#1c8dff' }} />
                      <Box sx={{ flex: 1 }}>
                        <Typography sx={{ fontWeight: 850 }}>
                          规则设置
                        </Typography>
                        <Typography
                          sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                        >
                          规则模式适合日常使用，全局模式会全部走代理。
                        </Typography>
                      </Box>
                    </Stack>
                    <ToggleButtonGroup
                      exclusive
                      value={mode}
                      onChange={changeMode}
                      disabled={busy}
                      fullWidth
                      size="small"
                      sx={{
                        '& .MuiToggleButton-root': {
                          py: 0.7,
                          fontWeight: 800,
                          borderColor: 'rgba(45,65,105,.16)',
                          '&.Mui-selected': {
                            color: '#fff',
                            bgcolor: '#1c8dff',
                          },
                          '&.Mui-selected:hover': {
                            bgcolor: '#167ce3',
                          },
                        },
                      }}
                    >
                      <ToggleButton value="rule">规则模式</ToggleButton>
                      <ToggleButton value="global">全局模式</ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                </Paper>

                <Paper
                  elevation={0}
                  sx={{
                    p: 1.25,
                    borderRadius: '14px',
                    border: '1px solid rgba(45,65,105,.12)',
                    bgcolor: 'rgba(255,255,255,.72)',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1.1}
                    sx={{ alignItems: 'center' }}
                  >
                    <RuleRounded sx={{ color: '#18a679' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850 }}>
                        流量规则编辑
                      </Typography>
                      <Typography
                        sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                      >
                        设置某个网址或域名固定走指定节点。
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!rulesProfileUid}
                      onClick={() => {
                        setTrafficRulePolicy(
                          trafficRulePolicy ||
                            selectedNode ||
                            primaryGroup?.name ||
                            '',
                        )
                        setTrafficRuleOpen(true)
                      }}
                    >
                      编辑
                    </Button>
                  </Stack>
                </Paper>

                {[
                  {
                    icon: <DnsRounded sx={{ color: '#7c5cff' }} />,
                    title: 'DNS 覆写',
                    desc: '需要自定义 DNS 时再开启，默认保持关闭更稳。',
                    checked: dnsOverwriteOn,
                    onChange: toggleDnsOverwrite,
                  },
                  {
                    icon: <LanRounded sx={{ color: '#12a87f' }} />,
                    title: '局域网连接',
                    desc: '允许同一局域网设备连接本机代理。',
                    checked: allowLanOn,
                    onChange: toggleAllowLan,
                  },
                  {
                    icon: <SettingsRounded sx={{ color: '#ff8a3d' }} />,
                    title: '系统代理守护',
                    desc: '系统代理被系统或浏览器改掉时自动恢复。',
                    checked: proxyGuardOn,
                    onChange: toggleProxyGuard,
                  },
                ].map((item) => (
                  <Paper
                    key={item.title}
                    elevation={0}
                    sx={{
                      p: 1.25,
                      borderRadius: '14px',
                      border: '1px solid rgba(45,65,105,.12)',
                      bgcolor: 'rgba(255,255,255,.72)',
                    }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.1}
                      sx={{ alignItems: 'center' }}
                    >
                      {item.icon}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 850 }}>
                          {item.title}
                        </Typography>
                        <Typography
                          sx={{ fontSize: 12, color: 'rgba(36,46,66,.62)' }}
                        >
                          {item.desc}
                        </Typography>
                      </Box>
                      <Switch
                        edge="end"
                        disabled={busy}
                        checked={item.checked}
                        onChange={(_, checked) => item.onChange(checked)}
                      />
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setAdvancedOpen(false)}>完成</Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={trafficRuleOpen}
            onClose={() => setTrafficRuleOpen(false)}
            fullWidth
            maxWidth="sm"
            slotProps={{
              paper: {
                sx: {
                  borderRadius: '20px',
                  border: '1px solid rgba(70,100,145,.16)',
                  background:
                    'linear-gradient(145deg, rgba(255,255,255,.98), rgba(244,249,255,.96))',
                },
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              流量规则编辑
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1.25}>
                <Typography sx={{ fontSize: 13, color: 'rgba(36,46,66,.66)' }}>
                  输入网址或域名，选择要走的节点。比如 google.com
                  走日本节点，baidu.com 走 DIRECT。
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    fullWidth
                    size="small"
                    sx={fieldSx}
                    label="网址或域名"
                    placeholder="例如 google.com 或 https://google.com"
                    value={trafficRuleInput}
                    disabled={busy}
                    onChange={(event) =>
                      setTrafficRuleInput(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        trafficRuleInput.trim() &&
                        !busy
                      ) {
                        addTrafficRule()
                      }
                    }}
                  />
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>走哪个节点</InputLabel>
                    <Select
                      sx={fieldSx}
                      label="走哪个节点"
                      value={trafficRulePolicy}
                      disabled={busy || rulePolicies.length === 0}
                      onChange={(event) =>
                        setTrafficRulePolicy(event.target.value)
                      }
                    >
                      {rulePolicies.map((policy) => (
                        <MenuItem key={policy} value={policy}>
                          {policy}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    startIcon={<AddRounded />}
                    disabled={
                      busy || !trafficRuleInput.trim() || !trafficRulePolicy
                    }
                    onClick={addTrafficRule}
                    sx={{
                      minWidth: 96,
                      bgcolor: '#1c8dff',
                      fontWeight: 800,
                      '&:hover': { bgcolor: '#167ce3' },
                    }}
                  >
                    添加
                  </Button>
                </Stack>

                <Stack spacing={0.8}>
                  {trafficRules.length === 0 ? (
                    <Alert severity="info" sx={{ py: 0.35 }}>
                      还没有自定义流量规则。
                    </Alert>
                  ) : (
                    trafficRules.map((rule) => (
                      <Paper
                        key={`${rule.domain}-${rule.policy}-${rule.raw}`}
                        elevation={0}
                        sx={{
                          p: 1,
                          borderRadius: '12px',
                          border: '1px solid rgba(45,65,105,.12)',
                          bgcolor: 'rgba(255,255,255,.78)',
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 850 }}>
                              {rule.domain}
                            </Typography>
                            <Typography
                              sx={{
                                fontSize: 12,
                                color: 'rgba(36,46,66,.62)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              走 {rule.policy}
                            </Typography>
                          </Box>
                          <IconButton
                            size="small"
                            disabled={busy}
                            onClick={() => deleteTrafficRule(rule)}
                          >
                            <DeleteRounded fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Paper>
                    ))
                  )}
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setTrafficRuleOpen(false)}>完成</Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={Boolean(desktopUpdate)}
            onClose={() => setDesktopUpdate(null)}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: {
                  borderRadius: '18px',
                  border: '1px solid rgba(70,100,145,.16)',
                  background:
                    'linear-gradient(145deg, rgba(255,255,255,.98), rgba(244,249,255,.96))',
                },
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              发现新版本
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Stack spacing={1.2}>
                <Typography sx={{ color: 'rgba(36,46,66,.78)' }}>
                  当前版本 {DESKTOP_VERSION}，最新版本{' '}
                  {desktopUpdate?.latest_version}
                </Typography>
                {desktopUpdate?.notes ? (
                  <Alert severity="info" sx={{ whiteSpace: 'pre-wrap' }}>
                    {desktopUpdate.notes}
                  </Alert>
                ) : null}
                {DESKTOP_PLATFORM === 'linux' ? (
                  <Alert severity="warning">
                    Linux 版本不会自动下载或安装，请根据你的发行版选择 DEB 或
                    RPM 安装包手动更新。
                  </Alert>
                ) : null}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setDesktopUpdate(null)}>稍后</Button>
              {DESKTOP_PLATFORM === 'linux' && desktopUpdate?.linux_deb_url ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    const url = desktopUpdate?.linux_deb_url
                    setDesktopUpdate(null)
                    if (url) openWebUrl(url).catch(() => undefined)
                  }}
                  sx={{ minWidth: 96, fontWeight: 800 }}
                >
                  下载 DEB
                </Button>
              ) : null}
              {DESKTOP_PLATFORM === 'linux' && desktopUpdate?.linux_rpm_url ? (
                <Button
                  variant="outlined"
                  onClick={() => {
                    const url = desktopUpdate?.linux_rpm_url
                    setDesktopUpdate(null)
                    if (url) openWebUrl(url).catch(() => undefined)
                  }}
                  sx={{ minWidth: 96, fontWeight: 800 }}
                >
                  下载 RPM
                </Button>
              ) : null}
              <Button
                variant="contained"
                onClick={() => {
                  const url = desktopUpdate?.download_url
                  setDesktopUpdate(null)
                  if (url) openWebUrl(url).catch(() => undefined)
                }}
                sx={{
                  minWidth: 112,
                  bgcolor: '#1c8dff',
                  fontWeight: 800,
                  '&:hover': { bgcolor: '#167ce3' },
                }}
              >
                {DESKTOP_PLATFORM === 'linux' ? '默认下载' : '前往下载'}
              </Button>
            </DialogActions>
          </Dialog>
          <Dialog
            open={codeDialogOpen}
            onClose={() => {
              if (busy) return
              setCode('')
              setCodeDialogOpen(false)
            }}
            fullWidth
            maxWidth="xs"
            slotProps={{
              paper: {
                sx: {
                  borderRadius: '18px',
                  border: '1px solid rgba(70,100,145,.16)',
                  background:
                    'linear-gradient(145deg, rgba(255,255,255,.98), rgba(244,249,255,.96))',
                },
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900, pb: 0.5 }}>
              {savedCode ? '切换提取码' : '导入订阅'}
            </DialogTitle>
            <DialogContent sx={{ pt: 1.5 }}>
              <Typography
                sx={{
                  mb: 1.5,
                  fontSize: 13,
                  color: 'rgba(36,46,66,.66)',
                }}
              >
                {savedCode
                  ? '输入新的提取码后会替换当前订阅。'
                  : '输入后台生成的提取码，客户端会自动获取订阅。'}
              </Typography>
              <TextField
                autoFocus
                fullWidth
                size="small"
                sx={fieldSx}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && code.trim() && !busy) {
                    importByCode()
                  }
                }}
                label="提取码"
                placeholder="请输入提取码"
                disabled={busy}
                slotProps={{
                  input: {
                    sx: fieldSx,
                    startAdornment: (
                      <KeyRounded
                        sx={{ mr: 1, color: 'rgba(28,141,255,.78)' }}
                      />
                    ),
                  },
                  inputLabel: {
                    sx: {
                      color: 'rgba(36,46,66,.66)',
                      '&.Mui-focused': { color: '#1c8dff' },
                    },
                  },
                }}
              />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button
                disabled={busy}
                onClick={() => {
                  setCode('')
                  setCodeDialogOpen(false)
                }}
              >
                取消
              </Button>
              <Button
                variant="contained"
                disabled={busy || !code.trim()}
                onClick={importByCode}
                sx={{
                  minWidth: 104,
                  bgcolor: '#1c8dff',
                  fontWeight: 800,
                  '&:hover': { bgcolor: '#167ce3' },
                }}
              >
                {busy ? '处理中' : savedCode ? '确认切换' : '确认导入'}
              </Button>
            </DialogActions>
          </Dialog>
        </Stack>
      </Box>
    </BasePage>
  )
}

export default HomePage
